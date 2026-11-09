/** One owner and one pending hint; callers never form an unbounded wait chain. */
export class ReconcileLane {
  private active: Promise<void> | null = null;
  private latest: Promise<void> | null = null;
  private again = false;
  private closed = false;
  constructor(private readonly work: () => Promise<void>, private readonly failure: (error: unknown) => void) {}
  request(): void {
    if (this.closed) return;
    if (this.active !== null) { this.again = true; return; }
    this.again = true;
    const owned = Promise.resolve().then(async () => {
      try {
        while (this.again && !this.closed) { this.again = false; await this.work(); }
      } catch (error) { this.failure(error); }
      finally {
        // Release in the continuation that checks the last hint. A later
        // microtask must start work instead of joining an already-drained pass.
        if (this.active === owned) this.active = null;
      }
    });
    this.active = owned;
    this.latest = owned;
    // The failure callback can close the mutation gate and throw. Retain that
    // rejection for join, while avoiding an unhandled background rejection.
    void owned.catch(() => {});
  }
  async join(): Promise<void> { await this.latest; }
  async close(): Promise<void> { this.closed = true; this.again = false; await this.join(); }
}
