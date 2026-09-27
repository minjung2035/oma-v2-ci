/** The stream channel's guest end (macos-platform §4.8): one connection,
 * one stream, declared before its bytes and kept only if they are what was
 * declared.
 *
 *   stream.put { key, bytes, sha256 } + the bytes  → { bytes, sha256 } | STREAM_INVALID
 *   stream.get { key, kind }                       → { bytes, sha256 } + the bytes
 *
 * A put is staged under its request key for the request that uses it
 * (project.import); a get sends what a request staged (project.export). The
 * size a put may have is what the data disk can take (D04's admission).
 */
import { createHash } from "node:crypto";
import { closeSync, constants, createReadStream, fsyncSync, statSync, statfsSync, unlinkSync, writeSync } from "node:fs";
import { entryAt, openBeneath, withinDirectory } from "../../storage/contained-fs.js";
import type { Socket } from "node:net";
import { encodeFrame } from "../../frame.js";
import { StoreError, errorCodeOf } from "../../domain/errors.js";
import { readLeadingFrame } from "../rpc.js";
import { isRequestKey, requestProblem } from "../../protocol/host-guest.js";
import { productText } from "../product-text.js";
import type { RequestLedger } from "./requests.js";

export interface StreamOptions {
  readonly ledger: RequestLedger;
  readonly frameBytes: number;
  readonly deadlineMs: number;
  /** Bytes the data disk must keep free after a put. */
  readonly reserveBytes: number;
  /** Where the data disk is, for its free space. */
  readonly dataDir: string;
}

export async function serveStream(socket: Socket, options: StreamOptions): Promise<void> {
  socket.on("error", () => { socket.destroy(); });
  let first: { frame: Record<string, unknown>; rest: Buffer };
  try { first = await readLeadingFrame(socket, options.frameBytes, options.deadlineMs); }
  catch { socket.destroy(); return; }
  const frame = first.frame;
  const id = typeof frame.id === "string" ? frame.id : "x";
  const answer = (value: Record<string, unknown>): void => { socket.write(encodeFrame({ v: 1, id, ...value })); };
  const refuse = (error: unknown): void => {
    const code = errorCodeOf(error);
    const message = error instanceof StoreError && productText(error.message) ? error.message : code;
    socket.end(encodeFrame({ v: 1, id, ok: false, error: { code, message, retry: "never" } }));
  };
  try {
    if (requestProblem(frame) !== null) throw new StoreError("INVALID_REQUEST", "a stream begins with stream.put or stream.get");
    const params = frame.params as Record<string, unknown>;
    if (!isRequestKey(params.key)) throw new StoreError("INVALID_REQUEST", "a stream names its request key");
    if (frame.method === "stream.put") {
      const { bytes, sha256 } = params;
      if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0 || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256))
        throw new StoreError("INVALID_REQUEST", "a put declares bytes and sha256");
      const disk = statfsSync(options.dataDir);
      if (bytes + options.reserveBytes > disk.bavail * disk.bsize) throw new StoreError("STORAGE_FULL", "the engine has no room for this");
      const target = options.ledger.staging(params.key, "bundle");
      await receive(socket, first.rest, target, bytes, sha256);
      answer({ ok: true, result: { bytes, sha256 } });
      socket.end();
      return;
    }
    if (frame.method === "stream.get") {
      if (params.kind !== "export" && params.kind !== "archive") throw new StoreError("INVALID_REQUEST", "a get names what was staged: export or archive");
      const source = options.ledger.staging(params.key, params.kind === "export" ? "export.bundle" : "archive.tar");
      let size: number;
      try { size = statSync(source).size; } catch { throw new StoreError("REQUEST_NOT_FOUND", "nothing was staged for this request"); }
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(source)) hash.update(chunk as Buffer);
      answer({ ok: true, result: { bytes: size, sha256: hash.digest("hex") } });
      createReadStream(source).pipe(socket);
      return;
    }
    throw new StoreError("UNKNOWN_METHOD", "a stream is stream.put or stream.get");
  } catch (error) { refuse(error); }
}

/** Writes exactly `bytes` to a new staging file and keeps it only if its
 * sha256 is the declared one. A stream that ends short, runs long, or hashes
 * differently leaves nothing behind. */
function receive(socket: Socket, head: Buffer, target: string, bytes: number, sha256: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // The ledger's directory is resolved once and the staging file named
    // through it (FS-005): the oma user's other processes share this uid.
    const fd = withinDirectory(target, (parent, name) => {
      try { unlinkSync(entryAt(parent, name)); } catch { /* none staged yet */ }
      return openBeneath(parent, name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    });
    const hash = createHash("sha256");
    let received = 0;
    let done = false;
    const finish = (error: Error | null): void => {
      if (done) return;
      done = true;
      socket.off("data", onData); socket.off("end", onEnd);
      try { if (error === null) fsyncSync(fd); } finally { closeSync(fd); }
      if (error !== null) {
        try { withinDirectory(target, (parent, name) => { unlinkSync(entryAt(parent, name)); }); } catch { /* already gone */ }
        reject(error); return;
      }
      resolve();
    };
    const onData = (chunk: Buffer): void => {
      if (received + chunk.length > bytes) { finish(new StoreError("STREAM_INVALID", "the stream is longer than declared")); return; }
      hash.update(chunk);
      for (let at = 0; at < chunk.length; ) at += writeSync(fd, chunk, at, chunk.length - at);
      received += chunk.length;
      if (received === bytes) finish(hash.digest("hex") === sha256 ? null : new StoreError("STREAM_INVALID", "the stream is not what was declared"));
    };
    const onEnd = (): void => { finish(new StoreError("STREAM_INVALID", "the stream ended before its declared length")); };
    socket.on("data", onData);
    socket.once("end", onEnd);
    if (head.length > 0) onData(head);
    if (bytes === 0) finish(hash.digest("hex") === sha256 ? null : new StoreError("STREAM_INVALID", "the stream is not what was declared"));
    socket.resume();
  });
}
