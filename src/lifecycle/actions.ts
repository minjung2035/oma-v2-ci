import type { Actor, AuthContext, OperationResult, Receipt } from "../../implementation/contracts.js";
import { Store, reused } from "../store.js";
import { StoreError } from "../domain/errors.js";
import { assertActorIdentity } from "../authority.js";
import { generateOperationId } from "../ids.js";
import { requestHash } from "../hash.js";
import { receiptOfOperation } from "../storage/receipt-projector.js";
import { UnitsModule } from "../units.js";
import type { LifecyclePaths } from "./contracts.js";
import { LifecyclePolicy, lifecycleReceipt } from "./policy.js";

/** Normal start/stop and recovery deliberately have separate decision paths.
 * Units owns revoke/path/service attempts and incarnation-aware death proof.
 * D06: current management authority is required even for terminal action replay.
 * A later desired state or incarnation cannot grant an old intent a new effect.
 * Without historical physical proof such an intent remains unknown, not failed.
 */
export class LifecycleActions {
  constructor(private readonly store: Store, private readonly units: UnitsModule,
    private readonly paths: LifecyclePaths, private readonly policy: LifecyclePolicy) {}

  start(auth: AuthContext, agent: Actor, key: string): Receipt {
    assertActorIdentity(this.store, auth);
    const hash = requestHash("agent.start", { agent });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "reused") throw reused(auth.actor, key);
    this.policy.requireManage(auth, agent);
    const target = this.requireTarget(agent);
    if (!this.paths.hasGoal()) throw new StoreError("GOAL_REQUIRED", "shared GOAL not published yet");
    const prior = claim === "retry" ? this.store.getOperation(auth.actor, key)! : null;
    if (prior && prior.state !== "pending" && prior.state !== "unknown") return receiptOfOperation(prior);
    if (prior) {
      if (prior.kind !== "agent.start" || prior.plan.agent !== agent)
        throw new StoreError("STORE_CORRUPT", "start replay differs from accepted identity");
      if (!this.currentIntent(prior.plan)) return this.unconfirmed(prior.id);
    }
    if (this.paths.activationAllowed() !== true)
      throw new StoreError("AGENT_NOT_READY", "broker recovery has not enabled activation");
    const observed = this.units.observe(agent);
    const alreadyRunning = target.desired === "enabled" && ["active", "activating"].includes(observed.activeState);
    if (!alreadyRunning && !this.units.confirmDead(agent, target.incarnation))
      throw new StoreError("RUN_TERMINATION_UNKNOWN", `previous cgroup of ${agent} not confirmed dead`);
    const id = prior?.id ?? generateOperationId();
    if (!prior) {
      const accepted = this.store.transaction(tx => {
        this.policy.requireManage(auth, agent);
        const current = this.requireTarget(agent);
        if (current.incarnation !== target.incarnation || current.desired !== target.desired)
          throw new StoreError("STALE_RUN", "target changed before start acceptance");
        const result = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.start",
          payloadJson: JSON.stringify({ agent }), planJson: JSON.stringify({ kind: "agent.start", agent,
            previousIncarnation: target.incarnation, desired: "enabled", remainingOperations: [] }) });
        if (result !== "retry") tx.updateAgent({ name: agent, desired: "enabled" });
        return result;
      });
      if (accepted === "retry") return receiptOfOperation(this.store.getOperation(auth.actor, key)!);
    }
    // Synchronous final identity check -> physical action. Neither a new target
    // epoch nor an old plan is rewritten to make this comparison succeed.
    if (!this.currentIntent({ agent, desired: "enabled", previousIncarnation: target.incarnation })) return this.unconfirmed(id);
    try { if (!alreadyRunning) this.units.start(agent, true); }
    catch (error) { return this.unconfirmed(id, error); }
    this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify({ kind: "agent.start", agent, desired: "enabled", remainingOperations: [] })));
    return lifecycleReceipt(this.store, id);
  }

  stop(auth: AuthContext, agent: Actor, key: string): Receipt {
    assertActorIdentity(this.store, auth);
    const hash = requestHash("agent.stop", { agent });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "reused") throw reused(auth.actor, key);
    this.policy.requireManage(auth, agent);
    const target = this.requireTarget(agent);
    const prior = claim === "retry" ? this.store.getOperation(auth.actor, key)! : null;
    if (prior && prior.state !== "pending" && prior.state !== "unknown") return receiptOfOperation(prior);
    if (prior) {
      if (prior.kind !== "agent.stop" || prior.plan.agent !== agent)
        throw new StoreError("STORE_CORRUPT", "stop replay differs from accepted identity");
      if (!this.currentIntent(prior.plan)) return this.unconfirmed(prior.id);
    }
    const id = prior?.id ?? generateOperationId();
    const incarnation = prior?.kind === "agent.stop" ? prior.plan.previousIncarnation : target.incarnation;
    if (!prior) {
      const accepted = this.store.transaction(tx => {
        this.policy.requireManage(auth, agent);
        const current = this.requireTarget(agent);
        if (current.incarnation !== target.incarnation || current.desired !== target.desired)
          throw new StoreError("STALE_RUN", "target changed before stop acceptance");
        const result = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.stop",
          payloadJson: JSON.stringify({ agent }), planJson: JSON.stringify({ kind: "agent.stop", agent,
            previousIncarnation: target.incarnation, desired: "stopped", remainingOperations: [] }) });
        if (result !== "retry") tx.updateAgent({ name: agent, desired: "stopped" });
        return result;
      });
      if (accepted === "retry") return receiptOfOperation(this.store.getOperation(auth.actor, key)!);
    }
    if (!this.currentIntent({ agent, desired: "stopped", previousIncarnation: incarnation })) return this.unconfirmed(id);
    try {
      this.units.stop(agent, incarnation);
      if (!this.units.confirmDead(agent, incarnation)) return this.unconfirmed(id);
    } catch (error) { return this.unconfirmed(id, error); }
    const remainingOperations = this.store.recoverableOperations().filter(value => value !== id);
    this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify({ kind: "agent.stop", agent, desired: "stopped", remainingOperations })));
    return lifecycleReceipt(this.store, id);
  }

  reconcile(id: string, allowActivation = true): void {
    const operation = this.store.getOperationById(id);
    if (!operation || (operation.kind !== "agent.start" && operation.kind !== "agent.stop") ||
      (operation.state !== "pending" && operation.state !== "unknown")) return;
    const plan = operation.plan;
    if (!this.currentIntent(plan)) { this.unconfirmed(id); return; }
    try {
      if (plan.kind === "agent.start") {
        if (!allowActivation || this.paths.activationAllowed() !== true || !this.paths.hasGoal()) return;
        const observed = this.units.observe(plan.agent);
        if (!["active", "activating"].includes(observed.activeState)) {
          if (!this.units.confirmDead(plan.agent, plan.previousIncarnation)) { this.unconfirmed(id); return; }
          if (!this.currentIntent(plan)) { this.unconfirmed(id); return; }
          this.units.start(plan.agent, false);
        }
      } else {
        this.units.stop(plan.agent, plan.previousIncarnation);
        if (!this.units.confirmDead(plan.agent, plan.previousIncarnation)) { this.unconfirmed(id); return; }
      }
    } catch (error) { this.unconfirmed(id, error); return; }
    const remainingOperations = this.store.recoverableOperations().filter(value => value !== id);
    const result: OperationResult = { kind: plan.kind, agent: plan.agent, desired: plan.desired, remainingOperations };
    this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify(result)));
  }

  private currentIntent(plan: { readonly agent: Actor; readonly previousIncarnation: number; readonly desired: "enabled" | "stopped" }): boolean {
    const current = this.store.getAgent(plan.agent);
    if (!current) throw new StoreError("STORE_CORRUPT", `missing agent ${plan.agent}`);
    return current.desired === plan.desired && current.incarnation === plan.previousIncarnation;
  }
  private requireTarget(agent: Actor) {
    const target = this.store.getAgent(agent);
    if (!target) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${agent}`);
    if (target.desired === "provisioning") throw new StoreError("AGENT_NOT_READY", `${agent} is provisioning`);
    if (target.desired === "retired") throw new StoreError("AGENT_RETIRED", `${agent} is retired`);
    return target;
  }
  private unconfirmed(id: string, error?: unknown): Receipt {
    // Corruption must reach the broker's sticky acceptance fence, not become a receipt.
    if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error;
    this.store.transaction(tx => tx.setOperationUnknown(id));
    return lifecycleReceipt(this.store, id);
  }
}
