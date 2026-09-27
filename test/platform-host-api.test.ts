/** MAC-020/021/222/251: the Host API and the Mac's attach client, down to a
 * real guest session on this machine (a stand-in TUI on a real pty). */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { connect, type Server } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { encodeFrame } from "../src/frame.js";
import { PlatformError, readLeadingFrame } from "../src/platform/rpc.js";
import { startGuestServer, type GuestIdentity } from "../src/platform/guest/server.js";
import { GuestHost, listening, type SessionLauncher } from "../src/platform/guest/host.js";
import { GuestLink } from "../src/platform/host/guest-link.js";
import { startHostApi, type HostApiBackend } from "../src/platform/host/host-api.js";
import { attachTerminal, type AttachTerminal } from "../src/platform/host/attach-client.js";
import { GUEST_PORTS, HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES } from "../src/protocol/host-guest.js";
import { HOST_API_VERSION } from "../src/protocol/host-api.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const holderEntry = join(here, "..", "src", "entry", "guest-session.js");
const fakeTui = join(here, "..", "..", "test", "fixtures", "fake-tui.mjs");
const INSTANCE = randomUUID();
const self = { uid: process.getuid!(), gid: process.getgid!() };
const setsid = existsSync("/usr/bin/setsid");

async function world(t: import("node:test").TestContext, options: { uid?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "oma-hostapi-"));
  const societiesDir = join(dir, "data", "oma"); const projectsDir = join(dir, "projects");
  mkdirSync(societiesDir, { recursive: true }); mkdirSync(projectsDir);
  const children: ChildProcess[] = [];
  const launcher: SessionLauncher = {
    socketPath: society => join(dir, `${society}.sock`),
    async start(society, projectDir) {
      children.push(spawn(process.execPath, [holderEntry, "--socket", join(dir, `${society}.sock`), "--cwd", projectDir, "--", process.execPath, fakeTui],
        { stdio: ["ignore", "ignore", "inherit"] }));
      for (let i = 0; i < 200 && !(await listening(join(dir, `${society}.sock`))); i++) await new Promise(r => setTimeout(r, 20));
    },
    async stop() { return "unknown"; },
  };
  const guestHost = new GuestHost({ societiesDir, projectsDir, launcher, stopDeadlineMs: 2000 });
  const identity = (): GuestIdentity => ({ instanceId: INSTANCE, guestImage: "2026.09.1", bootId: "8f14e45f-ceea-4e7a-9f6b-1b1a2c3d4e5f",
    stateSchema: { written: 1, readable: [1] }, capabilities: [] });
  const guestSocket = join(dir, "society.sock");
  const guest: Server = await startGuestServer({ socketPath: guestSocket, identity, bridge: self, frameBytes: PLATFORM_FRAME_BYTES,
    helloDeadlineMs: 2000, requestTimeoutMs: 5000, channels: {
      society: { kind: "json", serve: ({ peer }) => guestHost.serve(peer) },
      terminal: { kind: "bytes", serve: (socket, hello) => guestHost.terminal(socket, hello) },
    } });
  const link = new GuestLink({ connect: async port => {
    assert.equal(port, GUEST_PORTS.society);
    const socket = connect(guestSocket);
    await new Promise<void>((ok, fail) => { socket.once("connect", ok); socket.once("error", fail); });
    return socket;
  } }, { hostVersion: "1.0.0", installationId: randomUUID(), instanceId: INSTANCE, expectImage: "2026.09.1",
    protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } }, { frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 2000, requestTimeoutMs: 5000 });
  const backend: HostApiBackend = {
    state: () => "ready", start: async () => {}, stop: async () => "stopped",
    society: () => link.json("society"),
    terminal: (society, takeover) => link.bytes("terminal", { society, ...(takeover ? { takeover: true as const } : {}) }),
  };
  const token = randomBytes(32).toString("hex");
  const apiSocket = join(dir, "hostapi.sock");
  const api: Server = await startHostApi({ socketPath: apiSocket, token, backend, frameBytes: PLATFORM_FRAME_BYTES,
    helloDeadlineMs: 2000, requestTimeoutMs: 5000, uid: options.uid ?? self.uid });
  const sockets = new Set<import("node:net").Socket>();
  for (const server of [api, guest]) server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) { child.kill("SIGKILL"); await new Promise(r => child.once("exit", r)); }
    for (const socket of sockets) socket.destroy();
    await Promise.all([api, guest].map(server => new Promise(r => server.close(r))));
    rmSync(dir, { recursive: true, force: true });
  });
  const projectId = randomUUID();
  const mirror = join(projectsDir, projectId);
  mkdirSync(mirror);
  const git = (...args: string[]) => assert.equal(spawnSync("git", args, { cwd: mirror }).status, 0);
  git("init", "-q"); writeFileSync(join(mirror, "README"), "x\n"); git("add", "README"); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
  return { apiSocket, token, projectId };
}

/** One Host API exchange on a fresh connection. */
async function call(apiSocket: string, token: string, method: string, params: Record<string, unknown>, api = { min: 1, max: HOST_API_VERSION }) {
  const socket = connect(apiSocket);
  await new Promise<void>((ok, fail) => { socket.once("connect", ok); socket.once("error", fail); });
  socket.write(encodeFrame({ v: 1, id: "h", method: "hello", params: { api, token, client: "oma-cli" } }));
  const hello = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 3000).catch(() => null);
  if (hello === null || hello.frame.ok !== true) { socket.destroy(); return { hello: hello?.frame ?? null, answer: null }; }
  if (hello.rest.length > 0) socket.unshift(hello.rest);
  socket.write(encodeFrame({ v: 1, id: "r", method, params }));
  const answer = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 5000);
  socket.destroy();
  return { hello: hello.frame, answer: answer.frame };
}

class Screen implements AttachTerminal {
  readonly input = new PassThrough();
  shown = "";
  columns = 100; rows = 30;
  readonly output = Object.assign(new Writable({ write: (chunk, _encoding, done) => { this.shown += Buffer.from(chunk).toString("latin1"); done(); } }),
    { columns: 100, rows: 30 });
  onResize(): () => void { return () => {}; }
  async until(pattern: RegExp, what: string): Promise<void> {
    for (let i = 0; i < 200; i++) { if (pattern.test(this.shown)) return; await new Promise(r => setTimeout(r, 20)); }
    assert.fail(`${what}: ${JSON.stringify(this.shown.slice(-200))}`);
  }
}

test("MAC-021: a connection from another user, or without this start's token, gets nothing", async t => {
  const other = await world(t, { uid: self.uid + 1 });
  assert.deepEqual(await call(other.apiSocket, other.token, "engine.status", {}), { hello: null, answer: null }, "closed unread");
  const mine = await world(t);
  const wrong = await call(mine.apiSocket, randomBytes(32).toString("hex"), "engine.status", {});
  assert.equal((wrong.hello as { error: { code: string } }).error.code, "AUTH_FAILED");
});

test("MAC-251: a UI whose Host API range misses this service's is told so, and can say restart", async t => {
  const { apiSocket, token } = await world(t);
  const future = await call(apiSocket, token, "engine.status", {}, { min: HOST_API_VERSION + 1, max: HOST_API_VERSION + 2 });
  assert.equal((future.hello as { error: { code: string } }).error.code, "UNSUPPORTED_VERSION");
  const current = await call(apiSocket, token, "engine.status", {});
  assert.deepEqual((current.answer as { result: unknown }).result, { state: "ready" });
});

test("MAC-020: the society calls reach guesthost and its refusals come back as they are", async t => {
  const { apiSocket, token, projectId } = await world(t);
  const refused = await call(apiSocket, token, "society.open", { society: "demo", projectId: randomUUID() });
  assert.equal((refused.answer as { error: { code: string } }).error.code, "INVALID_REQUEST");
  const opened = await call(apiSocket, token, "society.open", { society: "demo", projectId });
  assert.deepEqual((opened.answer as { result: unknown }).result, { state: "running" });
});

test("MAC-222/§2.4: the Mac's client attaches, carries keys both ways, and puts its terminal back when another screen takes over", { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { apiSocket, token, projectId } = await world(t);
  await call(apiSocket, token, "society.open", { society: "demo", projectId });
  const first = new Screen();
  const firstEnd = attachTerminal({ socketPath: apiSocket, token, society: "demo", takeover: false, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000, terminal: first });
  await first.until(/frame \d+ 100x30/, "drawn whole");
  first.input.write("k");
  await first.until(/typed:k/, "a key reached the session");

  await assert.rejects(attachTerminal({ socketPath: apiSocket, token, society: "nosuch", takeover: false, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000, terminal: new Screen() })
    .then(end => { if (end.kind === "refused") throw new PlatformError({ code: "INVALID_REQUEST", message: end.message, retry: "never" }); return end; }),
    (error: unknown) => error instanceof PlatformError && error.failure.message === "the society is not open");

  const second = new Screen();
  const secondEnd = attachTerminal({ socketPath: apiSocket, token, society: "demo", takeover: true, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000, terminal: second });
  assert.deepEqual(await firstEnd, { kind: "detached" });
  assert.ok(first.shown.endsWith("\u001b[?2004l\u001b[?25h\u001b[?1049l"), "the first screen was put back: paste off, cursor on, main screen");
  await second.until(/frame \d+ 100x30/, "the second screen, drawn whole");
  second.input.write("q");
  assert.deepEqual(await secondEnd, { kind: "exit", code: 0, signal: null });
});
