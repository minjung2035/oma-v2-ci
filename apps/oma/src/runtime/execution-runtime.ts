/** Application composition only: common execution policy + storage recovery
 * observations + the selected kernel/sandbox primitives. No command replay.
 */
import { WorkloadBudget } from "@oma/platform-linux/workload-budget";
import { configurePreparationPlacement, preparationShutdownBarrier } from "@oma/process/preparation";
import type { WorkloadResourceProfile } from "@oma/contracts/host";
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
  private workload: WorkloadBudget | undefined;
  private releasePlacement: (() => void) | undefined;
  configureResources(profile: WorkloadResourceProfile, identity: string) {
    if (this.workload) throw new StoreError("INTERNAL_ERROR", "workload profile is already bound");
    this.workload = new WorkloadBudget(profile, identity);
    this.releasePlacement = configurePreparationPlacement(() => this.workload?.acquire());
    return this.workload.observation;
  }
  private async launch(command: CommandSpec, options: Record<string, unknown>) {
    const budget = this.workload, lease = budget?.acquire();
    try {
      const scope = await this.selected.launch(budget?.command(command) ?? command, { ...options, ...(lease === undefined ? {} : { placementFd: lease.placementFd }) });
      return { ...scope, result: scope.result.then(result => ({ ...result, ...(lease === undefined ? {} : { resources: { ...lease.events(), scope: lease.path } }) })),
        close: () => { scope.close(); lease?.close(); } };
    } catch (error) {
      if (lease !== undefined) try { lease.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "workload launch remains owned"); }
      throw error;
    }
  }
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
    return this.owner.run({ slot, launch: () => this.launch(command, { inheritedFds,
      ...(stderrFd === undefined ? {} : { stderrFd }), ...(signal === undefined ? {} : { signal }) }), authorize,
      ...(signal === undefined ? {} : { signal }), ...(prepared === undefined ? {} : { prepared }) });
  }
  begin(slot: string, command: (execution: string) => CommandSpec, signal: AbortSignal, authorize: () => void,
    prepared: (execution: string, witness: ExecutionWitness) => void, inheritedFds: readonly number[] = [],
    output: { stdoutSink?: (bytes: Uint8Array) => void; stderrSink?: (bytes: Uint8Array) => void } = {}) {
    return this.owner.begin({ slot, launch: execution => {
      let spec: CommandSpec;
      try { spec = command(execution); } catch (error) { throw new ExecutionNotStarted(error); }
      return this.launch(spec, { signal, inheritedFds, ...output });
    }, authorize, prepared, signal });
  }
  confirmDead(slot: string): boolean { return this.owner.confirmDead(slot); }
  /** AUD-19: the tri-state death observation the Git importer needs: an
   * accepted concurrent import owns the slot (busy), or nothing is proven
   * (unknown); only "dead" frees the slot for a new pick-up. */
  slotState(slot: string): "dead" | "busy" | "unknown" { return this.owner.slotState(slot); }
  async close(): Promise<void> { await this.owner.drain(); await preparationShutdownBarrier(); this.releasePlacement?.(); this.workload?.close(); this.journal.close(); }
}
