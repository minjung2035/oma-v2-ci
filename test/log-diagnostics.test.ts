import { decodePublicParams } from "@oma/protocol/methods";
import { TEST_PROTOCOL_LIMITS } from "./fixtures/limits.js";
import { clientProcessSource } from "./fixtures/client-process.js";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";

async function logs(sinceSeconds: number, truncated = false) {
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
        assert.equal(raw.method, "logs.read");
        assert.deepEqual(raw.params, { agent: "alice", sinceSeconds });
        socket.end(encodeFrame({ v: 1, id: raw.id, ok: true,
          result: { text: "", truncated, observedAtMs: 1 } }));
      }
    });
  });
  try {
    await new Promise<void>(resolve => server.listen(path, resolve));
    const source = clientProcessSource(`client.queryText("logs.read", { agent: "alice", sinceSeconds: ${JSON.stringify(sinceSeconds)} })`);
    const child = spawn(process.execPath, ["--input-type=module", "-e", source],
      { env: { PATH: "/usr/bin:/bin", HOME: root, OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: root, OMA_SOCKET: path }, stdio: ["ignore", "pipe", "pipe"] });
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
test("001. Typed log queries distinguish complete empty results from truncated ones", async () => {
  const empty = await logs(600);
  assert.equal(empty.code, 0); assert.equal(empty.calls, 1);
  assert.deepEqual(JSON.parse(empty.out), { text: "", truncated: false, observedAtMs: 1 });
  const partial = await logs(600, true);
  assert.equal(partial.code, 0); assert.equal(partial.calls, 1);
  assert.deepEqual(JSON.parse(partial.out), { text: "", truncated: true, observedAtMs: 1 });
});
// The retired oma_logs schema no longer owns caller validation. The retained
// backend decoder still has to reject durations it cannot represent safely.
test("002. Backend log durations reject unsafe values", () => {
  for (const sinceSeconds of [Number.MAX_SAFE_INTEGER + 1, -1, Infinity, NaN])
    assert.equal(decodePublicParams("logs.read", { agent: "alice", sinceSeconds },
      { limits: TEST_PROTOCOL_LIMITS }), null);
});
