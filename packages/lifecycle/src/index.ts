import type { LifecycleEffects, LifecycleWorkspace } from "./ports.js";
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
  constructor(store: LifecycleLedger, units: LifecycleUnits, paths: LifecyclePaths, resolveSpec: SpecResolver,
    workspace: LifecycleWorkspace, mail: LifecycleMail | null, effects: LifecycleEffects) {
    if (typeof paths.activationAllowed !== "function")
      throw new StoreError("UNSUPPORTED_PROFILE", "lifecycle requires an explicit activation gate");
    const policy = new LifecyclePolicy(store, resolveSpec);
    const gatedPaths = { ...paths, activationAllowed: () => paths.activationAllowed() && store.societyOpen() };
    this.creates = new CreateCoordinator(store, units, gatedPaths, policy, workspace, mail, effects);
    this.actions = new LifecycleActions(store, units, gatedPaths, policy, effects);
    this.society = new SocietyControl(store, units, effects);
    this.registry = new RegistryOperations(store, effects);
  }
  setSociety(auth: AuthContext, state: "open" | "closed", key: string): Promise<Receipt> { return this.society.set(auth, state, key); }
  reconcileSociety(id: string): Promise<void> { return this.society.reconcileById(id); }
  bootstrap(config: SeedConfig): Promise<void> { return this.creates.bootstrap(config); }
  create(auth: AuthContext, input: AgentCreateInput, key: string): Promise<Receipt> { return this.creates.create(auth, input, key); }
  start(auth: AuthContext, agent: Actor, key: string): Promise<Receipt> { return this.actions.start(auth, agent, key); }
  stop(auth: AuthContext, agent: Actor, key: string): Promise<Receipt> { return this.actions.stop(auth, agent, key); }
  ack(auth: AuthContext, message: MessageId, key: string): Receipt { return this.registry.ack(auth, message, key); }
  follow(auth: AuthContext, topic: string, subscribe: boolean, key: string): Receipt { return this.registry.follow(auth, topic, subscribe, key); }
  reconcileCreate(id: string, allowActivation = true): Promise<void> { return this.creates.reconcile(id, allowActivation); }
  reconcileAction(id: string, allowActivation = true): Promise<void> { return this.actions.reconcile(id, allowActivation); }
}
