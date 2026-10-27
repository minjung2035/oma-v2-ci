// AUTH-003/RUN-001: a pathname or dead connector is not proof that a run is dead.
import type { Actor, RunLease } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import type { ExecutionScopePin, SettlementQuiescence } from "@oma/contracts/runtime";
type Population = ReturnType<ExecutionScopePin["population"]>;

export interface RunIdentity {
  readonly actor: Actor;
  readonly incarnation: number;
  readonly invocationId: string;
  readonly scopeIdentity: unknown;
}
export interface RunEndpoint { readonly socketHostPath: string; done(): void }
export type RunPhase = "opening" | "live" | "revoked-awaiting-death" | "closed";
type RunState =
  | { readonly phase: "opening" }
  | { readonly phase: "live"; readonly lease: RunLease; readonly endpoint: RunEndpoint }
  | { readonly phase: "revoked-awaiting-death" }
  | { readonly phase: "closed" };

/** Owns the scope FD from opening through revoked-awaiting-death. */
export class OwnedRun {
  private state: RunState = { phase: "opening" };
  private waiting = false;
  readonly identity: RunIdentity;
  constructor(actor: Actor, incarnation: number, invocationId: string, private readonly pin: ExecutionScopePin) {
    this.identity = Object.freeze({ actor, incarnation, invocationId, scopeIdentity: pin.identity });
  }
  get phase(): RunPhase { return this.state.phase; }
  get invocationId(): string { return this.identity.invocationId; }
  get lease(): RunLease | null { return this.state.phase === "live" ? this.state.lease : null; }
  population(): Population { return this.state.phase === "closed" ? "unknown" : this.pin.population(); }
  matches(path: string): boolean { return this.state.phase === "live" && this.pin.matches(path); }
  confirmOpening(scope: string): void {
    if (this.state.phase !== "opening" || !this.pin.matches(scope) || this.pin.population() !== "populated")
      throw new StoreError("STALE_RUN", "opening run is revoked or its pinned scope changed");
  }
  publish(endpoint: RunEndpoint): RunLease {
    if (this.state.phase !== "opening") {
      endpoint.done();
      throw new StoreError("STALE_RUN", "run endpoint cannot be published twice");
    }
    const lease = Object.freeze({ actor: this.identity.actor, incarnation: this.identity.incarnation, socketHostPath: endpoint.socketHostPath });
    this.state = { phase: "live", lease, endpoint };
    return lease;
  }
  /** RUN-003: ephemeral intent belongs to this live incarnation, never its successor. */
  wait(incarnation: number, observe: boolean): boolean {
    if (this.state.phase !== "live" || incarnation !== this.identity.incarnation)
      throw new StoreError("STALE_RUN", "wait requires the current live run");
    if (!observe) this.waiting = true;
    return this.waiting;
  }
  revoke(): void {
    if (this.state.phase === "closed" || this.state.phase === "revoked-awaiting-death") return;
    const previous = this.state;
    this.state = { phase: "revoked-awaiting-death" };
    if (previous.phase === "live") previous.endpoint.done();
  }
  done(): void {
    if (this.state.phase === "closed") return;
    const previous = this.state;
    this.state = { phase: "closed" };
    try { if (previous.phase === "live") previous.endpoint.done(); }
    finally { this.pin.close(); }
  }
}

/** One registry owns each run pin; connection pidfds remain with SharedPeerPin. */
export class RunRegistry {
  private readonly records = new Map<Actor, OwnedRun>();
  constructor(private readonly acquire: (scope: string) => ExecutionScopePin) {
    if (typeof acquire !== "function") throw new StoreError("UNSUPPORTED_PROFILE", "run registry requires its platform scope observer");
  }
  get(actor: Actor): OwnedRun | undefined { return this.records.get(actor); }
  values(): IterableIterator<OwnedRun> { return this.records.values(); }
  begin(actor: Actor, incarnation: number, invocationId: string, scope: string): OwnedRun {
    const previous = this.records.get(actor);
    if (previous?.invocationId === invocationId)
      throw new StoreError("STALE_RUN", "an invocation cannot acquire a second run identity");
    if (!Number.isSafeInteger(incarnation) || incarnation < 1)
      throw new StoreError("STORE_CORRUPT", "invalid next incarnation");
    if (previous && previous.population() !== "empty")
      throw new StoreError("RUN_TERMINATION_UNKNOWN", "previous invocation scope is not proven empty");
    const pin = this.acquire(scope);
    if (pin.population() !== "populated" || !pin.matches(scope)) {
      pin.close();
      throw new StoreError("AUTH_FAILED", "current runner scope is not proven populated");
    }
    const record = new OwnedRun(actor, incarnation, invocationId, pin);
    // Publish the fence before any endpoint/transaction callback can fail.
    this.records.set(actor, record);
    try { previous?.done(); }
    catch (error) { record.revoke(); throw error; }
    return record;
  }
  /** D01/BATCH-004: while `actor`'s next run is opening, `begin` has proven its
   * previous invocation's scope empty (or this broker has run none
   * since its startup quiesced every scope), and the next run has no endpoint.
   * That is the only authority to settle the previous incarnation's receipts,
   * and it ends when the run is published, revoked or replaced. */
  settlementQuiescence(actor: Actor): SettlementQuiescence {
    const record = this.records.get(actor);
    if (!record || record.phase !== "opening")
      throw new StoreError("STALE_RUN", "no opening run holds receipt settlement authority");
    const confirm = (): void => {
      if (this.records.get(actor) !== record || record.phase !== "opening")
        throw new StoreError("STALE_RUN", "receipt settlement authority ended with its opening run");
    };
    return Object.freeze({ actor, incarnation: record.identity.incarnation - 1, confirm });
  }
  close(): void {
    let failed: unknown;
    for (const record of this.records.values()) {
      try { record.done(); } catch (error) { failed ??= error; }
    }
    if (failed !== undefined) throw failed;
  }
}
