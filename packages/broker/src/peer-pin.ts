import { StoreError } from "@oma/domain/errors";

export interface ConnectionPeerPin {
  /** The peer was observed running just now. False is "not verified running":
   * exited or not answered, which refuse alike and prove no death. */
  alive(): boolean;
  retainForExecution(): () => void;
  releaseConnection(): void;
}

/** One connection reference and at most one in-flight request reference.
 * Disconnect releases only the former. An already-dispatched coordinator keeps
 * its identity observation until it settles; live run-lease revocation is separate.
 */
export class SharedPeerPin implements ConnectionPeerPin {
  private connectionReleased = false;
  private executionHeld = false;
  private closed = false;
  constructor(private readonly observeAlive: () => boolean, private readonly closeNative: () => void) {}
  alive(): boolean {
    if (this.closed) return false;
    try { return this.observeAlive(); } catch { return false; }
  }
  retainForExecution(): () => void {
    if (this.closed || this.connectionReleased || this.executionHeld)
      throw new StoreError("AUTH_FAILED", "peer pin is closed or already held by a request");
    this.executionHeld = true;
    let released = false;
    return () => {
      if (released) return;
      released = true; this.executionHeld = false; this.maybeClose();
    };
  }
  releaseConnection(): void {
    if (this.connectionReleased) return;
    this.connectionReleased = true; this.maybeClose();
  }
  private maybeClose(): void {
    if (!this.closed && this.connectionReleased && !this.executionHeld) {
      this.closed = true; // Never retry close on an fd whose ownership is uncertain.
      this.closeNative();
    }
  }
}
