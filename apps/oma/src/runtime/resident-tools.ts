/** Bootstrap installation observation belongs to its own journaled scope and
 * private temporary. No actor HOME, ambient toolchain or raw spawn fallback. */
import { ExecutionStaging } from "@oma/storage/execution-staging";
import { observeMacDeveloperTools } from "@oma/platform-mac/developer-tools";
import type { MacDeveloperTools } from "@oma/protocol/mac-developer-tools";
import type { ExecutionRuntime } from "./execution-runtime.js";
export async function prepareResidentTools(stateRoot: string, executions: ExecutionRuntime,
  signal: AbortSignal, authorize: () => void): Promise<MacDeveloperTools | undefined> {
  if (process.platform !== "darwin") return undefined;
  // Bootstrap uses the existing closed journal preparation slot. Disposable
  // purpose names do not silently extend the persisted journal grammar.
  const slot = "preparation";
  return new ExecutionStaging(stateRoot, "runtime-tools", () => executions.confirmDead(slot)).run(stage =>
    observeMacDeveloperTools(stage.temporary, command => executions.run(slot, command, signal, authorize, [stage.leaseFd])));
}
