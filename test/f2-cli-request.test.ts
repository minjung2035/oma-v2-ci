// Typed client/request-cache regression: the socket peer is not a broker or systemd proof.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientCall, clientProcessArgs } from "./fixtures/client-process.js";
import { RequestCache } from "#oma-test/app/request-cache";
import { encodeFrame } from "@oma/protocol/frame";
import type { Receipt } from "@oma/contracts";

interface ClientResult {
  code: number | string;
  signal: string | null;
  killed: boolean;
  stdout: string;
  stderr: string;
}
function run(
  home: string,
  expression: string,
): Promise<ClientResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      clientProcessArgs(expression),
      {
        cwd: home,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 65536,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: home,
          OMA_SOCKET: join(home, "peer.sock"),
          NODE_OPTIONS: process.env.NODE_OPTIONS ?? "",
        },
      },
      (error, stdout, stderr) =>
        resolve({
          code: error?.code ?? 0,
          signal: error?.signal ?? null,
          killed: error?.killed ?? false,
          stdout,
          stderr,
        }),
    );
  });
}

test("001. Explicit valid request keys freeze once and retry by authoritative lookup", async () => {
  const home = mkdtempSync(join(tmpdir(), "oma-f2-request-"));
  const sockets = new Set<Socket>();
  const errors: unknown[] = [];
  const receipts = new Map<string, Receipt>();
  const seen: Array<{ method: string; key: string }> = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    let answered = false;
    socket.on("error", (error) => errors.push(error));
    socket.on("data", (chunk) => {
      if (answered) return;
      try {
        assert.ok(Buffer.isBuffer(chunk));
        pending = Buffer.concat([pending, chunk]);
        assert.ok(pending.length <= 65536, "fixture request exceeds bound");
        if (pending.length < 4) return;
        const bytes = pending.readUInt32BE(0);
        assert.ok(bytes <= 65532);
        if (pending.length < 4 + bytes) return;
        const request = JSON.parse(
          pending.subarray(4, 4 + bytes).toString("utf8"),
        ) as {
          id: string;
          method: string;
          request?: string;
          params: { key?: string; topic?: string; note?: string };
        };
        assert.equal(typeof request.id, "string");
        assert.ok(
          request.method === "route.follow" ||
            request.method === "operation.get" || request.method === "agent.continue",
        );
        const key =
          request.method === "operation.get"
            ? request.params.key
            : request.request;
        assert.equal(typeof key, "string");
        assert.ok(key);
        if (request.method !== "operation.get") {
          if (request.method === "route.follow") assert.equal(request.params.topic, "dev");
          else assert.equal(request.params.note, "first line\nsecond line\n");
          assert.equal(receipts.has(key), false);
          receipts.set(key, {
            operation: `op-00000000-0000-4000-8000-${String(receipts.size + 1).padStart(12, "0")}`,
            state: "succeeded",
            result: request.method === "route.follow" ? { kind: "route.follow", topic: "dev", subscribed: true }
              : { kind: "agent.continue", message: "m-00000000-0000-4000-8000-0000000000e1-0", recipientCount: 1, archivePath: "/mail/archive/cur/continuation:2," },
          });
        }
        const receipt = receipts.get(key);
        assert.ok(receipt, "lookup must refer to an existing request");
        seen.push({ method: request.method, key });
        answered = true;
        socket.end(
          encodeFrame({ v: 1, id: request.id, ok: true, result: receipt }),
        );
      } catch (error) {
        errors.push(error);
        socket.destroy();
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(join(home, "peer.sock"), resolve);
    });
    for (const key of ["Retry._Key-1", "-leading", "x".repeat(96), "Continuation_CRLF"]) {
      const continuation = key === "Continuation_CRLF";
      const method = continuation ? "agent.continue" : "route.follow";
      const at: number = seen.length;
      for (let n = 0; n < (continuation ? 3 : 2); n++) {
        const expression = continuation
          ? clientCall("continueAgent", n < 2 ? "first line\r\nsecond line\r\n" : "first line\nsecond line\n", key)
          : clientCall("subscribe", "follow", "dev", key);
        const result = await run(home, expression);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(result.signal, null);
      }
      assert.deepEqual(seen.slice(at), [
        { method, key },
        ...Array.from({ length: continuation ? 2 : 1 }, () => ({ method: "operation.get", key })),
      ]);
      const cached = new RequestCache(home).read(key);
      assert.equal(cached.kind, "present");
      if (cached.kind === "present")
        assert.deepEqual(cached.value.lastReceipt, receipts.get(key));
    }
    assert.deepEqual(
      errors,
      [],
      "fixture failures must not masquerade as client success",
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
});
