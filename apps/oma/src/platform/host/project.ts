/** The host's side of project sync (macos-platform §6).
 *
 * The Mac repository is the Human's. The host's git reads it to make a
 * bundle and writes only `refs/remotes/oma/*` and their objects (MAC-420).
 * It trusts nothing the repository says about running things (MAC-404): the
 * product's trusted environment, an empty hooks path, and the settings that
 * would run a program overridden on the command line; it runs only bundle,
 * fetch and inspection commands, never one that touches the working tree.
 */
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { closeSync, constants, createReadStream, fstatSync, fsyncSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { writeHostBytes, removeHostStaged } from "@oma/platform-mac/files";
import type { Socket } from "node:net";
import { StoreError } from "@oma/domain/errors";
import { encodeFrame } from "@oma/protocol/frame";
import { PlatformError, unknownOutcome } from "@oma/protocol/host-errors";
import { readLeadingResponse } from "../rpc.js";
import { borrowedFileRange, withStreamSource } from "../stream-source.js";
import { receiveDeclared } from "../stream-receive.js";
import { type Declared, type StreamSink } from "@oma/contracts/stream";

/** §4.8 put: declares the file, sends it, and waits for the guest to say it
 * arrived as declared. */
export async function putStream(opened: { socket: Socket; rest: Buffer }, key: string, path: string, frameBytes: number): Promise<void> {
  const { socket } = opened;
  // Keep the socket owned even while hashing or reading the file. Pipeline
  // observes error/close as well as backpressure; a lost drain cannot hang it.
  const failed = (): void => { socket.destroy(); };
  socket.on("error", failed);
  try {
    if (opened.rest.length > 0) socket.unshift(opened.rest);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    await withStreamSource(fd, async fd => {
      const source = fstatSync(fd);
      if (!source.isFile()) throw new StoreError("INVALID_REQUEST", "a stream source must be a regular file");
      const bytes = source.size;
      const hash = createHash("sha256");
      if (bytes > 0) for await (const chunk of borrowedFileRange(fd, bytes)) hash.update(chunk as Buffer);
      const sha256 = hash.digest("hex");
      socket.write(encodeFrame({ v: 1, id: "put", method: "stream.put", params: { key, bytes, sha256 } }));
      try {
        if (bytes > 0) await pipeline(borrowedFileRange(fd, bytes), socket, { end: false });
      } catch { throw unknownOutcome("the stream transfer could not be observed"); }
      const answer = await readLeadingResponse(socket, "put", frameBytes, 10 * 60_000);
      if (answer.result.bytes !== bytes || answer.result.sha256 !== sha256)
        throw unknownOutcome("the engine's stream receipt was malformed");
    });
  } finally { socket.destroy(); socket.off("error", failed); }
}

/** §4.8 get: the declared stream into the sink `sinkFor` makes once the
 * guest has declared it (P0V-104: the one receiver, `receiveDeclared`). */
export async function getStream(opened: { socket: Socket; rest: Buffer }, key: string, sinkFor: (declared: Declared) => StreamSink,
  frameBytes: number, kind: "export" | "archive" = "export"): Promise<Declared> {
  const { socket } = opened;
  if (opened.rest.length > 0) socket.unshift(opened.rest);
  try {
    socket.write(encodeFrame({ v: 1, id: "get", method: "stream.get", params: { key, kind } }));
    const answer = await readLeadingResponse(socket, "get", frameBytes, 60_000);
    const declared = answer.result;
    if (!Number.isSafeInteger(declared.bytes) || (declared.bytes as number) < 0 || typeof declared.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(declared.sha256))
      throw new PlatformError({ code: "ENGINE_UNAVAILABLE", message: "the engine's stream declaration was malformed", retry: "same-key" });
    const stream = { bytes: declared.bytes as number, sha256: declared.sha256 };
    await receiveDeclared(socket, answer.rest, stream, sinkFor(stream));
    return stream;
  } finally { socket.destroy(); }
}

/** A plain file the host keeps only while it uses it (an export bundle in
 * its transfer directory): written, flushed at the end, removed on failure. */
export function fileSink(path: string): StreamSink {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  let open = true;
  const close = (): void => { if (open) { open = false; closeSync(fd); } };
  return {
    write: chunk => { writeHostBytes(fd, chunk); },
    complete: () => { try { fsyncSync(fd); } finally { close(); } },
    abandon: () => { try { close(); } catch { /* already closed */ } removeHostStaged(path); },
  };
}
