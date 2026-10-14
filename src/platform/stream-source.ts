/** P0-4, §4.8: a stream borrows a file descriptor held by its caller.
 * autoClose:false does not prevent ReadStream.destroy() from closing an FD
 * on error. The borrowed stream drains its in-flight read on destroy, but
 * never returns the descriptor; the caller closes it once after awaiting it. */
import { closeSync, createReadStream, read, type ReadStream } from "node:fs";
import { PlatformError } from "./rpc.js";

export function borrowedFileRange(fd: number, bytes: number): ReadStream {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new RangeError("a file range must have a positive safe byte count");
  return createReadStream("", { fd, start: 0, end: bytes - 1,
    fs: { read, close: (_fd, done) => { done(null); } } });
}

/** Takes the source FD from its opener. A failed close is never retried and
 * never replaces an earlier read/remote outcome; both observations survive. */
export async function withStreamSource<T>(fd: number, use: (fd: number) => Promise<T>): Promise<T> {
  let primary: { error: unknown } | null = null;
  try { return await use(fd); }
  catch (error) { primary = { error }; throw error; }
  finally {
    try { closeSync(fd); }
    catch (cleanup) {
      if (primary === null) throw cleanup;
      const cause = new AggregateError([primary.error, cleanup], "stream source and descriptor release both failed");
      if (primary.error instanceof PlatformError) throw new PlatformError(primary.error.failure, { cause });
      throw cause;
    }
  }
}
