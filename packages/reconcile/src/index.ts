import type { ReconcileLedger, ReconcileMail, ReconcileGit, ReconcileReview, ReconcileUnits, ReconcileLifecycle, ReconcileEffects } from "./ports.js";
// REC-001/002: operation counts, process observations and activation are distinct facts.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "@oma/contracts";
import { StoreError, classifyError, errorCodeOf } from "@oma/domain/errors";
import { assertNever } from "@oma/domain/exhaustive";
import type { RecoveryCounts, PreacceptCollection } from "@oma/contracts/runtime";
import { OperationRecovery, type RecoveryRow } from "./operations.js";
import { preacceptEvent } from "./preaccept-event.js";

export interface ReconcilePaths {
  stateRoot: string; hasGoal: () => boolean; activationAllowed(): boolean;
  /** Ephemeral fresh provisioning observation, under this same society lease. */
  freshVerifiedMain?: string;
  /** Existing host receiptWaitSeconds; not a new configuration/wire field. */
  sweepBudgetSeconds?: number;
}
export interface UnitRecoveryDiagnostic { readonly agent: string; readonly outcome: "observed" | "started" | "stopped" | "unknown"; readonly reason: string | null }
const sweepScope = new AsyncLocalStorage<ReconcileModule>();
export class ReconcileModule {
  private starting = false;
  private inFlight: Promise<RecoveryCounts> | null = null;
  private readonly operations: OperationRecovery;
  private freshVerifiedMain: string | undefined;
  private diagnostics: readonly UnitRecoveryDiagnostic[] = [];
  constructor(private readonly store: ReconcileLedger, private readonly mail: ReconcileMail, private readonly git: ReconcileGit | null,
    private readonly reviews: ReconcileReview | null,
    private readonly units: ReconcileUnits, private readonly lifecycle: ReconcileLifecycle, private readonly paths: ReconcilePaths, private readonly effects: ReconcileEffects) {
    if (typeof paths.activationAllowed !== "function")
      throw new StoreError("UNSUPPORTED_PROFILE", "recovery requires an explicit activation gate");
    this.freshVerifiedMain = paths.freshVerifiedMain;
    this.operations = new OperationRecovery({ snapshot: () => store.recoverableOperations(), read: id => store.getOperationById(id),
      recover: operation => this.recover(operation, true), failure: error => this.retainRecoveryFailure(error),
      ...(paths.sweepBudgetSeconds === undefined ? {} : { budgetSeconds: paths.sweepBudgetSeconds }) });
  }
  get operationOutcomes() { return this.operations.lastOutcomes; }
  /** DR10: what the last startup collected of the artifacts made before an
   * acceptance that never happened, and what it kept and why. */
  get preacceptCollection(): PreacceptCollection | null { return this.collected; }
  private collected: PreacceptCollection | null = null;
  get unitDiagnostics(): readonly UnitRecoveryDiagnostic[] { return this.diagnostics; }
  private activation(allowed = true): boolean { return allowed && this.paths.activationAllowed() === true && this.store.societyOpen(); }
  /** Every resident gets its stop attempt; one unconfirmed death does not skip the rest. */
  private async quiesceResidents(): Promise<void> {
    await this.effects.quiesceResidents();
  }
  /** D03: the drain of a broker whose Residents are bound to no unit. The
   * same per-resident stop and death proof as startup, so a later startup finds
   * nothing it has to stop. */
  quiesceForShutdown(): Promise<void> { return this.quiesceResidents(); }
  async startup(allowActivation = true, prepare?: () => Promise<void>): Promise<void> {
    if (this.starting || this.inFlight) throw new StoreError("BROKER_UNAVAILABLE", "startup cannot share an active recovery pass");
    this.starting = true;
    try {
      await this.quiesceResidents();
      // DR10: before any request is admitted, and before bootstrap freezes its
      // own briefs. The state root is the Store's (store.ts planContext).
      this.collected = this.effects.collectUnacceptedArtifacts();
      const preaccept = preacceptEvent(this.collected, this.paths.stateRoot);
      if (preaccept !== null) console.error(JSON.stringify(preaccept));
      if (this.git) {
        const fresh = this.freshVerifiedMain;
        this.freshVerifiedMain = undefined;
        const main = fresh === undefined ? null : this.effects.canonicalMain();
        if (main === null || main.kind !== "present" || main.value !== fresh)
          await this.effects.assertCanonicalHealthy();
        // An earlier death observation is not a token valid across fsck's await.
        await this.quiesceResidents();
      }
      await prepare?.();
      const snapshot = [...new Set(this.store.recoverableOperations())];
      for (const id of snapshot) {
        const operation = this.store.getOperationById(id);
        if (!operation || (operation.state !== "pending" && operation.state !== "unknown")) continue;
        switch (operation.kind) {
          case "attest.record": case "mail.send": case "agent.continue":
            try {
              await this.mail.reconcileOperation(id);
            }
            catch (error) { this.retainRecoveryFailure(error); }
            break;
          case "society.set": case "agent.create": case "agent.start": case "agent.stop":
          case "git.submit": case "git.integrate": case "context.publish":
            // AV-20: one operation's recoverable failure must not end startup;
            // the same containment the sweep applies retains it. Corruption
            // still propagates (retainRecoveryFailure rethrows store-blocks).
            try { await this.recover(operation, allowActivation); }
            catch (error) { this.retainRecoveryFailure(error); }
            break;
          // These operations commit their complete effect within a single DB T.
          // Preserve startup's lack of a physical replay for a nonterminal row.
          case "mail.ack": case "route.follow": case "route.unfollow": break;
          default: assertNever(operation);
        }
      }
      // mail-v1 §5.4: startup advances every request that became ready while
      // the broker was down; a failure is a recovery observation, not a gate.
      if (this.git !== null)
        try { await this.reviews?.advanceAll(); }
        catch (error) { this.retainRecoveryFailure(error); }
    } catch (error) { this.effects.observeStoreFailure(error); throw error; }
    finally { this.starting = false; }
  }
  private async recover(operation: RecoveryRow, allowed: boolean): Promise<void> {
    switch (operation.kind) {
        case "society.set": await this.lifecycle.reconcileSociety(operation.id); return;
        case "attest.record": case "mail.send": case "agent.continue": await this.mail.reconcileOperation(operation.id); return;
        case "agent.create": await this.lifecycle.reconcileCreate(operation.id, this.activation(allowed)); return;
        case "agent.start": case "agent.stop": await this.lifecycle.reconcileAction(operation.id, this.activation(allowed)); return;
        case "git.submit": case "git.integrate": case "context.publish":
          if (!this.git) throw new StoreError("UNSUPPORTED_PROFILE", "Git recovery owner unavailable");
          await this.git.reconcile(operation.id); return;
        case "mail.ack": case "route.follow": case "route.unfollow":
          throw new StoreError("UNSUPPORTED_PROFILE", "operation has no safe physical recovery handler");
        default: assertNever(operation.kind);
    }
  }
  private retainRecoveryFailure(error: unknown): void {
    const code = errorCodeOf(error);
    const policy = classifyError({ code, phase: "recovering", effectKnowledge: "possible",
      observationKind: code === "STORE_CORRUPT" || code === "STREAM_INVALID" ? "corrupt" : "unavailable" });
    if (policy.blockScope === "store") {
      // The closed code and the store block are the contract; the original
      // reason is preserved so startup diagnostics keep the observed fact.
      const failure = new StoreError(policy.code, error instanceof StoreError ? error.message : "recovery observation is corrupt");
      this.effects.observeStoreFailure(failure); throw failure;
    }
    console.error(JSON.stringify({ event: "reconcile.operation", code: policy.code }));
  }
  /** Deliberately not async: all concurrent callers receive the identical Promise. */
  sweep(): Promise<RecoveryCounts> {
    if (sweepScope.getStore() === this) return Promise.reject(new StoreError("INTERNAL_ERROR", "a handler cannot await its own recovery sweep"));
    if (this.starting) return Promise.reject(new StoreError("BROKER_UNAVAILABLE", "startup recovery is active"));
    if (this.inFlight) return this.inFlight;
    const work = Promise.resolve().then(() => sweepScope.run(this, async () => {
      try {
        const counts = await this.operations.sweep();
        // mail-v1 §5.4: the 5 s sweep retries advance for ready requests; the
        // refresh/integration effects it creates are newly admitted work.
        if (this.git !== null)
          try { await this.reviews?.advanceAll(); }
          catch (error) { this.retainRecoveryFailure(error); }
        await this.observeUnits();
        return counts;
      } catch (error) { this.effects.observeStoreFailure(error); throw error; }
    }));
    const owned = work.finally(() => { if (this.inFlight === owned) this.inFlight = null; });
    this.inFlight = owned; return owned;
  }
  private async observeUnits(): Promise<void> {
    const diagnostics: UnitRecoveryDiagnostic[] = [];
    try {
      for (const agent of this.store.listAgents()) {
        if (agent.role !== "resident" || agent.desired === "retired") continue;
        try {
          const observation = await this.units.observeAsync(agent.name);
          const current = this.store.getAgent(agent.name);
          if (!current || current.role !== "resident" || current.incarnation !== agent.incarnation || current.specHash !== agent.specHash) {
            diagnostics.push({ agent: agent.name, outcome: "unknown", reason: "identity_changed" }); continue;
          }
          if (current.desired === "retired") {
            diagnostics.push({ agent: agent.name, outcome: "unknown", reason: "retired_during_observation" }); continue;
          }
          if (current.desired === "stopped" || !this.store.societyOpen()) {
            // Do not trust an old async inactive observation as death proof.
            if (!this.units.confirmDead(current.name, current.incarnation)) {
              const latest = this.store.getAgent(current.name);
              if (!latest || latest.incarnation !== current.incarnation ||
                (latest.desired !== "stopped" && this.store.societyOpen())) continue;
              await this.units.stop(current.name, current.incarnation);
              diagnostics.push({ agent: current.name, outcome: "stopped", reason: null });
            } else diagnostics.push({ agent: current.name, outcome: "observed", reason: null });
            continue;
          }
          if (observation.activeState === "unknown") {
            diagnostics.push({ agent: current.name, outcome: "unknown", reason: "RUN_TERMINATION_UNKNOWN" }); continue;
          }
          if (current.desired === "enabled" && this.activation() && this.paths.hasGoal()) {
            const hasPendingWork = this.effects.hasPendingWork(current.name);
            const restartDue = this.units.restartDue?.(current.name) === true;
            const canStart = (state: string): boolean => hasPendingWork && ["inactive", "dead"].includes(state) || restartDue && state === "failed";
            if (canStart(observation.activeState)) {
              const fresh = this.units.observe(current.name);
              if (canStart(fresh.activeState)) {
                // Current desired/incarnation/activation check -> start has no await.
                const latest = this.store.getAgent(current.name);
                if (!latest || latest.incarnation !== current.incarnation || latest.specHash !== current.specHash ||
                  latest.desired !== "enabled" || !this.activation() || !this.paths.hasGoal()) continue;
                const final = this.units.observe(current.name);
                if (!canStart(final.activeState)) continue;
                if (!this.units.confirmDead(current.name, current.incarnation))
                  throw new StoreError("RUN_TERMINATION_UNKNOWN", "previous execution scope is not confirmed dead");
                await this.units.start(current.name, false, () => {
                  const currentNow = this.store.getAgent(current.name);
                  if (!currentNow || currentNow.incarnation !== current.incarnation || currentNow.desired !== "enabled" ||
                      !this.activation() || !this.paths.hasGoal())
                    throw new StoreError("STALE_RUN", "reconcile activation changed before release");
                });
                diagnostics.push({ agent: current.name, outcome: "started", reason: null }); continue;
              }
              if (fresh.activeState === "unknown") throw new StoreError("RUN_TERMINATION_UNKNOWN", "final unit observation is unknown");
            }
          }
          diagnostics.push({ agent: current.name, outcome: "observed", reason: null });
        } catch (error) {
          this.retainRecoveryFailure(error);
          const reason = errorCodeOf(error);
          diagnostics.push({ agent: agent.name, outcome: "unknown", reason });
          console.error(JSON.stringify({ event: "reconcile.unit", agent: agent.name, code: reason }));
        }
      }
    } finally { this.diagnostics = Object.freeze(diagnostics.map(value => Object.freeze(value))); }
  }
  startLimitState(): Array<{ agent: Actor; why: string }> {
    const result: Array<{ agent: Actor; why: string }> = [];
    for (const agent of this.store.listAgents()) {
      if (agent.role !== "resident") continue;
      const why = this.units.startLimitStatus(agent.name); if (why) result.push({ agent: agent.name, why });
    }
    return result;
  }
}
