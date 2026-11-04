import { fstatSync } from "node:fs";
import { ExecutionNotStarted } from "@oma/domain/process-command";
import { runDarwinPreparation } from "./darwin-preparation.js";
import { StoreError } from "@oma/domain/errors";
import { startProcess, type AsyncProcessOptions } from "./async.js";
import { snapshotCommand, type CommandSpec, type ProcessObservation } from "./command.js";

import { nativeClosures, unprovenPreparations, acquirePreparationPlacement } from "./preparation-lifetime.js";
export { configurePreparationPlacement, acquirePreparationPlacement, preparationShutdownBarrier, retainNativeExecution,
  type PreparationPlacement } from "./preparation-lifetime.js";

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
export interface PreparationControls {
  /** Borrowed directory capability, retained by its caller through completion.
   * The command must not also select a pathname cwd. */
  readonly directoryFd?: number;
}
export interface PreparationExecutionPort {
  run(command: CommandSpec, signal: AbortSignal | undefined, inheritedFds: readonly number[],
    sinks: Pick<AsyncProcessOptions, "stdoutSink" | "stderrSink">, controls?: PreparationControls): Promise<ProcessObservation>;
}
let preparationExecution: PreparationExecutionPort | undefined;
/** A trusted application lifetime may bind preparation to its durable scope
 * journal. No environment, model input or hidden fallback selects this port. */
export function configurePreparationExecution(port: PreparationExecutionPort): () => void {
  if (preparationExecution !== undefined) throw new StoreError("INTERNAL_ERROR", "preparation execution owner is already configured");
  if (typeof port?.run !== "function") throw new TypeError("preparation execution requires an owner");
  const captured = Object.freeze({ run: port.run.bind(port) }); preparationExecution = captured;
  return () => { if (preparationExecution === captured) preparationExecution = undefined; };
}
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
  async run(source: CommandSpec, signal?: AbortSignal, inheritedFds: readonly number[] = [], sinks: Pick<AsyncProcessOptions, "stdoutSink" | "stderrSink"> = {}, controls: PreparationControls = {}): Promise<ProcessObservation> {
    const command = snapshotCommand(source), files = Object.freeze([...inheritedFds]), capture = Object.freeze({ ...sinks }),
      directoryFd = controls.directoryFd;
    if (directoryFd !== undefined && (!Number.isSafeInteger(directoryFd) || directoryFd < 0 || command.cwd !== undefined || !fstatSync(directoryFd).isDirectory()))
      throw new TypeError("preparation directory requires one held directory and no pathname cwd");
    const placementControls = Object.freeze(directoryFd === undefined ? {} : { directoryFd });
    if (files.some(fd => !Number.isSafeInteger(fd) || fd < 0)) throw new TypeError("invalid inherited descriptor");
    if (this.blocked) throw new StoreError("REF_STATE_UNKNOWN", "a prior preparation is active or has an uncertain outcome");
    if (process.platform !== "linux" && process.platform !== "darwin")
      throw new StoreError("UNSUPPORTED_PROFILE", "preparation requires a supported native process model");
    if (signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "preparation was cancelled before child creation");
    this.active = true;
    try {
      const selected = preparationExecution;
      if (selected !== undefined || process.platform === "darwin") {
        const run = Promise.resolve().then(() => selected === undefined ? runDarwinPreparation(command, signal, files, capture, placementControls) : selected.run(command, signal, files, capture, placementControls));
        const closure = run.then(observation => {
          if (observation.kind !== "exited") { this.uncertain = true; unprovenPreparations.add(this); }
        }, error => {
          if (error instanceof ExecutionNotStarted) return;
          this.uncertain = true; unprovenPreparations.add(this); throw error;
        });
        nativeClosures.add(closure);
        void closure.then(() => nativeClosures.delete(closure), () => { nativeClosures.delete(closure); });
        return await run;
      }
      const placement = acquirePreparationPlacement();
      let task: ReturnType<typeof startProcess>;
      // The parent keeps this exact directory descriptor until close. This
      // Linux proc entry is used before exec, independent of child FD slots.
      const physical = directoryFd === undefined ? command : { ...command, cwd: `/proc/${process.pid}/fd/${directoryFd}` };
      try { task = startProcess(physical, { ...(placement === undefined ? {} : { placementFd: placement.placementFd }), ...sinks, processGroup: true, inheritedFds, ...(signal === undefined ? {} : { signal }) }); }
      catch (error) { placement?.close(); throw error; }
      const closure = task.result.then(observation => {
        if (observation.kind !== "exited") unprovenPreparations.add(this);
        return task.closed.then(() => placement?.close());
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
