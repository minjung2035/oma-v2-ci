/** Shared execution/recovery policy. The owner retains live pins and journal
 * reservations after unknown outcomes; direct-child close is not scope death.
 */
import type { ProcessObservation } from "./command.js";
import { StoreError } from "@oma/domain/errors";
import { canonicalJson } from "@oma/domain/canonical-json";
import { setTimeout } from "node:timers/promises";
import { retainNativeExecution } from "./preparation-lifetime.js";
import { withCleanup, withAsyncCleanup } from "@oma/native/cleanup";

import type { BlockedExecution, ExecutionProcessPin, RecoveryScope } from "./execution-scope.js";
export type { BlockedExecution, ExecutionProcessPin, RecoveryScope } from "./execution-scope.js";
export interface ExecutionReservation<Witness> { readonly execution: string; publish(witness: Witness): void; retire(): void }
/** Backend evidence that child creation did not succeed. This is narrower
 * than a failed, cancelled or closed launcher whose descendants are unknown. */
import { ExecutionNotStarted } from "@oma/domain/process-command";
export { ExecutionNotStarted } from "@oma/domain/process-command";
export interface ExecutionJournalPort<Witness> {
  entries(): readonly { readonly slot: string; readonly execution: string; readonly witness: Witness | null }[];
  reserve(slot: string): ExecutionReservation<Witness>;
  retire(slot: string, execution: string): void;
}
export interface ExecutionRequest<Witness> {
  readonly slot: string;
  launch(execution: string): Promise<BlockedExecution<Witness>>;
  /** Fresh, synchronous authority check immediately before the release byte. */
  authorize(): void;
  /** Register the owned invocation before it can execute. This callback may
   * observe identity, but cannot turn it into a durable operation receipt. */
  prepared?(execution: string, witness: Witness): void;
  readonly signal?: AbortSignal;
}
export interface ExecutionTicket<Witness> {
  readonly pinChild?: () => ExecutionProcessPin;
  readonly execution: string;
  readonly witness: Witness;
  /** Includes descendant death, child close and journal retirement. */
  readonly completion: Promise<ProcessObservation>;
  population(): "populated" | "empty" | "unknown";
  stop(): Promise<void>;
}
/** A launcher can publish its init before that init forks the trusted child.
 * Only a positively observed not-yet-created child is retried; unreadable
 * process data is never turned into absence. The scope owner survives refusal. */
export async function acquireExecutionChild<Pin extends { close(): void }>(ticket: Pick<ExecutionTicket<unknown>, "population">,
  observe: () => { readonly kind: "waiting" } | { readonly kind: "ready"; readonly pin: Pin },
  signal: AbortSignal, timeoutMs: number): Promise<Pin> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("invalid execution readiness deadline");
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (signal.aborted || performance.now() >= deadline || ticket.population() !== "populated")
      throw new StoreError("RUN_TERMINATION_UNKNOWN", "trusted execution child did not become observable");
    const answer = observe();
    if (answer.kind === "ready") {
      if (signal.aborted || performance.now() >= deadline || ticket.population() !== "populated")
        return withCleanup(() => { throw new StoreError("RUN_TERMINATION_UNKNOWN", "execution changed while acquiring its trusted child"); }, () => answer.pin.close());
      return answer.pin;
    }
    await setTimeout(10);
  }
}
type Observation<Witness> = { readonly kind: "running"; readonly identity: Witness } | { readonly kind: "exited" | "unavailable" };
interface Owned<Witness> {
  readonly reservation: ExecutionReservation<Witness>;
  scope: BlockedExecution<Witness> | null;
  launch: Promise<BlockedExecution<Witness>> | null;
  settling: Promise<void> | null;
  uncertain: boolean;
  empty: boolean;
  returned(): void;
  failed(error: unknown): void;
}
export class ExecutionCoordinator<Witness> {
  private readonly active = new Map<string, Owned<Witness>>();
  private stopping = false;
  private failure: unknown = null;
  private recovering: Promise<void> | null = null;
  private readonly slotRecovery = new Map<string, Promise<void>>();
  private fullyDrained = false;
  constructor(private readonly journal: ExecutionJournalPort<Witness>,
    private readonly observe: (identity: Witness) => Observation<Witness>,
    private readonly acquireRecovery?: (identity: Witness) => RecoveryScope<Witness>) {}

  /** Before READY or new effects, under the journal's exclusive owner. A
   * numeric saved PID is never a signal target. Only a freshly acquired scope
   * capability with the identical complete witness may terminate an old scope.
   */
  recover(): Promise<void> {
    if (this.recovering !== null) return this.recovering;
    const task = Promise.allSettled([...new Set(this.journal.entries().map(entry => entry.slot))].map(slot => this.recoverSlot(slot))).then(answers => {
      const errors = answers.flatMap(answer => answer.status === "rejected" ? [answer.reason] : []);
      if (errors.length) throw new StoreError(errors.some(error => error instanceof StoreError && error.code === "STORE_CORRUPT") ? "STORE_CORRUPT" : "RUN_TERMINATION_UNKNOWN", "previous execution scopes remain owned", { cause: new AggregateError(errors) });
    });
    const owned = task.finally(() => { if (this.recovering === owned) this.recovering = null; });
    this.recovering = owned; return owned;
  }
  private recoverSlot(slot: string): Promise<void> {
    const existing = this.slotRecovery.get(slot); if (existing) return existing;
    const task = Promise.resolve().then(async () => {
      const entries = this.journal.entries().filter(entry => entry.slot === slot && !this.active.has(entry.slot));
      const answers = await Promise.allSettled(entries.map(async entry => {
        if (entry.witness === null) throw new Error("opening execution has no durable kernel witness");
        const observed = this.observe(entry.witness);
        if (observed.kind === "unavailable") throw new Error("previous execution scope is unobserved");
        if (observed.kind === "running" && canonicalJson(observed.identity) === canonicalJson(entry.witness)) {
          if (this.acquireRecovery === undefined) throw new Error("previous scope has no supported recovery capability");
          const pin = this.acquireRecovery(entry.witness);
          await withAsyncCleanup(async () => {
            if (canonicalJson(pin.identity) !== canonicalJson(entry.witness))
              throw new Error("scope identity changed while acquiring its recovery capability");
            pin.terminate();
            for (;;) {
              const population = pin.population();
              if (population === "empty") break;
              if (population === "unknown") throw new Error("recovered scope death is unobserved");
              await setTimeout(10);
              pin.terminate();
            }
          }, () => {
            try { pin.close(); } catch (error) { this.failure ??= error; throw error; }
          });
        }
        this.journal.retire(entry.slot, entry.execution);
      }));
      const failures = answers.flatMap(answer => answer.status === "rejected" ? [answer.reason] : []);
      if (failures.length) throw new StoreError(failures.some(error => error instanceof StoreError && error.code === "STORE_CORRUPT")
        ? "STORE_CORRUPT" : "RUN_TERMINATION_UNKNOWN", "previous execution scopes are not confirmed dead",
        { cause: new AggregateError(failures, "execution recovery observations") });

    }).catch(error => { if (error instanceof StoreError && error.code === "STORE_CORRUPT") this.failure ??= error; throw error; });
    const owned = task.finally(() => { if (this.slotRecovery.get(slot) === owned) this.slotRecovery.delete(slot); });
    this.slotRecovery.set(slot, owned); return owned;
  }
  async run(request: ExecutionRequest<Witness>): Promise<ProcessObservation> {
    return (await this.begin(request)).completion;
  }
  async begin(request: ExecutionRequest<Witness>): Promise<ExecutionTicket<Witness>> {
    if (this.stopping || this.failure !== null) throw new StoreError("BROKER_UNAVAILABLE", "execution owner is stopping or uncertain");
    const previous = this.active.get(request.slot);
    if (previous?.uncertain) await this.settle(request.slot, previous);
    if (this.stopping || this.failure !== null) throw new StoreError("BROKER_UNAVAILABLE", "execution owner changed during cleanup");
    if (request.signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "execution was cancelled before launch");
    if (this.active.has(request.slot)) throw this.contention(request.slot, "execution slot is still owned");
    await this.recoverSlot(request.slot);
    if (this.stopping || this.failure !== null) throw new StoreError("BROKER_UNAVAILABLE", "execution owner ended during recovery");
    if (request.signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "execution was cancelled during recovery");
    if (this.active.has(request.slot)) throw this.contention(request.slot, "execution slot was acquired during recovery");
    const reservation = this.journal.reserve(request.slot);
    let returned!: () => void, failed!: (error: unknown) => void;
    retainNativeExecution(new Promise<void>((resolve, reject) => { returned = resolve; failed = reject; }));
    const owner: Owned<Witness> = { reservation, scope: null, launch: null, settling: null, uncertain: false, empty: false, returned, failed };
    this.active.set(request.slot, owner);
    const failures: unknown[] = [];
    let interruptPreparation: ((error: unknown) => void) | undefined;
    const terminate = (): void => {
      interruptPreparation?.(new StoreError("CANCELLED_BEFORE_COMMIT", "execution was cancelled during blocked preparation"));
      try { owner.scope?.terminate(); } catch (error) { failures.push(error); }
    };
    owner.launch = Promise.resolve().then(() => request.launch(reservation.execution)).then(scope => {
      owner.scope = scope;
      request.signal?.addEventListener("abort", terminate, { once: true });
      owner.reservation.publish(scope.witness);
      const settle = (): Promise<void> | undefined => this.active.get(request.slot) === owner ? this.settle(request.slot, owner) : undefined;
      const terminal = scope.terminal?.then(settle, error => { failures.push(error); return settle(); });
      void terminal?.catch(error => { failures.push(error); });
      return scope;
    });
    // Scope creation/publication must not wait for preparation or admission:
    // drain can terminate an already-owned scope while its setup is pending.
    const admitted = owner.launch.then(async scope => {
      if (this.stopping || request.signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "execution was cancelled before release");
      if (scope.prepared !== undefined) {
        const interrupted = new Promise<never>((_resolve, reject) => { interruptPreparation = reject; });
        try {
          await Promise.race([scope.prepared, interrupted, scope.closed.then(() => {
            throw new StoreError(this.stopping || request.signal?.aborted ? "CANCELLED_BEFORE_COMMIT" : "BROKER_UNAVAILABLE",
              "execution closed during blocked preparation");
          })]);
        } finally { interruptPreparation = undefined; }
      }
      if (this.active.get(request.slot) !== owner || owner.empty || owner.uncertain || owner.settling !== null || this.stopping || request.signal?.aborted)
        throw new StoreError("CANCELLED_BEFORE_COMMIT", "execution ownership changed during preparation");
      request.prepared?.(reservation.execution, scope.witness);
      if (this.stopping || request.signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "execution was cancelled during preparation publication");
      request.authorize();
      if (this.stopping || request.signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "execution was cancelled during final authority observation");
      scope.release();
      return scope;
    });
    const completion = (async (): Promise<ProcessObservation> => {
      let primary: { error: unknown } | null = null;
      let observation: ProcessObservation | undefined;
      try { observation = await (await admitted).result; }
      catch (error) {
        primary = { error: error instanceof ExecutionNotStarted ? error.cause : error };
      }
      finally {
        request.signal?.removeEventListener("abort", terminate);
        if (this.active.get(request.slot) === owner) try { await this.settle(request.slot, owner); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new StoreError([...(primary === null ? [] : [primary.error]), ...failures].some(error =>
        error instanceof StoreError && error.code === "STORE_CORRUPT") ? "STORE_CORRUPT" : "RUN_TERMINATION_UNKNOWN", "execution or scope cleanup is unconfirmed",
        { cause: new AggregateError(primary === null ? failures : [primary.error, ...failures], "owned execution failures") });
      if (primary !== null) throw primary.error;
      if (observation === undefined) throw new StoreError("REF_STATE_UNKNOWN", "execution returned no observation");
      return observation;
    })();
    // A shutdown or launch failure can settle before the caller gets a ticket.
    // Keep rejection observed without changing the promise returned to its owner.
    void completion.catch(() => {});
    try { await admitted; } catch { await completion; throw new Error("unreachable execution completion"); }
    return Object.freeze({ execution: reservation.execution, witness: owner.scope!.witness, completion,
      ...(owner.scope!.pinChild === undefined ? {} : { pinChild: () => this.pinChild(request.slot, owner) }),
      population: () => owner.empty ? "empty" : owner.scope?.population() ?? "unknown",
      stop: () => this.active.get(request.slot) === owner ? this.settle(request.slot, owner) : Promise.resolve(),
    });
  }
  private pinChild(slot: string, owner: Owned<Witness>): ExecutionProcessPin {
    const scope = owner.scope;
    const owned = (): boolean => !this.stopping && this.active.get(slot) === owner && !owner.empty &&
      !owner.uncertain && owner.settling === null && scope?.population() === "populated";
    if (!owned() || scope?.pinChild === undefined)
      throw new StoreError("RUN_TERMINATION_UNKNOWN", "execution no longer owns an observable child");
    const pin = scope.pinChild();
    try {
      if (!pin.alive() || !owned()) throw new StoreError("RUN_TERMINATION_UNKNOWN", "execution changed during child acquisition");
      return pin;
    } catch (error) { return withCleanup(() => { throw error; }, () => pin.close()); }
  }
  /** Slot ownership callers must be able to read precisely: a live peer is
   * contention the caller re-drives with the same request key, while an owner
   * retained after a failed cleanup is unproven death. `confirmDead` keeps the
   * two-valued reading every current consumer asks for. */
  slotState(slot: string): "dead" | "busy" | "unknown" {
    if (this.failure !== null) return "unknown";
    const owner = this.active.get(slot);
    if (owner !== undefined) return owner.uncertain ? "unknown" : "busy";
    if (this.fullyDrained) return "dead";
    return this.journal.entries().some(entry => entry.slot === slot) ? "unknown" : "dead";
  }
  confirmDead(slot: string): boolean { return this.slotState(slot) === "dead"; }
  /** A live owner is contention, not a death question: the accepted intent
   * outlives the refusal and the caller re-drives it with the same request key.
   * A retained owner whose cleanup failed keeps the unproven reading. */
  private contention(slot: string, unproven: string): StoreError {
    const owner = this.active.get(slot);
    return owner !== undefined && !owner.uncertain
      ? new StoreError("BROKER_UNAVAILABLE", "execution slot is busy; retry the same request key", { details: { reason: "busy" } })
      : new StoreError("RUN_TERMINATION_UNKNOWN", unproven);
  }
  async drain(): Promise<void> {
    this.stopping = true;
    const failures: unknown[] = [];
    if (this.recovering !== null) try { await this.recovering; } catch (error) { failures.push(error); }
    const recovery = await Promise.allSettled([...this.slotRecovery.values()]);
    failures.push(...recovery.flatMap(answer => answer.status === "rejected" ? [answer.reason] : []));
    const answers = await Promise.allSettled([...this.active].map(([slot, owner]) => this.settle(slot, owner)));
    failures.push(...answers.flatMap(answer => answer.status === "rejected" ? [answer.reason] : []));
    if (this.failure !== null) failures.push(this.failure);
    if (!this.fullyDrained && this.journal.entries().length !== 0) failures.push(new StoreError("RUN_TERMINATION_UNKNOWN", "execution recovery still has unretired scopes"));
    if (failures.length) throw new AggregateError(failures, "execution scopes did not drain");
    this.fullyDrained = true;
  }
  private settle(slot: string, owner: Owned<Witness>): Promise<void> {
    if (owner.settling !== null) return owner.settling;
    const task = Promise.resolve().then(async () => {
      // Launch can fail after it published a scope (authority refusal, journal
      // failure). That scope still belongs to this cleanup owner.
      let launchFailure: unknown;
      if (owner.launch !== null) try { await owner.launch; } catch (error) { launchFailure = error; }
      const scope = owner.scope;
      if (scope === null && launchFailure instanceof ExecutionNotStarted) {
        try { owner.reservation.retire(); }
        catch (error) { this.failure ??= error; owner.failed(error); throw error; }
        this.active.delete(slot); owner.empty = true; owner.returned(); return;
      }
      if (scope === null) throw new StoreError("RUN_TERMINATION_UNKNOWN", "scope launch has no live witness");
      const failures: unknown[] = [];
      try { scope.terminate(); } catch (error) { failures.push(error); }
      for (;;) {
        const population = scope.population();
        if (population === "empty") break;
        if (population === "unknown") throw new StoreError("RUN_TERMINATION_UNKNOWN", "scope observation failed; ownership retained",
          failures.length ? { cause: new AggregateError(failures) } : undefined);
        if (failures.length) throw new StoreError("RUN_TERMINATION_UNKNOWN",
          `populated scope termination failed; ownership retained (${failures.map(error => error instanceof Error ? error.message : String(error)).join("; ").slice(0, 1024)})`,
          { cause: new AggregateError(failures) });
        await setTimeout(10);
        try { scope.terminate(); } catch (error) { failures.push(error); }
      }
      await scope.closed;
      owner.empty = true;
      try { owner.reservation.retire(); } catch (error) { failures.push(error); }
      try { scope.close(); } catch (error) { failures.push(error); }
      this.active.delete(slot);
      if (failures.length) {
        const error = failures.some(value => value instanceof StoreError && value.code === "STORE_CORRUPT")
          ? new StoreError("STORE_CORRUPT", "execution journal cleanup is corrupt", { cause: new AggregateError(failures) })
          : new AggregateError(failures, "execution terminated with cleanup failures");
        this.failure ??= error; owner.failed(error); throw error;
      }
      owner.returned();
    });
    const observed = task.catch(error => { owner.uncertain = true; throw error; });
    const owned = observed.finally(() => { if (owner.settling === owned) owner.settling = null; });
    owner.settling = owned; return owned;
  }
}
