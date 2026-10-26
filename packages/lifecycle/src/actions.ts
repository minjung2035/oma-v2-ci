import type { LifecycleEffects } from "./ports.js";
import { encodeOperationPlan } from "@oma/protocol/operation-codec";
import type { Actor, AuthContext, OperationResult, Receipt } from "@oma/contracts";
import type { LifecycleLedger } from "./ports.js";
import { reused } from "@oma/domain/request-identity";
import { StoreError, acceptedFailure } from "@oma/domain/errors";
import { assertActorIdentity } from "@oma/domain/authority";
import { requestHash } from "@oma/domain/request-identity";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import type { LifecycleUnits } from "./ports.js";
import type { LifecyclePaths } from "./contracts.js";
import { LifecyclePolicy, lifecycleReceipt } from "./policy.js";

/** Normal start/stop and recovery deliberately have separate decision paths.
 * The execution port owns revocation, stop attempts and incarnation-aware death proof.
 * D06: current management authority is required even for terminal action replay.
 * A later desired state or incarnation cannot grant an old intent a new effect.
 * Without historical physical proof such an intent remains unknown, not failed.
 */
export class LifecycleActions {
  constructor(private readonly store: LifecycleLedger, private readonly units: Pick<LifecycleUnits, "start" | "stop" | "observe" | "confirmDead">,
    private readonly paths: LifecyclePaths, private readonly policy: LifecyclePolicy, private readonly effects: Pick<LifecycleEffects, "nextOperationId">) {}

  async start(auth: AuthContext, agent: Actor, key: string): Promise<Receipt> {
    assertActorIdentity(this.store, auth);
    const hash = requestHash("agent.start", { agent });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "reused") throw reused(auth.actor, key);
    this.policy.requireManage(auth, agent);
    const prior = claim === "retry" ? this.store.retriedOperation(auth.actor, key) : null;
    // AV-20261003-27, P0-1: a durably accepted same-key request replays its
    // terminal receipt whatever the current environment says -- including a
    // retirement or re-provisioning since acceptance, so requireTarget's
    // desired-state fence (like the GOAL, release and activation gates below)
    // judges only new effects, never this lookup.
    if (prior && prior.state !== "pending" && prior.state !== "unknown") return receiptOfOperation(prior);
    if (prior) {
      if (prior.kind !== "agent.start" || prior.plan.agent !== agent)
        throw new StoreError("STORE_CORRUPT", "start replay differs from accepted identity");
      if (!this.currentIntent(prior.plan, prior.id)) return this.unconfirmed(prior.id);
    }
    const target = this.requireTarget(agent);
    if (!this.paths.hasGoal()) throw new StoreError("GOAL_REQUIRED", "shared GOAL not published yet");
    if (!prior && auth.channel === "actor" && auth.role === "principal" &&
        this.store.latestAgentAction(agent, "principal")?.kind !== "agent.stop")
      throw new StoreError("CAPABILITY_DENIED", "the Principal may resume its force-stop; Workers manage routine starts");
    this.requireStartRelease(auth.actor, agent);
    if (this.paths.activationAllowed() !== true)
      throw new StoreError("AGENT_NOT_READY", "broker recovery has not enabled activation");
    const observed = this.units.observe(agent);
    const alreadyRunning = target.desired === "enabled" && ["active", "activating"].includes(observed.activeState);
    if (!alreadyRunning && !this.units.confirmDead(agent, target.incarnation))
      throw new StoreError("RUN_TERMINATION_UNKNOWN", `previous execution scope of ${agent} not confirmed dead`);
    const id = prior?.id ?? this.effects.nextOperationId();
    if (!prior) {
      const accepted = this.store.transaction(tx => {
        this.policy.requireManage(auth, agent);
        this.requireStartRelease(auth.actor, agent);
        const current = this.requireTarget(agent);
        if (current.incarnation !== target.incarnation || current.desired !== target.desired)
          throw new StoreError("STALE_RUN", "target changed before start acceptance");
        const result = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.start",
          payloadJson: JSON.stringify({ agent }), planJson: encodeOperationPlan({ kind: "agent.start", agent,
            previousIncarnation: target.incarnation, desired: "enabled", remainingOperations: [] }) });
        if (result !== "retry") tx.updateAgent({ name: agent, desired: "enabled" });
        return result;
      });
      if (accepted === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    }
    // Synchronous final identity check -> physical action. Neither a new target
    // epoch nor an old plan is rewritten to make this comparison succeed.
    // The start intent is accepted: a failure from here is reported as accepted.
    try {
      if (!this.currentIntent({ agent, desired: "enabled", previousIncarnation: target.incarnation }, id)) return this.unconfirmed(id);
      try { if (!alreadyRunning) await this.units.start(agent, true, () => {
        this.policy.requireManage(auth, agent);
        this.requireStartRelease(auth.actor, agent);
        if (!this.currentIntent({ agent, desired: "enabled", previousIncarnation: target.incarnation }, id) ||
            !this.paths.hasGoal() || !this.paths.activationAllowed())
          throw new StoreError("STALE_RUN", "accepted start is no longer current before execution");
      }); }
      catch (error) { return this.unconfirmed(id, error); }
      this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify({ kind: "agent.start", agent, desired: "enabled", remainingOperations: [] })));
      return lifecycleReceipt(this.store, id);
    } catch (error) { throw acceptedFailure(error); }
  }

  async stop(auth: AuthContext, agent: Actor, key: string): Promise<Receipt> {
    assertActorIdentity(this.store, auth);
    const hash = requestHash("agent.stop", { agent });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "reused") throw reused(auth.actor, key);
    this.policy.requireManage(auth, agent);
    const prior = claim === "retry" ? this.store.retriedOperation(auth.actor, key) : null;
    // Same replay precedence as start: the accepted receipt is answered before
    // the target's current desired state can refuse the lookup.
    if (prior && prior.state !== "pending" && prior.state !== "unknown") return receiptOfOperation(prior);
    if (prior) {
      if (prior.kind !== "agent.stop" || prior.plan.agent !== agent)
        throw new StoreError("STORE_CORRUPT", "stop replay differs from accepted identity");
      if (!this.currentIntent(prior.plan, prior.id)) return this.unconfirmed(prior.id);
    }
    const target = this.requireTarget(agent);
    const id = prior?.id ?? this.effects.nextOperationId();
    const incarnation = prior?.kind === "agent.stop" ? prior.plan.previousIncarnation : target.incarnation;
    if (!prior) {
      const accepted = this.store.transaction(tx => {
        this.policy.requireManage(auth, agent);
        const current = this.requireTarget(agent);
        if (current.incarnation !== target.incarnation || current.desired !== target.desired)
          throw new StoreError("STALE_RUN", "target changed before stop acceptance");
        const result = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.stop",
          payloadJson: JSON.stringify({ agent }), planJson: encodeOperationPlan({ kind: "agent.stop", agent,
            previousIncarnation: target.incarnation, desired: "stopped", remainingOperations: [] }) });
        if (result !== "retry") tx.updateAgent({ name: agent, desired: "stopped" });
        return result;
      });
      if (accepted === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    }
    // The stop intent is accepted: a failure from here is reported as accepted.
    try {
      if (!this.currentIntent({ agent, desired: "stopped", previousIncarnation: incarnation }, id)) return this.unconfirmed(id);
      try {
        await this.units.stop(agent, incarnation);
        if (!this.units.confirmDead(agent, incarnation)) return this.unconfirmed(id);
      } catch (error) { return this.unconfirmed(id, error); }
      const remainingOperations = this.store.recoverableOperations().filter(value => value !== id);
      this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify({ kind: "agent.stop", agent, desired: "stopped", remainingOperations })));
      return lifecycleReceipt(this.store, id);
    } catch (error) { throw acceptedFailure(error); }
  }

  async reconcile(id: string, allowActivation = true): Promise<void> {
    const operation = this.store.getOperationById(id);
    if (!operation || (operation.kind !== "agent.start" && operation.kind !== "agent.stop") ||
      (operation.state !== "pending" && operation.state !== "unknown")) return;
    const plan = operation.plan;
    if (!this.currentIntent(plan, id)) { this.unconfirmed(id); return; }
    try {
      if (plan.kind === "agent.start") {
        this.requireStartRelease(operation.actor, plan.agent);
        if (!allowActivation || this.paths.activationAllowed() !== true || !this.paths.hasGoal()) return;
        const observed = this.units.observe(plan.agent);
        if (!["active", "activating"].includes(observed.activeState)) {
          if (!this.units.confirmDead(plan.agent, plan.previousIncarnation)) { this.unconfirmed(id); return; }
          if (!this.currentIntent(plan, id)) { this.unconfirmed(id); return; }
          await this.units.start(plan.agent, false, () => {
            this.requireStartRelease(operation.actor, plan.agent);
            if (!this.currentIntent(plan, id) || !this.paths.hasGoal() || !this.paths.activationAllowed())
              throw new StoreError("STALE_RUN", "recovered start is no longer current before execution");
          });
        }
      } else {
        await this.units.stop(plan.agent, plan.previousIncarnation);
        if (!this.units.confirmDead(plan.agent, plan.previousIncarnation)) { this.unconfirmed(id); return; }
      }
    } catch (error) { this.unconfirmed(id, error); return; }
    const remainingOperations = this.store.recoverableOperations().filter(value => value !== id);
    const result: OperationResult = { kind: plan.kind, agent: plan.agent, desired: plan.desired, remainingOperations };
    this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify(result)));
  }

  private requireStartRelease(actor: Actor, agent: Actor): void {
    if (actor !== "principal" && this.store.latestAgentAction(agent, "principal")?.kind === "agent.stop")
      throw new StoreError("CAPABILITY_DENIED", `${agent} was force-stopped by the Principal; an explicit Principal/host resume is required`);
  }
  private currentIntent(plan: { readonly agent: Actor; readonly previousIncarnation: number; readonly desired: "enabled" | "stopped" }, id: string): boolean {
    const current = this.store.getAgent(plan.agent);
    if (!current) throw new StoreError("STORE_CORRUPT", `missing agent ${plan.agent}`);
    return current.desired === plan.desired && current.incarnation === plan.previousIncarnation &&
      this.store.latestAgentAction(plan.agent)?.id === id;
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
