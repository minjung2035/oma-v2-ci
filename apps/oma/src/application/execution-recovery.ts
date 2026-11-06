/** Human-only Linux recovery. A prepared checkpoint and an actual host reboot
 * replace unknowable scope liveness; neither ACK nor child exit is evidence. */
import { closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "@oma/config";
import { StoreError } from "@oma/domain/errors";
import { withCleanup } from "@oma/native/cleanup";
import { withinDirectory, openRegularBeneath } from "@oma/native/files";
import { ProcessLock } from "@oma/native/process-lock";
import { prepareExecutionRecovery, applyExecutionRecovery } from "@oma/storage/execution-recovery";
import { hostLaunchLocation, assertStateRoot } from "../runtime/assets.js";
import { tryHoldSociety } from "../runtime/society-lease.js";
import { ensureOwnedUserDirectory } from "../runtime/user-files.js";

export function recoverSocietyExecutions(society: string, config: string | undefined, phase: "prepare" | "apply",
    env: NodeJS.ProcessEnv, log: (line: string) => void): void {
  if (process.platform === "darwin")
    throw new StoreError("UNSUPPORTED_PROFILE", "macOS execution scopes are bound to their kernel boot and recovered automatically when the Society opens; no manual reboot recovery is needed");
  if (process.platform !== "linux") throw new StoreError("UNSUPPORTED_PROFILE", "execution reboot recovery requires Linux");
  const { stateRoot, runRoot, configPath } = hostLaunchLocation(society, env, config);
  assertStateRoot(stateRoot);
  // Existing state only: do not bootstrap a Society or create an empty ledger.
  closeSync(withinDirectory(join(stateRoot, "runtime.sqlite"), (parent, name) => openRegularBeneath(parent, name)));
  const lease = tryHoldSociety(stateRoot);
  if (lease === null) throw new StoreError("BROKER_UNAVAILABLE", "close the Society before preparing or applying execution recovery");
  let lock: ProcessLock | null = null;
  withCleanup(() => {
    if (loadConfig(configPath).society !== society) throw new StoreError("INVALID_REQUEST", "execution recovery configuration names another Society");
    ensureOwnedUserDirectory(runRoot, dirname(runRoot));
    lock = ProcessLock.tryAcquire(join(runRoot, "broker.lock"));
    if (lock === null) throw new StoreError("BROKER_UNAVAILABLE", "a broker owns this Society");
    if (phase === "prepare") {
      const ticket = prepareExecutionRecovery(stateRoot);
      log(`Execution recovery prepared at Linux boot ${ticket.bootId}. Journal bytes and accepted work are unchanged.`);
      log(`Reboot this host, then run oma recover-execution --society ${society}${config === undefined ? "" : " --config <the same configuration path>"} --apply.`);
    } else {
      const result = applyExecutionRecovery(stateRoot);
      log(`Previous execution scopes are dead across the verified Linux reboot. ${result.archive === null ? "The missing journal was recreated." : `Original journal retained at ${result.archive}.`}`);
      log("Accepted work, request identities, receipts and completion state were not changed; resume the Society normally.");
    }
  }, () => withCleanup(() => lock?.close(), () => lease.release()));
}
