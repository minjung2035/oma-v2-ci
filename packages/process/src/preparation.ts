import { StoreError } from "@oma/domain/errors";
import { startProcess } from "./async.js";
import { snapshotCommand, type CommandSpec, type ProcessObservation } from "./command.js";

// Process-lifetime accounting only: no new queue, sidecar, worker DB or daemon.
// Completed tasks are removed. An executor whose last run did not reach a
// complete observation stays in `unprovenPreparations` -- the shutdown
// barrier's evidence that descendant quiescence was never proven -- until its
// owner re-observes the prepared state quiescent (reverifyStale), which is
// the authoritative startup recovery in this process's lifetime.
const nativeClosures = new Set<Promise<void>>();
/** A direct execution owner resolves only after its independent scope proof
 * and cleanup. A rejected closure stays a shutdown fence for this process. */
export function retainNativeExecution(closure: Promise<void>): void {
  nativeClosures.add(closure);
  void closure.then(() => nativeClosures.delete(closure), () => { /* retain the failed ownership proof */ });
}
const unprovenPreparations = new Set<PreparationExecutor>();
export async function preparationShutdownBarrier(): Promise<void> {
  if (unprovenPreparations.size > 0) throw new StoreError("RUN_TERMINATION_UNKNOWN", "native preparation quiescence is unproven; retain writer resources for process termination");
  while (nativeClosures.size > 0) {
    await Promise.all([...nativeClosures]);
    if (unprovenPreparations.size > 0) throw new StoreError("RUN_TERMINATION_UNKNOWN", "native preparation became uncertain during shutdown");
  }
}

/** The answer an owner asks a preparation executor to give for the state its
 * last run left behind -- the tree the run was preparing, observed fresh. */
export type PreparationQuiescence = "quiescent" | "active" | "unknown";

/** One owner per existing workflow/repository; no waiting array. A non-exit
 * observation blocks this owner while the outcome it left is unproven -- but
 * the block is a stale unknown, not a permanent one: the owner's next attempt
 * first re-observes the prepared state through its lease
 * (`reverifyStale`), and a fresh authoritative "quiescent" read lets the new
 * run proceed. What it must never do is treat the unproven run as complete;
 * the flag clears on the observation, never on the attempt.
 */
export class PreparationExecutor {
  private active = false;
  private uncertain = false;
  get blocked(): boolean { return this.active || this.uncertain; }
  get quiescence(): "quiescent" | "unknown" { return this.blocked ? "unknown" : "quiescent"; }
  /** A fresh observation of the state this executor's last run prepared.
   * "quiescent" clears the stale unknown and answers it; "active" and
   * "unknown" answer without clearing -- a run whose descendants still live
   * (or cannot be proven gone) keeps its owner blocked. Called only when a
   * new operation finds the executor blocked; it never runs the probe for a
   * currently-active run, whose answer would be obsolete on arrival. */
  reverifyStale(observe: () => PreparationQuiescence): PreparationQuiescence {
    if (this.active) return "active";
    if (!this.uncertain) return "quiescent";
    const observed = observe();
    if (observed === "quiescent") { this.uncertain = false; unprovenPreparations.delete(this); }
    return observed;
  }
  async run(source: CommandSpec, signal?: AbortSignal, inheritedFds: readonly number[] = []): Promise<ProcessObservation> {
    const command = snapshotCommand(source);
    if (this.blocked) throw new StoreError("REF_STATE_UNKNOWN", "a prior preparation is active or has an uncertain outcome");
    if (process.platform !== "linux") throw new StoreError("UNSUPPORTED_PROFILE", "preparation requires the existing Linux process model");
    if (signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "preparation was cancelled before child creation");
    this.active = true;
    try {
      const task = startProcess(command, { processGroup: true, inheritedFds, ...(signal === undefined ? {} : { signal }) });
      const closure = task.result.then(observation => {
        if (observation.kind !== "exited") unprovenPreparations.add(this);
        return task.closed;
      });
      nativeClosures.add(closure);
      void closure.then(() => nativeClosures.delete(closure), () => {
        unprovenPreparations.add(this); nativeClosures.delete(closure);
      });
      const observation = await task.result;
      if (observation.kind !== "exited") this.uncertain = true;
      return observation;
    } finally { this.active = false; }
  }
}
export function requirePreparedSuccess(result: ProcessObservation, operation: string): Buffer {
  if (result.kind !== "exited" || result.exitCode !== 0)
    throw new StoreError("REF_STATE_UNKNOWN", `${operation} requires authoritative observation after ${result.kind}`);
  return result.stdout;
}
