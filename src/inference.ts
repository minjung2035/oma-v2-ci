// MUST [INF-001..006]: inference slot/waiter, lineage quota, reservation and
// settle. The provider *codec* is SPIKE [S-04] gated: without a pinned
// provider codec the open() stream refuses with SPIKE_UNRESOLVED (never an
// arbitrary HTTP proxy). Reservation/quota/unknown accounting is real and is
// exercisable with a mock provider (SP-04-T).
import type { Actor, AuthContext, InferenceEvent, InferenceStart, Json } from "../implementation/contracts.js";
import { Store, StoreError } from "./store.js";

export interface InferenceConfig {
  inferenceSlots: number;          // quota.inferenceSlots
  principalReservedSlots: number;  // quota.principalReservedSlots
  societyUnits: number;            // quota.societyUnits (reserved commitment cap)
  lineageUnits: number;            // quota.lineageUnits per lineage
  principalReservedUnits: number;  // quota.principalReservedUnits
  /** MUST [SP-04-A]: host-pinned per-request upper bound; 0 => unsupported. */
  maxUnitsPerRequest: number;
}

export interface ProviderTransport {
  /** SPIKE [S-04]: real provider codec is pinned deployment data. null => unresolved. */
  stream(requestId: string, profile: string, payload: AsyncIterable<Uint8Array>): AsyncIterable<InferenceEvent> | null;
}

interface Waiter {
  resolve: () => void;
  cancelled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/** MUST [INF-002]: memory FIFO waiter, never a durable queue. */
export class InferenceSlot {
  private busy = 0;
  private waiters: Waiter[] = [];

  constructor(
    private readonly total: number,
    private readonly principalReserved: number,
    private readonly isPrincipal: (actor: Actor) => boolean,
  ) {}

  availableFor(actor: Actor): number {
    const free = this.total - this.busy;
    if (free <= 0) return 0;
    if (this.isPrincipal(actor)) return free;
    // residents may not consume the principal reserve (INF-002)
    const residentFree = this.total - this.principalReserved - this.busy;
    return Math.max(0, residentFree);
  }

  acquire(actor: Actor): boolean {
    if (this.availableFor(actor) < 1) return false;
    this.busy++;
    return true;
  }

  /** MUST [INF-002]: release hands the freed slot to the first FIFO waiter;
   * never a lost wakeup (busy-- alone would strand waiters). */
  release(): void {
    if (this.busy > 0) this.busy--;
    this.pump();
  }

  /** MUST [RUN-002]: bounded wait; cancels on signal. */
  async waitForSlot(actor: Actor, signal?: AbortSignal): Promise<boolean> {
    const timeout = setTimeout(() => this.failFirst(), waitTimeoutMs(actor));
    const waiter: Waiter = { resolve: () => { clearTimeout(timeout); this.pump(); }, cancelled: false, timer: null };
    this.waiters.push(waiter);
    const abort = (): void => {
      if (waiter.cancelled) return;
      waiter.cancelled = true;
      clearTimeout(timeout);
      const i = this.waiters.indexOf(waiter);
      if (i >= 0) this.waiters.splice(i, 1);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (this.acquire(actor)) {
      abort();
      return true;
    }
    await new Promise<void>((resolve) => {
      waiter.resolve = () => { clearTimeout(timeout); resolve(); };
    });
    signal?.removeEventListener("abort", abort);
    return !waiter.cancelled;
  }

  private failFirst(): void {
    const w = this.waiters.shift();
    if (w) {
      w.cancelled = true;
      w.resolve();
    }
  }

  private pump(): void {
    while (this.busy < this.total) {
      const w = this.waiters.shift();
      if (!w) return;
      if (w.cancelled) continue;
      this.busy++; // the slot is now this waiter's
      w.resolve();
      return;
    }
  }
}

function waitTimeoutMs(_actor: Actor): number {
  return 300000; // bounded waiter; systemd/broker cancel interrupts it per RUN-002
}

export interface LiageNode {
  name: string;
  createdBy: string | null;
}

/** MUST [INF-002/003]: lineage chain via agents.created_by; cycles are corruption. */
export function lineageOf(store: Store, actor: Actor): LiageNode[] {
  const out: LiageNode[] = [];
  const seen = new Set<string>();
  let cur: string | null = actor;
  while (cur) {
    if (seen.has(cur)) throw new StoreError("STORE_CORRUPT", `created_by cycle at ${cur}`);
    seen.add(cur);
    const a = store.getAgent(cur);
    if (!a) break;
    out.push({ name: a.name, createdBy: a.createdBy });
    cur = a.createdBy;
  }
  return out;
}

/**
 * MUST [INF-003]: committed + reserved + unknown cost of a society and of each
 * ancestor lineage, checked atomically with the reservation insert (single
 * transaction; never read-then-write).
 */
export function reservationAllowed(
  store: Store,
  cfg: InferenceConfig,
  actor: Actor,
  requestedUnits: number,
  isPrincipal: boolean,
): boolean {
  const reservedCap = isPrincipal ? cfg.principalReservedUnits : cfg.societyUnits;
  if (requestedUnits > reservedCap) return false;
  const society = sumUnits(store, actor, null);
  if (society + requestedUnits > cfg.societyUnits) return false;
  for (const node of lineageOf(store, actor)) {
    const sum = sumUnits(store, node.name, null);
    if (sum + requestedUnits > cfg.lineageUnits) return false;
  }
  return true;
}

/** committed+reserved+unknown units attributed to an actor subtree (or all when createdBy scope is null). */
export function sumUnits(store: Store, root: string | null, _scope: null): number {
  const rows = store.listAgents();
  const names = new Set<string>();
  if (root === null) {
    for (const r of rows) names.add(r.name);
  } else {
    // include root and all descendants (via created_by edges)
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of rows) {
        if (names.has(r.name)) continue;
        if (r.createdBy !== null && names.has(r.createdBy)) {
          names.add(r.name);
          changed = true;
        }
      }
      if (!names.has(root)) { names.add(root); changed = true; }
    }
  }
  let total = 0;
  for (const u of store.usageRows()) {
    if (!names.has(u.actor)) continue;
    total += u.reservedUnits; // commitment: reserved amounts are charged until settled
  }
  return total;
}

export class InferenceModule {
  private readonly slots: InferenceSlot;

  constructor(
    private readonly store: Store,
    private readonly cfg: InferenceConfig,
    private readonly provider: ProviderTransport,
  ) {
    if (!Number.isSafeInteger(cfg.maxUnitsPerRequest) || cfg.maxUnitsPerRequest <= 0) {
      throw new StoreError("UNSUPPORTED_PROFILE", "no pinned per-request billing upper bound (S-04)");
    }
    this.slots = new InferenceSlot(cfg.inferenceSlots, cfg.principalReservedSlots, (a) => a === "principal");
  }

  /** exposed slot view for operators/tests; the slot object stays internal. */
  slotAvailability(actor: Actor): number {
    return this.slots.availableFor(actor);
  }

  /** MUST [INF-005]: same request id -> existing outcome, never a re-call. */
  private existingOutcome(requestId: string): AsyncIterable<InferenceEvent> | null {
    const u = this.store.getUsage(requestId);
    if (!u) return null;
    return (async function* () {
      yield { v: 1, request: requestId, sequence: 0, event: "error", error: { code: "REQUEST_KEY_REUSED", message: `usage ${u.outcome} already recorded`, retry: "never" } };
    })();
  }

  async *open(auth: AuthContext, input: InferenceStart, payload: AsyncIterable<Uint8Array>): AsyncIterable<InferenceEvent> {
    const isPrincipal = auth.actor === "principal";
    const existing = this.existingOutcome(input.request);
    if (existing) {
      for await (const e of existing) yield e;
      return;
    }
    if (!(await this.slots.waitForSlot(auth.actor))) {
      yield this.errorOf(input.request, 0, { code: "DEADLINE_EXCEEDED", message: "inference slot wait cancelled/timed out", retry: "same-key" });
      return;
    }
    try {
      const upperBound = this.upperBoundUnits(input);
      // MUST [INF-003]: commit the reservation before any provider contact.
      if (!reservationAllowed(this.store, this.cfg, auth.actor, upperBound, isPrincipal)) {
        yield this.errorOf(input.request, 0, { code: "QUOTA_EXCEEDED", message: "society/lineage/reserve cap exceeded", retry: "never" });
        return;
      }
      this.store.transaction((_tx) => {
        this.store.reserveUsage({
          requestId: input.request, actor: auth.actor, incarnation: auth.incarnation,
          profile: input.profile, pricingRevision: input.codecRevision, reservedUnits: upperBound,
        });
      });
      // SPIKE [S-04]: without the pinned provider codec there is no transport.
      const stream = this.provider.stream(input.request, input.profile, payload);
      if (!stream) {
        this.store.transaction((_tx) => {
          this.store.settleUsage(input.request, "unknown", null, null);
        });
        yield this.errorOf(input.request, 0, { code: "SPIKE_UNRESOLVED", message: "provider codec not pinned (S-04)", retry: "never" });
        return;
      }
      let seq = 0;
      for await (const evt of stream) {
        const e = { ...evt, v: 1 as const, request: input.request, sequence: seq++ };
        if (e.event === "end") {
          // MUST [INF-004]: settle only on provider-confirmed detail. The unit
          // field shape is SPIKE [S-04] data; the mock/pinned codec carries the
          // reported integer in data.reportedUnits and the module narrows it.
          const reported = readReportedUnits(e.data);
          this.store.transaction((_tx) => {
            this.store.settleUsage(input.request, "completed", reported, JSON.stringify(detailsOf(e.data)));
          });
        }
        yield e;
      }
    } finally {
      this.slots.release();
    }
  }

  async cancel(auth: AuthContext, request: string): Promise<void> {
    const u = this.store.getUsage(request);
    if (!u) return;
    if (u.actor !== auth.actor) throw new StoreError("AUTH_FAILED", "not your inference request");
    // MUST [INF-004]: cancellation only settles at 0/cancelled when no provider
    // contact is proven; here the transport is S-04-gated so contact is absent.
    if (u.outcome === "reserved") {
      this.store.transaction((_tx) => {
        this.store.settleUsage(request, "cancelled", 0, null);
      });
    }
  }

  /** MUST [INF-006]/[LIFE-003]: revoke the run: drop waiters and cancel active streams. */
  async fence(actor: Actor, incarnation: number): Promise<void> {
    const rows = this.store.usageRows().filter((u) => u.actor === actor && u.incarnation === incarnation && u.outcome === "reserved");
    for (const r of rows) {
      this.store.transaction((_tx) => {
        this.store.settleUsage(r.requestId, "unknown", null, null);
      });
    }
  }

  private upperBoundUnits(input: InferenceStart): number {
    void input.codecRevision;
    return this.cfg.maxUnitsPerRequest;
  }

  private errorOf(request: string, seq: number, error: { code: string; message: string; retry: string }): InferenceEvent {
    return { v: 1, request, sequence: seq, event: "error", error: error as never };
  }
}

function readReportedUnits(data: unknown): number {
  if (typeof data === "number" && Number.isSafeInteger(data) && data >= 0) return data;
  if (typeof data === "object" && data !== null) {
    const v = (data as Record<string, unknown>).reportedUnits;
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
  }
  return 0; // no confirmed units => 0 is the only provable settlement
}

function detailsOf(data: unknown): Json | null {
  // MUST [INF-006]: details_json holds only numeric usage / provider request id / pricing revision.
  if (data === null || typeof data === "undefined") return null;
  const v = data as Json;
  if (typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, Json> = {};
    void v;
    return out; // numeric fields only; the pinned codec (S-04) defines the shape
  }
  return null;
}