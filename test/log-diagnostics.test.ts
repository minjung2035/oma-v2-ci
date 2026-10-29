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
    const source = `import { registerOmaTools } from ${JSON.stringify(import.meta.resolve("@oma/extension/mail-tools"))};
${clientProcessSource(`(async () => {
  const tools = new Map();
  registerOmaTools({ registerTool: tool => tools.set(tool.name, tool) }, process.cwd());
  const result = await tools.get("oma_logs").execute("logs-query", { agent: "alice", sinceSeconds: ${JSON.stringify(sinceSeconds)} });
  return result.content[0].text;
})()`)}`;
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
test("DR27: typed log queries distinguish complete empty results from truncated ones", async () => {
  const empty = await logs(600);
  assert.equal(empty.code, 0); assert.equal(empty.calls, 1);
  assert.deepEqual(JSON.parse(empty.out), { text: "", truncated: false, observedAtMs: 1 });
  const partial = await logs(600, true);
  assert.equal(partial.code, 0); assert.equal(partial.calls, 1);
  assert.deepEqual(JSON.parse(partial.out), { text: "", truncated: true, observedAtMs: 1 });
});
test("DR27: a duration outside the safe integer range never reaches the broker", async () => {
  const result = await logs(Number.MAX_SAFE_INTEGER + 1);
  assert.notEqual(result.code, 0); assert.equal(result.calls, 0);
  assert.match(result.err, /Invalid arguments for oma_logs/);
});
