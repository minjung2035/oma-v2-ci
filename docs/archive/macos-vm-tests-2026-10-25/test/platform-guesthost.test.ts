import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
/** macos-platform §4.5, §4.6 (MAC-412, MAC-220, MV-12): guesthost over its
 * real guest server -- the society channel and a terminal relayed to a real
 * session holder on a real pseudo-terminal. The holder runs a stand-in TUI
 * instead of `oma`; how a session is started is the launcher's, and the test
 * one starts the holder directly where production uses a user unit. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { connect, type Server } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { FramedPeer, sendHello, sendHelloForBytes } from "#oma-test/app/platform/rpc";
import { PlatformError } from "@oma/protocol/host-errors";
import { startGuestServer, type GuestIdentity } from "#oma-test/app/platform/guest/server";
import { GuestHost, listening, type SessionLauncher } from "#oma-test/app/platform/guest/host";
import type { GuestArchives } from "#oma-test/app/platform/guest/archive";
import { publishProjectBinding } from "#oma-test/app/runtime/provision";
import { holdSocketNames } from "./fixtures/socket-names.js";
import {
  HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES, TerminalFrameParser, encodeTerminalFrame, parseTerminalJson, resizePayload,
  type HelloParams,
} from "@oma/protocol/host-guest";

const here = fileURLToPath(new URL(".", import.meta.url));
const holderEntry = join(here, "../..", DEPLOYMENT_LAYOUT.entries.guestSession);
const fakeTui = join(here, "..", "..", "test", "fixtures", "fake-tui.mjs");
const INSTANCE = randomUUID();
const self = { uid: process.getuid!(), gid: process.getgid!() };
const identity = (): GuestIdentity => ({ instanceId: INSTANCE, guestImage: "2026.09.1", bootId: randomUUID(),
  stateSchema: { written: 1, readable: [1] }, capabilities: ["society", "terminal"] });
const hello = (overrides: Partial<HelloParams> = {}): HelloParams => ({ channel: "society",
  protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL }, hostVersion: "1.0.0",
  installationId: randomUUID(), instanceId: INSTANCE, expectImage: "2026.09.1", ...overrides });
const code = (expected: string) => (error: unknown) => error instanceof PlatformError && error.failure.code === expected;

/** Starts the holder as a child of the test; records what it was asked. */
function localLauncher(dir: string, env: Record<string, string>, societiesDir: string): SessionLauncher & { started: { society: string; projectDir: string }[]; children: ChildProcess[] } {
  const started: { society: string; projectDir: string }[] = [];
  const children: ChildProcess[] = [];
  const socketPath = (society: string): string => join(dir, `${society}.sock`);
  return {
    started, children, socketPath,
    async start(society, projectDir) {
      // The stand-in TUI does not provision; the real oma commits this binding.
      publishProjectBinding(join(societiesDir, society), { society, canonicalProjectPath: projectDir });
      started.push({ society, projectDir });
      const child = spawn(process.execPath, ["--import", join(here, "fixtures", "socket-names.js"), holderEntry, "--socket", socketPath(society), "--cwd", projectDir, "--", process.execPath, fakeTui],
        { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, ...env } });
      children.push(child);
      for (let i = 0; i < 200 && !(await listening(socketPath(society))); i++) await new Promise(r => setTimeout(r, 20));
    },
    async stop(society, deadlineMs) {
      const child = children.find(item => item.exitCode === null);
      if (child === undefined) return "stopped";
      child.kill("SIGTERM");
      const ended = await Promise.race([new Promise(r => child.once("exit", () => r(true))), new Promise(r => setTimeout(() => r(false), deadlineMs))]);
      return ended === true && !(await listening(socketPath(society))) ? "stopped" : "unknown";
    },
  };
}

async function setup(t: import("node:test").TestContext, archives?: GuestArchives) {
  const dir = mkdtempSync(join(tmpdir(), "oma-guesthost-"));
  const socketNames = holdSocketNames(dir);
  const launcher = localLauncher(dir, socketNames.env, join(dir, "data", "oma"));
  let server: Server | undefined;
  const peers: FramedPeer[] = [];
  const sockets = new Set<import("node:net").Socket>();
  t.after(async () => {
    try {
      for (const peer of peers) peer.close();
      for (const child of launcher.children) if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL"); await new Promise(r => child.once("exit", r));
      }
      for (const socket of sockets) socket.destroy();
      if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    } finally { socketNames.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  const societiesDir = join(dir, "data", "oma"); const projectsDir = join(dir, "projects");
  mkdirSync(societiesDir, { recursive: true }); mkdirSync(projectsDir);
  const host = new GuestHost({ societiesDir, projectsDir, launcher, stopDeadlineMs: 5000, ...(archives === undefined ? {} : { archives }) });
  const socketPath = join(dir, "society.sock");
  server = await startGuestServer({ socketPath, identity, bridge: self, frameBytes: PLATFORM_FRAME_BYTES,
    helloDeadlineMs: 2000, requestTimeoutMs: 10_000,
    channels: {
      society: { kind: "json", serve: ({ peer }) => host.serve(peer) },
      terminal: { kind: "bytes", serve: (socket, params) => host.terminal(socket, params) },
    } });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  const open = async (params: HelloParams): Promise<FramedPeer> => {
    const socket = connect(socketPath);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const peer = new FramedPeer(socket, { frameBytes: PLATFORM_FRAME_BYTES, requestTimeoutMs: 10_000 });
    peers.push(peer);
    await sendHello(peer, params);
    return peer;
  };
  /** A mirror with one commit, as a first import leaves it (§6.3). */
  const importedMirror = (projectId: string): string => {
    const mirror = join(projectsDir, projectId);
    const git = (...args: string[]) => assert.equal(spawnSync("git", args, { cwd: mirror, encoding: "utf8" }).status, 0, args.join(" "));
    mkdirSync(mirror);
    git("init", "-q"); writeFileSync(join(mirror, "README"), "hello\n"); git("add", "README");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    return mirror;
  };
  return { host, launcher, open, importedMirror, societiesDir, projectsDir, socketPath };
}

/** The host's screen on a terminal channel. */
async function screenOf(socketPath: string, params: HelloParams) {
  const socket = connect(socketPath);
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  const { rest } = await sendHelloForBytes(socket, params, PLATFORM_FRAME_BYTES, 5000);
  const parser = new TerminalFrameParser();
  const state = { shown: "", controls: [] as { kind: string; value: Record<string, unknown> | null }[] };
  socket.on("data", (chunk: Buffer) => {
    for (const frame of parser.feed(chunk)) {
      if (frame.kind === "output") state.shown += frame.payload.toString("latin1");
      else state.controls.push({ kind: frame.kind, value: parseTerminalJson(frame.payload, Object.keys(JSON.parse(frame.payload.toString("utf8")) as object)) });
    }
  });
  const closed = new Promise<void>(resolve => socket.once("close", () => resolve()));
  socket.emit("data", rest);
  socket.resume();
  const until = async (pattern: RegExp, what: string): Promise<void> => {
    for (let i = 0; i < 200; i++) { if (pattern.test(state.shown)) return; await new Promise(r => setTimeout(r, 20)); }
    assert.fail(`${what}: never shown; ${JSON.stringify(state.shown.slice(-200))}`);
  };
  return { socket, state, closed, until, size: (c: number, r: number) => socket.write(encodeTerminalFrame("resize", resizePayload(c, r))),
    type: (text: string) => socket.write(encodeTerminalFrame("input", Buffer.from(text))) };
}

const setsid = existsSync("/usr/bin/setsid");

test("MAC-412: a project's society does not open before its first import, and opens from the mirror after it", { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { open, launcher, importedMirror } = await setup(t);
  const projectId = randomUUID();
  const peer = await open(hello());
  await assert.rejects(peer.request("society.open", { society: "demo", projectId }), code("INVALID_REQUEST"));
  assert.deepEqual(launcher.started, [], "nothing was started on an empty mirror");
  const mirror = importedMirror(projectId);
  assert.deepEqual(await peer.request("society.open", { society: "demo", projectId }), { state: "running" });
  assert.deepEqual(launcher.started, [{ society: "demo", projectDir: mirror }]);
  assert.deepEqual(await peer.request("society.open", { society: "demo", projectId }), { state: "running" });
  assert.equal(launcher.started.length, 1, "an open society is not started twice");
});

test("P0V-106 (G13-04): two opens of one society at once start it once; the second sees what the first made", { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { open, launcher, importedMirror } = await setup(t);
  const projectId = randomUUID();
  importedMirror(projectId);
  const first = await open(hello());
  const second = await open(hello());
  const answers = await Promise.all([first.request("society.open", { society: "demo", projectId }), second.request("society.open", { society: "demo", projectId })]);
  assert.deepEqual(answers, [{ state: "running" }, { state: "running" }]);
  assert.equal(launcher.started.length, 1, "one session under the society's name");
});

test("D05 in the guest: an existing society opens only for the project it is bound to", async t => {
  const { open, launcher, importedMirror, societiesDir } = await setup(t);
  const bound = randomUUID(); const other = randomUUID();
  const boundMirror = importedMirror(bound); importedMirror(other);
  publishProjectBinding(join(societiesDir, "demo"), { society: "demo", canonicalProjectPath: boundMirror });
  const peer = await open(hello());
  await assert.rejects(peer.request("society.open", { society: "demo", projectId: other }), code("INVALID_REQUEST"));
  assert.deepEqual(launcher.started, []);
});

test("MAC-320: while maintenance is open no society opens, and a stopped society is reported stopped", { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { open, importedMirror, societiesDir } = await setup(t);
  const projectId = randomUUID(); importedMirror(projectId);
  const peer = await open(hello());
  await peer.request("maintenance.begin", {}, "m1");
  await assert.rejects(peer.request("society.open", { society: "demo", projectId }), code("BROKER_UNAVAILABLE"));
  assert.deepEqual(await peer.request("maintenance.end", {}, "m1"), { maintenance: false });
  await peer.request("society.open", { society: "demo", projectId });
  mkdirSync(join(societiesDir, "demo", "state"), { recursive: true });
  assert.deepEqual(await peer.request("society.list", {}), { societies: [{ society: "demo", running: true }] });
  assert.deepEqual(await peer.request("society.close", { society: "demo", mode: "stop" }), { state: "stopped" });
  assert.deepEqual(await peer.request("society.list", {}), { societies: [{ society: "demo", running: false }] });
});

test("§4.6/MV-12: a terminal relayed through guesthost attaches, is drawn whole, and gives way to a takeover", { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { open, importedMirror, socketPath } = await setup(t);
  const projectId = randomUUID(); importedMirror(projectId);
  const control = await open(hello());
  await control.request("society.open", { society: "demo", projectId });

  const first = await screenOf(socketPath, hello({ channel: "terminal", society: "demo" }));
  first.size(120, 40);
  await first.until(/frame \d+ 120x40/, "the relayed screen");
  first.type("z");
  await first.until(/typed:z/, "input through the relay");

  const refused = await screenOf(socketPath, hello({ channel: "terminal", society: "demo" }));
  refused.size(80, 24);
  await refused.closed;
  assert.deepEqual(refused.state.controls, [{ kind: "refused", value: { code: "ATTACH_CONFLICT", message: "this society is shown on another screen" } }]);

  const taker = await screenOf(socketPath, hello({ channel: "terminal", society: "demo", takeover: true }));
  taker.size(120, 40);
  await taker.until(/frame \d+ 120x40/, "the screen that took over, drawn whole at an unchanged size");
  await first.closed;
  assert.deepEqual(first.state.controls, [{ kind: "detached", value: { reason: "taken-over" } }]);
});

test("§4.6: a terminal for a society that is not open is refused in words the host can show", async t => {
  const { socketPath } = await setup(t);
  const screen = await screenOf(socketPath, hello({ channel: "terminal", society: "demo" }));
  await screen.closed;
  assert.deepEqual(screen.state.controls, [{ kind: "refused", value: { code: "INVALID_REQUEST", message: "the society is not open" } }]);
});


function heldArchive(fail = false) {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0;
  const archives = { async create() {
    calls++;
    if (calls > 1) throw new Error("archive already running");
    entered(); await gate;
    if (fail) throw new Error("archive could not finish");
    return { files: 1 };
  } } as unknown as GuestArchives;
  return { archives, started, release: () => release(), calls: () => calls };
}

for (const fail of [false, true]) test(`DR27/MAC-240: overlapping archive cannot return its owner's fence; failed=${fail}`, { timeout: 10000 }, async t => {
  const archive = heldArchive(fail);
  const { host, open } = await setup(t, archive.archives);
  const first = await open(hello()); const second = await open(hello());
  const pending = first.request("archive.create", { society: "demo" }, "a1");
  const settled = pending.then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    await archive.started;
    await assert.rejects(second.request("archive.create", { society: "demo" }, "a2"));
    assert.equal(archive.calls(), 1, "the second archive acquired the first archive's slot");
    await assert.rejects(host.open("demo", randomUUID()), { code: "BROKER_UNAVAILABLE" });
    assert.throws(() => host.maintenanceBegin("m1"), { code: "BROKER_UNAVAILABLE" });
  } finally { archive.release(); await settled; }
  if (fail) assert.ok((await settled).error instanceof PlatformError);
  else assert.deepEqual((await settled).value, { files: 1 });
  assert.doesNotThrow(() => { assert.deepEqual(host.maintenanceBegin("m1"), { maintenance: true }); }, "archive owner returned its fence");
  host.maintenanceEnd("m1");
});

test("DR27/MAC-320: maintenance and archive cannot overtake an in-flight society open", { timeout: 10000 }, async t => {
  const archive = heldArchive();
  const { host, open, launcher, importedMirror } = await setup(t, archive.archives);
  const projectId = randomUUID(); importedMirror(projectId);
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  t.mock.method(launcher, "start", async () => { entered(); await gate; });
  const pending = host.open("demo", projectId);
  const settled = pending.then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    await started;
    assert.throws(() => host.maintenanceBegin("m1"), { code: "BROKER_UNAVAILABLE" });
    const peer = await open(hello());
    archive.release();
    await assert.rejects(peer.request("archive.create", { society: "demo" }, "a1"), code("BROKER_UNAVAILABLE"));
    assert.equal(archive.calls(), 0);
  } finally { release(); archive.release(); await settled; }
  assert.deepEqual((await settled).value, { state: "running" });
  assert.deepEqual(host.maintenanceBegin("m1"), { maintenance: true });
  host.maintenanceEnd("m1");
});

test("DR27/MAC-320: archive cannot begin while maintenance owns the engine", async t => {
  const archive = heldArchive();
  const { host, open } = await setup(t, archive.archives);
  host.maintenanceBegin("m1");
  const peer = await open(hello());
  try {
    archive.release();
    await assert.rejects(peer.request("archive.create", { society: "demo" }, "a1"), code("BROKER_UNAVAILABLE"));
    assert.equal(archive.calls(), 0);
  } finally { host.maintenanceEnd("m1"); }
});

test("AV-23/P0-4: a maintenance latch ends with the connection that took it, however it ends", async t => {
  const archives = { async create() { return { files: 1 }; } } as unknown as GuestArchives;
  const { open } = await setup(t, archives);
  const owner = await open(hello());
  const other = await open(hello());
  await owner.request("maintenance.begin", {}, "m1");
  await assert.rejects(other.request("archive.create", { society: "demo" }, "a1"), code("BROKER_UNAVAILABLE"),
    "the live owner's latch bars the engine's work");
  owner.close();
  // The dead owner's latch is reaped when its close reaches the server: the
  // engine is no one's to hold.
  let unlatched: unknown = null;
  for (let i = 0; i < 200; i++) {
    try { unlatched = await other.request("archive.create", { society: "demo" }, `a${i}`); break; }
    catch (error) {
      assert.ok(error instanceof PlatformError && error.failure.code === "BROKER_UNAVAILABLE", String(error));
      await new Promise(r => setTimeout(r, 10));
    }
  }
  assert.deepEqual(unlatched, { files: 1 }, "the dead connection's latch was returned");
});

test("DR38: duplicate maintenance keys cannot replace a live owner", async t => {
  const archives = { async create() { return { files: 1 }; } } as unknown as GuestArchives;
  const { open } = await setup(t, archives);
  const owner = await open(hello()), other = await open(hello()), observer = await open(hello());
  await owner.request("maintenance.begin", {}, "same-snapshot");
  await assert.rejects(other.request("maintenance.begin", {}, "same-snapshot"), code("REQUEST_KEY_REUSED"));
  other.close();
  await assert.rejects(observer.request("archive.create", { society: "demo" }, "still-held"), code("BROKER_UNAVAILABLE"));
  assert.deepEqual(await owner.request("maintenance.end", {}, "same-snapshot"), { maintenance: false });
  assert.deepEqual(await observer.request("archive.create", { society: "demo" }, "released"), { files: 1 });
});

test("DR38: a foreign maintenance.end cannot return another connection's lease", async t => {
  const archives = { async create() { return { files: 1 }; } } as unknown as GuestArchives;
  const { open } = await setup(t, archives);
  const owner = await open(hello()), other = await open(hello());
  await owner.request("maintenance.begin", {}, "held");
  await assert.rejects(other.request("maintenance.end", {}, "held"), code("AUTH_FAILED"));
  await assert.rejects(other.request("archive.create", { society: "demo" }, "blocked"), code("BROKER_UNAVAILABLE"));
  assert.deepEqual(await owner.request("maintenance.end", {}, "held"), { maintenance: false });
});

test("DR38: a running society validates its imported project and binding before returning success", async t => {
  const { host, launcher, importedMirror, societiesDir, socketPath } = await setup(t);
  const bound = randomUUID(), other = randomUUID();
  const mirror = importedMirror(bound); importedMirror(other);
  publishProjectBinding(join(societiesDir, "demo"), { society: "demo", canonicalProjectPath: mirror });
  t.mock.method(launcher, "socketPath", () => socketPath);
  assert.deepEqual(await host.open("demo", bound), { state: "running" });
  await assert.rejects(host.open("demo", other), { code: "INVALID_REQUEST" });
  writeFileSync(join(societiesDir, "demo", "project-binding.json"), "{broken");
  await assert.rejects(host.open("demo", bound), { code: "BROKER_UNAVAILABLE" });
  assert.deepEqual(launcher.started, []);
});

test("DR38: society.close on another connection waits for its in-flight open", async t => {
  const { open, launcher, importedMirror } = await setup(t);
  const projectId = randomUUID(); importedMirror(projectId);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let stops = 0;
  t.mock.method(launcher, "start", async () => { entered(); await gate; });
  t.mock.method(launcher, "stop", async () => { stops++; return "stopped"; });
  const first = await open(hello()), second = await open(hello());
  const opening = first.request("society.open", { society: "demo", projectId });
  await started;
  const closing = second.request("society.close", { society: "demo", mode: "stop" });
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(stops, 0, "stop raced with start");
  } finally { release(); await Promise.allSettled([opening, closing]); }
  assert.equal(stops, 1);
  assert.deepEqual(await closing, { state: "stopped" });
});

test("DR38: a rejected close settles before the next open and does not poison its queue", async t => {
  const { host, launcher, importedMirror } = await setup(t);
  const projectId = randomUUID(); importedMirror(projectId);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let opens = 0;
  t.mock.method(launcher, "stop", async () => { entered(); await gate; throw new Error("stop unknown"); });
  t.mock.method(launcher, "start", async () => { opens++; });
  const closing = host.close("demo", "stop");
  const closed = closing.catch(error => error);
  await started;
  const opening = host.open("demo", projectId);
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(opens, 0);
    assert.throws(() => host.maintenanceBegin("busy"), { code: "BROKER_UNAVAILABLE" });
  } finally { release(); await closed; }
  assert.deepEqual(await opening, { state: "running" });
  assert.equal(opens, 1);
});
