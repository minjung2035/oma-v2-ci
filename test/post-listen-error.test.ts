/** Post-listen 'error' settlement (WORKSTREAM §9 — 전신성 부류 전수 스캔):
 * a `server.once("error", reject)` removed after a successful listen leaves
 * zero 'error' listeners behind, so a later accept-class error
 * (EMFILE/ENFILE) escapes its emit as the host process's death -- the
 * runner mid-delivery, oma-society mid-session, a guest service mid-boot.
 * Every listen boundary now keeps a permanent listener that journals and
 * keeps the socket bound: the kernel retries the accept, while a close
 * would unlink the name the clients still dial.
 *
 * The oracle needs no real fd exhaustion: `server.emit("error", ...)` is
 * synchronous and throws at the emit on a listenerless server; on a fixed
 * one the permanent listener absorbs it. Each site's journal seam is
 * checked too -- a sink that throws inside the emit is the same escape.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { connect, Socket, type Server } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { InferenceRelay } from "../src/runtime/inference-relay.js";
import { ConnectProxy, type EgressAudit } from "../src/runtime/connect-proxy.js";
import { EgressForwarder } from "../src/runtime/egress-forwarder.js";
import { startGuestServer, type GuestIdentity } from "../src/platform/guest/server.js";
import { EgressPool, startEgressService } from "../src/platform/guest/egress.js";
import { startHostApi, type HostApiBackend } from "../src/platform/host/host-api.js";
import { PLATFORM_FRAME_BYTES } from "../src/protocol/host-guest.js";

function scratch(t: TestContext): { path(name: string): string } {
  const dir = mkdtempSync(join(tmpdir(), "oma-listen-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { path: name => join(dir, name) };
}

/** The journal each unit writes on its stderr, captured for one test. */
function journal(t: TestContext): string[] {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  t.after(() => { console.error = original; });
  return lines;
}

/** The shape a kernel accept failure takes. */
const acceptError = (): Error => Object.assign(new Error("accept failed"), { code: "EMFILE" });

/** The listener still answers after the error: its name stayed bound. */
async function stillServing(socketPath: string): Promise<void> {
  const probe = connect(socketPath);
  probe.on("error", () => {});
  await once(probe, "connect");
  probe.destroy();
}

/** What the permanent listener leaves behind: itself alone, after the
 * startup once-listener is removed. Zero meant the emit below threw. */
function expectPermanent(server: Server): void {
  assert.equal(server.listenerCount("error"), 1, "the startup once-listener is gone; the permanent one stays");
}

test("post-listen: the inference relay absorbs an accept-class error and keeps the socket bound", async t => {
  const { path } = scratch(t);
  const socketPath = path("inference.sock");
  const relay = await InferenceRelay.open(socketPath,
    { origin: "https://example.com", headers: {} }, { concurrent: 2, timeoutMs: 5000 });
  t.after(() => relay.close());
  const lines = journal(t);
  const server = Reflect.get(relay, "server") as Server;
  expectPermanent(server);
  server.emit("error", acceptError());
  assert.ok(lines.some(line => line.includes("accept failed")), "the error reached the journal");
  assert.equal(server.listening, true, "the relay keeps listening");
  await stillServing(socketPath);
});

test("post-listen: the CONNECT proxy absorbs an accept-class error through its audit journal", async t => {
  const { path } = scratch(t);
  const socketPath = path("egress.sock");
  const audits: EgressAudit[] = [];
  const proxy = await ConnectProxy.open({ socketPath,
    policy: { role: "worker", allow: ["example.com"] }, actor: "alice",
    dial: async () => new Socket(), audit: entry => audits.push(entry) });
  t.after(() => proxy.close());
  const server = Reflect.get(proxy, "server") as Server;
  expectPermanent(server);
  server.emit("error", acceptError());
  assert.deepEqual(audits.map(entry => [entry.target, entry.decision]), [["(listener)", "fail"]]);
  assert.match(audits[0]!.reason, /accept failed/);
  assert.equal(server.listening, true);
  await stillServing(socketPath);
});

test("post-listen: a refusing audit sink cannot throw out of the proxy listener's emit", async t => {
  const { path } = scratch(t);
  const socketPath = path("egress.sock");
  const proxy = await ConnectProxy.open({ socketPath,
    policy: { role: "worker", allow: ["example.com"] }, actor: "alice",
    dial: async () => new Socket(), audit: () => { throw new Error("the journal is dead"); } });
  t.after(() => proxy.close());
  const server = Reflect.get(proxy, "server") as Server;
  server.emit("error", acceptError());
  assert.equal(server.listening, true);
  await stillServing(socketPath);
});

const RUN = { placeholderId: randomUUID(), society: "demo", actor: "principal", incarnation: 0, modelProfile: "default" };

test("post-listen: the forwarder reports an accept-class error on its host's journal and keeps the socket bound", async t => {
  const { path } = scratch(t);
  const socketPath = path("principal-inference.sock");
  const reported: string[] = [];
  // The seam oma-society wires to its screen: the host's own journal.
  const forwarder = await EgressForwarder.listen(socketPath, path("egress.sock"), RUN, 4, null,
    error => { reported.push(error.message); });
  t.after(() => forwarder.close());
  const server = Reflect.get(forwarder, "server") as Server;
  expectPermanent(server);
  server.emit("error", acceptError());
  assert.deepEqual(reported, ["accept failed"]);
  assert.equal(server.listening, true);
  await stillServing(socketPath);
});

test("post-listen: a journal that throws inside the forwarder's emit is caught at the boundary", async t => {
  const { path } = scratch(t);
  const forwarder = await EgressForwarder.listen(path("principal-inference.sock"), path("egress.sock"), RUN, 4, null,
    () => { throw new Error("the notice channel is dead"); });
  t.after(() => forwarder.close());
  const server = Reflect.get(forwarder, "server") as Server;
  server.emit("error", acceptError());
  assert.equal(server.listening, true);
});

test("post-listen: the runner's forwarder journals on its stderr by default", async t => {
  const { path } = scratch(t);
  const socketPath = path("inference.sock");
  // runner.ts calls listen with no onError: the unit's stderr is its journal.
  const forwarder = await EgressForwarder.listen(socketPath, path("egress.sock"), RUN, 4, null);
  t.after(() => forwarder.close());
  const lines = journal(t);
  const server = Reflect.get(forwarder, "server") as Server;
  server.emit("error", acceptError());
  assert.ok(lines.some(line => line.includes("accept failed")));
  await stillServing(socketPath);
});

const identity = (): GuestIdentity => ({ instanceId: randomUUID(), guestImage: "test", bootId: randomUUID(),
  stateSchema: { written: 1, readable: [1] }, capabilities: [] });

test("post-listen: the guest server absorbs an accept-class error -- the shared listener covers guesthost and guestctl", async t => {
  const { path } = scratch(t);
  const socketPath = path("society.sock");
  const lines = journal(t);
  const server = await startGuestServer({ socketPath,
    bridge: { uid: process.getuid!(), gid: process.getgid!() }, identity, channels: {},
    frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 1000, requestTimeoutMs: 1000 });
  t.after(() => server.close());
  expectPermanent(server);
  server.emit("error", acceptError());
  assert.ok(lines.some(line => line.includes("accept failed")), "the unit's journal got the error");
  assert.equal(server.listening, true);
  await stillServing(socketPath);
});

test("post-listen: the guest egress service absorbs an accept-class error", async t => {
  const { path } = scratch(t);
  const socketPath = path("oma-egress.sock");
  const pool = new EgressPool();
  const lines = journal(t);
  const server = await startEgressService({ socketPath, pool, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 1000 });
  t.after(() => { pool.close(); server.close(); });
  expectPermanent(server);
  server.emit("error", acceptError());
  assert.ok(lines.some(line => line.includes("accept failed")));
  assert.equal(server.listening, true);
  await stillServing(socketPath);
});

test("post-listen: the Host API absorbs an accept-class error", async t => {
  const { path } = scratch(t);
  const socketPath = path("hostapi.sock");
  const lines = journal(t);
  const backend: HostApiBackend = {
    state: () => "ready", start: async () => {}, stop: async () => "stopped",
    society: async () => { throw new Error("unused"); }, terminal: async () => { throw new Error("unused"); },
    importProject: async () => ({}), exportProject: async () => ({}), archive: async () => ({}), syncPackages: async () => ({}),
  };
  const server = await startHostApi({ socketPath, token: "t", backend, frameBytes: PLATFORM_FRAME_BYTES,
    helloDeadlineMs: 1000, requestTimeoutMs: 1000, uid: process.getuid!() });
  t.after(() => server.close());
  expectPermanent(server);
  server.emit("error", acceptError());
  assert.ok(lines.some(line => line.includes("accept failed")));
  assert.equal(server.listening, true);
  await stillServing(socketPath);
});
