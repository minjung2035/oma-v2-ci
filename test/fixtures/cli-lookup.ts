import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Receipt } from "@oma/contracts";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";

export interface CliLookupResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly requests: readonly Record<string, unknown>[];
}
/** A socket primitive, not a fake receipt-cache authority or Git implementation.
 * The actual CLI must ask operation.get; mutations are never handled here.
 */
export async function runCliWithLookup(
  home: string, cwd: string, args: readonly string[], key: string, receipt: Receipt,
): Promise<CliLookupResult> {
  const socketPath = join(home, `lookup-${randomUUID().slice(0, 8)}.sock`);
  const sockets = new Set<Socket>();
  const requests: Record<string, unknown>[] = [];
  const errors: unknown[] = [];
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", error => errors.push(error));
    const parser = new FrameParser(256 * 1024);
    socket.on("data", bytes => {
      try {
        assert.ok(Buffer.isBuffer(bytes));
        for (const { raw } of parser.feed(bytes)) {
          requests.push(raw);
          assert.equal(raw.v, 1);
          assert.equal(typeof raw.id, "string");
          assert.equal(raw.method, "operation.get", "replay may only perform an authoritative lookup");
          assert.deepEqual(raw.params, { key });
          assert.equal(Object.hasOwn(raw, "request"), false);
          socket.end(encodeFrame({ v: 1, id: raw.id, ok: true, result: receipt }));
        }
      } catch (error) { errors.push(error); socket.destroy(); }
    });
  });
  let child: ReturnType<typeof spawn> | null = null;
  let closed: Promise<number | null> | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => { server.off("error", reject); resolve(); });
    });
    server.on("error", error => errors.push(error));
    child = spawn(process.execPath, [fileURLToPath(new URL("../../../apps/oma/dist/cli.js", import.meta.url)), ...args], {
      cwd, env: { ...process.env, HOME: home, OMA_SOCKET: socketPath },
      stdio: ["ignore", "pipe", "pipe"], timeout: 5000, killSignal: "SIGKILL",
    });
    const processHandle = child;
    let stdout = ""; let stderr = "";
    let outputBytes = 0;
    const capture = (bytes: Buffer, output: boolean): void => {
      outputBytes += bytes.length;
      if (outputBytes > 1024 * 1024) { errors.push(new Error("CLI fixture output overflow")); processHandle.kill("SIGKILL"); return; }
      if (output) stdout += bytes.toString("utf8"); else stderr += bytes.toString("utf8");
    };
    child.stdout?.on("data", (bytes: Buffer) => capture(bytes, true));
    child.stderr?.on("data", (bytes: Buffer) => capture(bytes, false));
    child.on("error", error => errors.push(error));
    closed = new Promise(resolve => processHandle.once("close", status => resolve(status)));
    const status = await closed;
    assert.deepEqual(errors, [], "lookup fixture transport must be valid");
    return { status, stdout, stderr, requests };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (closed) await closed;
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
