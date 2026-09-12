// MUST [REC-001/002]: physical observations are not reconstructed from memory.
import { spawnSync } from "node:child_process";
import type { Actor } from "../implementation/contracts.js";
import { Store } from "./store.js";
import { StoreError, classifyError } from "./domain/errors.js";
import { MailModule } from "./mail.js";
import { GitModule, gitEnv } from "./git.js";
import { UnitsModule } from "./units.js";
import { LifecycleModule } from "./lifecycle.js";

export interface ReconcilePaths { projectGit: string; hasGoal?: () => boolean }

export class ReconcileModule {
  private sweeping = false;
  constructor(
    private readonly store: Store,
    private readonly mail: MailModule,
    private readonly git: GitModule | null,
    private readonly units: UnitsModule,
    private readonly lifecycle: LifecycleModule,
    private readonly paths: ReconcilePaths,
  ) {}

  /** LIFE-006/REC-001: preserve startup ordering and termination proof. */
  async startup(allowActivation = true): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const agent of this.store.listAgents()) {
        if (agent.role !== "resident") continue;
        if (!this.units.confirmDead(agent.name, agent.incarnation)) this.units.stop(agent.name, agent.incarnation);
        if (!this.units.confirmDead(agent.name, agent.incarnation))
          throw new StoreError("RUN_TERMINATION_UNKNOWN", `startup cannot prove ${agent.name} terminated`);
      }
      if (this.git) this.assertCanonicalHealthy();
      await this.mail.reconcilePending();
      for (const id of this.store.recoverableOperations()) {
        const operation = this.store.getOperationById(id);
        if (!operation) continue;
        if (operation.kind === "agent.create") { await this.lifecycle.reconcileCreate(id, allowActivation); continue; }
        if (operation.kind === "agent.start" || operation.kind === "agent.stop") {
          this.lifecycle.reconcileAction(id, allowActivation);
          continue;
        }
        if ((operation.kind === "git.submit" || operation.kind === "git.integrate" || operation.kind === "context.publish") && this.git)
          await this.git.reconcile(id);
      }
    } finally { this.sweeping = false; }
  }

  /** This coordinator does not own an operation's terminal transition. Unknown
   * effect is left to the typed recovery owner; corruption must not be swallowed.
   */
  private retainRecoveryFailure(error: unknown): void {
    const code = error instanceof StoreError ? error.code : "INTERNAL_ERROR";
    const policy = classifyError({
      code, phase: "recovering", effectKnowledge: "possible",
      observationKind: code === "STORE_CORRUPT" || code === "STREAM_INVALID" ? "corrupt" : "unavailable",
    });
    if (policy.blockScope === "store")
      throw new StoreError(policy.code, error instanceof Error ? error.message : "recovery observation is corrupt");
  }

  /** REC-002: keep one sweep and preserve per-owner recovery sequencing. */
  async sweep(): Promise<{ examined: number; repaired: number; remaining: number }> {
    if (this.sweeping) return { examined: 0, repaired: 0, remaining: 0 };
    this.sweeping = true;
    try {
      const mailResult = await this.mail.reconcilePending();
      let repaired = mailResult.repaired;
      let remaining = mailResult.remaining;
      let examined = mailResult.examined;
      for (const id of this.store.recoverableOperations()) {
        const operation = this.store.getOperationById(id);
        if (!operation || operation.kind === "mail.send" || operation.kind === "agent.continue") continue;
        examined++;
        try {
          if (operation.kind === "agent.create") await this.lifecycle.reconcileCreate(id);
          else if (operation.kind === "agent.start" || operation.kind === "agent.stop") this.lifecycle.reconcileAction(id);
          else if ((operation.kind === "git.submit" || operation.kind === "git.integrate" || operation.kind === "context.publish") && this.git)
            await this.git.reconcile(id);
          else { remaining++; continue; }
          if (this.store.getOperationById(id)?.state === "succeeded") repaired++;
          else remaining++;
        } catch (error) {
          this.retainRecoveryFailure(error);
          remaining++;
        }
      }

      // UNIT-005/CTX-006: stopped units are stopped; pre-GOAL mail cannot activate.
      for (const agent of this.store.listAgents()) {
        if (agent.role !== "resident" || agent.desired === "retired") continue;
        try {
          const observation = this.units.observe(agent.name);
          if (agent.desired === "stopped" && (observation.activeState === "active" || observation.activeState === "activating")) {
            this.units.stop(agent.name, agent.incarnation);
            continue;
          }
          if (agent.desired !== "enabled") continue;
          if (this.paths.hasGoal && !this.paths.hasGoal()) continue;
          const pendingCount = this.store.pendingDeliveries(agent.name).length + this.store.preparedBatches(agent.name).length;
          const inactive = observation.activeState === "inactive" || observation.activeState === "dead";
          if (pendingCount > 0 && inactive) this.units.start(agent.name, false);
        } catch (error) {
          this.retainRecoveryFailure(error);
          remaining++;
        }
      }
      return { examined, repaired, remaining };
    } finally { this.sweeping = false; }
  }

  /** UNIT-006: start-limit is observed, never automatically reset. */
  startLimitState(): Array<{ agent: Actor; why: string }> {
    const result: Array<{ agent: Actor; why: string }> = [];
    for (const agent of this.store.listAgents()) {
      if (agent.role !== "resident") continue;
      const why = this.units.startLimitStatus(agent.name);
      if (why) result.push({ agent: agent.name, why });
    }
    return result;
  }

  assertCanonicalHealthy(): void {
    const result = spawnSync("/usr/bin/git", ["--git-dir", this.paths.projectGit, "fsck", "--strict", "--no-reflogs"],
      { env: gitEnv, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
    if (result.error || result.signal || result.status === null)
      throw new StoreError("INTERNAL_ERROR", "canonical repository health could not be observed within bounds");
    if (result.status !== 0)
      throw new StoreError("STORE_CORRUPT", `canonical repo fsck failed: ${(result.stderr ?? "").slice(0, 300)}`);
  }
}
