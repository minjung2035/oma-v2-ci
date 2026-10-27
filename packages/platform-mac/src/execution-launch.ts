/** launchd is used only for process ownership; no launch-data RPC exists.
 * The actual workload reports its kernel identity through its native channel. */
import { StoreError } from "@oma/domain/errors";
import { removeLaunchdJob, submitLaunchdJob } from "./launchd-job.js";
import type { CommandSpec, ProcessObservation } from "@oma/process/command";
import type { BlockedExecution } from "@oma/process/owned-execution";
import type { DarwinSessionWitness } from "@oma/native/audit-session";

export interface DarwinScopeControls {
  readonly signal?: AbortSignal;
  readonly inheritedFds?: readonly number[];
  readonly stdoutSink?: (bytes: Uint8Array) => void;
  readonly stderrSink?: (bytes: Uint8Array) => void;
  readonly stderrFd?: number;
}
export async function launchBlockedDarwin(command: CommandSpec, controls: DarwinScopeControls = {}): Promise<BlockedExecution<DarwinSessionWitness>> {
  throw new StoreError("UNSUPPORTED_PROFILE", "Darwin execution requires the native launch-data channel");
}
