/** macos-platform §5 (MAC-301, MAC-320, MAC-330, MAC-331, MAC-601, MAC-211):
 * the host's VM state machine over a driver that runs the real guest
 * services on this machine instead of a VM. Timers are real and short. */
import test from "node:test";
import assert from "node:assert/strict";
import { type Server } from "node:net";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PlatformError } from "../src/platform/rpc.js";
import type { SessionLauncher } from "../src/platform/guest/host.js";
import { LocalDriver, listenSilently } from "./fixtures/local-guest.js";
import { GuestLink } from "../src/platform/host/guest-link.js";
import { VmLifecycle, type VmState } from "../src/platform/host/lifecycle.js";
import { HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES } from "../src/protocol/host-guest.js";

const INSTANCE = randomUUID();

async function world(t: import("node:test").TestContext, overrides: { restarts?: { max: number; windowMs: number; backoffMs: number } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "oma-lifecycle-"));
  const societiesDir = join(dir, "data", "oma");
  mkdirSync(join(societiesDir, "demo", "state"), { recursive: true });
  // A society whose session is running: its holder is a live socket here.
  const holderPath = join(dir, "demo.sock");
  let holder: Server | null = await listenSilently(holderPath);
  const stops: string[] = [];
  const launcher: SessionLauncher = {
    socketPath: () => holderPath,
    start: async () => {},
    stop: async society => { stops.push(society); await new Promise(r => holder?.close(r)); holder = null; return "stopped"; },
  };
  const driver = new LocalDriver(dir, { dir: societiesDir, launcher }, INSTANCE);
  const link = new GuestLink(driver, { hostVersion: "1.0.0", installationId: randomUUID(), instanceId: INSTANCE, expectImage: "2026.09.1",
    protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } }, { frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 300, requestTimeoutMs: 300 });
  const records: string[] = [];
  const states: VmState[] = [];
  const reboots: string[] = [];
  link.onReboot(bootId => reboots.push(bootId));
  const lifecycle = new VmLifecycle({
    driver, link, now: () => performance.now(), wallClock: () => Date.now(),
    after: (ms, run) => { const timer = setTimeout(run, ms); timer.unref(); return { cancel: () => clearTimeout(timer) }; },
    handshakeDeadlineMs: 2000, handshakeRetryMs: 20, drainDeadlineMs: 800, healthEveryMs: 40, hungAfterMs: 250,
    restarts: overrides.restarts ?? { max: 3, windowMs: 60_000, backoffMs: 20 },
    record: event => records.push(event),
  });
  lifecycle.onState(state => states.push(state));
  t.after(async () => { await lifecycle.stop().catch(() => undefined); await driver.dispose(); await new Promise(r => holder === null ? r(null) : holder.close(r)); rmSync(dir, { recursive: true, force: true }); });
  const until = async (state: VmState, what: string): Promise<void> => {
    for (let i = 0; i < 300 && lifecycle.state !== state; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(lifecycle.state, state, what);
  };
  return { lifecycle, driver, records, states, reboots, stops, until };
}

test("MAC-301/MAC-320: a start ends ready with the guest's clock set; a stop drains the societies, then powers off", async t => {
  const { lifecycle, driver, records, states, stops } = await world(t);
  await lifecycle.start();
  assert.deepEqual(states, ["booting", "handshaking", "ready"]);
  assert.deepEqual(driver.calls, ["time.set:true"]);
  assert.equal(await lifecycle.stop(), "stopped");
  assert.deepEqual(stops, ["demo"], "the running society was stopped through its own shutdown");
  assert.deepEqual(driver.calls.filter(call => call !== "time.set:true"), ["maintenance.begin", "society.list", "society.close", "power.off"],
    "maintenance first, the societies next, the power last");
  assert.deepEqual(states.slice(3), ["draining", "stopped"]);
  assert.deepEqual(records, ["clean"]);
  assert.equal(driver.forced, 0);
});

test("MAC-320: a guest that does not power off in time is stopped by force, and that is recorded", async t => {
  const { lifecycle, driver, records, states } = await world(t);
  await lifecycle.start();
  driver.ignorePowerOff = true;
  assert.equal(await lifecycle.stop(), "forced");
  assert.equal(driver.forced, 1);
  assert.deepEqual(records, ["forced"]);
  assert.deepEqual(states.slice(3), ["draining", "forced", "stopped"]);
});

test("MAC-330/MAC-211: a guest that stops answering is judged hung only after the silence, restarted, and its new boot noticed", async t => {
  const { lifecycle, driver, records, reboots, until } = await world(t);
  await lifecycle.start();
  driver.hung = true;
  driver.running!.silence();
  await until("crashed", "hung after the silence");
  assert.equal(driver.forced, 1, "the power was pulled only once the guest was judged hung");
  await until("ready", "restarted after the back-off");
  assert.equal(driver.starts, 2);
  assert.deepEqual(records, ["crashed"]);
  assert.equal(reboots.length, 1, "a new bootId is a reboot for whatever the host held of the last one");
});

test("MAC-331: crashes past the limit leave the engine failed, waiting for repair", async t => {
  const { lifecycle, driver, records, until } = await world(t, { restarts: { max: 2, windowMs: 60_000, backoffMs: 10 } });
  await lifecycle.start();
  for (let crash = 1; crash <= 2; crash++) {
    await driver.crash();
    await until("ready", `restart ${crash}`);
  }
  await driver.crash();
  await until("failed", "no third restart within the window");
  assert.equal(driver.starts, 3);
  assert.deepEqual(records, ["crashed", "crashed", "crashed", "failed"]);
  await assert.rejects(lifecycle.start(), (error: unknown) => error instanceof PlatformError && error.failure.retry === "after-repair");
});

test("MAC-601/A7: a guest that reports another image is not spoken to and is not retried", async t => {
  const { lifecycle, driver, records } = await world(t);
  driver.image = "2026.08.9";
  await assert.rejects(lifecycle.start(), (error: unknown) => error instanceof PlatformError && error.failure.code === "ENGINE_VERSION_SKEW");
  assert.equal(lifecycle.state, "failed");
  assert.deepEqual(records, ["failed"]);
  assert.equal(driver.starts, 1);
});
