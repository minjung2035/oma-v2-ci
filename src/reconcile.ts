// MUST [REC-001/002]: physical observations are not reconstructed from memory.
import type { Actor } from "../implementation/contracts.js";
import { Store } from "./store.js";
import { StoreError, classifyError } from "./domain/errors.js";
import { observeStoreFailure } from "./domain/admission.js";
import { runGitText } from "./process/policies.js";
import { MailModule } from "./mail.js";
import { GitModule } from "./git.js";
import { UnitsModule } from "./units.js";
import { LifecycleModule } from "./lifecycle.js";

export interface ReconcilePaths { projectGit: string; hasGoal?: () => boolean; activationAllowed?: () => boolean }
export class ReconcileModule {
  private sweeping = false;
  constructor(private readonly store: Store, private readonly mail: MailModule, private readonly git: GitModule | null,
    private readonly units: UnitsModule, private readonly lifecycle: LifecycleModule, private readonly paths: ReconcilePaths) {}
  private activation(allowed = true): boolean { return allowed && (this.paths.activationAllowed?.() ?? true); }
  /** Fresh bootstrap has no old runs; an existing registry is fenced before any
   * preparation callback may publish objects or recover physical resources.
   */
  async startup(allowActivation = true, prepare?: () => Promise<void>): Promise<void> {
    if (this.sweeping) throw new StoreError("BROKER_UNAVAILABLE", "startup cannot share an active recovery pass");
    this.sweeping = true;
    try {
      for (const agent of this.store.listAgents()) {
        if (agent.role !== "resident") continue;
        if (!this.units.confirmDead(agent.name, agent.incarnation)) this.units.stop(agent.name, agent.incarnation);
        if (!this.units.confirmDead(agent.name, agent.incarnation)) throw new StoreError("RUN_TERMINATION_UNKNOWN", `startup cannot prove ${agent.name} terminated`);
      }
      if (this.git) this.assertCanonicalHealthy();
      await prepare?.();
      await this.mail.reconcilePending();
      for (const id of this.store.recoverableOperations()) {
        const operation = this.store.getOperationById(id);
        if (!operation) continue;
        if (operation.kind === "agent.create") { await this.lifecycle.reconcileCreate(id, this.activation(allowActivation)); continue; }
        if (operation.kind === "agent.start" || operation.kind === "agent.stop") {
          this.lifecycle.reconcileAction(id, this.activation(allowActivation)); continue;
        }
        if ((operation.kind === "git.submit" || operation.kind === "git.integrate" || operation.kind === "context.publish") && this.git) await this.git.reconcile(id);
      }
    } catch (error) { observeStoreFailure(this.store, error); throw error; }
    finally { this.sweeping = false; }
  }
  private retainRecoveryFailure(error: unknown): void {
    const code = error instanceof StoreError ? error.code : "INTERNAL_ERROR";
    const policy = classifyError({ code, phase: "recovering", effectKnowledge: "possible",
      observationKind: code === "STORE_CORRUPT" || code === "STREAM_INVALID" ? "corrupt" : "unavailable" });
    if (policy.blockScope === "store") {
      const failure = new StoreError(policy.code, error instanceof Error ? error.message : "recovery observation is corrupt");
      observeStoreFailure(this.store, failure); throw failure;
    }
  }
  async sweep(): Promise<{ examined: number; repaired: number; remaining: number }> {
    if (this.sweeping) return { examined: 0, repaired: 0, remaining: 0 };
    this.sweeping = true;
    try {
      const mailResult = await this.mail.reconcilePending();
      let repaired = mailResult.repaired; let remaining = mailResult.remaining; let examined = mailResult.examined;
      for (const id of this.store.recoverableOperations()) {
        const operation = this.store.getOperationById(id);
        if (!operation || operation.kind === "mail.send" || operation.kind === "agent.continue") continue;
        examined++;
        try {
          if (operation.kind === "agent.create") await this.lifecycle.reconcileCreate(id, this.activation());
          else if (operation.kind === "agent.start" || operation.kind === "agent.stop") this.lifecycle.reconcileAction(id, this.activation());
          else if ((operation.kind === "git.submit" || operation.kind === "git.integrate" || operation.kind === "context.publish") && this.git) await this.git.reconcile(id);
          else { remaining++; continue; }
          if (this.store.getOperationById(id)?.state === "succeeded") repaired++; else remaining++;
        } catch (error) { this.retainRecoveryFailure(error); remaining++; }
      }
      for (const agent of this.store.listAgents()) {
        if (agent.role !== "resident" || agent.desired === "retired") continue;
        try {
          const observation = this.units.observe(agent.name);
          if (agent.desired === "stopped" && (observation.activeState === "active" || observation.activeState === "activating")) {
            this.units.stop(agent.name, agent.incarnation); continue;
          }
          if (agent.desired !== "enabled" || !this.activation()) continue;
          if (this.paths.hasGoal && !this.paths.hasGoal()) continue;
          const pendingCount = this.store.pendingDeliveries(agent.name).length + this.store.preparedBatches(agent.name).length;
          const inactive = observation.activeState === "inactive" || observation.activeState === "dead";
          if (pendingCount > 0 && inactive) this.units.start(agent.name, false);
        } catch (error) { this.retainRecoveryFailure(error); remaining++; }
      }
      return { examined, repaired, remaining };
    } catch (error) { observeStoreFailure(this.store, error); throw error; }
    finally { this.sweeping = false; }
  }
  startLimitState(): Array<{ agent: Actor; why: string }> {
    const result: Array<{ agent: Actor; why: string }> = [];
    for (const agent of this.store.listAgents()) {
      if (agent.role !== "resident") continue;
      const why = this.units.startLimitStatus(agent.name); if (why) result.push({ agent: agent.name, why });
    }
    return result;
  }
  assertCanonicalHealthy(): void {
    const result = runGitText(["fsck", "--strict", "--no-reflogs"], { gitDir: this.paths.projectGit, timeout: 30000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) throw new StoreError("STORE_CORRUPT", `canonical repo fsck failed: ${result.stderr.slice(0, 300)}`);
  }
}
