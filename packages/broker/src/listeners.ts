/** Listener acquisition and actual close observations for one Broker lifetime.
 * The Broker still owns admission, connection drain and final Store/lease release. */
import type { Server } from "node:net";
import { StoreError } from "@oma/domain/errors";

export class BrokerListeners {
  private readonly listening = new Map<Server, Promise<void>>();
  private readonly closing = new Set<Promise<void>>();
  constructor(private readonly onError: (error: unknown) => void) {}

  listen(server: Server, path: string): void {
    const ready = new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      // The handler remains after bind: a late listener error belongs to this
      // owner too, even when the initial readiness promise already settled.
      server.on("error", error => { this.onError(error); reject(error); });
      try { server.listen(path); } catch (error) { reject(error); }
    });
    this.listening.set(server, ready);
    void ready.catch(() => undefined);
  }
  ready(server: Server): Promise<void> {
    const ready = this.listening.get(server);
    if (ready === undefined) throw new StoreError("INTERNAL_ERROR", "listener has no acquisition owner");
    return ready;
  }
  close(server: Server): void {
    const ready = this.listening.get(server);
    if (ready === undefined) return;
    this.listening.delete(server);
    const closing = ready.then(() => new Promise<void>(resolve => {
      try { server.close(() => resolve()); } catch { resolve(); }
    }), () => { try { server.close(); } catch { /* failed bind owns no listening handle */ } });
    this.closing.add(closing);
    void closing.then(() => this.closing.delete(closing));
  }
  closeAll(): void { for (const server of this.listening.keys()) this.close(server); }
  get size(): number { return this.listening.size; }
  get pendingCloses(): readonly Promise<void>[] { return [...this.closing]; }
}
