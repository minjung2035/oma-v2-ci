import type { LifecycleWorkspace, LifecycleEffects } from "./ports.js";
import { encodeOperationPlan } from "@oma/protocol/operation-codec";
import type { Actor, AgentCreateInput, AuthContext, Receipt, ResolvedAgentSpec } from "@oma/contracts";
import type { LifecycleLedger } from "./ports.js";
import { reused } from "@oma/domain/request-identity";
import { type AgentRow } from "@oma/contracts/ledger";
import { StoreError, acceptedFailure } from "@oma/domain/errors";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { requestHash } from "@oma/domain/request-identity";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { assertActorIdentity, assertCurrentActor } from "@oma/domain/authority";
import { workspacePathAt, isWorkspacePathFor } from "@oma/domain/paths";
import type { MailPreacceptScope as PreacceptScope } from "@oma/mail/ports";
import { frozenMessageDisposition } from "@oma/mail/materializer";
import type { LifecycleMail } from "./ports.js";
import type { LifecycleUnits } from "./ports.js";
import type { LifecyclePaths, PhysicalCreatePlan, LinkedCreatePlan, SeedConfig } from "./contracts.js";
import { LifecyclePolicy, lifecycleReceipt } from "./policy.js";
import { CreationPublicationObserver } from "./create-publication.js";

/** A linked request owns no new workspace, unit or initial message.
 * Create preparation may await. Acceptance alone owns the atomic winner decision.
 */
export class CreateCoordinator {
  private readonly publication: CreationPublicationObserver;
  private completing: { readonly id: string; readonly task: Promise<Receipt> } | null = null;
  constructor(private readonly store: LifecycleLedger, private readonly units: Pick<LifecycleUnits, "assertResidentNamesFree" | "ensureResident" | "start">,
    private readonly paths: LifecyclePaths, private readonly policy: LifecyclePolicy,
    private readonly workspace: LifecycleWorkspace, private readonly mail: LifecycleMail | null, private readonly effects: LifecycleEffects) {
    this.publication = new CreationPublicationObserver(store, units, paths.stateRoot, workspace);
  }

  async bootstrap(config: SeedConfig): Promise<void> {
    if (this.paths.hasGoal()) return;
    const agents = this.store.listAgents();
    const recorded = agents.flatMap(agent => {
      const operation = this.store.getOperation("principal", `bootstrap-${agent.name}`);
      return operation?.kind === "agent.create" ? [operation] : [];
    });
    const resolve = (name: string, profile: string, brief: string, from: string): ResolvedAgentSpec => {
      const selected = config.agentProfiles[profile];
      if (!selected || !config.modelProfiles[selected.modelProfile])
        throw new StoreError("UNSUPPORTED_PROFILE", `unsupported bootstrap profile ${profile}`);
      return { name, profile, brief, from, modelProfile: selected.modelProfile,
        capabilities: [...new Set(selected.capabilities)].sort() };
    };
    if (agents.length > 0) {
      if (!recorded.some(operation => operation.state === "pending" || operation.state === "unknown")) return;
      if (recorded.length !== config.initialResidents.length)
        throw new StoreError("AGENT_CONFLICT", "bootstrap seed set changed during recovery");
      for (const operation of recorded) {
        const seed = config.initialResidents.find(value => value.name === operation.plan.spec.name);
        if (!seed || resolvedSpecDigest(resolve(seed.name, seed.profile, seed.brief, operation.plan.spec.from)) !== operation.plan.specHash)
          throw new StoreError("AGENT_CONFLICT", "bootstrap seed spec changed during recovery");
      }
      return;
    }
    const mail = this.requireMail();
    const from = this.workspace.canonicalMain();
    const principal = resolve("principal", config.principalProfile, "Principal", from);
    const auth: AuthContext = { actor: "principal", incarnation: 0, role: "principal", channel: "host",
      capabilities: new Set(principal.capabilities), peer: this.effects.bootstrapPeer() };
    // Seeds are prepared one at a time, so a failure leaves no preparation
    // running after it; every brief frozen so far settles with the seed set.
    const scope: PreacceptScope = this.effects.newPreacceptScope();
    const plans: { id: string; plan: PhysicalCreatePlan }[] = [];
    try {
      for (const seed of config.initialResidents) {
        const spec = resolve(seed.name, seed.profile, seed.brief, from);
        const id = this.effects.nextOperationId();
        const { message: initialMessage, artifact } = await mail.freezeCreateInitial(auth, id, seed.name, seed.brief);
        scope.register({ operationId: id, resource: initialMessage.id, owner: artifact, observe: () => frozenMessageDisposition(this.store, id, initialMessage) });
        plans.push({ id, plan: { kind: "agent.create", spec, specHash: resolvedSpecDigest(spec), parent: "principal",
          workspacePath: workspacePathAt(this.paths.stateRoot, seed.name), execution: "native", initialMessage, existingCreation: null } });
      }
      // All seed intentions and their registry/delivery links become visible together.
      this.store.transaction(tx => {
        if (this.store.listAgents().length > 0) throw new StoreError("AGENT_CONFLICT", "bootstrap registry changed during preparation");
        tx.insertAgent({ name: "principal", specHash: resolvedSpecDigest(principal), role: "principal", desired: "enabled",
          incarnation: 0, profile: principal.profile, createdBy: null, specJson: JSON.stringify(principal) });
        for (const { id, plan } of plans) {
          const input = { name: plan.spec.name, from, brief: plan.spec.brief };
          tx.acceptOperation({ id, actor: "principal", requestKey: `bootstrap-${plan.spec.name}`, requestHash: requestHash("agent.create", input),
            kind: "agent.create", payloadJson: JSON.stringify(input), planJson: encodeOperationPlan(plan) });
          tx.insertAgent({ name: plan.spec.name, specHash: plan.specHash, role: "resident", desired: "provisioning", incarnation: 0,
            profile: plan.spec.profile, createdBy: "principal", specJson: JSON.stringify(plan.spec) });
          tx.insertDeliveries([{ messageId: plan.initialMessage.id, recipient: plan.spec.name, operationId: id }]);
        }
      });
    } catch (error) { scope.settleFailure(error); }
    scope.settle();
  }

  async create(auth: AuthContext, source: AgentCreateInput, key: string): Promise<Receipt> {
    const input = Object.freeze({ ...source });
    assertActorIdentity(this.store, auth);
    const hash = requestHash("agent.create", { name: input.name, from: input.from, brief: input.brief });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    if (claim === "reused") throw reused(auth.actor, key);
    let revision = this.policy.refresh();
    let { spec, specHash } = this.policy.resolve(auth, input);
    const existing = this.store.getAgent(input.name);
    if (existing) {
      if (existing.specHash !== specHash) throw new StoreError("AGENT_CONFLICT", `name ${input.name} already exists with a different resolved spec`);
      const original = this.store.findPhysicalCreate(input.name, specHash);
      if (!original) throw new StoreError("STORE_CORRUPT", `agent ${input.name} has no physical create operation`);
      const id = this.effects.nextOperationId();
      const accepted = this.store.transaction(tx => {
        this.policy.assertRevision(revision);
        ({ spec, specHash } = this.policy.resolve(auth, input));
        if (this.store.getAgent(input.name)?.specHash !== specHash)
          throw new StoreError("AGENT_CONFLICT", "existing child spec changed before acceptance");
        const plan: LinkedCreatePlan = { kind: "agent.create", spec, specHash, parent: auth.actor,
          workspacePath: workspacePathAt(this.paths.stateRoot, input.name), execution: "native",
          initialMessage: null, existingCreation: original.id };
        return tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.create",
          payloadJson: JSON.stringify(input), planJson: encodeOperationPlan(plan) });
      });
      if (accepted === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
      return this.settleLinked(id, original.id, input.name);
    }
    this.workspace.assertCanonicalBase(input.from);
    // P0V-26: refused before acceptance, rather than accepted and then unable
    // to install its units.
    this.units.assertResidentNamesFree(input.name);
    const id = this.effects.nextOperationId();
    // From the frozen brief to acceptance, one settlement decides the brief:
    // a physical winner's plan names it, a linked plan or a loser does not.
    const scope: PreacceptScope = this.effects.newPreacceptScope();
    let accepted: { outcome: "inserted" | "retry"; linked: string | null };
    try {
      const { message: initialMessage, artifact } = await this.requireMail().freezeCreateInitial(auth, id, input.name, input.brief);
      scope.register({ operationId: id, resource: initialMessage.id, owner: artifact, observe: () => frozenMessageDisposition(this.store, id, initialMessage) });
      revision = this.policy.refresh();
      accepted = this.store.transaction(tx => {
        this.policy.assertRevision(revision);
        ({ spec, specHash } = this.policy.resolve(auth, input));
        const plan: PhysicalCreatePlan = { kind: "agent.create", spec, specHash, parent: auth.actor,
          workspacePath: workspacePathAt(this.paths.stateRoot, input.name), execution: "native", initialMessage, existingCreation: null };
        const raced = this.store.getAgent(input.name);
        if (raced) {
          if (raced.specHash !== specHash) throw new StoreError("AGENT_CONFLICT", `name ${input.name} already exists with a different resolved spec`);
          const original = this.store.findPhysicalCreate(input.name, specHash);
          if (!original) throw new StoreError("STORE_CORRUPT", `agent ${input.name} has no physical create operation`);
          const linked: LinkedCreatePlan = { ...plan, initialMessage: null, existingCreation: original.id };
          const outcome = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.create",
            payloadJson: JSON.stringify(input), planJson: encodeOperationPlan(linked) });
          return { outcome, linked: original.id };
        }
        const outcome = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.create",
          payloadJson: JSON.stringify(input), planJson: encodeOperationPlan(plan) });
        if (outcome === "inserted") {
          tx.insertAgent({ name: input.name, specHash, role: "resident", desired: "provisioning", incarnation: 0,
            profile: spec.profile, createdBy: auth.actor, specJson: JSON.stringify(spec) });
          tx.insertDeliveries([{ messageId: initialMessage.id, recipient: input.name, operationId: id }]);
        }
        return { outcome, linked: null };
      });
    } catch (error) { scope.settleFailure(error); }
    scope.settle();
    if (accepted.outcome === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    // The creation is accepted: a failure from here is reported as accepted.
    try { return accepted.linked ? this.settleLinked(id, accepted.linked, input.name) : await this.finish(id, true, auth); }
    catch (error) { throw acceptedFailure(error); }
  }

  async reconcile(id: string, allowActivation = true): Promise<void> {
    const operation = this.store.getOperationById(id);
    if (!operation || operation.kind !== "agent.create" || (operation.state !== "pending" && operation.state !== "unknown")) return;
    if (operation.plan.existingCreation) { this.settleLinked(id, operation.plan.existingCreation, operation.plan.spec.name); return; }
    await this.finish(id, allowActivation);
  }

  private settleLinked(id: string, originalId: string, name: Actor): Receipt {
    const original = this.store.getOperationById(originalId);
    const linked = this.store.getOperationById(id);
    if (!original || original.kind !== "agent.create" || !linked || linked.kind !== "agent.create" || original.id === linked.id ||
      linked.plan.existingCreation !== original.id || linked.plan.initialMessage !== null || original.plan.existingCreation !== null ||
      original.plan.spec.name !== name || linked.plan.spec.name !== name || original.plan.specHash !== linked.plan.specHash)
      throw new StoreError("STORE_CORRUPT", "linked create does not identify the original physical creation");
    if (linked.state === "succeeded" || linked.state === "failed") return receiptOfOperation(linked);
    if (original.state === "succeeded") {
      const agent = this.store.getAgent(name);
      if (!agent || agent.specHash !== original.plan.specHash) throw new StoreError("STORE_CORRUPT", "converged agent missing or changed");
      this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify({ kind: "agent.create", agent: name, desired: agent.desired, remainingOperations: [] })));
    } else if (original.state === "failed") {
      this.store.transaction(tx => tx.setOperationFailed(id, original.errorCode));
    } else if (original.state === "unknown") this.store.transaction(tx => tx.setOperationUnknown(id));
    return lifecycleReceipt(this.store, id);
  }

  private finish(id: string, allowActivation = true, auth?: AuthContext): Promise<Receipt> {
    if (this.completing) return this.completing.id === id ? this.completing.task :
      Promise.reject(new StoreError("BROKER_UNAVAILABLE", "another accepted creation is completing; its intent is retained", { details: { reason: "busy" } }));
    const task = Promise.resolve().then(() => this.finishAccepted(id, allowActivation, auth))
      .finally(() => { if (this.completing?.task === task) this.completing = null; });
    this.completing = { id, task }; return task;
  }

  private async finishAccepted(id: string, allowActivation: boolean, auth?: AuthContext): Promise<Receipt> {
    const mail = this.requireMail();
    const operation = this.store.getOperationById(id);
    if (!operation || operation.kind !== "agent.create") throw new StoreError("REQUEST_NOT_FOUND", `no create operation ${id}`);
    if (operation.state === "succeeded" || operation.state === "failed") return receiptOfOperation(operation);
    const plan = operation.plan;
    if (plan.existingCreation) throw new StoreError("AGENT_NOT_READY", "linked create awaits original creation");
    if (!plan.initialMessage) throw new StoreError("STORE_CORRUPT", "create plan has no initial message");
    if ("unitNames" in plan)
      throw new StoreError("UNSUPPORTED_PROFILE", "accepted systemd installation intent is retained; native execution cannot complete it");
    if (!isWorkspacePathFor(plan.workspacePath, { stateRoot: this.paths.stateRoot, actor: plan.spec.name }))
      throw new StoreError("STORE_CORRUPT", "create workspace identity mismatch");
    const agent = this.store.getAgent(plan.spec.name);
    if (!agent || agent.specHash !== plan.specHash || resolvedSpecDigest(resolvedSpecOf(agent)) !== plan.specHash)
      throw new StoreError("STORE_CORRUPT", "create agent/spec mismatch");
    // P0-1, CREATE-003: the accepted plan and the agent row it made are the
    // facts, and the host policy was resolved in the acceptance transaction; a
    // later edit does not reinterpret them, here or in recovery. Two things are
    // checked instead: that the agent is still the one this plan made, and --
    // before an effect on a live request's behalf -- that the requester still
    // holds its lease and capability (INV06). A requester that lost them leaves
    // the accepted intent to recovery, which never fabricates a live context.
    const assertCurrent = (): AgentRow => {
      const current = this.store.getAgent(plan.spec.name);
      if (!current || current.specHash !== plan.specHash) throw new StoreError("STORE_CORRUPT", "create owner changed during preparation");
      if (current.incarnation !== agent.incarnation) throw new StoreError("RUN_TERMINATION_UNKNOWN", "create incarnation changed during preparation");
      if (auth) assertCurrentActor(this.store, auth, "agent.create");
      return current;
    };
    mail.publishCreateInitial(plan.initialMessage);
    await this.workspace.ensure(plan, agent.desired !== "provisioning");
    const fresh = this.store.getOperationById(id);
    if (!fresh || fresh.kind !== "agent.create" || fresh.planJson !== operation.planJson)
      throw new StoreError("STORE_CORRUPT", "accepted creation changed during workspace preparation");
    if (fresh.state === "succeeded" || fresh.state === "failed") return receiptOfOperation(fresh);
    assertCurrent();
    this.effects.ensureAgentDirectories(plan.spec.name);
    // Current authority -> installation/readiness is a synchronous section.
    const proof = this.publication.ready(fresh);
    await mail.publishGated(id, proof);
    // P0V-92: the row the check just read, not a second read assumed present.
    const current = assertCurrent();
    const desired = current.desired;
    if (desired === "enabled" && this.paths.hasGoal()) {
      if (!allowActivation || this.paths.activationAllowed() !== true) return lifecycleReceipt(this.store, id);
      // No await between current identity/stop/activation checks and start.
      await this.units.start(plan.spec.name, false, () => {
        const current = assertCurrent();
        if (current.desired !== "enabled" || !this.paths.hasGoal() || !this.paths.activationAllowed())
          throw new StoreError("STALE_RUN", "creation activation is no longer permitted");
      });
    }
    this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify({ kind: "agent.create", agent: plan.spec.name, desired, remainingOperations: [] })));
    return lifecycleReceipt(this.store, id);
  }
  private requireMail(): LifecycleMail {
    if (!this.mail) throw new StoreError("INTERNAL_ERROR", "create mail boundary unavailable");
    return this.mail;
  }
}
