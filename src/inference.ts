// MUST [INF-001..006]: reservation and conservative settlement; provider codec S-04 stays gated.
import type { Actor, AuthContext, Failure, InferenceEvent, InferenceStart, Json } from "../implementation/contracts.js";
import { Store, type StoreReads } from "./store.js";
import { StoreError } from "./domain/errors.js";
import { assertActorIdentity, assertCurrentActor, resolvedSpecOf } from "./authority.js";
import { LineageSnapshot, type LineageNode } from "./domain/lineage.js";
import { sumUsage, permitsReservation } from "./domain/usage-budget.js";

export interface InferenceConfig {
  inferenceSlots: number; principalReservedSlots: number; societyUnits: number; lineageUnits: number;
  principalReservedUnits: number; maxUnitsPerRequest: number;
}
export interface ProviderTransport {
  /** SPIKE [S-04]: real provider codec is pinned deployment data. null => unresolved. */
  stream(requestId: string, profile: string, payload: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncIterable<InferenceEvent> | null;
}
interface Waiter { actor: Actor; finish: (acquired: boolean) => void }

/** MUST [INF-002]: FIFO among eligible waiters; residents cannot consume the reserve. */
export class InferenceSlot {
  private active: Actor[] = [];
  private waiters: Waiter[] = [];
  constructor(private readonly total: number, private readonly principalReserved: number, private readonly isPrincipal: (actor: Actor) => boolean) {
    if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(principalReserved) || principalReserved < 0 || principalReserved > total)
      throw new RangeError("invalid inference slot limits");
  }
  availableFor(actor: Actor): number {
    const free = this.total - this.active.length;
    if (this.isPrincipal(actor)) return free;
    const residents = this.active.filter(name => !this.isPrincipal(name)).length;
    return Math.max(0, Math.min(free, this.total - this.principalReserved - residents));
  }
  acquire(actor: Actor): boolean {
    if (this.availableFor(actor) < 1) return false;
    this.active.push(actor); return true;
  }
  release(actor: Actor): void {
    const index = this.active.indexOf(actor);
    if (index < 0) return;
    this.active.splice(index, 1); this.pump();
  }
  waitForSlot(actor: Actor, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      const waiter: Waiter = { actor, finish: acquired => {
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(acquired);
      } };
      const abort = () => { waiter.finish(false); this.pump(); };
      const timer = setTimeout(abort, 300000);
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter); this.pump();
    });
  }
  private pump(): void {
    for (;;) {
      const waiter = this.waiters.find(value => this.availableFor(value.actor) > 0);
      if (!waiter) return;
      this.acquire(waiter.actor); waiter.finish(true);
    }
  }
}

/** Compatibility spelling retained; relationship semantics live in LineageSnapshot. */
export interface LiageNode extends LineageNode {}
type BudgetReader = Pick<StoreReads, "listAgents" | "usageRows">;
export function lineageOf(store: Pick<StoreReads, "listAgents">, actor: Actor): LiageNode[] {
  return new LineageSnapshot(store.listAgents()).ancestors(actor).map(node => ({ name: node.name, createdBy: node.createdBy }));
}
export function reservationAllowed(store: BudgetReader, cfg: InferenceConfig, actor: Actor, requestedUnits: number, isPrincipal: boolean): boolean {
  const graph = new LineageSnapshot(store.listAgents());
  return permitsReservation(graph, store.usageRows(), cfg, actor, requestedUnits, isPrincipal);
}
export function sumUnits(store: BudgetReader, root: string | null, residentsOnly = false): number {
  return sumUsage(new LineageSnapshot(store.listAgents()), store.usageRows(), root, residentsOnly);
}

export class InferenceModule {
  private readonly slots: InferenceSlot;
  private readonly calls = new Map<string, { actor: Actor; incarnation: number; controller: AbortController }>();
  private readonly fenced = new Map<Actor, number>();
  constructor(private readonly store: Store, private readonly cfg: InferenceConfig, private readonly provider: ProviderTransport) {
    if (!Number.isSafeInteger(cfg.maxUnitsPerRequest) || cfg.maxUnitsPerRequest <= 0)
      throw new StoreError("UNSUPPORTED_PROFILE", "no pinned per-request billing upper bound (S-04)");
    this.slots = new InferenceSlot(cfg.inferenceSlots, cfg.principalReservedSlots, actor => actor === "principal");
  }
  slotAvailability(actor: Actor): number { return this.slots.availableFor(actor); }
  /** Existing usage never triggers provider replay; actor identity is checked first. */
  private existingOutcome(auth: AuthContext, requestId: string): AsyncIterable<InferenceEvent> | null {
    const usage = this.store.getUsage(requestId);
    if (!usage) return null;
    if (usage.actor !== auth.actor) throw new StoreError("AUTH_FAILED", "not your inference request");
    return (async function* () {
      yield { v: 1, request: requestId, sequence: 0, event: "error", error: {
        code: "REQUEST_KEY_REUSED", message: `usage ${usage.outcome} already recorded`, retry: "never",
      } };
    })();
  }
  async *open(auth: AuthContext, input: InferenceStart, payload: AsyncIterable<Uint8Array>): AsyncIterable<InferenceEvent> {
    assertActorIdentity(this.store, auth);
    const isPrincipal = auth.actor === "principal";
    const existing = this.existingOutcome(auth, input.request);
    if (existing) { for await (const event of existing) yield event; return; }
    if (auth.incarnation <= (this.fenced.get(auth.actor) ?? -1)) {
      yield this.errorOf(input.request, 0, { code: "STALE_RUN", message: "inference run was fenced", retry: "never" }); return;
    }
    if (this.calls.has(input.request)) {
      yield this.errorOf(input.request, 0, { code: "REQUEST_KEY_REUSED", message: "inference request is already active", retry: "never" }); return;
    }
    const controller = new AbortController();
    this.calls.set(input.request, { actor: auth.actor, incarnation: auth.incarnation, controller });
    let acquired = false; let reserved = false;
    try {
      acquired = await this.slots.waitForSlot(auth.actor, controller.signal);
      if (!acquired || controller.signal.aborted) {
        yield this.errorOf(input.request, 0, { code: "DEADLINE_EXCEEDED", message: "inference slot wait cancelled/timed out", retry: "same-key" }); return;
      }
      const upperBound = this.upperBoundUnits(input);
      const accepted = this.store.transaction(tx => {
        const actor = assertCurrentActor(this.store, auth);
        if (resolvedSpecOf(actor).modelProfile !== input.profile)
          throw new StoreError("UNSUPPORTED_PROFILE", "inference profile does not match frozen authority");
        if (this.store.getUsage(input.request)) return "existing" as const;
        if (!reservationAllowed(this.store, this.cfg, auth.actor, upperBound, isPrincipal)) return false;
        tx.reserveUsage({ requestId: input.request, actor: auth.actor, incarnation: auth.incarnation,
          profile: input.profile, pricingRevision: input.codecRevision, reservedUnits: upperBound });
        return true;
      });
      if (accepted === "existing") { for await (const event of this.existingOutcome(auth, input.request)!) yield event; return; }
      reserved = accepted;
      if (!accepted) {
        yield this.errorOf(input.request, 0, { code: "QUOTA_EXCEEDED", message: "society/lineage/reserve cap exceeded", retry: "never" }); return;
      }
      const stream = this.provider.stream(input.request, input.profile, payload, controller.signal);
      if (!stream) {
        this.store.transaction(tx => tx.settleUsage(input.request, "cancelled", 0, null));
        yield this.errorOf(input.request, 0, { code: "SPIKE_UNRESOLVED", message: "provider codec not pinned (S-04)", retry: "never" }); return;
      }
      let sequence = 0;
      for await (const event of stream) {
        if (controller.signal.aborted) return;
        const next = { ...event, v: 1 as const, request: input.request, sequence: sequence++ };
        if (next.event === "end") {
          const reported = readReportedUnits(next.data);
          this.store.transaction(tx => tx.settleUsage(input.request, reported === null ? "unknown" : "completed", reported, JSON.stringify(detailsOf(next.data))));
        }
        yield next;
        if (next.event === "end") return;
      }
    } finally {
      try {
        if (reserved && this.store.getUsage(input.request)?.outcome === "reserved")
          this.store.transaction(tx => tx.settleUsage(input.request, "unknown", null, null));
      } finally {
        controller.abort(); this.calls.delete(input.request);
        if (acquired) this.slots.release(auth.actor);
      }
    }
  }
  async cancel(auth: AuthContext, request: string): Promise<void> {
    assertActorIdentity(this.store, auth);
    const call = this.calls.get(request);
    if (call) {
      if (call.actor !== auth.actor || call.incarnation !== auth.incarnation) throw new StoreError("AUTH_FAILED", "not your inference run");
      call.controller.abort();
    }
    const usage = this.store.getUsage(request);
    if (!usage) return;
    if (usage.actor !== auth.actor) throw new StoreError("AUTH_FAILED", "not your inference request");
    if (usage.outcome === "reserved") this.store.transaction(tx => tx.settleUsage(request, "unknown", null, null));
  }
  async fence(actor: Actor, incarnation: number): Promise<void> {
    this.fenced.set(actor, Math.max(incarnation, this.fenced.get(actor) ?? -1));
    for (const call of this.calls.values()) if (call.actor === actor && call.incarnation === incarnation) call.controller.abort();
    const rows = this.store.usageRows().filter(usage => usage.actor === actor && usage.incarnation === incarnation && usage.outcome === "reserved");
    for (const row of rows) this.store.transaction(tx => tx.settleUsage(row.requestId, "unknown", null, null));
  }
  private upperBoundUnits(input: InferenceStart): number { void input.codecRevision; return this.cfg.maxUnitsPerRequest; }
  private errorOf(request: string, sequence: number, error: Failure): InferenceEvent {
    return { v: 1, request, sequence, event: "error", error };
  }
}
function readReportedUnits(data: unknown): number | null {
  if (typeof data === "number" && Number.isSafeInteger(data) && data >= 0) return data;
  if (typeof data === "object" && data !== null && "reportedUnits" in data) {
    const value = data.reportedUnits;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null; // Missing/invalid reported cost is unknown, never proof of zero.
}
function detailsOf(data: unknown): Json | null {
  if (data === null || data === undefined) return null;
  if (typeof data === "object" && !Array.isArray(data)) return {};
  return null; // Only a pinned S-04 codec may introduce accounting-detail fields.
}
