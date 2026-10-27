import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { FrameParser, ConnectionDecoder, FrameError, encodeFrame } from "@oma/protocol/frame";
import { RpcConnection, type RpcSocket, type SocketEvents, type AlarmFactory, type RpcConnectionOptions } from "@oma/broker/connection";
import { SharedPeerPin } from "@oma/broker/peer-pin";
import { TransportSpool } from "@oma/storage/transport-spool";
import { StoreError } from "@oma/domain/errors";

class SocketHarness extends EventEmitter<SocketEvents> implements RpcSocket {
  destroyed = false; ended = false; paused = false; writable = true;
  readonly output: Buffer[] = [];
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  write(bytes: Uint8Array): boolean { this.output.push(Buffer.from(bytes)); return this.writable; }
  end(bytes?: Uint8Array) { if (bytes) this.output.push(Buffer.from(bytes)); this.ended = true; }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.emit("close", false); }
}
class ManualAlarms implements AlarmFactory {
  now = 0;
  readonly entries: Array<{ due: number; active: boolean; run: () => void }> = [];
  after(seconds: number, run: () => void) {
    const entry = { due: this.now + seconds, active: true, run }; this.entries.push(entry);
    return { cancel() { entry.active = false; } };
  }
  advance(seconds: number): void {
    const target = this.now + seconds;
    for (;;) {
      const next = this.entries.filter(entry => entry.active && entry.due <= target).sort((a, b) => a.due - b.due)[0];
      if (!next) break;
      this.now = next.due; next.active = false; next.run();
    }
    this.now = target;
  }
  get active() { return this.entries.filter(entry => entry.active).length; }
}
function deferred() {
  let resolve!: (value: object) => void;
  const promise = new Promise<object>(done => { resolve = done; });
  return { promise, resolve };
}
const digest = (body: Buffer) => ({ bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") });
const control = (id = "next") => encodeFrame({ v: 1, id, method: "status.get", params: {} });
const streamFrame = (body: Buffer) => encodeFrame({ v: 1, id: "stream", method: "context.publish", request: "key", params: { content: { ...digest(body), mediaType: "application/vnd.oma.context-v1" } } });
function harness(t: TestContext, handle: RpcConnectionOptions["handle"], customize: Partial<Pick<RpcConnectionOptions, "preflight" | "makeSpool">> = {}) {
  const root = mkdtempSync(join(tmpdir(), "oma-r14-"));
  const socket = new SocketHarness(); const alarms = new ManualAlarms();
  let closes = 0; let closed = 0;
  const peer = new SharedPeerPin(() => true, () => { closes++; });
  const tasks: Promise<void>[] = [];
  const connection = new RpcConnection({ socket, peer, alarms, makeSpool: descriptor => new TransportSpool(root, descriptor),
    limits: { frameBytes: 1024, idleStreamSeconds: 2, receiptWaitSeconds: 5 }, handle,
    preflight: () => undefined, ...customize,
    onTask: task => { tasks.push(task); }, onClosed: () => { closed++; },
  });
  t.after(() => { connection.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, socket, alarms, peer, connection, tasks, peerCloses: () => closes, connectionCloses: () => closed };
}

for (const ending of ["success", "close", "revoke", "short EOF"] as const) {
  test(`DR46/P0-1/4: raw stream ${ending} checks current authority before creating a spool`, async t => {
    let allowed = true, created = 0, handled = 0;
    const body = Buffer.from("raw");
    const h = harness(t, async (_raw, input) => {
      handled++;
      const chunks: Buffer[] = [];
      for await (const bytes of input!) chunks.push(Buffer.from(bytes));
      assert.deepEqual(Buffer.concat(chunks), body);
      return {};
    }, {
      preflight() { if (!allowed) throw new StoreError("CAPABILITY_DENIED", "current authority revoked"); },
      makeSpool(descriptor) { created++; return new TransportSpool(h.root, descriptor); },
    });
    if (ending === "close") h.socket.destroy();
    if (ending === "revoke") allowed = false;
    h.socket.emit("data", Buffer.concat([streamFrame(body), ending === "short EOF" ? body.subarray(0, 1) : body]));
    h.socket.emit("end");
    await Promise.all(h.tasks);
    assert.equal(created, ending === "success" || ending === "short EOF" ? 1 : 0);
    assert.equal(handled, ending === "success" ? 1 : 0);
    assert.deepEqual(readdirSync(h.root), []);
  });
}

test("R14: every two-way split and single-byte feed preserves an exact four-byte header", () => {
  const value = { id: "fragment", nested: { text: "한글 🧪" }, value: 1 };
  const bytes = encodeFrame(value);
  for (let split = 0; split <= bytes.length; split++) {
    const parser = new FrameParser(1024);
    assert.deepEqual([...parser.feed(bytes.subarray(0, split)), ...parser.feed(bytes.subarray(split))].map(frame => frame.raw), [value]);
    parser.finish();
  }
  const parser = new FrameParser(1024); const frames: unknown[] = [];
  for (const byte of bytes) frames.push(...parser.feed(Buffer.from([byte])).map(frame => frame.raw));
  assert.deepEqual(frames, [value]); parser.finish();
  const decoder = new ConnectionDecoder(1024); const events = [];
  for (const byte of bytes) events.push(...decoder.push(Buffer.from([byte])));
  assert.equal(events.length, 1); assert.equal(events[0]?.kind, "frame");
});

test("R14: fatal UTF-8/JSON/length/EOF never allows a later valid frame to resynchronize", () => {
  const invalidBodies = [Buffer.from('{"a":1,"a":2}'), Buffer.from([0xff]), Buffer.from("[]"), Buffer.from("{")];
  for (const body of invalidBodies) {
    const header = Buffer.alloc(4); header.writeUInt32BE(body.length);
    const parser = new FrameParser(1024);
    assert.throws(() => parser.feed(Buffer.concat([header, body])), FrameError);
    assert.equal(parser.poisoned, true);
    assert.throws(() => parser.feed(control()), FrameError);
  }
  const decoder = new ConnectionDecoder(4);
  assert.equal(decoder.push(Buffer.from([0, 0, 0, 5]))[0]?.kind, "invalid");
  assert.equal(decoder.push(encodeFrame({}))[0]?.kind, "invalid");
  for (let count = 1; count <= 5; count++) {
    const parser = new FrameParser(1024); parser.feed(control().subarray(0, count));
    assert.throws(() => parser.finish(), FrameError);
  }
});

test("R14: raw body plus 0–5 next-frame bytes keeps all four excess decisions distinct", () => {
  const body = Buffer.from("raw bytes, not JSON"); const next = control();
  for (let count = 0; count <= 5; count++) {
    const received: Buffer[] = [];
    const decoder = new ConnectionDecoder(1024, part => received.push(Buffer.from(part)));
    decoder.push(Buffer.concat([streamFrame(body), body, next.subarray(0, count)]));
    assert.equal(decoder.beginStream(body.length)[0]?.kind, "stream");
    assert.deepEqual(Buffer.concat(received), body);
    assert.equal(decoder.excessStatus(), count === 0 ? "clean" : "pending");
    if (count > 0) {
      assert.deepEqual(decoder.bufferControl(next.subarray(count)), []);
      assert.equal(decoder.excessStatus(), "next");
      assert.equal(decoder.resumeParsing()[0]?.kind, "frame");
    }
  }
  const malformed = new ConnectionDecoder(1024, () => undefined);
  malformed.push(Buffer.concat([streamFrame(body), body, Buffer.from([255, 255, 255, 255])]));
  malformed.beginStream(body.length);
  assert.equal(malformed.excessStatus(), "excess");
});

test("R14: short raw EOF and undecidable trailing prefixes are cleaned before any handler runs", t => {
  for (const trailing of [null, Buffer.from([0]), Buffer.from([0, 0, 0, 5, 123])]) {
    let calls = 0;
    const h = harness(t, async () => { calls++; return {}; });
    const body = Buffer.from("hello");
    h.socket.emit("data", Buffer.concat([streamFrame(body), trailing === null ? body.subarray(0, 4) : body, trailing ?? Buffer.alloc(0)]));
    assert.equal(h.connection.snapshot().phase, trailing === null ? "receivingStream" : "awaitingExcessDecision");
    assert.equal(readdirSync(h.root).length, 1);
    h.socket.emit("end"); h.alarms.advance(3);
    assert.equal(calls, 0); assert.deepEqual(readdirSync(h.root), []);
    assert.equal(h.peerCloses(), 1); assert.equal(h.alarms.active, 0);
    h.connection.close(); assert.equal(h.connectionCloses(), 1);
  }
});

test("R14: preflight rejection cannot allocate a spool; write failure cleans its allocated spool", t => {
  let allocations = 0;
  const denied = harness(t, async () => ({}), {
    preflight: () => { throw new StoreError("CAPABILITY_DENIED", "revoked"); },
    makeSpool: () => { allocations++; throw new Error("must not allocate"); },
  });
  denied.socket.emit("data", streamFrame(Buffer.from("hello")));
  assert.equal(allocations, 0); denied.alarms.advance(3); assert.equal(denied.peerCloses(), 1);
  let actual: TransportSpool | undefined;
  const broken = harness(t, async () => assert.fail("preaccept I/O failure cannot dispatch"), {
    makeSpool: descriptor => {
      actual = new TransportSpool(broken.root, descriptor);
      return { append() { throw Object.assign(new Error("write failed"), { code: "EIO" }); },
        seal: () => actual!.seal(), handoff: () => actual!.handoff(), releaseConnection: () => actual!.releaseConnection() };
    },
  });
  broken.socket.emit("data", Buffer.concat([streamFrame(Buffer.from("hello")), Buffer.from("hello")]));
  broken.alarms.advance(3);
  assert.ok(actual); assert.equal(existsSync(actual.path), false); assert.equal(broken.peerCloses(), 1);
});

test("R14: disconnect preserves dispatched ownership but cancels every queued request", async t => {
  const gate = deferred(); let calls = 0;
  const h = harness(t, async () => { calls++; return gate.promise; });
  const body = Buffer.from("hello");
  h.socket.emit("data", Buffer.concat([streamFrame(body), body, control("must-not-run")]));
  assert.equal(calls, 1); assert.equal(h.connection.snapshot().phase, "executing");
  const evidence = join(h.root, "accepted-operation-evidence");
  writeFileSync(evidence, "owned by the workflow, not the connection");
  h.socket.destroy();
  assert.equal(h.peerCloses(), 0, "the running task retains the peer pin");
  assert.equal(readdirSync(h.root).filter(path => path.endsWith(".wire")).length, 1);
  gate.resolve({ v: 1, id: "stream", ok: true, result: {} });
  await Promise.all(h.tasks);
  assert.equal(calls, 1); assert.equal(h.peerCloses(), 1); assert.equal(h.socket.output.length, 0);
  assert.equal(existsSync(evidence), true);
  assert.deepEqual(readdirSync(h.root), ["accepted-operation-evidence"]);
  assert.equal(h.alarms.active, 0);
});

test("R14: backpressure runs no queued method until drain and closes at a finite receipt deadline", async t => {
  let calls = 0;
  const h = harness(t, async raw => { calls++; return { v: 1, id: raw.id, ok: true, result: {} }; });
  h.socket.writable = false;
  h.socket.emit("data", Buffer.concat([control("first"), control("second")]));
  await Promise.all(h.tasks);
  assert.equal(calls, 1); assert.equal(h.socket.output.length, 1); assert.equal(h.socket.paused, true);
  h.alarms.advance(6);
  assert.equal(h.socket.destroyed, true); assert.equal(calls, 1); assert.equal(h.socket.output.length, 1);
  assert.equal(h.peerCloses(), 1); assert.equal(h.alarms.active, 0);
  const flow = harness(t, async raw => ({ v: 1, id: raw.id, ok: true, result: {} }));
  flow.socket.writable = false; flow.socket.emit("data", Buffer.concat([control("a"), control("b")]));
  await Promise.all(flow.tasks); assert.equal(flow.tasks.length, 1);
  flow.socket.writable = true; flow.socket.emit("drain");
  await Promise.all(flow.tasks); assert.equal(flow.tasks.length, 2); assert.equal(flow.socket.output.length, 2);
});

test("R14: slow headers, control floods and half-close have bounded, non-resynchronizing outcomes", async t => {
  const slow = harness(t, async () => assert.fail("incomplete header"));
  slow.socket.emit("data", Buffer.from([0])); slow.alarms.advance(10);
  assert.equal(slow.socket.destroyed, true); assert.equal(slow.alarms.active, 0);
  const gate = deferred(); const flood = harness(t, () => gate.promise);
  flood.socket.emit("data", control()); flood.socket.emit("data", Buffer.alloc(1029));
  assert.equal(flood.connection.snapshot().bufferedBytes, 0);
  flood.alarms.advance(3); gate.resolve({}); await Promise.all(flood.tasks);
  assert.equal(flood.peerCloses(), 1);
  const eof = harness(t, async raw => ({ v: 1, id: raw.id, ok: true, result: {} }));
  eof.socket.emit("data", control()); eof.socket.emit("end"); await Promise.all(eof.tasks);
  assert.equal(eof.socket.output.length, 1); assert.equal(eof.socket.ended, true);
  eof.alarms.advance(3); assert.equal(eof.peerCloses(), 1);
});
