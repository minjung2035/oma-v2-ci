/** P0V-104 (F-03, G13-01, X2-01, X2-02): the one receiver of a declared
 * stream (macos-platform §4.8), for the guest's put and the host's get.
 *
 * Exactly the declared number of bytes are taken from the socket into a
 * sink, hashed as they pass, and the sink is completed only when they hash to
 * the declared sha256. Whatever the sink's effects throw -- a full disk, a
 * quota, an I/O error -- ends the receive through its promise, with the sink
 * abandoned: a socket callback has no caller to catch an exception, so one
 * thrown there would end the whole process instead of this one stream.
 * Architecture rule `socket-callback-effects` keeps every other socket data
 * callback from making such effects itself.
 */
import { createHash } from "node:crypto";
import type { Socket } from "node:net";
import { StoreError } from "../domain/errors.js";

export interface StreamSink {
  /** Takes the next bytes. May throw; the receive then fails. */
  write(chunk: Buffer): void;
  /** All bytes arrived and hashed as declared: make them durable. */
  complete(): void;
  /** The receive failed: leave nothing behind. Must not throw. */
  abandon(): void;
}

export interface Declared { readonly bytes: number; readonly sha256: string }

export function receiveDeclared(socket: Socket, head: Buffer, declared: Declared, sink: StreamSink): Promise<void> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let received = 0;
    let done = false;
    const finish = (error: unknown): void => {
      if (done) return;
      done = true;
      socket.off("data", onData); socket.off("end", onEnd); socket.off("close", onEnd); socket.off("error", onError);
      if (error === null) {
        try { sink.complete(); resolve(); return; }
        catch (failure) { error = failure; }
      }
      sink.abandon();
      reject(error);
    };
    const onData = (chunk: Buffer): void => {
      if (done) return;
      if (received + chunk.length > declared.bytes) { finish(new StoreError("STREAM_INVALID", "the stream is longer than declared")); return; }
      try { sink.write(chunk); } catch (error) { finish(error); return; }
      hash.update(chunk);
      received += chunk.length;
      if (received === declared.bytes)
        finish(hash.digest("hex") === declared.sha256 ? null : new StoreError("STREAM_INVALID", "the stream is not what was declared"));
    };
    const onEnd = (): void => { finish(new StoreError("STREAM_INVALID", "the stream ended before its declared length")); };
    const onError = (): void => { finish(new StoreError("STREAM_INVALID", "the stream's connection failed")); };
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("close", onEnd);
    socket.once("error", onError);
    if (head.length > 0) onData(head);
    if (declared.bytes === 0 && !done)
      finish(hash.digest("hex") === declared.sha256 ? null : new StoreError("STREAM_INVALID", "the stream is not what was declared"));
    if (!done) socket.resume();
  });
}
