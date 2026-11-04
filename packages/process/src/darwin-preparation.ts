/** Standalone consumers own one transient scope per preparation. Application
 * composition binds its durable journal through configurePreparationExecution. */
import { StoreError } from "@oma/domain/errors";
import { randomUUID } from "node:crypto";
import { ExecutionCoordinator } from "./owned-execution.js";
import { launchDarwinJobScope } from "./darwin-execution.js";
import type { CommandSpec } from "./command.js";
import type { AsyncProcessOptions } from "./async.js";
import type { DarwinCoalitionIdentity } from "@oma/native/audit-session";
export async function runDarwinPreparation(command: CommandSpec, signal: AbortSignal | undefined, inheritedFds: readonly number[],
  sinks: Pick<AsyncProcessOptions, "stdoutSink" | "stderrSink">, controls: { readonly directoryFd?: number } = {}) {
  const rows: { slot: string; execution: string; witness: DarwinCoalitionIdentity | null }[] = [];
  const owner = new ExecutionCoordinator<DarwinCoalitionIdentity>({ entries: () => rows.map(row => ({ ...row })), reserve(slot) {
    const row = { slot, execution: randomUUID(), witness: null as DarwinCoalitionIdentity | null }; rows.push(row);
    return { execution: row.execution, publish(witness) { row.witness = witness; }, retire() { rows.splice(rows.indexOf(row), 1); } };
  }, retire() { throw new Error("transient preparation has no startup recovery row"); } }, () => ({ kind: "unavailable" }));
  return owner.run({ slot: "preparation", launch: () => launchDarwinJobScope(command, { ...sinks, ...controls, ...(signal === undefined ? {} : { signal }),
    files: inheritedFds.map((fd, index) => ({ target: index + 3, fd })) }), authorize() {
    if (signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "preparation was cancelled before release");
  }, ...(signal === undefined ? {} : { signal }) });
}
