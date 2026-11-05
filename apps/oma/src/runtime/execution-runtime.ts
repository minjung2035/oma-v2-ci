/** Application composition only: common execution policy + storage recovery
 * observations + the selected kernel/sandbox primitives. No command replay.
 */
import { randomUUID } from "node:crypto";
import { WorkloadBudget } from "@oma/platform-linux/workload-budget";
import { configurePreparationPlacement, configurePreparationExecution, preparationShutdownBarrier } from "@oma/process/preparation";
import type { WorkloadResourceProfile } from "@oma/contracts/host";
import { ExecutionCoordinator, ExecutionNotStarted, type BlockedExecution, type RecoveryScope } from "@oma/process/owned-execution";
import type { CommandSpec } from "@oma/process/command";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { observeNamespaceProcess, pinNamespaceInit, type NamespaceInitIdentity } from "@oma/native/pid-namespace";
import { launchBlockedNamespace } from "@oma/platform-linux/namespace-execution";
import type { ExecutionWitness } from "@oma/process/execution-witness";
import { launchBlockedDarwin } from "@oma/platform-mac/execution-launch";
import { observeDarwinJobScope, acquireDarwinJobScope } from "@oma/platform-mac/job-recovery";
import { EXECUTION_JOURNAL_VERSION, DARWIN_EXECUTION_JOURNAL_VERSION } from "@oma/protocol/persisted-formats";
import { withAsyncCleanup, withCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";

type Observation = { readonly kind: "running"; readonly identity: ExecutionWitness } | { readonly kind: "exited" | "unavailable" };
interface Backend {
  readonly journalVersion: typeof EXECUTION_JOURNAL_VERSION | typeof DARWIN_EXECUTION_JOURNAL_VERSION;
  launch: (command: CommandSpec, options: Record<string, unknown>) => Promise<BlockedExecution<ExecutionWitness>>;
  observe: (witness: ExecutionWitness) => Observation;
  acquire: (witness: ExecutionWitness) => RecoveryScope<ExecutionWitness>;
}
function backend(): Backend {
  if (process.platform === "darwin") return {
    journalVersion: DARWIN_EXECUTION_JOURNAL_VERSION,
    launch: launchBlockedDarwin,
    observe: observeDarwinJobScope,
    acquire: acquireDarwinJobScope,
  };
  if (process.platform !== "linux") throw new StoreError("UNSUPPORTED_PROFILE", "native execution requires a supported platform");
  return { journalVersion: EXECUTION_JOURNAL_VERSION, launch: launchBlockedNamespace,
    observe: (witness: ExecutionWitness): Observation => witness.kind === "linux-namespace" ? observeNamespaceProcess(witness.pid) : { kind: "unavailable" },
    acquire: (witness: ExecutionWitness) => {
      if (witness.kind !== "linux-namespace") throw new StoreError("RUN_TERMINATION_UNKNOWN", "Linux recovery witness has the wrong platform identity");
      return pinNamespaceInit(witness.pid);
    } };
}
export async function recoverExecutionState(stateRoot: string, fresh: boolean): Promise<void> {
  const selected = backend();
  if (fresh) ExecutionJournal.initialize(stateRoot);
  const journal = ExecutionJournal.open(stateRoot, selected.journalVersion);
  await withAsyncCleanup(() => new ExecutionCoordinator(journal, selected.observe, selected.acquire).recover(), () => journal.close());
}
export class ExecutionRuntime {
  private admissions = 0;
  private maintenance: Promise<unknown> | undefined;
  private maintaining = false;
  private closing = false;
  private maintenanceFailed = false;
  private maintenanceFailure: unknown;
  private assertAdmission(): void {
    if (this.maintaining || this.closing || this.maintenanceFailed) throw new StoreError("BROKER_UNAVAILABLE", "execution admission is closed for recovery or shutdown");
  }
  private async admit<T>(work: () => Promise<T>): Promise<T> {
    this.assertAdmission(); this.admissions++;
    try { return await work(); } finally { this.admissions--; }
  }
  /** Recovery does not itself stop current owners. Hold admission closed and
   * require the actual journal to be empty before touching disposable assets. */
  recoverAndMaintain<T>(work: () => Promise<T>): Promise<T> {
    this.assertAdmission();
    if (this.admissions !== 0) throw new StoreError("RUN_TERMINATION_UNKNOWN", "execution admission is still in progress");
    this.maintaining = true;
    let entered = false;
    const task = Promise.resolve().then(async () => {
      await this.owner.recover();
      if (this.closing) throw new StoreError("CANCELLED_BEFORE_COMMIT", "runtime maintenance was cancelled before effects");
      if (this.journal.entries().length !== 0)
        throw new StoreError("RUN_TERMINATION_UNKNOWN", "runtime maintenance has no quiescent execution owner");
      entered = true; return work();
    }).catch(error => { if (entered) { this.maintenanceFailed = true; this.maintenanceFailure = error; } throw error; });
    const owned = task.finally(() => { if (this.maintenance === owned) { this.maintenance = undefined; this.maintaining = false; } });
    this.maintenance = owned; return owned;
  }
  private workload: WorkloadBudget | undefined;
  private releasePlacement: (() => void) | undefined;
  private releasePreparation: (() => void) | undefined;
  configureResources(profile: WorkloadResourceProfile, identity: string) {
    if (this.workload) throw new StoreError("INTERNAL_ERROR", "workload profile is already bound");
    this.workload = new WorkloadBudget(profile, identity);
    this.releasePlacement = configurePreparationPlacement(() => this.workload?.acquire());
    return this.workload.observation;
  }
  private async launch(command: CommandSpec, options: Record<string, unknown>, physicalLaunch = this.selected.launch) {
    try { this.assertAdmission(); } catch (error) { throw new ExecutionNotStarted(error); }
    const budget = this.workload, lease = budget?.acquire();
    try {
      const files = process.platform === "darwin" && options.files === undefined && Array.isArray(options.inheritedFds)
        ? { files: options.inheritedFds.map((fd: number, index: number) => ({ target: index + 6, fd })) } : {};
      const scope = await physicalLaunch(budget?.command(command) ?? command, { ...options, ...files, ...(lease === undefined ? {} : { placementFd: lease.placementFd }) });
      // Preserve lazy setup: spreading scope would invoke its getter before
      // the common owner has published the acquired kernel witness.
      const wrapped: BlockedExecution<ExecutionWitness> = { witness: scope.witness, closed: scope.closed,
        ...(scope.pinChild === undefined ? {} : { pinChild: () => scope.pinChild!() }),
        population: () => scope.population(), release: () => scope.release(), terminate: () => scope.terminate(),
        result: scope.result.then(result => ({ ...result, ...(lease === undefined ? {} : { resources: { ...lease.events(), scope: lease.path } }) })),
        close: () => { scope.close(); lease?.close(); } };
      for (const key of ["prepared", "terminal"] as const) if (key in scope)
        Object.defineProperty(wrapped, key, { enumerable: true, get: () => scope[key] });
      return wrapped;
    } catch (error) {
      if (lease !== undefined) try { lease.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "workload launch remains owned"); }
      throw error;
    }
  }
  private readonly journal: ExecutionJournal;
  private readonly selected = backend();
  private readonly owner: ExecutionCoordinator<ExecutionWitness>;
  constructor(stateRoot: string, physicalLaunch?: Backend["launch"]) {
    if (physicalLaunch !== undefined) {
      if (process.platform !== "darwin") throw new StoreError("UNSUPPORTED_PROFILE", "explicit Darwin capture requires the Darwin backend");
      this.selected.launch = physicalLaunch;
    }
    this.journal = ExecutionJournal.open(stateRoot, this.selected.journalVersion);
    this.owner = new ExecutionCoordinator(this.journal, this.selected.observe, this.selected.acquire);
    try { if (physicalLaunch !== undefined) this.releasePreparation = configurePreparationExecution({ run: (command, signal, files, sinks, controls) => {
      try { this.assertAdmission(); } catch (error) { throw new ExecutionNotStarted(error); }
      return this.admit(() => this.owner.run({ slot: "preparation:" + randomUUID(), launch: () => this.launch(command, { ...sinks,
        files: files.map((fd, index) => ({ target: index + 3, fd })), ...(controls?.directoryFd === undefined ? {} : { directoryFd: controls.directoryFd }), ...(signal === undefined ? {} : { signal }) }),
        authorize() { if (signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "preparation authority was cancelled"); },
        ...(signal === undefined ? {} : { signal }) })); } }); }
    catch (error) { withCleanup(() => { throw error; }, () => this.journal.close()); }
  }
  recover(): Promise<void> { return this.owner.recover(); }
  run(slot: string, command: CommandSpec, signal: AbortSignal | undefined, authorize: () => void, inheritedFds: readonly number[] = [],
    stderrFd?: number, prepared?: () => void) {
    return this.admit(() => this.owner.run({ slot, launch: () => this.launch(command, { inheritedFds,
      ...(stderrFd === undefined ? {} : { stderrFd }), ...(signal === undefined ? {} : { signal }) }), authorize,
      ...(signal === undefined ? {} : { signal }), ...(prepared === undefined ? {} : { prepared }) }));
  }
  begin(slot: string, command: (execution: string) => CommandSpec, signal: AbortSignal, authorize: () => void,
    prepared: (execution: string, witness: ExecutionWitness) => void, inheritedFds: readonly number[] = [],
    output: { stdoutSink?: (bytes: Uint8Array) => void; stderrSink?: (bytes: Uint8Array) => void } = {}, physicalLaunch?: Backend["launch"]) {
    if (physicalLaunch !== undefined && process.platform !== "darwin")
      throw new StoreError("UNSUPPORTED_PROFILE", "explicit Resident launch requires the Darwin backend");
    return this.admit(() => this.owner.begin({ slot, launch: execution => {
      let spec: CommandSpec;
      try { spec = command(execution); } catch (error) { throw new ExecutionNotStarted(error); }
      return this.launch(spec, { signal, inheritedFds, ...output }, physicalLaunch);
    }, authorize, prepared, signal }));
  }
  confirmDead(slot: string): boolean { return this.owner.confirmDead(slot); }
  /** AUD-19: the tri-state death observation the Git importer needs: an
   * accepted concurrent import owns the slot (busy), or nothing is proven
   * (unknown); only "dead" frees the slot for a new pick-up. */
  slotState(slot: string): "dead" | "busy" | "unknown" { return this.owner.slotState(slot); }
  async close(): Promise<void> {
    this.closing = true;
    let failed = this.maintenanceFailed, failure: unknown = this.maintenanceFailure;
    try { await this.maintenance; } catch (error) {
      if (!(error instanceof StoreError && error.code === "CANCELLED_BEFORE_COMMIT")) { failed = true; failure = error; }
    }
    if (failed && failure instanceof StoreError && failure.code === "CANCELLED_BEFORE_COMMIT") failed = false;
    await withAsyncCleanup(async () => { if (failed) throw failure; }, async () => {
      await this.owner.drain(); await preparationShutdownBarrier(); this.releasePreparation?.(); this.releasePlacement?.(); this.workload?.close(); this.journal.close();
    });
  }
}
