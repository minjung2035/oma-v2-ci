/** Memory-only hints. The callback re-reads its authoritative inputs; this
 * object owns neither accepted work nor process-death/activation evidence. */
import { AsyncLocalStorage } from "node:async_hooks";
export class CoalescedWake {
  private requested = false;
  private closed = false;
  private active: Promise<void> | null = null;
  private readonly ended = Promise.resolve();
  // A hint must not lend its request/transaction/recovery context to the
  // owner's callback, including a hint raised by the callback's own work.
  private readonly dispatch = AsyncLocalStorage.snapshot();
  constructor(private readonly run: () => Promise<void>) {}

  request(): Promise<void> {
    if (this.closed) return this.ended;
    this.requested = true;
    if (this.active !== null) return this.active;
    const work = this.dispatch(() => Promise.resolve().then(async () => {
      while (!this.closed && this.requested) {
        this.requested = false;
        await this.run();
      }
    }));
    const owned = work.finally(() => { if (this.active === owned) this.active = null; });
    this.active = owned;
    return owned;
  }

  /** The current callback remains its caller's task until it settles. Close
   * prevents every queued/future callback, including one requested in flight. */
  close(): void { this.closed = true; this.requested = false; }
}
