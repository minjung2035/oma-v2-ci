import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrokerChannel, RunnerModule } from "../src/runner.js";
import { FrameParser, encodeFrame } from "../src/frame.js";

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

test("SP-003: a prepared runner handoff reports the unresolved adapter, not successful consumption", async () => {
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
          const result = raw.method === "runner.open" ? { actor: "a", incarnation: 1, socketHostPath: "/unused" }
            : prepared ? { id: "b-00000000-0000-4000-8000-000000000015", agent: "a", incarnation: 1,
              messageIds: ["m-00000000-0000-4000-8000-000000000015-0"], sessionPath: null, deliveryMode: "followUp", notice: "mail", indexPath: "/inbox.md" } : null;
          peer.write(encodeFrame({ v: 1, id: raw.id, ok: true, result }));
        }
      });
    });
    const runner = new RunnerModule({ runRoot: dir }, "a");
    try {
      await new Promise<void>(resolve => server.listen(join(dir, "admin.sock"), resolve));
      if (prepared) await assert.rejects(runner.run(), { code: "SPIKE_UNRESOLVED" });
      else assert.equal(await runner.run(), 0);
      assert.deepEqual(methods, ["runner.open", "batch.prepare"]);
    } finally {
      await runner.stop();
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
