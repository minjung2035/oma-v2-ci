import { StoreError } from "../domain/errors.js";
import { startProcess } from "./async.js";
import { snapshotCommand, type CommandSpec, type ProcessObservation } from "./command.js";

/** One owner per existing workflow/repository. There is deliberately no waiting
 * array, worker database, new host limit, daemon, transient scope or runtime file.
 * A non-exit observation blocks this owner until authoritative recovery/restart;
 * even a later direct-child close cannot prove all descendants/artifacts safe.
 */
export class PreparationExecutor {
  private active = false;
  private uncertain = false;
  get blocked(): boolean { return this.active || this.uncertain; }
  async run(source: CommandSpec, signal?: AbortSignal): Promise<ProcessObservation> {
    const command = snapshotCommand(source);
    if (this.blocked) throw new StoreError("REF_STATE_UNKNOWN", "a prior preparation is active or has an uncertain outcome");
    if (process.platform !== "linux") throw new StoreError("UNSUPPORTED_PROFILE", "preparation requires the existing Linux process model");
    if (signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "preparation was cancelled before child creation");
    this.active = true;
    try {
      const task = startProcess(command, { processGroup: true, ...(signal === undefined ? {} : { signal }) });
      const observation = await task.result;
      // No successful callback or kill acknowledgement is promoted to physical
      // proof. Callers still verify canonical object, file and ref identities.
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
