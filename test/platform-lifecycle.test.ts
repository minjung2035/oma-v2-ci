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
import { PlatformError } from "@oma/protocol/host-errors";
import type { SessionLauncher } from "#oma-test/app/platform/guest/host";
import { LocalDriver, listenSilently } from "./fixtures/local-guest.js";
import { GuestLink } from "#oma-test/app/platform/host/guest-link";
import { VmLifecycle, type VmState } from "#oma-test/app/platform/host/lifecycle";
import { HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES } from "@oma/protocol/host-guest";

const INSTANCE = randomUUID();

async function world(t: import("node:test").TestContext,
  overrides: { restarts?: { max: number; windowMs: number; backoffMs: number }; record?: (event: string) => void; ready?: () => void } = {}) {
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
    ...(overrides.ready === undefined ? {} : { ready: overrides.ready }),
    record: event => { overrides.record?.(event); records.push(event); },
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

test("NB-26: a wake whose clock step cannot be made is a crash, not silence -- the power is pulled and it is recorded", async t => {
  const { lifecycle, driver, records, until } = await world(t);
  await lifecycle.start();
  // The wedge outlasts the wake's own retries but not the restart's boot.
  driver.failTimeSets = 3;
  await lifecycle.woke();
  await until("ready", "the crashed boot was ended and restarted");
  assert.equal(driver.forced, 1, "the boot whose clock could not be stepped was ended, not trusted");
  assert.equal(driver.starts, 2);
  assert.deepEqual(records, ["crashed"]);
});

test("NB-26: a clock that never steps again fails every restart the same as it failed the wake", async t => {
  const { lifecycle, driver, records, until } = await world(t, { restarts: { max: 2, windowMs: 60_000, backoffMs: 10 } });
  await lifecycle.start();
  driver.failTimeSets = 1_000;
  await lifecycle.woke();
  await until("failed", "every restart met the same wedge and the engine is marked for repair");
  assert.equal(driver.forced, 3, "the wedged boot and each of its restarts was ended by force");
  assert.deepEqual(records, ["crashed", "crashed", "crashed", "failed"]);
});

test("NB-23: a record write that fails is told to the stop's caller and never leaves the VM half-stopped", async t => {
  const clean = await world(t, { record: event => { if (event === "clean") throw new Error("record unwritable"); } });
  await clean.lifecycle.start();
  await assert.rejects(clean.lifecycle.stop(), /record unwritable/);
  assert.equal(clean.lifecycle.state, "stopped", "the power went; the bookkeeping failure was told");
  assert.deepEqual(clean.records, []);

  const forced = await world(t, { record: event => { if (event === "forced") throw new Error("record unwritable"); } });
  await forced.lifecycle.start();
  forced.driver.ignorePowerOff = true;
  await assert.rejects(forced.lifecycle.stop(), /record unwritable/);
  assert.equal(forced.driver.forced, 1, "the power was pulled before the bookkeeping ran");
  assert.equal(forced.lifecycle.state, "stopped");
});

test("NB-23: a record write that fails inside a callback marks the engine for repair -- it never escapes the callback", async t => {
  const { lifecycle, driver, until } = await world(t, { record: event => { if (event === "crashed") throw new Error("record unwritable"); } });
  await lifecycle.start();
  await driver.crash();
  await until("failed", "a crash its record could not describe is repair, not a silent restart");
  await new Promise(r => setTimeout(r, 60));
  assert.equal(driver.starts, 1, "no restart hides behind the failed record");
});

test("NB-29: a stop is not kept waiting on a stopped event the helper never sends", async t => {
  const { lifecycle, driver, records } = await world(t);
  await lifecycle.start();
  driver.ignorePowerOff = true;
  t.mock.method(driver, "forceStop", async () => { driver.forced += 1; });
  await assert.rejects(lifecycle.stop(), (error: unknown) => error instanceof PlatformError && error.failure.code === "ENGINE_UNAVAILABLE");
  assert.equal(driver.forced, 1, "the power was still asked of the helper");
  assert.equal(lifecycle.state, "failed", "an end that cannot be observed is repair, not a wait forever");
  assert.deepEqual(records, ["failed"]);
});

test("DR38: failed mandatory ready persistence rejects startup and ends that VM", async t => {
  const { lifecycle, driver, states, records } = await world(t, { ready: () => { throw new Error("ready record unwritable"); } });
  await assert.rejects(lifecycle.start(), /ready record unwritable/);
  assert.equal(lifecycle.state, "failed");
  assert.equal(states.includes("ready"), false);
  assert.equal(driver.running, null);
  assert.equal(driver.forced, 1);
  assert.deepEqual(records, ["failed"]);
});

test("DR38: an optional state observer failure does not change the VM state", async t => {
  const { lifecycle, driver } = await world(t);
  lifecycle.onState(() => { throw new Error("UI observer unavailable"); });
  await lifecycle.start();
  assert.equal(lifecycle.state, "ready");
  assert.notEqual(driver.running, null);
  assert.equal(await lifecycle.stop(), "stopped");
  assert.equal(lifecycle.state, "stopped");
});
