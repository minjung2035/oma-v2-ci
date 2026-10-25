import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";

async function logs(since: string, truncated = false) {
  const root = mkdtempSync(join(tmpdir(), "oma-log-diagnostic-"));
  const path = join(root, "actor.sock");
  const sockets = new Set<Socket>();
  let calls = 0;
  const server = createServer(socket => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
    const parser = new FrameParser(1024 * 1024);
    socket.on("data", bytes => {
      for (const { raw } of parser.feed(bytes as Buffer)) {
        calls++;
        socket.end(encodeFrame({ v: 1, id: raw.id, ok: true,
          result: { text: "", truncated, observedAtMs: 1 } }));
      }
    });
  });
  try {
    await new Promise<void>(resolve => server.listen(path, resolve));
    const child = spawn(process.execPath, [join(import.meta.dirname, "../..", DEPLOYMENT_LAYOUT.cli), "logs", "alice", "--since", since],
      { env: { PATH: "/usr/bin:/bin", HOME: root, OMA_SOCKET: path }, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = "";
    child.stdout.on("data", bytes => { out += String(bytes); });
    child.stderr.on("data", bytes => { err += String(bytes); });
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    return { code, out, err, calls };
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}
test("DR27: only a complete empty log query is described as having no entries", async () => {
  const empty = await logs("10m");
  assert.equal(empty.code, 0); assert.equal(empty.calls, 1);
  assert.equal(empty.out, "No log entries for alice in the last 10m.\n");
  const partial = await logs("10m", true);
  assert.equal(partial.code, 0); assert.doesNotMatch(partial.out, /No log entries/);
  assert.match(partial.err, /truncated/);
});
test("DR27: a duration that overflows when converted to seconds never reaches the broker", async () => {
  const result = await logs(`${Number.MAX_SAFE_INTEGER}d`);
  assert.equal(result.code, 2); assert.equal(result.calls, 0);
  assert.match(result.err, /duration exceeds the supported integer range/);
});
