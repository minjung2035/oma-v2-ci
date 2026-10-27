import { test } from "node:test";
import type { PreparedBatch } from "@oma/contracts";
import assert from "node:assert/strict";
import { createServer, Socket } from "node:net";
import { controlSocketPair } from "@oma/native/control-socket";
import { closeEvery } from "@oma/native/files";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { RpcConnection, type ConnectionLimits } from "@oma/broker/connection";
import { SharedPeerPin } from "@oma/broker/peer-pin";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrokerChannel, RunnerModule } from "#oma-test/app/runner";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { actorSocketPathAt, runnerSessionDirPathAt, runnerReceiptPathAt } from "@oma/domain/paths";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import { publishDeliveryReceipt } from "@oma/storage/delivery-receipt";
import { generateBatchId, generateOperationId } from "@oma/native/identity";
import { messageIdForOperation } from "@oma/domain/derived";
import { TEST_PROTOCOL_LIMITS } from "./fixtures/limits.js";
import { writeBoundarySession } from "./fixtures/delivery-receipt.js";

test("RUN-001: broker EOF, malformed reply and local stop settle all pending calls", { timeout: 5000 }, async () => {
  for (const mode of ["eof", "malformed", "oversize", "stop", "timeout", "success"]) {
    const dir = mkdtempSync(join(tmpdir(), "oma-channel-"));
    const socket = join(dir, "broker.sock");
    const channel = new BrokerChannel({ frameBytes: 4096, idleStreamSeconds: 2, receiptWaitSeconds: 1 });
    const server = createServer(peer => {
      const parser = new FrameParser(4096);
      peer.on("error", () => {});
      peer.on("data", chunk => {
        if (mode === "eof") return peer.end();
        if (mode === "malformed") return peer.write(Buffer.from([0, 0, 0, 1, 0xff]));
        if (mode === "oversize") return peer.write(Buffer.from([0, 0, 0x10, 1]));
        if (mode !== "success") return;
        assert.ok(Buffer.isBuffer(chunk));
        for (const frame of parser.feed(chunk)) {
          const raw = frame.raw;
          assert.ok(raw !== null && typeof raw === "object" && "id" in raw);
          const reply = encodeFrame({ v: 1, id: raw.id, ok: true, result: null });
          peer.write(reply.subarray(0, 3)); peer.write(reply.subarray(3));
        }
      });
    });
    try {
      await assert.rejects(channel.call("batch.prepare", {}), /not connected/);
      await new Promise<void>(resolve => server.listen(socket, resolve));
      await channel.connect(socket);
      await assert.rejects(channel.call("batch.prepare", { excessive: "x".repeat(4096) }), /exceeds frame limit/);
      const calls = Promise.allSettled([channel.call("batch.prepare", {}), channel.call("batch.prepare", {})]);
      if (mode === "stop") channel.close();
      const settled = await calls;
      assert.equal(settled[0]?.status, mode === "success" ? "fulfilled" : "rejected", mode);
      assert.ok(settled[1]?.status === "rejected");
      assert.equal(settled[1].reason.code, "LIMIT_EXCEEDED", "the second call must not enter an unlimited pending queue");
      for (const result of settled) if (result.status === "rejected")
        assert.ok(["BROKER_UNAVAILABLE", "INVALID_REQUEST", "FRAME_TOO_LARGE", "LIMIT_EXCEEDED"].includes(result.reason.code));
    } finally {
      channel.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** Real private socket transport; reply handlers are protocol stubs, not
 * authentication or G-AUTH qualification. No pathname reconnect is offered. */
async function privateTransport(t: import("node:test").TestContext,
  reply: (raw: Record<string, unknown>) => unknown,
  limits: ConnectionLimits = TEST_PROTOCOL_LIMITS) {
  const pair = controlSocketPair(); let serverFd: number | undefined = pair.parent, controlFd: number | undefined = pair.child;
  let server: Socket | undefined, control: Socket | undefined;
  try {
    server = new Socket({ fd: serverFd, readable: true, writable: true }); serverFd = undefined;
    control = new Socket({ fd: controlFd, readable: true, writable: true }); controlFd = undefined;
    const ownedServer = server, ownedControl = control;
    ownedServer.on("error", () => {}); ownedControl.on("error", () => {});
    const closed = [ownedServer, ownedControl].map(socket => new Promise<void>(resolve => socket.once("close", () => resolve())));
    const tasks = new Set<Promise<void>>();
    const peer = new SharedPeerPin(() => !ownedServer.destroyed, () => {});
    const connection = new RpcConnection({ socket: ownedServer, peer, inheritedControl: true, limits,
      handle: async raw => ({ v: 1, id: raw.id, ok: true, result: await reply(raw) }),
      preflight() {}, makeSpool() { throw new Error("runner protocol fixture cannot spool bodies"); },
      onTask(task) { tasks.add(task); void task.then(() => tasks.delete(task), () => tasks.delete(task)); },
    });
    t.after(async () => {
      connection.close(); ownedControl.destroy();
      await Promise.all(closed); await Promise.allSettled([...tasks]);
    });
    return { control: ownedControl, server: ownedServer, connection };
  } catch (error) {
    return withAsyncCleanup(async () => { throw error; }, async () => {
      const sockets = [server, control].filter((socket): socket is Socket => socket !== undefined);
      const closed = sockets.map(socket => socket.closed ? Promise.resolve() : new Promise<void>(resolve => socket.once("close", () => resolve())));
      for (const socket of sockets) { socket.on("error", () => {}); socket.destroy(); }
      await withAsyncCleanup(async () => { closeEvery(serverFd, controlFd); }, async () => { await Promise.all(closed); });
    });
  }
}

test("RUN-001: a prepared handoff requires an explicitly configured Pi adapter", async t => {
  for (const prepared of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), "oma-run-gate-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const methods: unknown[] = [];
    const transport = await privateTransport(t, raw => {
      methods.push(raw.method);
      if (raw.method === "runner.open") assert.deepEqual(raw.params, { agent: "a", invocationId: "a".repeat(32) });
      return raw.method === "runner.open"
        ? { actor: "a", incarnation: 1, socketHostPath: actorSocketPathAt(dir, "a", 1) }
        : prepared ? { id: "b-00000000-0000-4000-8000-000000000015", agent: "a", incarnation: 1,
          messageIds: ["m-00000000-0000-4000-8000-000000000015-0"], sessionPath: null, deliveryMode: "followUp", notice: "mail", indexPath: "/inbox.md" } : null;
    });
    const runner = new RunnerModule({ runRoot: dir }, "a", "a".repeat(32), undefined, undefined, transport.control);
    try {
      if (prepared) await assert.rejects(runner.run(), { code: "UNSUPPORTED_PROFILE" });
      else assert.equal(await runner.run(), 0);
      assert.deepEqual(methods, ["runner.open", "batch.prepare"]);
    } finally { await runner.stop(); }
  }
});

test("Native runner rejects missing or malformed explicit execution identity", () => {
  for (const identity of [undefined, "", "legacy-unit", "a".repeat(31), "A".repeat(32)])
    assert.throws(() => new RunnerModule({ runRoot: "/unused" }, "alice", identity as string), /explicit execution identity/);
});

// The old AV21 pathname-reconnect case is preserved in the raw archive.
// These native cases retain the directly owned endpoint and refuse its EOF.
async function idleDelivery(t: import("node:test").TestContext, broken: boolean): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "oma-native-runner-control-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const operation = generateOperationId();
  const batch: PreparedBatch = { id: generateBatchId(), agent: "alice", incarnation: 1, messageIds: [messageIdForOperation(operation, 0)],
    sessionPath: null, deliveryMode: "followUp", notice: "mail", indexPath: "/inbox.md" };
  const sessions = runnerSessionDirPathAt(dir, "alice"); mkdirSync(sessions, { recursive: true, mode: 0o700 });
  const sessionPath = join(sessions, "session.jsonl"); writeBoundarySession(sessionPath, batch, "0123abcd");
  publishDeliveryReceipt(dir, batch, { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id, incarnation: 1, sessionPath, entryId: "0123abcd" }, TEST_PROTOCOL_LIMITS.frameBytes);
  const receipt = runnerReceiptPathAt(dir, "alice", batch.id), bytes = readFileSync(receipt);
  const calls: unknown[] = [];
  const transport = await privateTransport(t, raw => {
    calls.push(raw.method);
    return raw.method === "runner.open" ? { actor: "alice", incarnation: 1, socketHostPath: actorSocketPathAt(dir, "alice", 1) }
      : raw.method === "batch.prepare" ? batch : { completed: true };
  }, { ...TEST_PROTOCOL_LIMITS, idleStreamSeconds: 1 });
  const runner = new RunnerModule({ runRoot: dir, stateRoot: dir }, "alice", "a".repeat(32), { ...TEST_PROTOCOL_LIMITS, idleStreamSeconds: 1 }, undefined, transport.control);
  const consume = Reflect.get(runner, "consume").bind(runner);
  t.mock.method(runner as unknown as Record<string, (...args: never[]) => unknown>, "consume", async (value: PreparedBatch) => {
    // A real quiet interval exceeds both transport idle budgets.
    if (broken) transport.server.destroy();
    await new Promise(resolve => setTimeout(resolve, 1200));
    await consume(value);
  });
  try {
    if (broken) await assert.rejects(runner.run(), { code: "BROKER_UNAVAILABLE" });
    else assert.equal(await runner.run(), 0);
    assert.deepEqual(calls, broken ? ["runner.open", "batch.prepare"] : ["runner.open", "batch.prepare", "batch.complete"]);
    assert.deepEqual(readFileSync(receipt), bytes, "transport lifetime does not rewrite the durable receipt");
  } finally { await runner.stop(); }

}
test("NATIVE-RUNNER-CONTROL-01: idle delivery retains its owned endpoint", { timeout: 10000 }, t => idleDelivery(t, false));
test("NATIVE-RUNNER-CONTROL-01: idle delivery refuses a lost endpoint", { timeout: 10000 }, t => idleDelivery(t, true));
