import type { Actor } from "../../implementation/contracts.js";

export interface SlotLease { readonly actor: Actor; release(): void }
export type SlotWaitResult =
  | { readonly state: "acquired"; readonly lease: SlotLease }
  | { readonly state: "cancelled" }
  | { readonly state: "timedOut" };
type WaiterState = "queued" | SlotWaitResult["state"];
interface Waiter { readonly actor: Actor; state: WaiterState; finish(result: SlotWaitResult): void }

/** FIFO among eligible waiters, with the existing Principal reserved capacity.
 * The existing 300000ms deadline bounds each waiter lifetime. A global waiter
 * count needs a separately approved host budget (D05), not an invented default.
 */
export class InferenceSlot {
  private readonly active = new Map<SlotLease, Actor>();
  private readonly waiters: Waiter[] = [];
  private closed = false;
  constructor(private readonly total: number, private readonly principalReserved: number,
    private readonly isPrincipal: (actor: Actor) => boolean) {
    if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(principalReserved) || principalReserved < 0 || principalReserved > total)
      throw new RangeError("invalid inference slot limits");
  }
  availableFor(actor: Actor): number {
    if (this.closed) return 0;
    const free = this.total - this.active.size;
    if (this.isPrincipal(actor)) return free;
    const residents = [...this.active.values()].filter(name => !this.isPrincipal(name)).length;
    return Math.max(0, Math.min(free, this.total - this.principalReserved - residents));
  }
  private grant(actor: Actor): SlotLease | null {
    if (this.availableFor(actor) < 1) return null;
    const lease: SlotLease = Object.freeze({ actor, release: () => {
      if (this.active.delete(lease)) this.pump();
    } });
    this.active.set(lease, actor);
    return lease;
  }
  acquire(actor: Actor): SlotLease | null { this.pump(); return this.grant(actor); }
  release(lease: SlotLease): void { if (this.active.has(lease)) lease.release(); }
  waitForSlot(actor: Actor, signal?: AbortSignal): Promise<SlotWaitResult> {
    if (this.closed || signal?.aborted) return Promise.resolve({ state: "cancelled" });
    return new Promise(resolve => {
      const waiter: Waiter = { actor, state: "queued", finish: result => {
        if (waiter.state !== "queued") return;
        waiter.state = result.state;
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(result);
      } };
      const abort = () => { waiter.finish({ state: "cancelled" }); this.pump(); };
      const timer = setTimeout(() => { waiter.finish({ state: "timedOut" }); this.pump(); }, 300000);
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter); this.pump();
    });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of [...this.waiters]) waiter.finish({ state: "cancelled" });
    // Active leases remain with their calls until the provider iterator settles.
  }
  private pump(): void {
    while (!this.closed) {
      const waiter = this.waiters.find(value => value.state === "queued" && this.availableFor(value.actor) > 0);
      if (!waiter) return;
      const lease = this.grant(waiter.actor);
      if (!lease) return;
      waiter.finish({ state: "acquired", lease });
    }
  }
}
