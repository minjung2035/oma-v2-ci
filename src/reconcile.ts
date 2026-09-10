// MUST [REC-001/002]: bounded physical reconciliation — pending/unknown
// operations and prepared batches are compared against the actual filesystem,
// Git refs and systemd units; memory-only state is not reconstructed.
import { spawnSync } from "node:child_process";
import type { Actor } from "../implementation/contracts.js";
import { Store, StoreError } from "./store.js";
import { MailModule } from "./mail.js";
import { GitModule, gitEnv } from "./git.js";
import { UnitsModule } from "./units.js";
import { LifecycleModule } from "./lifecycle.js";

export interface ReconcilePaths {
  projectGit: string;
  hasGoal?: () => boolean;
}

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

  /** MUST [LIFE-006]/[REC-001]: order matters — mail, create/Git, then units. */
  async startup(allowActivation = true): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const agent of this.store.listAgents()) {
        if (agent.role !== "resident") continue;
        if (!this.units.confirmDead(agent.name, agent.incarnation))
          this.units.stop(agent.name, agent.incarnation);
        if (!this.units.confirmDead(agent.name, agent.incarnation))
          throw new StoreError("RUN_TERMINATION_UNKNOWN", `startup cannot prove ${agent.name} terminated`);
      }
      if (this.git) this.assertCanonicalHealthy();
      await this.mail.reconcilePending();
      for (const id of this.store.recoverableOperations()) {
        const op = this.store.getOperationById(id);
        if (!op) continue;
        if (op.kind === "agent.create") {
          await this.lifecycle.reconcileCreate(id, allowActivation);
          continue;
        }
        if (op.kind === "agent.start" || op.kind === "agent.stop") {
          this.lifecycle.reconcileAction(id, allowActivation);
          continue;
        }
        if (
          (op.kind === "git.submit" ||
            op.kind === "git.integrate" ||
            op.kind === "context.publish") &&
          this.git
        ) {
          await this.git.reconcile(id);
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  /** MUST [REC-002]: one bounded sweep; concurrent sweeps join/skip. */
  async sweep(): Promise<{
    examined: number;
    repaired: number;
    remaining: number;
  }> {
    if (this.sweeping) return { examined: 0, repaired: 0, remaining: 0 };
    this.sweeping = true;
    try {
      const mailRes = await this.mail.reconcilePending();
      let repaired = mailRes.repaired;
      let remaining = mailRes.remaining;
      let examined = mailRes.examined;
      for (const id of this.store.recoverableOperations()) {
        const op = this.store.getOperationById(id);
        if (!op || op.kind === "mail.send" || op.kind === "agent.continue")
          continue;
        examined++;
        try {
          if (op.kind === "agent.create") {
            await this.lifecycle.reconcileCreate(id);
          } else if (op.kind === "agent.start" || op.kind === "agent.stop") {
            this.lifecycle.reconcileAction(id);
          } else if (
            (op.kind === "git.submit" ||
              op.kind === "git.integrate" ||
              op.kind === "context.publish") &&
            this.git
          ) {
            await this.git.reconcile(id);
          } else {
            remaining++;
            continue;
          }
          if (this.store.getOperationById(id)?.state === "succeeded") repaired++;
          else remaining++;
        } catch (error) {
          if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error;
          remaining++;
        }
      }

      // UNIT-005/CTX-006: stopped agents with a live unit are stopped. Enabled
      // agents only activate after a shared GOAL exists; pre-GOAL initial mail
      // must not wake a newly created Resident.
      for (const a of this.store.listAgents()) {
        if (a.role !== "resident" || a.desired === "retired") continue;
        try {
          const obs = this.units.observe(a.name);
          if (
            a.desired === "stopped" &&
            (obs.activeState === "active" || obs.activeState === "activating")
          ) {
            this.units.stop(a.name, a.incarnation);
            continue;
          }
          if (a.desired !== "enabled") continue;
          if (this.paths.hasGoal && !this.paths.hasGoal()) continue;
          const pendingCount = this.store.pendingDeliveries(a.name).length +
            this.store.preparedBatches(a.name).length;
          const inactive =
            obs.activeState === "inactive" || obs.activeState === "dead";
          if (pendingCount > 0 && inactive) this.units.start(a.name, false);
        } catch (error) {
          if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error;
          remaining++;
        }
      }
      return { examined, repaired, remaining };
    } finally {
      this.sweeping = false;
    }
  }

  /** MUST [UNIT-006]: start-limit surface never auto-resets. */
  startLimitState(): Array<{ agent: Actor; why: string }> {
    const out: Array<{ agent: Actor; why: string }> = [];
    for (const a of this.store.listAgents()) {
      if (a.role !== "resident") continue;
      const why = this.units.startLimitStatus(a.name);
      if (why) out.push({ agent: a.name, why });
    }
    return out;
  }

  /** integrity guard for the shared repo (REC-001: never silently overwrite). */
  assertCanonicalHealthy(): void {
    const r = spawnSync(
      "/usr/bin/git",
      ["--git-dir", this.paths.projectGit, "fsck", "--strict", "--no-reflogs"],
      { env: gitEnv, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    if (r.error || r.signal)
      throw new StoreError("INTERNAL_ERROR", "canonical repository health could not be observed within bounds");
    if (r.status !== 0)
      throw new StoreError(
        "STORE_CORRUPT",
        `canonical repo fsck failed: ${(r.stderr ?? "").slice(0, 300)}`,
      );
  }
}
