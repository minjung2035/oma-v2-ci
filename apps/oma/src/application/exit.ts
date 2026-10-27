/** The single process.exit owner for the product surface. The exit a failure
 * gets is the CLI's (CLI-003, DR13): `errorExit` is the one reading of what a
 * code says -- 2 settled, 3 not known, 4 unsupported -- so an unknown outcome
 * is never reported here as a settled failure.
 */
import { writeSync } from "node:fs";
import type { ErrorCode } from "@oma/contracts/errors";
import { errorCodeOf, errorExit } from "@oma/domain/errors";

export type ExitCode = 0 | 2 | 3 | 4;

export function exitFor(code: ErrorCode): ExitCode { return errorExit(code); }

export function codeFor(error: unknown): ExitCode { return exitFor(errorCodeOf(error)); }

export function fail(message: string, code: ExitCode): never {
  const stream = process.stderr;
  const text = `oma: ${message}\n`;
  // A stream write is buffered; `process.exit` on its heels can drop the
  // message when the stream is a pipe (NB-06). Writing the fd itself is what
  // drains it -- and even that write may land short on a nonblocking pipe,
  // so it loops and hands only the unwritten remainder to the buffered path.
  const fd = (stream as { fd?: unknown }).fd;
  let rest: Buffer | null = Buffer.from(text);
  if (typeof fd === "number") {
    let written = 0;
    // Even a synchronous write may land short on a nonblocking fd, and the
    // next one then answers EAGAIN while its reader catches up -- or the
    // write is interrupted and says EINTR. Both deserve a short, bounded
    // wait rather than an instant fallback to the buffered path that exit
    // drops; never an infinite one, since exiting is all that is left.
    const wait = new Int32Array(new SharedArrayBuffer(4));
    for (let attempts = 0; written < rest.length; ) {
      try {
        const next = writeSync(fd, rest, written);
        if (next <= 0) break;
        written += next;
        attempts = 0;
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if ((code !== "EAGAIN" && code !== "EINTR") || ++attempts > 8) break;
        Atomics.wait(wait, 0, 0, 8);
      }
    }
    // Whatever the fd already took is not written again; the buffered path
    // gets only the remainder.
    rest = written >= rest.length ? null : rest.subarray(written);
  }
  if (rest !== null) {
    try { stream.write(rest); } catch { /* nothing left to say it on */ }
  }
  process.exit(code);
}

export function done(): never { process.exit(0); }
