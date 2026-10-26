/** Listener acquisition and actual close observations for one Broker lifetime.
 * The Broker still owns admission, connection drain and final Store/lease release. */
import type { BrokerListener } from "./ports.js";
import { StoreError } from "@oma/domain/errors";

export class BrokerListeners {
  private readonly listening = new Map<BrokerListener, Promise<void>>();
  private readonly closing = new Set<Promise<void>>();
  constructor(private readonly onError: (error: unknown) => void) {}

  listen(server: BrokerListener, path: string, prepare: () => void = () => {}): void {
    const ready = new Promise<void>((resolve, reject) => {
      server.once("listening", () => {
        try { prepare(); resolve(); } catch (error) { this.onError(error); reject(error); }
      });
      // The handler remains after bind: a late listener error belongs to this
      // owner too, even when the initial readiness promise already settled.
      server.on("error", error => { this.onError(error); reject(error); });
      try { server.listen(path); } catch (error) { reject(error); }
    });
    this.listening.set(server, ready);
    void ready.catch(() => undefined);
  }
  ready(server: BrokerListener): Promise<void> {
    const ready = this.listening.get(server);
    if (ready === undefined) throw new StoreError("INTERNAL_ERROR", "listener has no acquisition owner");
    return ready;
  }
  close(server: BrokerListener): void {
    const ready = this.listening.get(server);
    if (ready === undefined) return;
    this.listening.delete(server);
    // Preparation may fail after bind acquired a listener. Rejected readiness
    // therefore still needs an actual close callback, before Store/lock drain.
    const closing = ready.then(() => undefined, () => undefined).then(() => new Promise<void>(resolve => {
      try { server.close(() => resolve()); }
      catch (error) {
        // Keep this close pending: the lifetime's existing grace can expire,
        // but an unanswered close never becomes a completed resource return.
        this.onError(error);
      }
    }));
    this.closing.add(closing);
    void closing.then(() => this.closing.delete(closing));
  }
  closeAll(): void { for (const server of this.listening.keys()) this.close(server); }
  get size(): number { return this.listening.size; }
  get pendingCloses(): readonly Promise<void>[] { return [...this.closing]; }
}
