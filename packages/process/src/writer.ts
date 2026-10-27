/** Bounded contention wait; an acquired writer remains owned until its
 * effect and any inherited child fence finish. No deadline interrupts writes. */
import { setTimeout as pause } from "node:timers/promises";
import { ProcessLock } from "@oma/native/process-lock";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";

export function assertWriterWait(waitMs: number): void {
  if (!Number.isFinite(waitMs) || waitMs <= 0)
    throw new StoreError("INVALID_REQUEST", "the writer lock wait must be a positive finite number of milliseconds");
}

export async function withProcessWriterLock<T>(path: string, run: (held: ProcessLock) => Promise<T>,
  options: { readonly waitMs: number; readonly signal?: AbortSignal; readonly busyMessage: string }): Promise<T> {
  assertWriterWait(options.waitMs);
  const deadline = performance.now() + options.waitMs;
  let held: ProcessLock;
  for (;;) {
    options.signal?.throwIfAborted();
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new StoreError("BROKER_UNAVAILABLE", options.busyMessage);
    let lock: ProcessLock | null;
    try { lock = ProcessLock.tryAcquire(path); }
    catch (error) {
      if (["EMFILE", "ENFILE", "EAGAIN"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw new StoreError("BROKER_UNAVAILABLE", "the writer lock could not be acquired; try again");
      throw error;
    }
    if (lock !== null) { held = lock; break; }
    // The existing 25 ms contention polling interval; never sleep beyond
    // the remaining budget. The monotonic deadline owns longer waits.
    await pause(Math.min(25, remaining), undefined, { signal: options.signal });
  }
  return withAsyncCleanup(async () => {
    options.signal?.throwIfAborted(); held.assertHeld(path);
    return await run(held);
  }, () => held.close());
}
