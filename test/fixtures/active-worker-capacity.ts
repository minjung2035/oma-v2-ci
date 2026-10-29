import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, ExecutionObservation } from "@oma/contracts";
import { defaultHostConfig } from "@oma/config/defaults";
import { createChildSpecResolver } from "@oma/config/policy";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { projectGitPathAt } from "@oma/domain/paths";
import { Store } from "@oma/storage";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { provisionSociety } from "#oma-test/app/runtime/provision";
import { PolicyExecution } from "./execution.js";

/** Controlled execution port only: no OS process, provider or confinement claim.
 * Store, lifecycle, mail, reconciliation and private Git workspaces are actual owners. */
export class CapacityUnits extends PolicyExecution {
  readonly alive = new Set<string>();
  readonly stubborn = new Set<string>();
  readonly starts: string[] = [];
  onEnsure: ((actor: string) => void) | undefined;
  onDeathObservation: ((actor: string) => void) | undefined;
  constructor(private readonly inTransaction: () => boolean) { super(); }
  override ensureResident(actor: string, profile: string, modelProfile: string): void {
    super.ensureResident(actor, profile, modelProfile);
    this.onEnsure?.(actor);
  }
  override observe(actor: string): ExecutionObservation {
    if (this.inTransaction()) throw new Error("physical observation inside SQLite transaction");
    const idle = super.observe(actor);
    return this.alive.has(actor) ? { ...idle, activeState: "active", subState: "running", invocationId: "1".repeat(32) } : idle;
  }
  override confirmDead(actor: string, incarnation: number): boolean {
    if (this.inTransaction()) throw new Error("physical death observation inside SQLite transaction");
    const dead = super.confirmDead(actor, incarnation);
    this.onDeathObservation?.(actor);
    return dead;
  }
  override start(actor: string, _repair: boolean, authorize?: () => void): void {
    if (this.inTransaction()) throw new Error("physical start inside SQLite transaction");
    authorize?.();
    this.starts.push(actor); this.alive.add(actor);
  }
  override stop(actor: string): ExecutionObservation {
    if (this.inTransaction()) throw new Error("physical stop inside SQLite transaction");
    if (!this.stubborn.has(actor)) this.alive.delete(actor);
    return this.observe(actor);
  }
}

export async function activeCapacityFixture(maxWorkers = 2) {
  const root = mkdtempSync(join(tmpdir(), "oma-active-capacity-"));
  provisionSociety(root);
  let store = new Store(join(root, "runtime.sqlite"));
  const config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: process.cwd(), deploymentDigest: "a".repeat(64) });
  config.maxWorkers = maxWorkers;
  config.initialResidents = config.initialResidents.slice(0, 1);
  let goal = false;
  const units = new CapacityUnits(() => store.inTransaction);
  const projectGit = projectGitPathAt(root);
  const from = execFileSync("/usr/bin/git", ["--git-dir", projectGit, "rev-parse", "main"], { encoding: "utf8" }).trim();
  const compose = () => {
    const mail = createMailModule({ stateRoot: root, society: "demo" }, store, config.limits.addresses, config.limits.batchMaxMessages, config.limits);
    const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit, society: "demo", hasGoal: () => goal,
      activationAllowed: () => true }, createChildSpecResolver(() => config, () => store.inTransaction), mail);
    const reconcile = createReconcileModule(store, mail, null, null, units, lifecycle, { projectGit, hasGoal: () => goal,
      activationAllowed: () => { lifecycle.assertActiveCapacity(); return true; } });
    return { lifecycle, reconcile };
  };
  let modules = compose();
  try {
    await modules.lifecycle.bootstrap(config);
    await modules.lifecycle.reconcileCreate(store.getOperation("principal", "bootstrap-worker-1")!.id);
    goal = true;
  } catch (error) { store.close(); rmSync(root, { recursive: true, force: true }); throw error; }
  const auth = (actor = "worker-1", channel: "host" | "actor" = "actor"): AuthContext => {
    const row = store.getAgent(actor)!;
    return { actor, role: row.role, incarnation: row.incarnation, channel,
      capabilities: new Set(resolvedSpecOf(row).capabilities),
      peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
  };
  return {
    root, config, units, from, auth,
    get store() { return store; },
    get lifecycle() { return modules.lifecycle; },
    get reconcile() { return modules.reconcile; },
    create(name: string, key = name) { return modules.lifecycle.create(auth(), { name, from, brief: `Independent assignment for ${name}` }, key); },
    stop(name: string, key = `stop-${name}`) { return modules.lifecycle.stop(auth("principal", "host"), name, key); },
    start(name: string, key = `start-${name}`) { return modules.lifecycle.start(auth("principal", "host"), name, key); },
    competingLifecycle() { return compose().lifecycle; },
    reopen() { store.close(); store = new Store(join(root, "runtime.sqlite")); modules = compose(); },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
