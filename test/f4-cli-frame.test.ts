import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, ClientError } from "@oma/client";
import { installRuntime } from "@oma/client/runtime";
import { CLIENT_RUNTIME } from "#oma-test/app/runtime/client-runtime";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { MIN_LOG_FRAME_BYTES } from "@oma/protocol/log-response";

installRuntime(CLIENT_RUNTIME);

const params = { agent: "alice", sinceSeconds: 60 };
const mail = (bytes: number) => ({
  to: ["alice"],
  kind: "message",
  subject: "test",
  body: "B".repeat(bytes),
});
async function withFrame(value: string | undefined, run: () => Promise<void>) {
  const original = process.env.OMA_FRAME_BYTES;
  if (value === undefined) delete process.env.OMA_FRAME_BYTES;
  else process.env.OMA_FRAME_BYTES = value;
  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.OMA_FRAME_BYTES;
    else process.env.OMA_FRAME_BYTES = original;
  }
}
// Owned temporary local socket only: this proves transport limits, not deployment admission.
async function withServer(
  textBytes: number,
  run: (
    client: Client,
    seen: Record<string, unknown>[],
    connections: () => number,
    path: string,
  ) => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), "oma-client-frame-"));
  const path = join(root, "fixture.sock");
  const sockets = new Set<Socket>();
  const seen: Record<string, unknown>[] = [];
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const parser = new FrameParser(1024 * 1024);
    socket.on("data", (bytes) => {
      assert.ok(
        Buffer.isBuffer(bytes),
        "mock socket must remain byte-oriented",
      );
      for (const frame of parser.feed(bytes)) {
        const request = frame.raw;
        seen.push(request);
        const result =
          request.method === "mail.send"
            ? {
                operation: "op-00000000-0000-4000-8000-000000000001",
                state: "pending",
              }
            : request.method === "operation.get"
            ? {
                operation: "",
                state: "failed",
                error: { code: "REQUEST_NOT_FOUND", message: "request not found", retry: "same-key" },
              }
            : {
                text: "L".repeat(textBytes),
                truncated: false,
                observedAtMs: 1,
              };
        const reply = encodeFrame({ v: 1, id: request.id, ok: true, result });
        socket.write(reply.subarray(0, 2));
        setImmediate(() => socket.end(reply.subarray(2)));
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, resolve);
    });
    await run(new Client({ cwd: root, env: { ...process.env, HOME: root, OMA_SOCKET: path } }), seen, () => connections, path);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}

test("F4: fragmented larger frames work in both directions without retrying", {
  timeout: 5000,
}, async () => {
  await withFrame(String(512 * 1024), () =>
    withServer(300 * 1024, async (client, seen, connections) => {
      const logs = await client.query("logs.read", params);
      assert.equal(logs.text, "L".repeat(300 * 1024));
      const sent = await client.sendMail(mail(300 * 1024), "original-key");
      assert.equal(JSON.parse(sent).receipt.state, "pending");
      assert.equal(seen.length, 2);
      assert.equal(connections(), 2);
      assert.equal(seen[1]?.request, "original-key");
      assert.ok(Buffer.byteLength(JSON.stringify(seen[1])) > 256 * 1024);
    }),
  );
});

test("F4: a lower configured limit is enforced in both directions", {
  timeout: 5000,
}, async () => {
  await withFrame("512", () =>
    withServer(1024, async (client, seen) => {
      // Fits the two-frame request cache, but not one wire frame.
      await assert.rejects(
        client.sendMail(mail(512), "same-key"),
        error => error instanceof ClientError && error.exitCode === 3 && error.request === "same-key",
      );
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.method, "operation.get");
      await assert.rejects(client.query("logs.read", params), {
        code: "FRAME_TOO_LARGE",
      });
      assert.equal(seen.length, 2);
    }),
  );
});

test("F4: malformed or unsupported limits fail before socket connection, never fall back", {
  timeout: 5000,
}, async () => {
  await withServer(1, async (_client, seen, connections, path) => {
    for (const value of [
      "",
      "0",
      "-1",
      "1.5",
      "NaN",
      "Infinity",
      "1e6",
      "0x40000",
      " 262144 ",
      "9007199254740992",
      "4294967296",
      String(MIN_LOG_FRAME_BYTES - 1),
    ]) {
      await withFrame(value, async () => {
        const configured = new Client({ cwd: process.cwd(), env: { ...process.env, OMA_SOCKET: path } });
        await assert.rejects(configured.query("logs.read", params), {
          code: "INVALID_REQUEST",
        });
      });
    }
    assert.equal(connections(), 0);
    assert.equal(seen.length, 0);
  });
});
