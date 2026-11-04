/** App composition connects Lifecycle to actual ledger, units, Mail and Git workspaces. */
import type { Store } from "@oma/storage";
import type { MailModule } from "@oma/mail";
import { LifecycleModule, type LifecyclePaths, type SpecResolver } from "@oma/lifecycle";
import { WorkspaceCoordinator } from "@oma/git/workspace";
import type { LifecycleEffects, LifecycleUnits, LifecycleMail } from "@oma/lifecycle/ports";
import { lifecycleLedger } from "./lifecycle-ledger.js";
import { PreacceptScope } from "@oma/storage/preaccept-artifact";
import { ensureOwnedDurableDirectory } from "@oma/storage/durable-fs";
import { generateOperationId } from "@oma/native/identity";
import { agentRootPathAt } from "@oma/domain/paths";
import { join } from "node:path";
import type { GitModule } from "@oma/git";
import { StoreError } from "@oma/domain/errors";

export interface LifecycleCompositionPaths extends LifecyclePaths {
  readonly ownerSignal?: AbortSignal;
  readonly projectGit: string;
  /** Origin as seen through a Resident's sandbox mount. */
  readonly residentProjectGit?: string;
}
export function lifecycleEffects(stateRoot: string, ownerSignal?: AbortSignal): LifecycleEffects {
  return {
    nextOperationId: generateOperationId,
    assertOwner: () => {
      if (ownerSignal === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "broker creation ownership was not bound");
      if (ownerSignal.aborted) throw new StoreError("BROKER_UNAVAILABLE", "broker creation owner is stopping");
      return undefined;
    },
    newPreacceptScope: () => new PreacceptScope(),
    bootstrapPeer: () => ({ pid: process.pid, uid: process.getuid!(), gid: process.getgid!() }),
    ensureAgentDirectories: actor => {
      ensureOwnedDurableDirectory(join(agentRootPathAt(stateRoot, actor), "home"), stateRoot, 0o755);
      ensureOwnedDurableDirectory(join(stateRoot, "mail", "inboxes", actor), stateRoot, 0o755);
    },
  };
}
export interface LifecycleExecution extends LifecycleUnits {
  bindIncarnationReader(reader: (actor: string) => number | null): void;
}
export function lifecycleUnits(units: LifecycleExecution): LifecycleUnits {
  return {
    assertResidentNamesFree: agent => units.assertResidentNamesFree(agent),
    ensureResident: (agent, profile, modelProfile) => units.ensureResident(agent, profile, modelProfile),
    start: (agent, repair, authorize) => units.start(agent, repair, authorize), stop: (agent, incarnation) => units.stop(agent, incarnation),
    observe: agent => units.observe(agent), confirmDead: (agent, incarnation) => units.confirmDead(agent, incarnation),
  };
}
function lifecycleMail(mail: MailModule | null): LifecycleMail | null {
  return mail === null ? null : {
    freezeCreateInitial: (auth, id, actor, brief, dateMs) => mail.freezeCreateInitial(auth, id, actor, brief, dateMs),
    publishCreateInitial: message => mail.publishCreateInitial(message),
    publishGated: (id, proof) => mail.publishGated(id, proof),
  };
}
export function createLifecycleModule(store: Store, units: LifecycleExecution, paths: LifecycleCompositionPaths,
  resolveSpec: SpecResolver, mail: MailModule | null = null, git: GitModule | null = null): LifecycleModule {
  const feature = new LifecycleModule(lifecycleLedger(store), lifecycleUnits(units), paths, resolveSpec,
    new WorkspaceCoordinator(paths), lifecycleMail(mail), lifecycleEffects(paths.stateRoot, paths.ownerSignal), git === null ? null : {
      prepare: (...args) => git.stageCreateSource(...args), finalize: plan => git.finalizeCreateSource(plan), complete: root => git.completeCreateSource(root),
    });
  store.bindRepositoryIdentity({ society: paths.society });
  // Always bind the original live durable reader, including custom constructor readers.
  units.bindIncarnationReader(agent => store.getAgent(agent)?.incarnation ?? null);
  return feature;
}
