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
    for (const observe of [() => endpointListening("/unused/socket"), () => brokerListening("/unused")]) {
      if (["ENOENT", "ECONNREFUSED"].includes(code)) assert.equal(await observe(), false);
      else await assert.rejects(observe(), unavailable);
    }
    for (const socket of sockets) assert.equal(socket.destroyed, true, "failed probes retain no live socket");
  });
}

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
