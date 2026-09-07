// MUST [REC-001/002]: bounded physical reconciliation — pending/unknown
// operations and prepared batches are compared against the actual filesystem,
// Git refs and systemd units; memory-only state is not reconstructed.
import { spawnSync } from "node:child_process";
import type { Actor } from "../implementation/contracts.js";
import { Store, StoreError } from "./store.js";
import { MailModule } from "./mail.js";
import { GitModule } from "./git.js";
import { UnitsModule } from "./units.js";

export interface ReconcilePaths {
  projectGit: string;
}

export class ReconcileModule {
  private sweeping = false;

  constructor(
    private readonly store: Store,
    private readonly mail: MailModule,
    private readonly git: GitModule | null,
    private readonly units: UnitsModule,
    private readonly paths: ReconcilePaths,
  ) {}

  /** MUST [LIFE-006]/[REC-001]: order matters — mail effects, git effects, units. */
  async startup(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.mail.reconcilePending();
      const ids = this.store.recoverableOperations();
      for (const id of ids) {
        const op = this.store.getOperationById(id);
        if (!op) continue;
        if (op.kind === "git.submit" && this.git) await this.git.reconcile(id);
      }
    } finally {
      this.sweeping = false;
    }
  }

  /** MUST [REC-002]: one bounded sweep; concurrent sweeps join/skip. */
  async sweep(): Promise<{ examined: number; repaired: number; remaining: number }> {
    if (this.sweeping) return { examined: 0, repaired: 0, remaining: 0 };
    this.sweeping = true;
    try {
      const mailRes = await this.mail.reconcilePending();
      let repaired = mailRes.repaired;
      let remaining = mailRes.remaining;
      const ids = this.store.recoverableOperations();
      let examined = mailRes.examined;
      for (const id of ids) {
        examined++;
        const op = this.store.getOperationById(id);
        if (!op) continue;
        if (op.kind === "git.submit" && this.git) {
          await this.git.reconcile(id);
          if (this.store.getOperationById(id)!.state === "succeeded") repaired++;
          else remaining++;
        }
      }
      // UNIT-005: stopped agents with a live unit are stopped; enabled agents
      // with pending work and an inactive unit are started.
      for (const a of this.store.listAgents()) {
        if (a.role !== "resident" || a.desired === "retired") continue;
        const obs = this.units.observe(a.name);
        if (a.desired === "stopped" && (obs.activeState === "active" || obs.activeState === "activating")) {
          this.units.stop(a.name, a.incarnation);
          continue;
        }
        if (a.desired !== "enabled") continue;
        const pendingCount = this.store.pendingDeliveries(a.name).length + this.store.preparedBatches(a.name).length;
        const inactive = obs.activeState === "inactive" || obs.activeState === "dead";
        if (pendingCount > 0 && inactive) {
          this.units.start(a.name, false);
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
    const r = spawnSync("git", ["--git-dir", this.paths.projectGit, "fsck", "--strict", "--no-reflogs"], { encoding: "utf8" });
    if (r.status !== 0) throw new StoreError("STORE_CORRUPT", `canonical repo fsck failed: ${(r.stderr ?? "").slice(0, 300)}`);
  }
}