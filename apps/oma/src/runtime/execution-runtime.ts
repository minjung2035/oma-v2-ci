/** Application composition only: common execution policy + storage recovery
 * observations + the selected kernel/sandbox primitives. No command replay.
 */
import { ExecutionCoordinator, ExecutionNotStarted, type BlockedExecution, type RecoveryScope } from "@oma/process/owned-execution";
import type { CommandSpec } from "@oma/process/command";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { observeNamespaceProcess, pinNamespaceInit, type NamespaceInitIdentity } from "@oma/native/pid-namespace";
import { launchBlockedNamespace } from "@oma/platform-linux/namespace-execution";
import type { ExecutionWitness } from "@oma/process/execution-witness";
import { launchBlockedDarwin } from "@oma/platform-mac/execution-launch";
import { observeDarwinSessionPopulation, terminateDarwinSessionMembers, type DarwinSessionWitness } from "@oma/native/audit-session";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";

type Observation = { readonly kind: "running"; readonly identity: ExecutionWitness } | { readonly kind: "exited" | "unavailable" };
interface Backend {
  launch: (command: CommandSpec, options: Record<string, unknown>) => Promise<BlockedExecution<ExecutionWitness>>;
  observe: (witness: ExecutionWitness) => Observation;
  acquire: (witness: ExecutionWitness) => RecoveryScope<ExecutionWitness>;
}
function backend(): Backend {
  if (process.platform === "darwin") return {
    launch: launchBlockedDarwin,
    observe: (witness: ExecutionWitness): Observation => {
      if (witness.kind !== "darwin-audit-session") return { kind: "unavailable" };
      const population = observeDarwinSessionPopulation(witness);
      return population === "unknown" ? { kind: "unavailable" as const } : population === "empty" ? { kind: "exited" as const } : { kind: "running" as const, identity: witness };
    },
    acquire: (witness: ExecutionWitness) => {
      if (witness.kind !== "darwin-audit-session") throw new StoreError("RUN_TERMINATION_UNKNOWN", "Darwin recovery witness has the wrong platform identity");
      return { identity: witness,
      population: () => observeDarwinSessionPopulation(witness),
      terminate: () => terminateDarwinSessionMembers(witness), close: () => {} };
    },
  };
  if (process.platform !== "linux") throw new StoreError("UNSUPPORTED_PROFILE", "native execution requires a supported platform");
  return { launch: launchBlockedNamespace,
    observe: (witness: ExecutionWitness): Observation => witness.kind === "linux-namespace" ? observeNamespaceProcess(witness.pid) : { kind: "unavailable" },
    acquire: (witness: ExecutionWitness) => {
      if (witness.kind !== "linux-namespace") throw new StoreError("RUN_TERMINATION_UNKNOWN", "Linux recovery witness has the wrong platform identity");
      return pinNamespaceInit(witness.pid);
    } };
}
export async function recoverExecutionState(stateRoot: string, fresh: boolean): Promise<void> {
  const selected = backend();
  if (fresh) ExecutionJournal.initialize(stateRoot);
  const journal = ExecutionJournal.open(stateRoot);
  await withAsyncCleanup(() => new ExecutionCoordinator(journal, selected.observe, selected.acquire).recover(), () => journal.close());
}
export class ExecutionRuntime {
  private readonly journal: ExecutionJournal;
  private readonly selected = backend();
  private readonly owner: ExecutionCoordinator<ExecutionWitness>;
  constructor(stateRoot: string) {
    this.journal = ExecutionJournal.open(stateRoot);
    this.owner = new ExecutionCoordinator(this.journal, this.selected.observe, this.selected.acquire);
  }
  recover(): Promise<void> { return this.owner.recover(); }
  run(slot: string, command: CommandSpec, signal: AbortSignal | undefined, authorize: () => void, inheritedFds: readonly number[] = [],
    stderrFd?: number, prepared?: () => void) {
    return this.owner.run({ slot, launch: () => this.selected.launch(command, { inheritedFds,
      ...(stderrFd === undefined ? {} : { stderrFd }), ...(signal === undefined ? {} : { signal }) }), authorize,
      ...(signal === undefined ? {} : { signal }), ...(prepared === undefined ? {} : { prepared }) });
  }
  begin(slot: string, command: (execution: string) => CommandSpec, signal: AbortSignal, authorize: () => void,
    prepared: (execution: string, witness: ExecutionWitness) => void, inheritedFds: readonly number[] = [],
    output: { stdoutSink?: (bytes: Uint8Array) => void; stderrSink?: (bytes: Uint8Array) => void } = {}) {
    return this.owner.begin({ slot, launch: execution => {
      let spec: CommandSpec;
      try { spec = command(execution); } catch (error) { throw new ExecutionNotStarted(error); }
      return this.selected.launch(spec, { signal, inheritedFds, ...output });
    }, authorize, prepared, signal });
  }
  confirmDead(slot: string): boolean { return this.owner.confirmDead(slot); }
  async close(): Promise<void> { await this.owner.drain(); this.journal.close(); }
}
