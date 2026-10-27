import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { BrokerChannel, dialUnixChannel } from "@oma/client/channel";

async function peerFixture(handle: (socket: Socket, index: number) => void) {
  const root = mkdtempSync(join(tmpdir(), "oma-r15-channel-")); const sockets = new Set<Socket>(); let index = 0;
  const server = createServer(socket => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.on("error", () => {}); handle(socket, index++);
  });
  const path = join(root, "socket");
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
  return { path, async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); } };
}
function requestId(bytes: Buffer): string {
  const parser = new FrameParser(4096); const frames = parser.feed(bytes); assert.equal(frames.length, 1);
  const raw = frames[0]!.raw;
  assert.ok(raw !== null && typeof raw === "object" && "id" in raw && typeof raw.id === "string");
  return raw.id;
}

for (const fault of ["wrong-id", "duplicate", "missing-version", "wrong-result", "trailing-header", "partial-eof", "duplicate-json-key"] as const) {
  test(`R15: ${fault} poisons this generation without a replay or a second dispatch`, async () => {
    let requests = 0;
    const f = await peerFixture(socket => socket.once("data", bytes => {
      assert.ok(Buffer.isBuffer(bytes)); const id = requestId(bytes); requests++;
      const valid = encodeFrame({ v: 1, id, ok: true, result: null });
      if (fault === "wrong-id") socket.end(encodeFrame({ v: 1, id: "another-request", ok: true, result: null }));
      if (fault === "duplicate") socket.end(Buffer.concat([valid, valid]));
      if (fault === "missing-version") socket.end(encodeFrame({ id, ok: true, result: null }));
      if (fault === "wrong-result") socket.end(encodeFrame({ v: 1, id, ok: true, result: { prepared: true } }));
      if (fault === "trailing-header") socket.end(Buffer.concat([valid, Buffer.from([0, 0])]));
      if (fault === "partial-eof") socket.end(valid.subarray(0, 7));
      if (fault === "duplicate-json-key") {
        const body = Buffer.from(`{"v":1,"id":"${id}","ok":true,"result":null,"id":"${id}"}`);
        const header = Buffer.alloc(4); header.writeUInt32BE(body.length); socket.end(Buffer.concat([header, body]));
      }
    }));
    const channel = new BrokerChannel({ frameBytes: 4096, idleStreamSeconds: 30, receiptWaitSeconds: 30 });
    try {
      await channel.connect(f.path);
      await assert.rejects(channel.call("batch.prepare", {}));
      await assert.rejects(channel.call("batch.prepare", {}), { code: "BROKER_UNAVAILABLE" });
      assert.equal(requests, 1);
    } finally { channel.close(); await f.close(); }
  });
}

test("R15: reconnect after a partial header rejects the old request and ignores old-socket events", async () => {
  const clients: Duplex[] = [];
  const f = await peerFixture((socket, index) => socket.once("data", bytes => {
    assert.ok(Buffer.isBuffer(bytes)); const id = requestId(bytes);
    const reply = encodeFrame({ v: 1, id, ok: true, result: null });
    if (index === 0) socket.write(reply.subarray(0, 3)); else socket.end(reply);
  }));
  const channel = new BrokerChannel({ frameBytes: 4096, idleStreamSeconds: 30, receiptWaitSeconds: 30 }, path => {
    const endpoint = dialUnixChannel(path); clients.push(endpoint.socket); return endpoint;
  });
  try {
    await channel.connect(f.path);
    const old = clients[0]!;
    const receivedPrefix = new Promise<void>(resolve => old.once("data", () => resolve()));
    const rejected = assert.rejects(channel.call("batch.prepare", {}), { code: "BROKER_UNAVAILABLE" });
    await receivedPrefix;
    await channel.connect(f.path);
    await rejected;
    old.emit("data", Buffer.from([255, 255, 255, 255])); old.emit("close", true); old.emit("error", new Error("late old-generation error"));
    const reply = await channel.call("batch.prepare", {});
    assert.deepEqual(reply, { ok: true, result: null });
    assert.equal(clients.length, 2);
  } finally { channel.close(); await f.close(); }
});

test("R15: raw upload waits for drain and sends metadata before exact declared body bytes", async () => {
  const body = Buffer.alloc(160 * 1024, 120);
  const digest = createHash("sha256").update(body).digest("hex");
  let writes = 0; let received: Buffer | null = null;
  const errors: unknown[] = [];
  const f = await peerFixture(socket => {
    let input = Buffer.alloc(0); let done = false;
    socket.on("data", chunk => {
      try {
        assert.ok(Buffer.isBuffer(chunk));
        input = Buffer.concat([input, chunk]);
        assert.ok(input.length <= 4096 + 4 + body.length);
        if (done || input.length < 4) return;
        const length = input.readUInt32BE(0);
        if (input.length < 4 + length + body.length) return;
        done = true;
        const raw: unknown = JSON.parse(input.subarray(4, 4 + length).toString("utf8"));
        assert.ok(raw !== null && typeof raw === "object" && "id" in raw && "method" in raw && "request" in raw);
        assert.equal(raw.method, "context.publish"); assert.equal(raw.request, "raw-frozen");
        received = input.subarray(4 + length);
        assert.deepEqual(received, body);
        socket.end(encodeFrame({ v: 1, id: raw.id, ok: true, result: { operation: "op-00000000-0000-4000-8000-000000000015", state: "pending" } }));
      } catch (error) { errors.push(error); socket.destroy(); }
    });
  });
  const channel = new BrokerChannel({ frameBytes: 4096, idleStreamSeconds: 30, receiptWaitSeconds: 30 }, path => {
    const endpoint = dialUnixChannel(path), socket = endpoint.socket;
    socket.write = new Proxy(socket.write, {
      apply(target, receiver, args) {
        writes++;
        const result = Reflect.apply(target, receiver, args);
        if (writes === 1) { queueMicrotask(() => socket.emit("drain")); return false; }
        return result;
      },
    });
    return endpoint;
  });
  try {
    await channel.connect(f.path);
    const request = channel.call("context.publish", { expected: null,
      entries: [{ path: "GOAL.md", bytes: body.length, sha256: digest }],
      content: { bytes: body.length, sha256: digest, mediaType: "application/vnd.oma.context-v1" },
    }, { request: "raw-frozen", streamBytes: body });
    assert.equal(writes, 1, "a false metadata write must prevent immediately queueing the raw body");
    await assert.rejects(channel.call("batch.prepare", {}), { code: "LIMIT_EXCEEDED" });
    const reply = await request;
    assert.ok(reply.ok); assert.equal(reply.result.state, "pending");
    assert.ok(writes >= 4); assert.deepEqual(received, body); assert.deepEqual(errors, []);
  } finally { channel.close(); await f.close(); }
});
