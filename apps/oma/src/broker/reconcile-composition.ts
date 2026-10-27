/** Actual application composition: live reads and physical lifetime owners. */
import { dirname } from "node:path";
import type { Store } from "@oma/storage";
import { observeStoreFailure } from "@oma/domain/admission";
import { collectUnacceptedArtifacts } from "@oma/storage/preaccept-collection";
import { createCanonicalObserver } from "@oma/git/canonical-command";
import { CanonicalHealthObserver } from "@oma/git/canonical-health";
import { quiesceResidents } from "@oma/lifecycle/society";
import { pendingWork } from "../views/pending-work.js";
import { ReconcileModule, type ReconcilePaths } from "@oma/reconcile";
import type { ReconcileMail, ReconcileGit, ReconcileReview, ReconcileUnits, ReconcileLifecycle } from "@oma/reconcile/ports";
export interface ReconcileCompositionPaths extends Omit<ReconcilePaths, "stateRoot"> { projectGit: string }
export function createReconcileModule(store: Store, mail: ReconcileMail, git: ReconcileGit | null,
  reviews: ReconcileReview | null, units: ReconcileUnits, lifecycle: ReconcileLifecycle, paths: ReconcileCompositionPaths): ReconcileModule {
  const health = new CanonicalHealthObserver(paths.projectGit);
  const reads = Object.freeze({
    recoverableOperations: () => store.recoverableOperations(),
    getOperationById: (id: string) => store.getOperationById(id),
    listAgents: () => store.listAgents(), getAgent: (actor: string) => store.getAgent(actor),
    societyOpen: () => store.societyOpen(),
  });
  const recoveryUnits: ReconcileUnits = Object.freeze({
    observeAsync: (actor: string) => units.observeAsync(actor), observe: (actor: string) => units.observe(actor),
    confirmDead: (actor: string, incarnation: number) => units.confirmDead(actor, incarnation),
    stop: (actor: string, incarnation: number) => units.stop(actor, incarnation),
    start: (actor: string, repair: boolean, authorize?: () => void) => units.start(actor, repair, authorize),
    startLimitStatus: (actor: string) => units.startLimitStatus(actor),
    restartDue: (actor: string) => units.restartDue?.(actor) === true,
  });
  return new ReconcileModule(reads, Object.freeze({ reconcileOperation: (id: string) => mail.reconcileOperation(id) }),
    git === null ? null : Object.freeze({ reconcile: (id: string) => git.reconcile(id) }),
    reviews === null ? null : Object.freeze({ advanceAll: () => reviews.advanceAll() }), recoveryUnits,
    Object.freeze({ reconcileSociety: (id: string) => lifecycle.reconcileSociety(id),
      reconcileCreate: (id: string, allowed: boolean) => lifecycle.reconcileCreate(id, allowed),
      reconcileAction: (id: string, allowed: boolean) => lifecycle.reconcileAction(id, allowed) }), {
    stateRoot: dirname(store.path), hasGoal: paths.hasGoal, activationAllowed: paths.activationAllowed,
    ...(paths.freshVerifiedMain === undefined ? {} : { freshVerifiedMain: paths.freshVerifiedMain }),
    ...(paths.sweepBudgetSeconds === undefined ? {} : { sweepBudgetSeconds: paths.sweepBudgetSeconds }),
  }, Object.freeze({
    observeStoreFailure: (error: unknown) => observeStoreFailure(store, error),
    quiesceResidents: () => quiesceResidents(reads, units),
    collectUnacceptedArtifacts: () => collectUnacceptedArtifacts(dirname(store.path), reads),
    canonicalMain: () => createCanonicalObserver().ref(paths.projectGit, "refs/heads/main"),
    assertCanonicalHealthy: () => health.assertHealthy(),
    hasPendingWork: (actor: string) => pendingWork(store, actor).hasPendingWork,
  }));
}
