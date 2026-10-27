/** Application composition only: common execution policy + storage recovery
 * observations + the selected kernel/sandbox primitives. No command replay.
 */
import { ExecutionCoordinator, ExecutionNotStarted } from "@oma/process/owned-execution";
import type { CommandSpec } from "@oma/process/command";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { observeNamespaceProcess, pinNamespaceInit, type NamespaceInitIdentity } from "@oma/native/pid-namespace";
import { launchBlockedNamespace } from "@oma/platform-linux/namespace-execution";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";

function backend() {
  if (process.platform !== "linux") throw new StoreError("UNSUPPORTED_PROFILE", "native execution scope gates are unresolved on this platform");
  return { launch: launchBlockedNamespace,
    observe: (witness: NamespaceInitIdentity) => observeNamespaceProcess(witness.pid),
    acquire: (witness: NamespaceInitIdentity) => pinNamespaceInit(witness.pid) };
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
  private readonly owner: ExecutionCoordinator<NamespaceInitIdentity>;
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
    prepared: (execution: string, witness: NamespaceInitIdentity) => void, inheritedFds: readonly number[] = [],
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
