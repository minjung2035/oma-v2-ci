import type { CreateAcceptance, LifecycleSourcePublication, LifecycleEffects, LifecycleWorkspace } from "./ports.js";
import type { HostControlParams, HostControlResult } from "@oma/contracts/internal-wire";
import { assertCurrentActor } from "@oma/domain/authority";
import { publicFailure } from "@oma/domain/errors";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
// LIFE/CREATE: feature workflow composition through consumer-owned capabilities.
import type { Actor, AgentCreateInput, AuthContext, MessageId, Receipt } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import type { LifecycleLedger } from "./ports.js";
import type { LifecycleUnits } from "./ports.js";
import type { LifecycleMail } from "./ports.js";
import { LifecyclePolicy } from "./policy.js";
import { CreateCoordinator } from "./create.js";
import { SocietyControl } from "./society.js";
import { LifecycleActions } from "./actions.js";
import { RegistryOperations } from "./registry-operations.js";
import type { LifecyclePaths, SeedConfig, SpecResolver } from "./contracts.js";
export type { LifecyclePaths, SpecResolver } from "./contracts.js";

export class LifecycleModule {
  private readonly creates: CreateCoordinator;
  private readonly society: SocietyControl;
  private readonly actions: LifecycleActions;
  private readonly registry: RegistryOperations;
  private readonly policy: LifecyclePolicy;
  constructor(private readonly store: LifecycleLedger, private readonly units: LifecycleUnits, paths: LifecyclePaths, resolveSpec: SpecResolver,
    workspace: LifecycleWorkspace, mail: LifecycleMail | null, effects: LifecycleEffects, source: LifecycleSourcePublication | null = null) {
    if (typeof paths.activationAllowed !== "function")
      throw new StoreError("UNSUPPORTED_PROFILE", "lifecycle requires an explicit activation gate");
    const policy = this.policy = new LifecyclePolicy(store, resolveSpec);
    const gatedPaths = { ...paths, activationAllowed: () => paths.activationAllowed() && store.societyOpen() };
    this.creates = new CreateCoordinator(store, units, gatedPaths, policy, workspace, mail, effects, source);
    this.actions = new LifecycleActions(store, units, gatedPaths, policy, effects);
    this.society = new SocietyControl(store, units, effects);
    this.registry = new RegistryOperations(store, effects);
  }
  /** Human-only adapter. Accepted facts and physical recovery remain owned by
   * the original actions/Society coordinators; these expectations fence only
   * fresh acceptance and never reinterpret a previous receipt. */
  async control(auth: AuthContext, input: HostControlParams): Promise<HostControlResult> {
    if (auth.channel !== "host" || auth.actor !== "principal" || auth.role !== "principal")
      throw new StoreError("AUTH_FAILED", "individual Human controls require the supervising host");
    assertCurrentActor(this.store, auth);
    if (input.action === "receipt") {
      const operation = this.store.getOperation(auth.actor, input.key);
      return { kind: "receipt", key: input.key, receipt: operation === null ? null : receiptOfOperation(operation) };
    }
    if (input.action === "society")
      return { kind: "receipt", key: input.key, receipt: await this.society.set(auth, input.state, input.key) };
    // Fresh-only expectations cannot retarget an already accepted Human key to
    // another incarnation. The original owner still decides receipt/recovery.
    if (input.action === "stop" || input.action === "release") {
      const prior = this.store.getOperation(auth.actor, input.key);
      if (prior !== null && (prior.kind === "agent.start" || prior.kind === "agent.stop") && prior.plan.previousIncarnation !== input.expected.incarnation)
        throw new StoreError("REQUEST_KEY_REUSED", "the original Human control key names another observed incarnation");
    }
    this.policy.requireManage(auth, input.agent);
    const target = this.store.getAgent(input.agent);
    if (target === null) throw new StoreError("ADDRESS_NOT_FOUND", "Human control target is unknown");
    if (target.role !== "resident") throw new StoreError("CAPABILITY_DENIED", "individual Human controls target Workers only");
    if (input.action === "inspect") {
      const control = this.store.latestAgentAction(input.agent);
      const principal = this.store.latestAgentAction(input.agent, "principal");
      const registryObservedAtMs = Date.now();
      let execution: import("@oma/contracts").ExecutionObservation | null = null;
      let executionError: import("@oma/contracts").ErrorCode | null = null;
      try { execution = this.units.observe(input.agent); } catch (error) { const failure = publicFailure(error); if (failure.code === "STORE_CORRUPT") throw error; executionError = failure.code; }
      const executionObservedAtMs = Date.now();
      let termination: "confirmed-dead" | "unconfirmed" = "unconfirmed";
      let terminationError: import("@oma/contracts").ErrorCode | null = null;
      try { if (this.units.confirmDead(input.agent, target.incarnation)) termination = "confirmed-dead"; }
      catch (error) { const failure = publicFailure(error); if (failure.code === "STORE_CORRUPT") throw error; terminationError = failure.code; }
      return { kind: "status", agent: input.agent, desired: target.desired, incarnation: target.incarnation, registryObservedAtMs,
        control: control === null ? null : { operation: control.id, actor: control.actor, key: control.requestKey, kind: control.kind, state: control.state },
        principalControl: principal === null ? null : { operation: principal.id, key: principal.requestKey, kind: principal.kind, state: principal.state },
        execution, executionObservedAtMs, executionError, termination, terminationObservedAtMs: Date.now(), terminationError };
    }
    const beforeAccept = (): undefined => {
      const current = this.store.getAgent(input.agent);
      const control = this.store.latestAgentAction(input.agent);
      if (current === null || current.role !== "resident" || current.incarnation !== input.expected.incarnation ||
          current.desired !== input.expected.desired || (control?.id ?? null) !== input.expected.control)
        throw new StoreError("STALE_RUN", "Human control target or original stop changed; inspect it before a distinct decision");
      if (input.action === "release" && (control?.kind !== "agent.stop" || current.desired !== "stopped"))
        throw new StoreError("CAPABILITY_DENIED", "Human release requires the exact observed current stop");
      return undefined;
    };
    const receipt = input.action === "stop" ? await this.actions.stop(auth, input.agent, input.key, beforeAccept)
      : await this.actions.start(auth, input.agent, input.key, beforeAccept);
    return { kind: "receipt", key: input.key, receipt };
  }
  freezeCreation(auth: AuthContext, input: AgentCreateInput) { return this.policy.freezeCreation(auth, input); }
  creation(auth: AuthContext) { return this.policy.observeCreation(auth); }
  assertActiveCapacity(): void { this.policy.assertActiveCapacity(); }
  setSociety(auth: AuthContext, state: "open" | "closed", key: string): Promise<Receipt> { return this.society.set(auth, state, key); }
  reconcileSociety(id: string): Promise<void> { return this.society.reconcileById(id); }
  bootstrap(config: SeedConfig): Promise<void> { return this.creates.bootstrap(config); }
  create(auth: AuthContext, input: AgentCreateInput, key: string, stream?: AsyncIterable<Uint8Array>, beforeAccept?: CreateAcceptance): Promise<Receipt> { return this.creates.create(auth, input, key, stream, beforeAccept); }
  start(auth: AuthContext, agent: Actor, key: string): Promise<Receipt> { return this.actions.start(auth, agent, key); }
  stop(auth: AuthContext, agent: Actor, key: string): Promise<Receipt> { return this.actions.stop(auth, agent, key); }
  ack(auth: AuthContext, message: MessageId, key: string): Receipt { return this.registry.ack(auth, message, key); }
  follow(auth: AuthContext, topic: string, subscribe: boolean, key: string): Receipt { return this.registry.follow(auth, topic, subscribe, key); }
  reconcileCreate(id: string, allowActivation = true): Promise<void> { return this.creates.reconcile(id, allowActivation); }
  reconcileAction(id: string, allowActivation = true): Promise<void> { return this.actions.reconcile(id, allowActivation); }
}
