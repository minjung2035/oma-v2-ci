import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type { DecodedOperation as OperationRow } from "@oma/protocol/operation-codec";
import { StoreError, errorCodeOf } from "@oma/domain/errors";
import type { RecoveryCounts } from "@oma/contracts/runtime";

export type ReconcileOutcome =
  | { id: string; state: "succeeded" | "failed-terminal" | "pending" | "unknown" | "corrupt"; reason: string | null; nextAction: "none" | "next-timer" | "operator-review" | "close-mutation-gate" }
  | { id: string; state: "skipped-busy" | "skipped-already-terminal"; reason: string; nextAction: "next-timer" | "none" };
export type RecoveryRow = Pick<OperationRow, "id" | "kind" | "state">;
export interface RecoveryDependencies {
  snapshot(): readonly string[];
  read(id: string): RecoveryRow | null;
  recover(operation: RecoveryRow): Promise<void>;
  failure(error: unknown): void; // throws after closing the mutation gate on corruption
  clock?(): number;
  /** Existing receipt-wait limit supplied by host composition, not a new knob. */
  budgetSeconds?: number;
}
const scope = new AsyncLocalStorage<OperationRecovery>();
const recoverable = (row: RecoveryRow): boolean => row.state === "pending" || row.state === "unknown";

export class OperationRecovery {
  private inFlight: Promise<RecoveryCounts> | null = null;
  private readonly retryAfter = new Map<string, number>();
  private resumeAfter: string | null = null;
  private outcomes: readonly Readonly<ReconcileOutcome>[] = [];
  constructor(private readonly dependencies: RecoveryDependencies) {
    if (dependencies.budgetSeconds !== undefined && (!Number.isSafeInteger(dependencies.budgetSeconds) || dependencies.budgetSeconds <= 0))
      throw new StoreError("UNSUPPORTED_PROFILE", "recovery budget must use a positive configured receipt wait");
  }
  get running(): boolean { return this.inFlight !== null; }
  get lastOutcomes(): readonly Readonly<ReconcileOutcome>[] { return this.outcomes; }
  sweep(): Promise<RecoveryCounts> {
    if (scope.getStore() === this) return Promise.reject(new StoreError("INTERNAL_ERROR", "a recovery handler cannot await its own sweep"));
    if (this.inFlight) return this.inFlight;
    const work = Promise.resolve().then(() => scope.run(this, () => this.perform()));
    const owned = work.finally(() => { if (this.inFlight === owned) this.inFlight = null; });
    this.inFlight = owned;
    return owned;
  }
  private async perform(): Promise<RecoveryCounts> {
    const outcomes: ReconcileOutcome[] = [];
    const counts = { examined: 0, repaired: 0, remaining: 0 };
    const now = this.dependencies.clock ?? (() => performance.now());
    const start = now();
    const budget = this.dependencies.budgetSeconds;
    const snapshot = [...new Set(this.dependencies.snapshot())];
    const eligible = new Set(snapshot);
    for (const id of this.retryAfter.keys()) if (!eligible.has(id)) this.retryAfter.delete(id);
    const index = this.resumeAfter === null ? -1 : snapshot.indexOf(this.resumeAfter);
    const ordered = index < 0 ? snapshot : [...snapshot.slice(index + 1), ...snapshot.slice(0, index + 1)];
    // P0V-88 (R6-11): a failure is observed once. What `failure` throws is its
    // own verdict on an error it has already seen, not a second failure.
    let verdict = null as { readonly error: unknown } | null;
    try {
      // At most the finite initial snapshot; new accepts belong to the next pass.
      // Individual physical I/O retains its adapter timeout/output bound. The
      // wall budget is checked between operations, never interrupting a DB T.
      for (const id of ordered) {
        if (budget !== undefined && now() - start >= budget * 1000) {
          outcomes.push({ id, state: "skipped-busy", reason: "sweep-budget-exhausted", nextAction: "next-timer" }); break;
        }
        this.resumeAfter = id;
        const before = this.dependencies.read(id);
        if (!before) throw new StoreError("STORE_CORRUPT", "snapshot operation disappeared");
        if (!recoverable(before)) {
          outcomes.push({ id, state: "skipped-already-terminal", reason: "terminal-before-comparison", nextAction: "none" }); continue;
        }
        if ((this.retryAfter.get(id) ?? -1) > now()) {
          outcomes.push({ id, state: "skipped-busy", reason: "no-progress-backoff", nextAction: "next-timer" }); continue;
        }
        counts.examined++;
        let reason: string | null = null;
        try { await this.dependencies.recover(before); }
        catch (error) {
          reason = errorCodeOf(error);
          try { this.dependencies.failure(error); }
          catch (fatal) {
            outcomes.push({ id, state: "corrupt", reason, nextAction: "close-mutation-gate" });
            verdict = { error: fatal }; throw fatal;
          }
        }
        const after = this.dependencies.read(id);
        if (!after) throw new StoreError("STORE_CORRUPT", "accepted operation disappeared after comparison");
        if (after.state === "succeeded" || after.state === "failed") {
          counts.repaired++; this.retryAfter.delete(id);
          outcomes.push({ id, state: after.state === "succeeded" ? "succeeded" : "failed-terminal", reason, nextAction: "none" });
        } else {
          counts.remaining++;
          const gated = reason === "SPIKE_UNRESOLVED" || reason === "UNSUPPORTED_PROFILE";
          outcomes.push({ id, state: after.state, reason: reason ?? "no-progress", nextAction: gated ? "operator-review" : "next-timer" });
          if (budget !== undefined) this.retryAfter.set(id, now() + budget * 1000);
        }
      }
      if (counts.examined !== counts.repaired + counts.remaining) throw new StoreError("INTERNAL_ERROR", "recovery count invariant violated");
      return Object.freeze(counts);
    } catch (error) {
      if (verdict === null || verdict.error !== error) this.dependencies.failure(error);
      throw error;
    }
    finally { this.outcomes = Object.freeze(outcomes.map(outcome => Object.freeze(outcome))); }
  }
}
