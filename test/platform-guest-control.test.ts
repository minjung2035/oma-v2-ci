import { GUEST_IMAGE_ASSETS } from "@oma/platform-linux/guest-assets";
/** MAC-2xx §4: the host-guest protocol, the guest's connection server and its
 * control channel, over real unix sockets. The machine effects are a recording
 * stand-in; what is under test is what the guest decides. */
import test from "node:test";
import assert from "node:assert/strict";
import { connect, createServer, type Server } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { FramedPeer, sendHello } from "#oma-test/app/platform/rpc";
import { PlatformError } from "@oma/protocol/host-errors";
import { startGuestServer, type GuestIdentity } from "#oma-test/app/platform/guest/server";
import { FREEZE_LIMIT_MS, FREEZE_MARGIN_MS, GuestControl } from "#oma-test/app/platform/guest/control";
import { type GuestSystem, type ReceiptWaitFloor } from "@oma/contracts/guest-control";
import { receiptWaitFloor } from "#oma-test/app/platform/guest/receipt-wait";
import { defaultHostConfig } from "@oma/config/defaults";
import { StoreError } from "@oma/domain/errors";
import {
  HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES, helloParamsProblem, negotiate, type HelloParams,
} from "@oma/protocol/host-guest";
import { productText } from "@oma/domain/product-text";

const INSTANCE = randomUUID();
const identity = (): GuestIdentity => ({ instanceId: INSTANCE, guestImage: "2026.09.1", bootId: randomUUID(),
  stateSchema: { written: 1, readable: [1] }, capabilities: ["control"] });
const hello = (overrides: Partial<HelloParams> = {}): HelloParams => ({ channel: "control",
  protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL }, hostVersion: "1.0.0",
  installationId: randomUUID(), instanceId: INSTANCE, expectImage: "2026.09.1", ...overrides });

function fakeSystem(): GuestSystem & { calls: string[]; fire(): void; clock: number; floor: ReceiptWaitFloor; scheduledMs: number | null } {
  let pending: (() => void) | null = null;
  const system = {
    calls: [] as string[], clock: 1_000_000, floor: { kind: "known", ms: 30_000 } as ReceiptWaitFloor, scheduledMs: null as number | null,
    receiptWaitFloor: () => system.floor,
    wallClock: () => system.clock,
    setWallClock(ms: number) { system.calls.push(`clock:${ms}`); system.clock = ms; },
    health: () => ({ uptimeMs: 1, load: [0, 0, 0] as [number, number, number], memory: { totalBytes: 2, availableBytes: 1 },
      disk: { totalBytes: 10, freeBytes: 5 }, failedUnits: 0 }),
    freeze() { system.calls.push("freeze"); },
    thaw() { system.calls.push("thaw"); },
    grow: async () => { throw new StoreError("INTERNAL_ERROR", "resize2fs failed on /dev/vdb for /var/lib/oma"); },
    powerOff() { system.calls.push("poweroff"); },
    schedule(ms: number, run: () => void) { system.scheduledMs = ms; pending = run; return { cancel: () => { pending = null; } }; },
    fire() { const run = pending; pending = null; run?.(); },
  };
  return system;
}

/** The bridge's user is this test's own: the server answers only it. */
const self = { uid: process.getuid!(), gid: process.getgid!() };
async function guest(t: import("node:test").TestContext, control = new GuestControl(fakeSystem()), bridge = self) {
  const dir = mkdtempSync(join(tmpdir(), "oma-guest-"));
  const socketPath = join(dir, "control.sock");
  const server = await startGuestServer({ socketPath, identity, bridge, frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 2000, requestTimeoutMs: 5000,
    channels: { control: { kind: "json", serve: ({ peer }) => control.serve(peer) } } });
  // A server closes once its connections have: the host's ends are closed first.
  const peers: FramedPeer[] = [];
  t.after(() => new Promise<void>(resolve => {
    for (const peer of peers) peer.close();
    server.close(() => { rmSync(dir, { recursive: true, force: true }); resolve(); });
  }));
  const open = async (): Promise<FramedPeer> => {
    const socket = connect(socketPath);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const peer = new FramedPeer(socket, { frameBytes: PLATFORM_FRAME_BYTES, requestTimeoutMs: 5000 });
    peers.push(peer);
    return peer;
  };
  return { control, open };
}
const code = (expected: string) => (error: unknown) => error instanceof PlatformError && error.failure.code === expected;

test("MAC-230: a hello is exactly its shape; a terminal names a society (and may take over) and nothing else does", () => {
  assert.equal(helloParamsProblem(hello()), null);
  assert.match(helloParamsProblem({ ...hello(), extra: 1 }) ?? "", /unknown field/);
  assert.match(helloParamsProblem(hello({ channel: "terminal" })) ?? "", /names a valid society/);
  assert.equal(helloParamsProblem(hello({ channel: "terminal", society: "demo" })), null);
  assert.match(helloParamsProblem(hello({ society: "demo" })) ?? "", /only a terminal/);
  assert.equal(helloParamsProblem(hello({ channel: "terminal", society: "demo", takeover: true })), null);
  assert.match(helloParamsProblem(hello({ takeover: true })) ?? "", /only a terminal/);
  assert.match(helloParamsProblem({ ...hello({ channel: "terminal", society: "demo" }), takeover: false }) ?? "", /true or absent/);
  assert.match(helloParamsProblem(hello({ protocol: { min: 3, max: 2 } })) ?? "", /min <= max/);
  assert.equal(negotiate({ min: 1, max: 2 }, 2), 2);
  assert.equal(negotiate({ min: 1, max: 1 }, 2), null);
});

test("MAC-231: what the guest says about itself carries no Linux path, unit name, errno or machinery word", () => {
  for (const text of ["the state filesystem is frozen", "ERROR: the EMAIL field is empty", "a society's receipt wait could not be read",
    "this guest speaks protocol 1", "the oma-bridge account does not exist", "input/output is fine"])
    assert.equal(productText(text), true, text);
  for (const text of ["cannot open /var/lib/oma/societies/x", "oma-demo-alice.service failed", "user@1000.service is down",
    "EACCES while reading", "failed with ENOSPC", "bad\u0007bell", "reading /dev/vdb", "systemd refused", "the cgroup is gone",
    "Linux kernel error", "Debian package missing", "resize of ext4 failed", "(/proc/self/mounts)"])
    assert.equal(productText(text), false, text);
});

test("MAC-211: the guest answers a hello for its own VM instance and protocol, and refuses any other", async t => {
  const { open } = await guest(t);
  const ok = await open();
  const result = await sendHello(ok, hello());
  assert.equal(result.protocol, HOST_GUEST_PROTOCOL);
  assert.equal(result.guestImage, "2026.09.1");
  ok.close();
  const other = await open();
  await assert.rejects(sendHello(other, hello({ instanceId: randomUUID() })), code("AUTH_FAILED"));
  const future = await open();
  await assert.rejects(sendHello(future, hello({ protocol: { min: HOST_GUEST_PROTOCOL + 1, max: HOST_GUEST_PROTOCOL + 2 } })), code("UNSUPPORTED_VERSION"));
  const wrong = await open();
  await assert.rejects(sendHello(wrong, hello({ channel: "society" })), code("INVALID_REQUEST"));
});

test("MAC-202: a connection from any process but the bridge's user is closed unread", async t => {
  // A process of the service's own user can open the socket; the kernel's
  // answer about who connected, not the file's mode, decides (FS-005).
  const { open } = await guest(t, undefined, { uid: self.uid + 1, gid: self.gid });
  const intruder = await open();
  await assert.rejects(sendHello(intruder, hello()), (error: unknown) =>
    error instanceof PlatformError && error.failure.code === "ENGINE_UNAVAILABLE");
});

test("MAC-620: a freeze ends before the shortest receipt wait configured here, and never on an unknown one", () => {
  const system = fakeSystem();
  const control = new GuestControl(system);
  system.floor = { kind: "known", ms: 3000 };
  assert.deepEqual(control.freeze(5000), { frozenAt: system.clock, deadlineMs: 3000 - FREEZE_MARGIN_MS });
  assert.equal(system.scheduledMs, 3000 - FREEZE_MARGIN_MS, "the timer is the shortened deadline");
  control.thaw();
  system.floor = { kind: "known", ms: 30_000 };
  assert.equal(control.freeze(5000).deadlineMs, 5000, "a shorter request stands");
  control.thaw();
  system.floor = { kind: "none" };
  assert.equal(control.freeze(60_000).deadlineMs, FREEZE_LIMIT_MS);
  control.thaw();
  system.floor = { kind: "unknown" };
  assert.throws(() => control.freeze(1000), (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE");
  system.floor = { kind: "known", ms: FREEZE_MARGIN_MS };
  assert.throws(() => control.freeze(1000), (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST");
  assert.deepEqual(system.calls, ["freeze", "thaw", "freeze", "thaw", "freeze", "thaw"], "a refused freeze froze nothing");
});

test("MAC-620: the receipt-wait bound is read from each society's own configuration", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-societies-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(receiptWaitFloor(join(dir, "absent")), { kind: "none" });
  const society = (name: string, seconds: number | null): void => {
    mkdirSync(join(dir, name));
    if (seconds === null) return;
    const config = defaultHostConfig({ society: name, node: "/usr/bin/node", libdir: "/opt/oma", rootfs: `/state/${name}/rootfs`, deploymentDigest: "a".repeat(64) });
    writeFileSync(join(dir, name, "config.json"), JSON.stringify({ ...config, limits: { ...config.limits, receiptWaitSeconds: seconds } }));
  };
  society("alpha", 30);
  society("beta", 4);
  society("fresh", null);
  assert.deepEqual(receiptWaitFloor(dir), { kind: "known", ms: 4000 });
  writeFileSync(join(dir, "fresh", "config.json"), "{ not json");
  assert.deepEqual(receiptWaitFloor(dir), { kind: "unknown" }, "an unreadable configuration is not skipped");
});

test("MAC-620: a freeze always ends -- at the host's thaw, or at its deadline when no thaw comes", async t => {
  const system = fakeSystem();
  const { open } = await guest(t, new GuestControl(system));
  const peer = await open();
  await sendHello(peer, hello());
  assert.deepEqual(await peer.request("fs.freeze", { deadlineMs: 5000 }), { frozenAt: system.clock, deadlineMs: 5000 });
  await assert.rejects(peer.request("fs.freeze", { deadlineMs: 5000 }), code("BATCH_CONFLICT"));
  assert.deepEqual(await peer.request("fs.thaw", {}), { thawed: true });
  assert.deepEqual(await peer.request("fs.thaw", {}), { thawed: false }, "a second thaw is not an error");
  // The host goes away while the filesystem is frozen: the deadline still thaws it.
  await peer.request("fs.freeze", { deadlineMs: 5000 });
  peer.close();
  system.fire();
  assert.deepEqual(system.calls, ["freeze", "thaw", "freeze", "thaw"]);
});

test("MAC-320: power-off thaws a frozen filesystem first and is asked once", async t => {
  const system = fakeSystem();
  const control = new GuestControl(system);
  control.freeze(1000);
  control.powerOff(); control.powerOff();
  assert.deepEqual(system.calls, ["freeze", "thaw", "poweroff"]);
  assert.throws(() => control.freeze(1000), (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE");
  void t;
});

test("§9.2: the host's wall clock is stepped to, and the step is reported", async t => {
  const system = fakeSystem();
  const { open } = await guest(t, new GuestControl(system));
  const peer = await open();
  await sendHello(peer, hello());
  assert.deepEqual(await peer.request("time.set", { wallMs: 1_000_000 + 3_600_000 }), { steppedByMs: 3_600_000 });
  await assert.rejects(peer.request("time.set", { wallMs: -1 }), code("INVALID_REQUEST"));
});

test("MAC-231: a refusal whose words name Linux leaves the guest as its code alone", async t => {
  const { open } = await guest(t);
  const peer = await open();
  await sendHello(peer, hello());
  await assert.rejects(peer.request("disk.grow", {}), (error: unknown) =>
    error instanceof PlatformError && error.failure.code === "INTERNAL_ERROR" && !/\/dev|\/var/.test(error.failure.message));
  await assert.rejects(peer.request("no.such", {}), code("UNKNOWN_METHOD"));
});

test("MAC-241: a request whose answer never comes is an unknown outcome, never a refusal", async t => {
  // A peer that accepts the connection and never answers.
  const dir = mkdtempSync(join(tmpdir(), "oma-silent-"));
  const silent: Server = createServer(socket => { socket.on("data", () => {}); });
  await new Promise<void>(resolve => silent.listen(join(dir, "s.sock"), resolve));
  t.after(() => new Promise<void>(resolve => silent.close(() => { rmSync(dir, { recursive: true, force: true }); resolve(); })));
  const socket = connect(join(dir, "s.sock"));
  await new Promise<void>(resolve => socket.once("connect", resolve));
  const peer = new FramedPeer(socket, { frameBytes: PLATFORM_FRAME_BYTES, requestTimeoutMs: 100 });
  await assert.rejects(peer.request("project.export", {}, "k1"), (error: unknown) =>
    error instanceof PlatformError && error.failure.code === "ENGINE_UNAVAILABLE" && error.failure.retry === "same-key");
  const pending = peer.request("project.export", {}, "k2");
  socket.destroy();
  await assert.rejects(pending, (error: unknown) => error instanceof PlatformError && error.failure.retry === "same-key");
});

test("P0V-82 / MAC-620: a freeze ends with the process that holds it, and after it by the unit, however it stopped", () => {
  const system = fakeSystem();
  const control = new GuestControl(system);
  control.freeze(5000);
  control.release();
  assert.equal(control.isFrozen, false);
  assert.equal(control.lastThaw, "released");
  assert.equal(system.fire(), undefined);
  control.release();
  assert.deepEqual(system.calls, ["freeze", "thaw"], "a released freeze is thawed once, and its deadline never fires after");
  // What outlives the process: systemd's post-stop runs the same entry to thaw.
  const unit = readFileSync(join(GUEST_IMAGE_ASSETS, "systemd", "oma-guestctl.service"), "utf8");
  const line = (key: string) => unit.split("\n").find(entry => entry.startsWith(`${key}=`))?.slice(key.length + 1).split(" ") ?? [];
  const [start, post] = [line("ExecStart"), line("ExecStopPost")];
  assert.deepEqual(post.slice(0, 2), start.slice(0, 2), "the post-stop is not guestctl itself");
  assert.ok(post.includes("--thaw"), "the post-stop does not thaw");
  assert.equal(post[post.indexOf("--data") + 1], start[start.indexOf("--data") + 1], "the post-stop thaws another filesystem");
});

test("NB-24: a thaw that fails keeps the filesystem frozen, armed, and retryable; power-off is not marked accepted", t => {
  const system = fakeSystem();
  const control = new GuestControl(system);
  control.freeze(5000);
  let wedged = true;
  t.mock.method(system, "thaw", () => { system.calls.push("thaw"); if (wedged) throw new StoreError("INTERNAL_ERROR", "thaw could not run"); });
  assert.throws(() => control.thaw(), /thaw could not run/);
  assert.equal(control.isFrozen, true, "a failed thaw is not a thaw");
  assert.throws(() => control.freeze(1000), (error: unknown) => error instanceof StoreError && error.code === "BATCH_CONFLICT", "still frozen");
  assert.throws(() => control.powerOff(), /thaw could not run/, "a failed thaw cannot be hidden under a power-off");
  wedged = false;
  assert.deepEqual(control.thaw(), { thawed: true });
  assert.deepEqual(system.calls.filter(call => call === "thaw").length, 3, "each attempt thawed; only the last landed");
  assert.deepEqual(control.powerOff(), { accepted: true });
});
