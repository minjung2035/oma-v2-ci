import { test } from "node:test";
import type { PreparedBatch } from "@oma/contracts";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrokerChannel, RunnerModule } from "#oma-test/app/runner";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { actorSocketPathAt, runnerSessionDirPathAt } from "@oma/domain/paths";
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

test("RUN-001: a prepared handoff requires an explicitly configured Pi adapter", async () => {
  for (const prepared of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), "oma-run-gate-"));
    const methods: string[] = [];
    const server = createServer(peer => {
      const parser = new FrameParser(4096);
      peer.on("error", () => {});
      peer.on("data", chunk => {
        assert.ok(Buffer.isBuffer(chunk));
        for (const frame of parser.feed(chunk)) {
          const raw = frame.raw;
          assert.ok(raw !== null && typeof raw === "object" && "id" in raw && "method" in raw && typeof raw.method === "string");
          methods.push(raw.method);
          // The lease is valid; this fixture intentionally omits Pi adapter paths.
          const result = raw.method === "runner.open"
            ? { actor: "a", incarnation: 1, socketHostPath: actorSocketPathAt(dir, "a", 1) }
            : prepared ? { id: "b-00000000-0000-4000-8000-000000000015", agent: "a", incarnation: 1,
              messageIds: ["m-00000000-0000-4000-8000-000000000015-0"], sessionPath: null, deliveryMode: "followUp", notice: "mail", indexPath: "/inbox.md" } : null;
          peer.write(encodeFrame({ v: 1, id: raw.id, ok: true, result }));
        }
      });
    });
    const runner = new RunnerModule({ runRoot: dir }, "a");
    try {
      await new Promise<void>(resolve => server.listen(join(dir, "admin.sock"), resolve));
      if (prepared) await assert.rejects(runner.run(), { code: "UNSUPPORTED_PROFILE" });
      else assert.equal(await runner.run(), 0);
      assert.deepEqual(methods, ["runner.open", "batch.prepare"]);
    } finally {
      await runner.stop();
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** AV21 -- D01, RUN-001: the sixth functional run found a Resident's runner
 * exiting with BROKER_UNAVAILABLE after every delivery that took longer than
 * idleStreamSeconds. It held the connection it opened the run with through the
 * whole turn; the broker closed it as idle, and `batch.complete` went to a
 * closed channel. The next incarnation settled the batch from its receipt, but
 * each long batch cost a failed start against the unit's start limit. Here the
 * broker closes the connection after `batch.prepare`, as its idle bound does;
 * the receipt is already published, so the runner goes straight to completion. */
test("AV21 / D01, RUN-001: a batch outlasting the broker's idle bound completes on a new connection", { timeout: 10000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-av21-"));
  const operation = generateOperationId();
  const batch: PreparedBatch = { id: generateBatchId(), agent: "alice", incarnation: 1, messageIds: [messageIdForOperation(operation, 0)],
    sessionPath: null, deliveryMode: "followUp", notice: "mail", indexPath: "/inbox.md" };
  const sessions = runnerSessionDirPathAt(dir, "alice");
  mkdirSync(sessions, { recursive: true, mode: 0o700 });
  const sessionPath = join(sessions, "session.jsonl");
  writeBoundarySession(sessionPath, batch, "0123abcd");
  publishDeliveryReceipt(dir, batch, { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id, incarnation: 1, sessionPath, entryId: "0123abcd" },
    TEST_PROTOCOL_LIMITS.frameBytes);
  const calls: { method: string; connection: number }[] = [];
  let connections = 0;
  const server = createServer(peer => {
    const connection = ++connections;
    const parser = new FrameParser(1 << 20);
    peer.on("error", () => {});
    peer.on("data", chunk => {
      assert.ok(Buffer.isBuffer(chunk));
      for (const frame of parser.feed(chunk)) {
        const raw = frame.raw as { id: string; method: string };
        calls.push({ method: raw.method, connection });
        const result = raw.method === "runner.open" ? { actor: "alice", incarnation: 1, socketHostPath: actorSocketPathAt(dir, "alice", 1) }
          : raw.method === "batch.prepare" ? batch : { completed: true };
        peer.write(encodeFrame({ v: 1, id: raw.id, ok: true, result }));
        // The delivery outlasts idleStreamSeconds: the broker ends this connection.
        if (raw.method === "batch.prepare") peer.end();
      }
    });
  });
  const runner = new RunnerModule({ runRoot: dir, stateRoot: dir }, "alice", TEST_PROTOCOL_LIMITS);
  try {
    await new Promise<void>(resolve => server.listen(join(dir, "admin.sock"), resolve));
    assert.equal(await runner.run(), 0);
    assert.deepEqual(calls.map(call => call.method), ["runner.open", "batch.prepare", "batch.complete"]);
    assert.ok(calls[2]!.connection > calls[1]!.connection, "completion was sent on the connection the broker closed");
  } finally {
    await runner.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
