// MUST [INF-001..006]: inference slot/waiter, lineage quota, reservation and
// settle. The provider *codec* is SPIKE [S-04] gated: without a pinned
// provider codec the open() stream refuses with SPIKE_UNRESOLVED (never an
// arbitrary HTTP proxy). Reservation/quota/unknown accounting is real and is
// exercisable with a mock provider (SP-04-T).
import type {
  Actor,
  AuthContext,
  InferenceEvent,
  InferenceStart,
  Json,
} from "../implementation/contracts.js";
import { Store, StoreError } from "./store.js";
import { assertCurrentActor, resolvedSpecOf } from "./authority.js";

export interface InferenceConfig {
  inferenceSlots: number; // quota.inferenceSlots
  principalReservedSlots: number; // quota.principalReservedSlots
  societyUnits: number; // quota.societyUnits (reserved commitment cap)
  lineageUnits: number; // quota.lineageUnits per lineage
  principalReservedUnits: number; // quota.principalReservedUnits
  /** MUST [SP-04-A]: host-pinned per-request upper bound; 0 => unsupported. */
  maxUnitsPerRequest: number;
}

export interface ProviderTransport {
  /** SPIKE [S-04]: real provider codec is pinned deployment data. null => unresolved. */
  stream(
    requestId: string,
    profile: string,
    payload: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): AsyncIterable<InferenceEvent> | null;
}

interface Waiter {
  actor: Actor;
  finish: (acquired: boolean) => void;
}

/** MUST [INF-002]: FIFO among eligible waiters; residents cannot consume the reserve. */
export class InferenceSlot {
  // ponytail: scan bounded active slots; use counters if large slot counts matter.
  private active: Actor[] = [];
  private waiters: Waiter[] = [];

  constructor(
    private readonly total: number,
    private readonly principalReserved: number,
    private readonly isPrincipal: (actor: Actor) => boolean,
  ) {
    if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(principalReserved) || principalReserved < 0 || principalReserved > total)
      throw new RangeError("invalid inference slot limits");
  }

  availableFor(actor: Actor): number {
    const free = this.total - this.active.length;
    if (this.isPrincipal(actor)) return free;
    const residents = this.active.filter(a => !this.isPrincipal(a)).length;
    return Math.max(0, Math.min(free, this.total - this.principalReserved - residents));
  }

  acquire(actor: Actor): boolean {
    if (this.availableFor(actor) < 1) return false;
    this.active.push(actor);
    return true;
  }

  release(actor: Actor): void {
    const index = this.active.indexOf(actor);
    if (index < 0) return;
    this.active.splice(index, 1);
    this.pump();
  }

  /** MUST [RUN-002]: cancellation and timeout settle this waiter, never another one. */
  waitForSlot(actor: Actor, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      const waiter: Waiter = { actor, finish: acquired => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(acquired);
      } };
      const abort = () => { waiter.finish(false); this.pump(); };
      const timer = setTimeout(abort, 300000);
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter);
      this.pump();
    });
  }

  private pump(): void {
    for (;;) {
      const waiter = this.waiters.find(w => this.availableFor(w.actor) > 0);
      if (!waiter) return;
      this.acquire(waiter.actor);
      waiter.finish(true);
    }
  }
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
    if (seen.has(cur))
      throw new StoreError("STORE_CORRUPT", `created_by cycle at ${cur}`);
    seen.add(cur);
    const a = store.getAgent(cur);
    if (!a) throw new StoreError("STORE_CORRUPT", `missing lineage actor ${cur}`);
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
  if (!Number.isSafeInteger(requestedUnits) || requestedUnits < 0) return false;
  const society = sumUnits(store, null);
  if (society + requestedUnits > cfg.societyUnits) return false;
  if (!isPrincipal && sumUnits(store, null, true) + requestedUnits > cfg.societyUnits - cfg.principalReservedUnits) return false;
  for (const node of lineageOf(store, actor)) {
    const sum = sumUnits(store, node.name);
    if (sum + requestedUnits > cfg.lineageUnits) return false;
  }
  return true;
}

/** committed+reserved+unknown units attributed to an actor subtree (or all when createdBy scope is null). */
export function sumUnits(
  store: Store,
  root: string | null,
  residentsOnly = false,
): number {
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
      if (!names.has(root)) {
        names.add(root);
        changed = true;
      }
    }
  }
  let total = 0;
  for (const u of store.usageRows()) {
    if (!names.has(u.actor) || (residentsOnly && u.actor === "principal")) continue;
    const units = u.outcome === "completed" || u.outcome === "cancelled" ? u.reportedUnits : u.reservedUnits;
    if (units === null || !Number.isSafeInteger(units) || units < 0)
      throw new StoreError("STORE_CORRUPT", "invalid settled usage units");
    total += units;
    if (!Number.isSafeInteger(total)) throw new StoreError("STORE_CORRUPT", "usage sum exceeds integer range");
  }
  return total;
}

export class InferenceModule {
  private readonly slots: InferenceSlot;
  private readonly calls = new Map<string, { actor: Actor; incarnation: number; controller: AbortController }>();
  private readonly fenced = new Map<Actor, number>();

  constructor(
    private readonly store: Store,
    private readonly cfg: InferenceConfig,
    private readonly provider: ProviderTransport,
  ) {
    if (
      !Number.isSafeInteger(cfg.maxUnitsPerRequest) ||
      cfg.maxUnitsPerRequest <= 0
    ) {
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        "no pinned per-request billing upper bound (S-04)",
      );
    }
    this.slots = new InferenceSlot(
      cfg.inferenceSlots,
      cfg.principalReservedSlots,
      (a) => a === "principal",
    );
  }

  /** exposed slot view for operators/tests; the slot object stays internal. */
  slotAvailability(actor: Actor): number {
    return this.slots.availableFor(actor);
  }

  /** MUST [INF-005]: same request id -> existing outcome, never a re-call. */
  private existingOutcome(
    requestId: string,
  ): AsyncIterable<InferenceEvent> | null {
    const u = this.store.getUsage(requestId);
    if (!u) return null;
    return (async function* () {
      yield {
        v: 1,
        request: requestId,
        sequence: 0,
        event: "error",
        error: {
          code: "REQUEST_KEY_REUSED",
          message: `usage ${u.outcome} already recorded`,
          retry: "never",
        },
      };
    })();
  }

  async *open(
    auth: AuthContext,
    input: InferenceStart,
    payload: AsyncIterable<Uint8Array>,
  ): AsyncIterable<InferenceEvent> {
    const isPrincipal = auth.actor === "principal";
    const existing = this.existingOutcome(input.request);
    if (existing) {
      for await (const e of existing) yield e;
      return;
    }
    if (auth.incarnation <= (this.fenced.get(auth.actor) ?? -1)) {
      yield this.errorOf(input.request, 0, { code: "STALE_RUN", message: "inference run was fenced", retry: "never" });
      return;
    }
    if (this.calls.has(input.request)) {
      yield this.errorOf(input.request, 0, { code: "REQUEST_KEY_REUSED", message: "inference request is already active", retry: "never" });
      return;
    }
    const controller = new AbortController();
    this.calls.set(input.request, { actor: auth.actor, incarnation: auth.incarnation, controller });
    let acquired = false;
    let reserved = false;
    try {
      acquired = await this.slots.waitForSlot(auth.actor, controller.signal);
      if (!acquired || controller.signal.aborted) {
        yield this.errorOf(input.request, 0, { code: "DEADLINE_EXCEEDED", message: "inference slot wait cancelled/timed out", retry: "same-key" });
        return;
      }
      const upperBound = this.upperBoundUnits(input);
      // MUST [INF-003]: check all budgets and reserve in the same transaction.
      const accepted = this.store.transaction((_tx) => {
        const actor = assertCurrentActor(this.store, auth);
        if (resolvedSpecOf(actor).modelProfile !== input.profile)
          throw new StoreError("UNSUPPORTED_PROFILE", "inference profile does not match frozen authority");
        if (this.store.getUsage(input.request)) return "existing" as const;
        if (!reservationAllowed(this.store, this.cfg, auth.actor, upperBound, isPrincipal)) return false;
        this.store.reserveUsage({
          requestId: input.request, actor: auth.actor, incarnation: auth.incarnation,
          profile: input.profile, pricingRevision: input.codecRevision, reservedUnits: upperBound,
        });
        return true;
      });
      if (accepted === "existing") {
        for await (const event of this.existingOutcome(input.request)!) yield event;
        return;
      }
      reserved = accepted;
      if (!accepted) {
        yield this.errorOf(input.request, 0, { code: "QUOTA_EXCEEDED", message: "society/lineage/reserve cap exceeded", retry: "never" });
        return;
      }
      // SPIKE [S-04]: without the pinned provider codec there is no transport.
      const stream = this.provider.stream(
        input.request,
        input.profile,
        payload,
        controller.signal,
      );
      if (!stream) {
        this.store.transaction((_tx) => {
          this.store.settleUsage(input.request, "cancelled", 0, null);
        });
        yield this.errorOf(input.request, 0, {
          code: "SPIKE_UNRESOLVED",
          message: "provider codec not pinned (S-04)",
          retry: "never",
        });
        return;
      }
      let seq = 0;
      for await (const evt of stream) {
        if (controller.signal.aborted) return;
        const e = {
          ...evt,
          v: 1 as const,
          request: input.request,
          sequence: seq++,
        };
        if (e.event === "end") {
          // MUST [INF-004]: settle only on provider-confirmed detail. The unit
          // field shape is SPIKE [S-04] data; the mock/pinned codec carries the
          // reported integer in data.reportedUnits and the module narrows it.
          const reported = readReportedUnits(e.data);
          this.store.transaction((_tx) => {
            this.store.settleUsage(
              input.request,
              reported === null ? "unknown" : "completed",
              reported,
              JSON.stringify(detailsOf(e.data)),
            );
          });
        }
        yield e;
        if (e.event === "end") return;
      }
    } finally {
      try {
        if (reserved && this.store.getUsage(input.request)?.outcome === "reserved")
          this.store.transaction(() => this.store.settleUsage(input.request, "unknown", null, null));
      } finally {
        controller.abort();
        this.calls.delete(input.request);
        if (acquired) this.slots.release(auth.actor);
      }
    }
  }

  async cancel(auth: AuthContext, request: string): Promise<void> {
    const call = this.calls.get(request);
    if (call) {
      if (call.actor !== auth.actor || call.incarnation !== auth.incarnation) throw new StoreError("AUTH_FAILED", "not your inference run");
      call.controller.abort();
    }
    const u = this.store.getUsage(request);
    if (!u) return;
    if (u.actor !== auth.actor)
      throw new StoreError("AUTH_FAILED", "not your inference request");
    // A reserved row alone does not prove that provider contact never happened.
    if (u.outcome === "reserved") {
      this.store.transaction((_tx) => {
        this.store.settleUsage(request, "unknown", null, null);
      });
    }
  }

  /** MUST [INF-006]/[LIFE-003]: revoke the run: drop waiters and cancel active streams. */
  async fence(actor: Actor, incarnation: number): Promise<void> {
    this.fenced.set(actor, Math.max(incarnation, this.fenced.get(actor) ?? -1));
    for (const call of this.calls.values())
      if (call.actor === actor && call.incarnation === incarnation) call.controller.abort();
    const rows = this.store
      .usageRows()
      .filter(
        (u) =>
          u.actor === actor &&
          u.incarnation === incarnation &&
          u.outcome === "reserved",
      );
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

  private errorOf(
    request: string,
    seq: number,
    error: { code: string; message: string; retry: string },
  ): InferenceEvent {
    return {
      v: 1,
      request,
      sequence: seq,
      event: "error",
      error: error as never,
    };
  }
}

function readReportedUnits(data: unknown): number | null {
  if (typeof data === "number" && Number.isSafeInteger(data) && data >= 0)
    return data;
  if (typeof data === "object" && data !== null) {
    const v = (data as Record<string, unknown>).reportedUnits;
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
  }
  return null; // Missing/invalid reported cost is unknown, never proof of zero.
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
