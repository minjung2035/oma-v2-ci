import { TransportSpool } from "@oma/storage/transport-spool";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcConnection } from "@oma/broker/connection";
import { SharedPeerPin } from "@oma/broker/peer-pin";

/** Actual CLI and RPC framing with a controlled local application peer. No live
 * broker startup, authentication, user-manager or deployment proof is implied. */
export async function runCliWithPeer(
  home: string,
  cwd: string,
  args: readonly string[],
  handle: (
    request: Record<string, unknown>,
    body: AsyncIterable<Uint8Array> | null,
  ) => Promise<object>,
  preload?: string,
) {
  const socketPath = join(home, "peer.sock");
  const temporary = join(home, "tmp");
  mkdirSync(temporary, { recursive: true });
  const connections = new Set<RpcConnection>();
  const tasks = new Set<Promise<void>>();
  const errors: unknown[] = [];
  const requests: Record<string, unknown>[] = [];
  const server = createServer((socket) => {
    const connection = new RpcConnection({
      socket,
      makeSpool: descriptor => new TransportSpool(home, descriptor),
      peer: new SharedPeerPin(
        () => true,
        () => {},
      ),
      limits: {
        frameBytes: 256 * 1024,
        idleStreamSeconds: 10,
        receiptWaitSeconds: 10,
      },
      preflight(raw) {
        const params = raw.params as { bundle?: { bytes?: unknown } };
        if (params?.bundle)
          assert.ok(
            typeof params.bundle.bytes === "number" &&
              params.bundle.bytes <= 4 * 1024 * 1024,
          );
      },
      handle: async (request, body) => {
        requests.push(request);
        try {
          return await handle(request, body);
        } catch (error) {
          errors.push(error);
          throw error;
        }
      },
      onTask(task) {
        tasks.add(task);
        void task
          .finally(() => tasks.delete(task))
          .catch((error) => errors.push(error));
      },
      onCleanupError: (error) => errors.push(error),
      onClosed: () => connections.delete(connection),
    });
    connections.add(connection);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    const result = await new Promise<{
      status: number | string;
      signal: string | null;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        process.execPath,
        [
          ...(preload ? ["--import", preload] : []),
          fileURLToPath(new URL("../../../apps/oma/dist/cli.js", import.meta.url)),
          ...args,
        ],
        {
          cwd,
          env: {
            ...process.env,
            HOME: home,
            TMPDIR: temporary,
            OMA_SOCKET: socketPath,
            OMA_FRAME_BYTES: "262144",
          },
          timeout: 20000,
          killSignal: "SIGKILL",
          maxBuffer: 1024 * 1024,
          encoding: "utf8",
        },
        (error, stdout, stderr) =>
          resolve({
            status: error?.code ?? 0,
            signal: error?.signal ?? null,
            stdout,
            stderr,
          }),
      );
    });
    await Promise.all(tasks);
    assert.deepEqual(
      errors,
      [],
      "fixture transport errors are not successful CLI observations",
    );
    return { ...result, requests };
  } finally {
    for (const connection of connections) connection.close();
    await Promise.allSettled(tasks);
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
