/** Explicit host action on a closed Society. The same lease as resume excludes
 * active sessions; no bootstrap, actor activation or model is involved. */
import { closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "@oma/config";
import { StoreError } from "@oma/domain/errors";
import { openRegularBeneath, withinDirectory } from "@oma/native/files";
import { ProcessLock } from "@oma/native/process-lock";
import { Store } from "@oma/storage";
import { ensureOwnedUserDirectory } from "../runtime/user-files.js";
import { hostLaunchLocation } from "../runtime/assets.js";
import { ExecutionRuntime } from "../runtime/execution-runtime.js";
import { SessionStorage } from "../runtime/session-storage.js";
import { tryHoldSociety } from "../runtime/society-lease.js";

export async function archiveSociety(society: string, config: string | undefined,
    env: NodeJS.ProcessEnv, log: (line: string) => void): Promise<void> {
  const { stateRoot, runRoot, configPath } = hostLaunchLocation(society, env, config);
  const lease = tryHoldSociety(stateRoot);
  if (lease === null) throw new StoreError("BROKER_UNAVAILABLE", "an active session owns this Society; close it before archive");
  let lock: ProcessLock | null = null, executions: ExecutionRuntime | undefined;
  try {
    const cfg = loadConfig(configPath);
    if (cfg.society !== society) throw new StoreError("INVALID_REQUEST", "archive configuration names another Society");
    ensureOwnedUserDirectory(runRoot, dirname(runRoot));
    lock = ProcessLock.tryAcquire(join(runRoot, "broker.lock"));
    if (lock === null) throw new StoreError("BROKER_UNAVAILABLE", "a broker owns this Society");
    // Absence must not create a fresh database or execution history.
    closeSync(withinDirectory(join(stateRoot, "runtime.sqlite"), (parent, name) => openRegularBeneath(parent, name)));
    executions = new ExecutionRuntime(stateRoot);
    await executions.recover();
    const storage = SessionStorage.forSociety({ stateRoot, society, fence: lease.fence, env, log,
      quiesce: actors => {
        for (const actor of actors) if (!executions!.confirmDead(`resident:${actor.name}`))
          throw new StoreError("RUN_TERMINATION_UNKNOWN", `archive cannot prove ${actor.name} ended`);
      } });
    if (storage === null) throw new StoreError("STORE_CORRUPT", "archive requires an existing project-bound Society");
    if (storage.isArchived()) { log("Session is already archived; its verified checkpoint remains selected."); return; }
    const store = new Store(join(stateRoot, "runtime.sqlite"));
    let residents;
    try { residents = store.listAgents().filter(row => row.role === "resident").map(row => ({ name: row.name, incarnation: row.incarnation })); }
    finally { store.close(); }
    await storage.archive(residents);
  } finally {
    try { await executions?.close(); } finally { try { lock?.close(); } finally { lease.release(); } }
  }
}
