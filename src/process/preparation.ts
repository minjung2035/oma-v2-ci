import { StoreError } from "../domain/errors.js";
import { startProcess } from "./async.js";
import { snapshotCommand, type CommandSpec, type ProcessObservation } from "./command.js";

// Process-lifetime accounting only: no new queue, sidecar, worker DB or daemon.
// Completed tasks are removed. Uncertain descendant quiescence is deliberately
// sticky until process/cgroup termination and authoritative startup recovery.
const nativeClosures = new Set<Promise<void>>();
let uncertainNativePreparation = false;
export async function preparationShutdownBarrier(): Promise<void> {
  if (uncertainNativePreparation) throw new StoreError("RUN_TERMINATION_UNKNOWN", "native preparation quiescence is unproven; retain writer resources for process termination");
  while (nativeClosures.size > 0) {
    await Promise.all([...nativeClosures]);
    if (uncertainNativePreparation) throw new StoreError("RUN_TERMINATION_UNKNOWN", "native preparation became uncertain during shutdown");
  }
}

/** One owner per existing workflow/repository; no waiting array. A non-exit
 * observation blocks this owner until recovery/restart. Direct-child close is
 * not proof of arbitrary-descendant death and cannot authorize artifact cleanup.
 */
export class PreparationExecutor {
  private active = false;
  private uncertain = false;
  get blocked(): boolean { return this.active || this.uncertain; }
  get quiescence(): "quiescent" | "unknown" { return this.blocked ? "unknown" : "quiescent"; }
  async run(source: CommandSpec, signal?: AbortSignal, inheritedFds: readonly number[] = []): Promise<ProcessObservation> {
    const command = snapshotCommand(source);
    if (this.blocked) throw new StoreError("REF_STATE_UNKNOWN", "a prior preparation is active or has an uncertain outcome");
    if (process.platform !== "linux") throw new StoreError("UNSUPPORTED_PROFILE", "preparation requires the existing Linux process model");
    if (signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "preparation was cancelled before child creation");
    this.active = true;
    try {
      const task = startProcess(command, { processGroup: true, inheritedFds, ...(signal === undefined ? {} : { signal }) });
      const closure = task.result.then(observation => {
        if (observation.kind !== "exited") uncertainNativePreparation = true;
        return task.closed;
      });
      nativeClosures.add(closure);
      void closure.then(() => nativeClosures.delete(closure), () => {
        uncertainNativePreparation = true; nativeClosures.delete(closure);
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
