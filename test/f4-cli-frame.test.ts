import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callActor } from "#oma-test/app/cli/transport";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { MIN_LOG_FRAME_BYTES } from "@oma/protocol/log-response";

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
    path: string,
    seen: Record<string, unknown>[],
    connections: () => number,
  ) => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), "oma-cli-frame-"));
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
            : {
                text: "L".repeat(textBytes),
                truncated: false,
                observedAtMs: 1,
              };
        socket.write(encodeFrame({ v: 1, id: request.id, ok: true, result }));
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, resolve);
    });
    await run(path, seen, () => connections);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}

test("F4: configured larger frames work in both directions without retrying", {
  timeout: 5000,
}, async () => {
  await withFrame(String(512 * 1024), () =>
    withServer(300 * 1024, async (path, seen, connections) => {
      const logs = await callActor(path, "logs.read", params);
      assert.ok(
        logs[0]?.ok &&
          "text" in logs[0].result &&
          logs[0].result.text === "L".repeat(300 * 1024),
      );
      const sent = await callActor(
        path,
        "mail.send",
        mail(300 * 1024),
        "original-key",
      );
      assert.ok(
        sent[0]?.ok &&
          "state" in sent[0].result &&
          sent[0].result.state === "pending",
      );
      assert.equal(seen.length, 2);
      assert.equal(connections(), 2);
      assert.equal(seen[1]?.request, "original-key");
      assert.ok(Buffer.byteLength(JSON.stringify(seen[1])) > 256 * 1024);
    }),
  );
});

test("F4: omitted configuration retains the bounded 256 KiB default", {
  timeout: 5000,
}, async () => {
  await withFrame(undefined, async () => {
    await withServer(32, async (path) => {
      assert.equal((await callActor(path, "logs.read", params))[0]?.ok, true);
    });
    await withServer(300 * 1024, async (path, seen) => {
      await assert.rejects(
        callActor(path, "mail.send", mail(300 * 1024), "same-key"),
        { code: "FRAME_TOO_LARGE" },
      );
      assert.equal(
        seen.length,
        0,
        "oversized request never reaches the mock broker",
      );
      await assert.rejects(callActor(path, "logs.read", params), {
        code: "FRAME_TOO_LARGE",
      });
      assert.equal(seen.length, 1, "oversized response never triggers a retry");
    });
  });
});

test("F4: a lower configured limit is enforced in both directions", {
  timeout: 5000,
}, async () => {
  await withFrame("512", () =>
    withServer(1024, async (path, seen) => {
      await assert.rejects(
        callActor(path, "mail.send", mail(1024), "same-key"),
        { code: "FRAME_TOO_LARGE" },
      );
      assert.equal(seen.length, 0);
      await assert.rejects(callActor(path, "logs.read", params), {
        code: "FRAME_TOO_LARGE",
      });
      assert.equal(seen.length, 1);
    }),
  );
});

test("F4: malformed or unsupported limits fail before socket connection, never fall back", {
  timeout: 5000,
}, async () => {
  await withServer(1, async (path, seen, connections) => {
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
        await assert.rejects(callActor(path, "logs.read", params), {
          code: "INVALID_REQUEST",
        });
      });
    }
    assert.equal(connections(), 0);
    assert.equal(seen.length, 0);
  });
});
