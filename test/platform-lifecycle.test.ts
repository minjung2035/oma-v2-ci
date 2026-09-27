/** macos-platform §5 (MAC-301, MAC-320, MAC-330, MAC-331, MAC-601, MAC-211):
 * the host's VM state machine over a driver that runs the real guest
 * services on this machine instead of a VM. Timers are real and short. */
import test from "node:test";
import assert from "node:assert/strict";
import { connect, createServer, type Server, type Socket } from "node:net";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PlatformError } from "../src/platform/rpc.js";
import { startGuestServer, type GuestIdentity } from "../src/platform/guest/server.js";
import { GuestControl, type GuestSystem } from "../src/platform/guest/control.js";
import { GuestHost, type SessionLauncher } from "../src/platform/guest/host.js";
import { GuestLink } from "../src/platform/host/guest-link.js";
import { VmLifecycle, type VmDriver, type VmState } from "../src/platform/host/lifecycle.js";
import { GUEST_PORTS, HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES } from "../src/protocol/host-guest.js";

const INSTANCE = randomUUID();
const self = { uid: process.getuid!(), gid: process.getgid!() };

interface Guest { readonly control: string; readonly society: string; readonly calls: string[]; close(): Promise<void>; silence(): void }

/** Runs guestctl and guesthost here; `power.off` stops "the VM" unless the
 * guest is told to ignore it. */
class LocalDriver implements VmDriver {
  running: Guest | null = null;
  starts = 0;
  forced = 0;
  image = "2026.09.1";
  ignorePowerOff = false;
  hung = false;
  readonly calls: string[] = [];
  private readonly stopListeners: (() => void)[] = [];
  private silent: Server | null = null;
  constructor(private readonly dir: string, private readonly societies: { dir: string; launcher: SessionLauncher }) {}

  onStopped(listener: () => void): void { this.stopListeners.push(listener); }
  private stopped(): void { for (const listener of this.stopListeners) listener(); }

  async start(): Promise<void> {
    this.starts += 1;
    this.hung = false;
    this.running = await this.boot();
  }
  async forceStop(): Promise<void> {
    this.forced += 1;
    await this.halt();
  }
  /** The guest crashes on its own. */
  async crash(): Promise<void> { await this.halt(); }
  private async halt(): Promise<void> {
    const guest = this.running;
    this.running = null;
    if (guest === null) return;
    await guest.close();
    this.stopped();
  }
  async connect(port: number): Promise<Socket> {
    if (this.hung) {
      this.silent ??= await listenSilently(join(this.dir, "silent.sock"));
      return open(join(this.dir, "silent.sock"));
    }
    if (this.running === null) throw new Error("no VM");
    return open(port === GUEST_PORTS.control ? this.running.control : this.running.society);
  }

  private async boot(): Promise<Guest> {
    const bootId = randomUUID();
    const identity = (): GuestIdentity => ({ instanceId: INSTANCE, guestImage: this.image, bootId,
      stateSchema: { written: 1, readable: [1] }, capabilities: [] });
    const system: GuestSystem = {
      wallClock: () => 0, setWallClock: ms => { this.calls.push(`time.set:${ms > 0}`); },
      health: () => ({ uptimeMs: 1, load: [0, 0, 0], memory: { totalBytes: 1, availableBytes: 1 }, disk: { totalBytes: 1, freeBytes: 1 }, failedUnits: 0 }),
      freeze: () => {}, thaw: () => {}, grow: async () => 0,
      powerOff: () => { this.calls.push("power.off"); if (!this.ignorePowerOff) setTimeout(() => { void this.halt(); }, 10); },
      schedule: (ms, run) => { const timer = setTimeout(run, ms); return { cancel: () => clearTimeout(timer) }; },
      receiptWaitFloor: () => ({ kind: "none" }),
    };
    const control = new GuestControl(system);
    const host = new GuestHost({ societiesDir: this.societies.dir, projectsDir: join(this.dir, "projects"), launcher: this.societies.launcher, stopDeadlineMs: 2000 });
    const suffix = randomUUID().slice(0, 8);
    const servers = [
      await startGuestServer({ socketPath: join(this.dir, `c-${suffix}.sock`), identity, bridge: self, frameBytes: PLATFORM_FRAME_BYTES,
        helloDeadlineMs: 1000, requestTimeoutMs: 2000, channels: { control: { kind: "json", serve: ({ peer }) => control.serve(peer) } } }),
      await startGuestServer({ socketPath: join(this.dir, `s-${suffix}.sock`), identity, bridge: self, frameBytes: PLATFORM_FRAME_BYTES,
        helloDeadlineMs: 1000, requestTimeoutMs: 2000, channels: { society: { kind: "json", serve: ({ peer }) => {
          peer.onFrame(frame => { if (typeof frame.method === "string") this.calls.push(frame.method); });
          host.serve(peer);
        } } } }),
    ];
    const sockets = new Set<Socket>();
    for (const server of servers) server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    return {
      control: join(this.dir, `c-${suffix}.sock`), society: join(this.dir, `s-${suffix}.sock`), calls: this.calls,
      close: async () => { for (const socket of sockets) socket.destroy(); await Promise.all(servers.map(server => new Promise(r => server.close(r)))); },
      silence: () => { for (const socket of sockets) socket.destroy(); },
    };
  }
  async dispose(): Promise<void> { await this.halt(); await new Promise(r => this.silent === null ? r(null) : this.silent.close(r)); }
}
async function open(path: string): Promise<Socket> {
  const socket = connect(path);
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  return socket;
}
/** A guest that accepts and never answers: a hung VM. */
async function listenSilently(path: string): Promise<Server> {
  const server = createServer(socket => { socket.on("data", () => {}); });
  await new Promise<void>(resolve => server.listen(path, resolve));
  return server;
}

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
  const driver = new LocalDriver(dir, { dir: societiesDir, launcher });
  const link = new GuestLink(driver, { hostVersion: "1.0.0", installationId: randomUUID(), instanceId: INSTANCE, expectImage: "2026.09.1",
    protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } }, { frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 300, requestTimeoutMs: 300 });
  const records: string[] = [];
  const states: VmState[] = [];
  const reboots: string[] = [];
  link.onReboot(bootId => reboots.push(bootId));
  const lifecycle = new VmLifecycle({
    driver, link, now: () => performance.now(), wallClock: () => Date.now(),
    after: (ms, run) => { const timer = setTimeout(run, ms); return { cancel: () => clearTimeout(timer) }; },
    handshakeDeadlineMs: 2000, handshakeRetryMs: 20, drainDeadlineMs: 800, healthEveryMs: 40, hungAfterMs: 250,
    restarts: overrides.restarts ?? { max: 3, windowMs: 60_000, backoffMs: 20 },
    record: event => records.push(event),
  });
  lifecycle.onState(state => states.push(state));
  t.after(async () => { await driver.dispose(); await new Promise(r => holder === null ? r(null) : holder.close(r)); rmSync(dir, { recursive: true, force: true }); });
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
  assert.deepEqual(records, []);
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
