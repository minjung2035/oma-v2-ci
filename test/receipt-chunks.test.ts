import { TransportSpool } from "@oma/storage/transport-spool";
import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Socket } from "node:net";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { callActor } from "#oma-test/app/cli/transport";
import type { AuthContext, Receipt, Request } from "@oma/contracts";
import { Store } from "@oma/storage";
import { Broker } from "@oma/broker";
import { RpcConnection } from "@oma/broker/connection";
import { SharedPeerPin } from "@oma/broker/peer-pin";
import { MailModule } from "@oma/mail";
import { LifecycleModule } from "@oma/lifecycle";
import { ViewsModule } from "#oma-test/app/views";
import type { FeatureExecution } from "./fixtures/execution.js";
import { requestHash } from "@oma/domain/request-identity";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { TEST_PROTOCOL_LIMITS } from "./fixtures/limits.js";
import { collectReceipt, receiptChunk } from "@oma/protocol/receipt-chunks";
import { decodeRpcReply } from "@oma/protocol/response-codec";
import { RequestCache, readCacheFile } from "#oma-test/app/request-cache";

const operation = "op-12345678-1234-4234-8234-123456789abc";
const receipt: Receipt = { operation, state: "succeeded", result: { kind: "agent.stop", agent: "alice", desired: "stopped",
  remainingOperations: Array.from({ length: 1000 }, (_, n) => `op-12345678-1234-4234-8234-${n.toString().padStart(12, "0")}`) } };

test("G03-broker-01: a large immutable receipt round trips in bounded, decoded frames", async () => {
  let calls = 0;
  const actual = await collectReceipt("stop-1", 100000, async params => {
    calls++;
    const answer = receiptChunk("chunk", receipt, params, 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(answer)) <= 1024);
    const decoded = decodeRpcReply("operation.read", answer, "chunk", params);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) throw new Error("unexpected failure");
    return decoded.result;
  });
  assert.deepEqual(actual, receipt);
  assert.ok(calls > 1);
});

test("G03-broker-01: a changed receipt, missing version or discontinuous bytes never authorize resend", async () => {
  const first = receiptChunk("x", receipt, { key: "k", offset: 0 }, 512).result;
  assert.throws(() => receiptChunk("x", receipt, { key: "k", offset: first.next! }, 512), { code: "INVALID_REQUEST" });
  assert.throws(() => receiptChunk("x", { operation, state: "pending" }, { key: "k", offset: first.next!, sha256: first.sha256 }, 512), { code: "INVALID_REQUEST" });
  for (const corrupt of [
    { ...first, offset: 1 }, { ...first, bytes: 100001 }, { ...first, data: "" },
    { ...first, next: null }, { ...first, data: first.data + "!" },
  ]) await assert.rejects(collectReceipt("k", 100000, async () => corrupt), { code: "BROKER_UNAVAILABLE" });
  // Every piece can be locally well-formed and claim the same (wrong) digest.
  // Only hashing the complete bytes rejects this coherent substitution.
  await assert.rejects(collectReceipt("k", 100000, async params => ({
    ...receiptChunk("x", receipt, { key: params.key, offset: params.offset, sha256: first.sha256 }, 512).result,
    sha256: "0".repeat(64),
  })), /digest mismatch/);
  let calls = 0;
  await assert.rejects(collectReceipt("k", 100000, async params => {
    if (++calls > 1) throw new Error("connection lost");
    return receiptChunk("x", receipt, params, 512).result;
  }), /connection lost/);
});

test("G03-broker-01: CLI recovers a handled oversized answer across connections without repeating its effect", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-chunk-wire-"));
  const sockets = new Set<Socket>(); let effects = 0; let reads = 0;
  const previous = process.env.OMA_FRAME_BYTES;
  process.env.OMA_FRAME_BYTES = "1024";
  const server = createServer(socket => {
    sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket));
    const parser = new FrameParser(1024);
    socket.on("data", bytes => {
      assert.ok(Buffer.isBuffer(bytes));
      for (const frame of parser.feed(bytes)) {
        const request = frame.raw;
        if (request.method === "agent.stop") {
          effects++;
          socket.end(encodeFrame({ v: 1, id: request.id, ok: false,
            error: { code: "FRAME_TOO_LARGE", message: "handled answer too large", retry: "same-key" } }));
        } else {
          assert.equal(request.method, "operation.read"); reads++;
          const params = request.params as { key: string; offset: number; sha256?: string };
          assert.equal(params.key, "stop-1");
          socket.end(encodeFrame(receiptChunk(String(request.id), receipt, params, 1024)));
        }
      }
    });
  });
  await new Promise<void>(resolve => server.listen(join(root, "socket"), resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.OMA_FRAME_BYTES; else process.env.OMA_FRAME_BYTES = previous;
  });
  const result = await callActor(join(root, "socket"), "agent.stop", { agent: "alice" }, "stop-1");
  assert.deepEqual(result, [{ ok: true, result: receipt }]);
  assert.equal(effects, 1); assert.ok(reads > 1);
});

test("G03-broker-01 / IPC-006: a stalled chunk connection is closed after one observation window of silence", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-chunk-deadline-"));
  const sockets = new Set<Socket>(); let calls = 0; let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const { installRuntime } = await import("@oma/client/runtime");
  const { CLIENT_RUNTIME, installClientRuntime } = await import("#oma-test/app/runtime/client-runtime");
  // A 1 s observation window (the smallest legal policy): the chunk read's own
  // budget, small enough to see stall detection on a deliberately silent peer.
  installRuntime({ ...CLIENT_RUNTIME, observationSeconds: 1 });
  t.after(() => installClientRuntime());
  const server = createServer(socket => {
    sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket));
    const parser = new FrameParser(262144);
    socket.on("data", bytes => {
      assert.ok(Buffer.isBuffer(bytes));
      for (const { raw } of parser.feed(bytes)) {
        calls++;
        if (raw.method === "agent.stop") {
          // The original call's own window is already spent when its answer
          // lands -- if the chunk read shared that deadline it could never
          // even be sent. Under progress-reset observation it gets its own
          // whole window.
          clock = 100_000;
          socket.end(encodeFrame({ v: 1, id: raw.id, ok: false,
            error: { code: "FRAME_TOO_LARGE", message: "handled answer too large", retry: "same-key" } }));
        } else assert.equal(raw.method, "operation.read"); // Deliberately no answer.
      }
    });
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });
  await new Promise<void>(resolve => server.listen(join(root, "socket"), resolve));
  const started = Date.now();
  await assert.rejects(callActor(join(root, "socket"), "agent.stop", { agent: "alice" }, "stop-1"), { code: "BROKER_UNAVAILABLE" });
  const elapsed = Date.now() - started;
  // The chunk read ran and, past the shared deadline, still got its own
  // window (~1 s) before the silent broker was refused.
  assert.equal(calls, 2, "the chunk read was issued even after the first call's window had passed");
  assert.ok(elapsed >= 800 && elapsed < 10000, `stall window was ${elapsed} ms, not the chunk's own observation window`);
});

test("G03-broker-01: durable stop receipt survives a lost chunk and broker restart without repeating the effect or crossing actors", { timeout: 15000 }, async t => {
  // Real ledger, lifecycle, dispatch, framing and CLI. Only peer authentication
  // and the unit-manager boundary are fixtures; this is not kernel-auth evidence.
  const root = mkdtempSync(join(tmpdir(), "oma-chunk-ledger-"));
  const limits = { ...TEST_PROTOCOL_LIMITS, frameBytes: 1024 };
  const previous = process.env.OMA_FRAME_BYTES;
  process.env.OMA_FRAME_BYTES = String(limits.frameBytes);
  let effects = 0; let reads = 0; let drop = true;
  const units = { bindIncarnationReader() {}, stop() { effects++; }, confirmDead: () => true,
    observeStatus: async () => new Map() } as unknown as FeatureExecution;
  const open = () => {
    const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
    const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 24);
    const views = new ViewsModule(store, root, "demo", "p", limits);
    const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo",
      hasGoal: () => true, activationAllowed: () => true },
      (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
    return { store, broker: testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: () => true }, limits: limits }) };
  };
  let current = open();
  const auth = (actor: string): AuthContext => ({ actor, incarnation: 1, role: "resident", channel: "actor",
    capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } });
  current.store.transaction(tx => {
    for (const actor of ["alice", "bob", "worker"]) tx.insertAgent(makeValidAgent(actor, actor === "worker" ? { createdBy: "alice" } : {}));
    for (let n = 0; n < 120; n++) {
      const topic = `pending-${n}`;
      tx.acceptOperation({ id: `op-12345678-1234-4234-8234-${n.toString().padStart(12, "0")}`, actor: "alice", requestKey: topic,
        requestHash: requestHash("route.follow", { topic }), kind: "route.follow", payloadJson: JSON.stringify({ topic }),
        planJson: serializePlanIntent({ kind: "route.follow", topic, agent: "alice" }) });
    }
  });
  const sockets = new Set<Socket>();
  const tasks = new Set<Promise<void>>();
  const servers = ["alice", "bob"].map(actor => {
    const server = createServer({ allowHalfOpen: true }, socket => {
      sockets.add(socket); socket.once("close", () => sockets.delete(socket));
      new RpcConnection({ socket, peer: new SharedPeerPin(() => true, () => {}), limits, makeSpool: descriptor => new TransportSpool(join(root, "staging"), descriptor),
        preflight() {}, onTask(task) { tasks.add(task); void task.finally(() => tasks.delete(task)); },
        async handle(raw, stream) {
          if (raw.method === "operation.read") {
            reads++;
            if (drop && (raw.params as { offset: number }).offset > 0) { drop = false; socket.destroy(); }
          }
          return current.broker.dispatch(auth(actor), raw as unknown as Request, stream);
        } });
    });
    return { actor, server };
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(({ server }) => new Promise<void>(resolve => server.close(() => resolve()))));
    await Promise.all(tasks);
    await current.broker.drainAndClose();
    rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.OMA_FRAME_BYTES; else process.env.OMA_FRAME_BYTES = previous;
  });
  await Promise.all(servers.map(({ actor, server }) => new Promise<void>(resolve => server.listen(join(root, actor), resolve))));
  const path = join(root, "alice");
  await assert.rejects(callActor(path, "agent.stop", { agent: "worker" }, "stop-durable"));
  await Promise.all(tasks);
  const recorded = receiptOfOperation(current.store.getOperation("alice", "stop-durable")!)!;
  assert.equal(recorded.state, "succeeded");
  assert.ok(Buffer.byteLength(JSON.stringify(recorded)) > limits.frameBytes);
  assert.equal(effects, 1); assert.ok(reads >= 2);
  await current.broker.drainAndClose();
  current = open();
  assert.deepEqual(receiptOfOperation(current.store.getOperation("alice", "stop-durable")!), recorded);
  assert.deepEqual(await callActor(path, "operation.get", { key: "stop-durable" }), [{ ok: true, result: recorded }]);
  assert.deepEqual(await callActor(path, "agent.stop", { agent: "worker" }, "stop-durable"), [{ ok: true, result: recorded }]);
  assert.equal(effects, 1, "same-key recovery repeated the stop effect");
  const first = (await callActor(path, "operation.read", { key: "stop-durable", offset: 0 }))[0]!;
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("missing first chunk");
  const chunk = first.result as { sha256: string; next: number };
  const foreign = await callActor(join(root, "bob"), "operation.read", { key: "stop-durable", offset: chunk.next, sha256: chunk.sha256 });
  assert.equal(foreign[0]?.ok, false);
  if (foreign[0]?.ok === false) assert.equal(foreign[0].error.code, "INVALID_REQUEST");
  const missing = await collectReceipt("stop-durable", 100000, async params => {
    const reply = (await callActor(join(root, "bob"), "operation.read", params))[0]!;
    assert.equal(reply.ok, true);
    return reply.result as ReturnType<typeof receiptChunk>["result"];
  });
  assert.equal(missing.operation, "");
  assert.equal(missing.state, "failed");
  assert.equal(missing.error?.code, "REQUEST_NOT_FOUND");
});

test("G03-broker-01: a large observation cannot overwrite the bounded original freeze", t => {
  const home = mkdtempSync(join(tmpdir(), "oma-chunk-cache-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const cache = new RequestCache(home, readCacheFile, 1024);
  cache.freeze({ key: "stop-1", method: "agent.stop", params: { agent: "alice" }, createdAtMs: 1 });
  assert.throws(() => cache.updateReceipt("stop-1", receipt), { code: "CACHE_UNAVAILABLE" });
  const kept = cache.read("stop-1");
  assert.equal(kept.kind, "present");
  if (kept.kind === "present") assert.equal(kept.value.lastReceipt, null);
});
