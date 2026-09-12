// MUST [INF-001..006]: domain orchestration only; production S-04 remains unconnected.
import type { Actor, AuthContext, Failure, InferenceEvent, InferenceStart } from "../implementation/contracts.js";
import { Store, type StoreReads } from "./store.js";
import { StoreError } from "./domain/errors.js";
import { assertActorIdentity, assertCurrentActor, resolvedSpecOf } from "./authority.js";
import { LineageSnapshot, type LineageNode } from "./domain/lineage.js";
import { sumUsage, permitsReservation } from "./domain/usage-budget.js";
import { InferenceSlot } from "./inference/slots.js";
import { InferenceCall, reportedUnits, accountingDetails } from "./inference/call.js";
export { InferenceSlot } from "./inference/slots.js";
export type { SlotLease, SlotWaitResult } from "./inference/slots.js";

export interface InferenceConfig {
  inferenceSlots: number; principalReservedSlots: number; societyUnits: number; lineageUnits: number;
  principalReservedUnits: number; maxUnitsPerRequest: number;
}
export interface ProviderTransport {
  /** S-04: null is the adapter's explicit no-contact result, not a disconnected stream. */
  stream(requestId: string, profile: string, payload: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncIterable<InferenceEvent> | null;
}
export interface LiageNode extends LineageNode {}
type BudgetReader = Pick<StoreReads, "listAgents" | "usageRows">;
export function lineageOf(store: Pick<StoreReads, "listAgents">, actor: Actor): LiageNode[] {
  return new LineageSnapshot(store.listAgents()).ancestors(actor).map(node => ({ name: node.name, createdBy: node.createdBy }));
}
export function reservationAllowed(store: BudgetReader, cfg: InferenceConfig, actor: Actor, requestedUnits: number, isPrincipal: boolean): boolean {
  return permitsReservation(new LineageSnapshot(store.listAgents()), store.usageRows(), cfg, actor, requestedUnits, isPrincipal);
}
export function sumUnits(store: BudgetReader, root: string | null, residentsOnly = false): number {
  return sumUsage(new LineageSnapshot(store.listAgents()), store.usageRows(), root, residentsOnly);
}

export class InferenceModule {
  private readonly slots: InferenceSlot;
  private readonly calls = new Map<string, InferenceCall>();
  private readonly fenced = new Map<Actor, number>();
  private closed = false;
  constructor(private readonly store: Store, private readonly cfg: InferenceConfig, private readonly provider: ProviderTransport) {
    if (!Number.isSafeInteger(cfg.maxUnitsPerRequest) || cfg.maxUnitsPerRequest <= 0)
      throw new StoreError("UNSUPPORTED_PROFILE", "no pinned per-request billing upper bound (S-04)");
    this.slots = new InferenceSlot(cfg.inferenceSlots, cfg.principalReservedSlots, actor => actor === "principal");
  }
  slotAvailability(actor: Actor): number { return this.slots.availableFor(actor); }
  private existingOutcome(auth: AuthContext, input: InferenceStart): AsyncIterable<InferenceEvent> | null {
    const usage = this.store.getUsage(input.request);
    if (!usage) return null;
    if (usage.actor !== auth.actor || usage.incarnation !== auth.incarnation)
      throw new StoreError("AUTH_FAILED", "not your inference request incarnation");
    if (usage.profile !== input.profile || usage.pricingRevision !== input.codecRevision)
      throw new StoreError("REQUEST_KEY_REUSED", "inference identity differs from the recorded reservation");
    return (async function* () {
      yield { v: 1 as const, request: input.request, sequence: 0, event: "error" as const, error: {
        code: "REQUEST_KEY_REUSED" as const, message: `usage ${usage.outcome} already recorded`, retry: "never" as const,
      } };
    })();
  }
  async *open(auth: AuthContext, source: InferenceStart, payload: AsyncIterable<Uint8Array>): AsyncIterable<InferenceEvent> {
    const input = Object.freeze({ ...source, payload: Object.freeze({ ...source.payload }) });
    const actor = assertCurrentActor(this.store, auth);
    if (resolvedSpecOf(actor).modelProfile !== input.profile)
      throw new StoreError("UNSUPPORTED_PROFILE", "inference profile does not match frozen authority");
    const existing = this.existingOutcome(auth, input);
    if (existing) { for await (const event of existing) yield event; return; }
    if (this.closed || auth.incarnation <= (this.fenced.get(auth.actor) ?? -1)) {
      yield this.errorOf(input.request, 0, { code: "STALE_RUN", message: "inference run was fenced or closed", retry: "never" }); return;
    }
    const active = this.calls.get(input.request);
    if (active) {
      if (active.actor !== auth.actor || active.incarnation !== auth.incarnation)
        throw new StoreError("AUTH_FAILED", "not your active inference request");
      yield this.errorOf(input.request, 0, { code: "REQUEST_KEY_REUSED", message: "inference request is already active", retry: "never" }); return;
    }
    const call = new InferenceCall(input.request, auth.actor, auth.incarnation);
    this.calls.set(input.request, call);
    try {
      const slot = await this.slots.waitForSlot(auth.actor, call.controller.signal);
      if (slot.state !== "acquired") {
        yield this.errorOf(input.request, 0, { code: "DEADLINE_EXCEEDED", message: "inference slot wait cancelled/timed out", retry: "same-key" }); return;
      }
      try {
        if (call.controller.signal.aborted) return;
        const upperBound = this.upperBoundUnits(input);
        const accepted = this.store.transaction(tx => {
          const current = assertCurrentActor(this.store, auth);
          if (resolvedSpecOf(current).modelProfile !== input.profile)
            throw new StoreError("UNSUPPORTED_PROFILE", "inference profile does not match frozen authority");
          if (this.store.getUsage(input.request)) return "existing" as const;
          if (!reservationAllowed(this.store, this.cfg, auth.actor, upperBound, auth.actor === "principal")) return false;
          tx.reserveUsage({ requestId: input.request, actor: auth.actor, incarnation: auth.incarnation,
            profile: input.profile, pricingRevision: input.codecRevision, reservedUnits: upperBound });
          return true;
        });
        if (accepted === "existing") {
          const outcome = this.existingOutcome(auth, input);
          if (!outcome) throw new StoreError("STORE_CORRUPT", "reservation winner disappeared");
          for await (const event of outcome) yield event;
          return;
        }
        if (!accepted) {
          yield this.errorOf(input.request, 0, { code: "QUOTA_EXCEEDED", message: "society/lineage/reserve cap exceeded", retry: "never" }); return;
        }
        call.reserve();
        if (call.controller.signal.aborted) { this.settleAborted(call); return; }
        // The call may contact the provider synchronously; record that phase first.
        call.beginContact();
        const stream = this.provider.stream(input.request, input.profile, payload, call.controller.signal);
        if (stream === null) {
          this.store.transaction(tx => tx.settleUsage(input.request, "cancelled", 0, null));
          call.settle("cancelled");
          yield this.errorOf(input.request, 0, { code: "SPIKE_UNRESOLVED", message: "provider codec not pinned (S-04)", retry: "never" }); return;
        }
        let sequence = 0;
        for await (const event of stream) {
          if (call.controller.signal.aborted) return;
          const next = { ...event, v: 1 as const, request: input.request, sequence: sequence++ };
          if (next.event === "end") {
            const reported = reportedUnits(next.data);
            const outcome = reported === null ? "unknown" : "completed";
            this.store.transaction(tx => tx.settleUsage(input.request, outcome, reported, JSON.stringify(accountingDetails(next.data))));
            call.settle(outcome);
          }
          yield next;
          if (next.event === "end") return;
        }
      } finally { slot.lease.release(); }
    } finally {
      try {
        if (call.ownsReservation && this.store.getUsage(input.request)?.outcome === "reserved") {
          this.store.transaction(tx => tx.settleUsage(input.request, "unknown", null, null));
          call.settle("unknown");
        }
      } finally {
        call.controller.abort();
        if (this.calls.get(input.request) === call) this.calls.delete(input.request);
      }
    }
  }
  private settleAborted(call: InferenceCall): void {
    call.controller.abort();
    if (!call.ownsReservation || this.store.getUsage(call.request)?.outcome !== "reserved") return;
    const beforeContact = call.phase === "reserved";
    this.store.transaction(tx => tx.settleUsage(call.request, beforeContact ? "cancelled" : "unknown", beforeContact ? 0 : null, null));
    call.settle(beforeContact ? "cancelled" : "unknown");
  }
  async cancel(auth: AuthContext, request: string): Promise<void> {
    assertActorIdentity(this.store, auth);
    const call = this.calls.get(request);
    if (call) {
      if (call.actor !== auth.actor || call.incarnation !== auth.incarnation) throw new StoreError("AUTH_FAILED", "not your inference run");
      this.settleAborted(call);
    }
    const usage = this.store.getUsage(request);
    if (!usage) return;
    if (usage.actor !== auth.actor || usage.incarnation !== auth.incarnation) throw new StoreError("AUTH_FAILED", "not your inference request incarnation");
    if (usage.outcome === "reserved") this.store.transaction(tx => tx.settleUsage(request, "unknown", null, null));
  }
  async fence(actor: Actor, incarnation: number): Promise<void> {
    this.fenced.set(actor, Math.max(incarnation, this.fenced.get(actor) ?? -1));
    for (const call of this.calls.values()) if (call.actor === actor && call.incarnation === incarnation) this.settleAborted(call);
    for (const row of this.store.usageRows()) {
      if (row.actor === actor && row.incarnation === incarnation && row.outcome === "reserved")
        this.store.transaction(tx => tx.settleUsage(row.requestId, "unknown", null, null));
    }
  }
  /** Startup accounting only; it neither replays providers nor creates an endpoint. */
  recoverReservations(): number {
    if (this.calls.size > 0) throw new StoreError("INTERNAL_ERROR", "startup accounting cannot run over live calls");
    let recovered = 0;
    for (const row of this.store.usageRows()) if (row.outcome === "reserved") {
      this.store.transaction(tx => tx.settleUsage(row.requestId, "unknown", null, null)); recovered++;
    }
    return recovered;
  }
  shutdown(): void {
    this.closed = true; this.slots.close();
    for (const call of this.calls.values()) this.settleAborted(call);
    // Noncooperative providers keep their own live slot until iterator cleanup.
    // A real provider/input/abort deadline requires the still-unresolved S-04/D05 policy.
  }
  private upperBoundUnits(input: InferenceStart): number {
    void input.codecRevision; // Mock/domain bound, not proof from a real pinned pricing codec.
    return this.cfg.maxUnitsPerRequest;
  }
  private errorOf(request: string, sequence: number, error: Failure): InferenceEvent {
    return { v: 1, request, sequence, event: "error", error };
  }
}
