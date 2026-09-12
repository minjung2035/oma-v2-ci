// REC-001/002: operation counts, process observations and activation are distinct facts.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "../implementation/contracts.js";
import { Store } from "./store.js";
import { StoreError, classifyError } from "./domain/errors.js";
import { observeStoreFailure } from "./domain/admission.js";
import { runGitText, GIT_ENV } from "./process/policies.js";
import { PreparationExecutor } from "./process/preparation.js";
import { MailModule } from "./mail.js";
import { reconcileMailOperation, type RecoveryCounts } from "./mail/reconcile.js";
import { OperationRecovery, type RecoveryRow } from "./reconcile/operations.js";
import { GitModule } from "./git.js";
import { UnitsModule } from "./units.js";
import { LifecycleModule } from "./lifecycle.js";
import { pendingWork } from "./views/pending-work.js";

export interface ReconcilePaths {
  projectGit: string; hasGoal?: () => boolean; activationAllowed?: () => boolean;
  /** Existing host receiptWaitSeconds; not a new configuration/wire field. */
  sweepBudgetSeconds?: number;
}
export interface UnitRecoveryDiagnostic { readonly agent: string; readonly outcome: "observed" | "started" | "stopped" | "unknown"; readonly reason: string | null }
const sweepScope = new AsyncLocalStorage<ReconcileModule>();
export class ReconcileModule {
  private starting = false;
  private inFlight: Promise<RecoveryCounts> | null = null;
  private readonly operations: OperationRecovery;
  private readonly healthExecutor = new PreparationExecutor();
  private healthTask: Promise<void> | null = null;
  private diagnostics: readonly UnitRecoveryDiagnostic[] = [];
  constructor(private readonly store: Store, private readonly mail: MailModule, private readonly git: GitModule | null,
    private readonly units: UnitsModule, private readonly lifecycle: LifecycleModule, private readonly paths: ReconcilePaths) {
    this.operations = new OperationRecovery({ snapshot: () => store.recoverableOperations(), read: id => store.getOperationById(id),
      recover: operation => this.recover(operation, true), failure: error => this.retainRecoveryFailure(error),
      ...(paths.sweepBudgetSeconds === undefined ? {} : { budgetSeconds: paths.sweepBudgetSeconds }) });
  }
  get operationOutcomes() { return this.operations.lastOutcomes; }
  get unitDiagnostics(): readonly UnitRecoveryDiagnostic[] { return this.diagnostics; }
  private activation(allowed = true): boolean { return allowed && (this.paths.activationAllowed?.() ?? true); }
  private quiesceResidents(): void {
    for (const agent of this.store.listAgents()) {
      if (agent.role !== "resident") continue;
      if (!this.units.confirmDead(agent.name, agent.incarnation)) this.units.stop(agent.name, agent.incarnation);
      if (!this.units.confirmDead(agent.name, agent.incarnation)) throw new StoreError("RUN_TERMINATION_UNKNOWN", `startup cannot prove ${agent.name} terminated`);
    }
  }
  async startup(allowActivation = true, prepare?: () => Promise<void>): Promise<void> {
    if (this.starting || this.inFlight) throw new StoreError("BROKER_UNAVAILABLE", "startup cannot share an active recovery pass");
    this.starting = true;
    try {
      this.quiesceResidents();
      if (this.git) {
        await this.assertCanonicalHealthyAsync();
        // An earlier death observation is not a token valid across fsck's await.
        this.quiesceResidents();
      }
      await prepare?.();
      const snapshot = [...new Set(this.store.recoverableOperations())];
      for (const id of snapshot) {
        const operation = this.store.getOperationById(id);
        if (!operation || (operation.state !== "pending" && operation.state !== "unknown")) continue;
        if (operation.kind === "mail.send" || operation.kind === "agent.continue") {
          try { await reconcileMailOperation(this.store, this.mail, id); }
          catch (error) { this.retainRecoveryFailure(error); }
        } else if (["agent.create", "agent.start", "agent.stop", "git.submit", "git.integrate", "context.publish"].includes(operation.kind)) {
          await this.recover(operation, allowActivation);
        }
      }
    } catch (error) { observeStoreFailure(this.store, error); throw error; }
    finally { this.starting = false; }
  }
  private async recover(operation: RecoveryRow, allowed: boolean): Promise<void> {
    switch (operation.kind) {
      case "mail.send": case "agent.continue": await reconcileMailOperation(this.store, this.mail, operation.id); return;
      case "agent.create": await this.lifecycle.reconcileCreate(operation.id, this.activation(allowed)); return;
      case "agent.start": case "agent.stop": this.lifecycle.reconcileAction(operation.id, this.activation(allowed)); return;
      case "git.submit": case "git.integrate": case "context.publish":
        if (!this.git) throw new StoreError("UNSUPPORTED_PROFILE", "Git recovery owner unavailable");
        await this.git.reconcile(operation.id); return;
      default: throw new StoreError("SPIKE_UNRESOLVED", "operation has no safe physical recovery handler");
    }
  }
  private retainRecoveryFailure(error: unknown): void {
    const code = error instanceof StoreError ? error.code : "INTERNAL_ERROR";
    const policy = classifyError({ code, phase: "recovering", effectKnowledge: "possible",
      observationKind: code === "STORE_CORRUPT" || code === "STREAM_INVALID" ? "corrupt" : "unavailable" });
    if (policy.blockScope === "store") {
      const failure = new StoreError(policy.code, "recovery observation is corrupt");
      observeStoreFailure(this.store, failure); throw failure;
    }
  }
  /** Deliberately not async: all concurrent callers receive the identical Promise. */
  sweep(): Promise<RecoveryCounts> {
    if (sweepScope.getStore() === this) return Promise.reject(new StoreError("INTERNAL_ERROR", "a handler cannot await its own recovery sweep"));
    if (this.starting) return Promise.reject(new StoreError("BROKER_UNAVAILABLE", "startup recovery is active"));
    if (this.inFlight) return this.inFlight;
    const work = Promise.resolve().then(() => sweepScope.run(this, async () => {
      try {
        const counts = await this.operations.sweep();
        await this.observeUnits();
        return counts;
      } catch (error) { observeStoreFailure(this.store, error); throw error; }
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
          if (current.desired === "stopped") {
            // Do not trust an old async inactive observation as death proof.
            if (!this.units.confirmDead(current.name, current.incarnation)) {
              this.units.stop(current.name, current.incarnation);
              diagnostics.push({ agent: current.name, outcome: "stopped", reason: null });
            } else diagnostics.push({ agent: current.name, outcome: "observed", reason: null });
            continue;
          }
          if (observation.activeState === "unknown") {
            diagnostics.push({ agent: current.name, outcome: "unknown", reason: "RUN_TERMINATION_UNKNOWN" }); continue;
          }
          if (current.desired === "enabled" && this.activation() && (!this.paths.hasGoal || this.paths.hasGoal())) {
            const { hasPendingWork } = pendingWork(this.store, current.name);
            if (hasPendingWork && ["inactive", "dead"].includes(observation.activeState)) {
              const fresh = this.units.observe(current.name);
              if (["inactive", "dead"].includes(fresh.activeState)) {
                // Current desired/incarnation/activation check -> start has no await.
                this.units.start(current.name, false);
                diagnostics.push({ agent: current.name, outcome: "started", reason: null }); continue;
              }
              if (fresh.activeState === "unknown") throw new StoreError("RUN_TERMINATION_UNKNOWN", "final unit observation is unknown");
            }
          }
          diagnostics.push({ agent: current.name, outcome: "observed", reason: null });
        } catch (error) {
          this.retainRecoveryFailure(error);
          const reason = error instanceof StoreError ? error.code : "INTERNAL_ERROR";
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
  /** Compatibility observation for synchronous callers, not the startup path. */
  assertCanonicalHealthy(): void {
    const result = runGitText(["fsck", "--strict", "--no-reflogs"], { gitDir: this.paths.projectGit, timeout: 30000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) throw new StoreError("STORE_CORRUPT", "canonical repository health observation failed");
  }
  assertCanonicalHealthyAsync(): Promise<void> {
    if (this.healthTask) return this.healthTask;
    const task = this.healthExecutor.run({ executable: "/usr/bin/git",
      argv: ["--git-dir", this.paths.projectGit, "fsck", "--strict", "--no-reflogs"], env: GIT_ENV,
      timeoutMs: 30000, stdoutBytes: 1024 * 1024, stderrBytes: 1024 * 1024 }).then(result => {
      if (result.kind !== "exited") throw new StoreError("REF_STATE_UNKNOWN", "canonical health observation is uncertain");
      if (result.exitCode !== 0) throw new StoreError("STORE_CORRUPT", "canonical repository health observation failed");
    }).finally(() => { if (this.healthTask === task) this.healthTask = null; });
    this.healthTask = task; return task;
  }
}
