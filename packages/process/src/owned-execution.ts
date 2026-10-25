/** Shared execution/recovery policy. The owner retains live pins and journal
 * reservations after unknown outcomes; direct-child close is not scope death.
 */
import type { ProcessObservation } from "./command.js";
import { StoreError } from "@oma/domain/errors";
import { canonicalJson } from "@oma/domain/canonical-json";
import { setTimeout } from "node:timers/promises";
import { retainNativeExecution } from "./preparation.js";
import { withCleanup, withAsyncCleanup } from "@oma/native/cleanup";

export interface BlockedExecution<Witness> {
  readonly witness: Witness;
  readonly result: Promise<ProcessObservation>;
  readonly closed: Promise<void>;
  population(): "populated" | "empty" | "unknown";
  release(): void;
  terminate(): void;
  close(): void;
}
export interface ExecutionReservation<Witness> { readonly execution: string; publish(witness: Witness): void; retire(): void }
/** Backend evidence that child creation did not succeed. This is narrower
 * than a failed, cancelled or closed launcher whose descendants are unknown. */
export class ExecutionNotStarted extends Error {
  constructor(cause: unknown) { super("execution scope was not created", { cause }); }
}
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
export interface RecoveryScope<Witness> {
  readonly identity: Witness;
  population(): "populated" | "empty" | "unknown";
  terminate(): void;
  close(): void;
}
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
    const task = Promise.resolve().then(async () => {
      const entries = this.journal.entries().filter(entry => !this.active.has(entry.slot));
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
    });
    const owned = task.finally(() => { if (this.recovering === owned) this.recovering = null; });
    this.recovering = owned; return owned;
  }
  async run(request: ExecutionRequest<Witness>): Promise<ProcessObservation> {
    return (await this.begin(request)).completion;
  }
  async begin(request: ExecutionRequest<Witness>): Promise<ExecutionTicket<Witness>> {
    if (this.stopping || this.failure !== null) throw new StoreError("BROKER_UNAVAILABLE", "execution owner is stopping or uncertain");
    for (const [slot, owner] of this.active) if (owner.uncertain) await this.settle(slot, owner);
    if (this.stopping || this.failure !== null) throw new StoreError("BROKER_UNAVAILABLE", "execution owner changed during cleanup");
    if (request.signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "execution was cancelled before launch");
    if (this.active.has(request.slot)) throw new StoreError("RUN_TERMINATION_UNKNOWN", "execution slot is still owned");
    await this.recover();
    if (this.stopping || this.failure !== null) throw new StoreError("BROKER_UNAVAILABLE", "execution owner ended during recovery");
    if (request.signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "execution was cancelled during recovery");
    if (this.active.has(request.slot)) throw new StoreError("RUN_TERMINATION_UNKNOWN", "execution slot was acquired during recovery");
    const reservation = this.journal.reserve(request.slot);
    let returned!: () => void, failed!: (error: unknown) => void;
    retainNativeExecution(new Promise<void>((resolve, reject) => { returned = resolve; failed = reject; }));
    const owner: Owned<Witness> = { reservation, scope: null, launch: null, settling: null, uncertain: false, empty: false, returned, failed };
    this.active.set(request.slot, owner);
    const failures: unknown[] = [];
    const terminate = (): void => { try { owner.scope?.terminate(); } catch (error) { failures.push(error); } };
    owner.launch = Promise.resolve().then(() => request.launch(reservation.execution)).then(scope => {
      owner.scope = scope;
      request.signal?.addEventListener("abort", terminate, { once: true });
      owner.reservation.publish(scope.witness);
      if (this.stopping || request.signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "execution was cancelled before release");
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
      try { observation = await (await owner.launch!).result; }
      catch (error) {
        primary = { error: error instanceof ExecutionNotStarted ? error.cause : error };
      }
      finally {
        request.signal?.removeEventListener("abort", terminate);
        if (this.active.has(request.slot)) try { await this.settle(request.slot, owner); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new StoreError([...(primary === null ? [] : [primary.error]), ...failures].some(error =>
        error instanceof StoreError && error.code === "STORE_CORRUPT") ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", "execution or scope cleanup is unconfirmed",
        { cause: new AggregateError(primary === null ? failures : [primary.error, ...failures], "owned execution failures") });
      if (primary !== null) throw primary.error;
      if (observation === undefined) throw new StoreError("REF_STATE_UNKNOWN", "execution returned no observation");
      return observation;
    })();
    // A shutdown or launch failure can settle before the caller gets a ticket.
    // Keep rejection observed without changing the promise returned to its owner.
    void completion.catch(() => {});
    try { await owner.launch; } catch { await completion; throw new Error("unreachable execution completion"); }
    return Object.freeze({ execution: reservation.execution, witness: owner.scope!.witness, completion,
      population: () => owner.empty ? "empty" : owner.scope?.population() ?? "unknown",
      stop: () => this.active.get(request.slot) === owner ? this.settle(request.slot, owner) : Promise.resolve(),
    });
  }
  confirmDead(slot: string): boolean {
    if (this.failure !== null || this.active.has(slot)) return false;
    if (this.fullyDrained) return true;
    return !this.journal.entries().some(entry => entry.slot === slot);
  }
  async drain(): Promise<void> {
    this.stopping = true;
    const failures: unknown[] = [];
    if (this.recovering !== null) try { await this.recovering; } catch (error) { failures.push(error); }
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
        await setTimeout(10);
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
