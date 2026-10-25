/** DR27/P0-5: an unreachable endpoint is not a stopped society or permission
 * to start another owner. No manager, provider or running society is touched. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { connectEndpoint, endpointListening } from "@oma/client/connection";
import { StoreError } from "@oma/domain/errors";
import { GuestHost, listening } from "#oma-test/app/platform/guest/host";
import { GuestArchives } from "#oma-test/app/platform/guest/archive";
import { RequestLedger } from "#oma-test/app/platform/guest/requests";
import { brokerListening, superviseBroker } from "#oma-test/app/runtime/broker-supervisor";

function refused(t: TestContext, code: string): Socket[] {
  const sockets: Socket[] = [];
  t.mock.method(Socket.prototype, "connect", function(this: Socket) {
    sockets.push(this);
    queueMicrotask(() => this.emit("error", Object.assign(new Error("injected dial failure"), { code })));
    return this;
  });
  t.after(() => { for (const socket of sockets) socket.destroy(); });
  return sockets;
}
const unavailable = (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE";

for (const code of ["EACCES", "EMFILE", "EIO", "ETIMEDOUT", "ENOENT", "ECONNREFUSED"]) {
  test(`DR27: endpoint observation distinguishes an answered absence from ${code}`, async t => {
    const sockets = refused(t, code);
    for (const observe of [() => listening("/unused/socket"), () => brokerListening("/unused")]) {
      if (["ENOENT", "ECONNREFUSED"].includes(code)) assert.equal(await observe(), false);
      else await assert.rejects(observe(), unavailable);
    }
    for (const socket of sockets) assert.equal(socket.destroyed, true, "failed probes retain no live socket");
  });
}

test("DR27: an unobserved guest endpoint cannot authorize open or a terminal stopped answer", async t => {
  refused(t, "EACCES");
  let starts = 0;
  const host = new GuestHost({ societiesDir: "/unused", projectsDir: "/unused", stopDeadlineMs: 100,
    launcher: { socketPath: () => "/unused/socket", start: async () => { starts++; }, stop: async () => "unknown" } });
  await assert.rejects(host.open("demo", randomUUID()), unavailable);
  assert.deepEqual(await host.close("demo", "keep-running"), { state: "unknown" });
  assert.equal(starts, 0);
});

test("DR27: even answered endpoint absence does not prove a society stopped", async t => {
  refused(t, "ENOENT");
  let stops = 0;
  const host = new GuestHost({ societiesDir: "/unused", projectsDir: "/unused", stopDeadlineMs: 100,
    launcher: { socketPath: () => "/unused/socket", start: async () => {}, stop: async () => { stops++; return "unknown"; } } });
  assert.deepEqual(await host.close("demo", "keep-running"), { state: "unknown" });
  assert.deepEqual(await host.close("demo", "stop"), { state: "unknown" });
  assert.equal(stops, 1, "the launcher, not a socket error, owns stop confirmation");
});

test("DR27: an unobserved endpoint leaves archive intent pending, not durably refused", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-observe-archive-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = new RequestLedger(dir);
  refused(t, "EACCES");
  const archives = new GuestArchives(dir, ledger, async () => await listening("/unused/socket") ? "running" : "unknown");
  await assert.rejects(archives.create("archive-key", { society: "demo" }), unavailable);
  assert.deepEqual(ledger.status("archive-key"), { state: "pending", method: "archive.create" });
});

test("DR27: an unobserved broker probe starts no replacement process", async t => {
  refused(t, "EACCES");
  await assert.rejects(superviseBroker({ node: "/not-used", libdir: "/unused", society: "demo",
    stateRoot: "/unused", runRoot: "/unused", configPath: "/unused/config" }), unavailable);
});

for (const mode of ["silence", "abort", "closed", "throw"] as const) {
  test(`DR27: the endpoint attempt releases its owner on ${mode}, without inventing absence`, async t => {
    let socket: Socket | undefined;
    t.mock.method(Socket.prototype, "connect", function(this: Socket) {
      socket = this;
      if (mode === "closed") queueMicrotask(() => this.destroy());
      if (mode === "throw") throw Object.assign(new Error("injected connect failure"), { code: "EMFILE" });
      return this;
    });
    const abort = new AbortController();
    const keepAlive = setTimeout(() => {}, 1000);
    t.after(() => { clearTimeout(keepAlive); socket?.destroy(); });
    const pending = mode === "abort" ? connectEndpoint("/unused", 30, abort.signal) : endpointListening("/unused", 30);
    if (mode === "abort") abort.abort();
    await assert.rejects(pending, unavailable);
    assert.ok(socket?.destroyed);
    await new Promise<void>(resolve => setImmediate(resolve));
    for (const event of ["connect", "error", "close"]) assert.equal(socket.listenerCount(event), 0);
  });
}

test("DR27: an attempt already cancelled opens no socket", async t => {
  const sockets = refused(t, "ENOENT");
  await assert.rejects(connectEndpoint("/unused", 30, AbortSignal.abort()), unavailable);
  assert.equal(sockets.length, 0);
});

test("DR27: cancellation owns late connect errors through close", async t => {
  const abort = new AbortController();
  let socket: Socket | undefined;
  t.mock.method(Socket.prototype, "connect", function(this: Socket) { socket = this; return this; });
  const pending = connectEndpoint("/unused", 30, abort.signal);
  abort.abort();
  // Before close, an error queued by the abandoned connect is still ours.
  assert.doesNotThrow(() => socket!.emit("error", new Error("late connection failure")));
  await assert.rejects(pending, unavailable);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(socket!.listenerCount("error"), 0);
});

test("DR27: closing a screen cancels its pending holder connection without an attach", async t => {
  const sockets: Socket[] = [];
  t.mock.method(Socket.prototype, "connect", function(this: Socket) { sockets.push(this); return this; });
  const screen = new Socket();
  t.after(() => { screen.destroy(); for (const socket of sockets) socket.destroy(); });
  const host = new GuestHost({ societiesDir: "/unused", projectsDir: "/unused", stopDeadlineMs: 100,
    launcher: { socketPath: () => "/unused/socket", start: async () => {}, stop: async () => "unknown" } });
  host.terminal(screen, { channel: "terminal", society: "demo", protocol: { min: 1, max: 1 },
    hostVersion: "test", installationId: randomUUID(), instanceId: randomUUID(), expectImage: "test" });
  screen.destroy();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(sockets.length, 1); assert.equal(sockets[0]!.destroyed, true);
});
