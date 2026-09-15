// MUST [LIFE-001..009]/[CREATE-001..003]: compatibility facade and composition only.
import type { Actor, AgentCreateInput, AuthContext, MessageId, Receipt } from "../implementation/contracts.js";
import { StoreError } from "./domain/errors.js";
import { Store } from "./store.js";
import { UnitsModule } from "./units.js";
import type { MailModule } from "./mail.js";
import { LifecyclePolicy } from "./lifecycle/policy.js";
import { WorkspaceCoordinator } from "./lifecycle/workspace.js";
import { CreateCoordinator } from "./lifecycle/create.js";
import { LifecycleActions } from "./lifecycle/actions.js";
import { RegistryOperations } from "./lifecycle/registry-operations.js";
import type { AgentQuota, LifecyclePaths, SeedConfig, SpecResolver } from "./lifecycle/contracts.js";
export type { LifecyclePaths, SpecResolver } from "./lifecycle/contracts.js";

export class LifecycleModule {
  private readonly creates: CreateCoordinator;
  private readonly actions: LifecycleActions;
  private readonly registry: RegistryOperations;
  constructor(store: Store, units: UnitsModule, paths: LifecyclePaths, resolveSpec: SpecResolver,
    mail: MailModule | null = null, agentQuota: AgentQuota | null = null) {
    if (typeof paths.activationAllowed !== "function")
      throw new StoreError("UNSUPPORTED_PROFILE", "lifecycle requires an explicit activation gate");
    store.bindRepositoryIdentity({ society: paths.society });
    // The durable reader remains authoritative over custom constructor readers.
    units.bindIncarnationReader(agent => store.getAgent(agent)?.incarnation ?? null);
    const policy = new LifecyclePolicy(store, resolveSpec, agentQuota);
    this.creates = new CreateCoordinator(store, units, paths, policy, new WorkspaceCoordinator(paths), mail);
    this.actions = new LifecycleActions(store, units, paths, policy);
    this.registry = new RegistryOperations(store);
  }
  bootstrap(config: SeedConfig): Promise<void> { return this.creates.bootstrap(config); }
  create(auth: AuthContext, input: AgentCreateInput, key: string): Promise<Receipt> { return this.creates.create(auth, input, key); }
  start(auth: AuthContext, agent: Actor, key: string): Receipt { return this.actions.start(auth, agent, key); }
  stop(auth: AuthContext, agent: Actor, key: string): Receipt { return this.actions.stop(auth, agent, key); }
  ack(auth: AuthContext, message: MessageId, key: string): Receipt { return this.registry.ack(auth, message, key); }
  follow(auth: AuthContext, topic: string, subscribe: boolean, key: string): Receipt { return this.registry.follow(auth, topic, subscribe, key); }
  reconcileCreate(id: string, allowActivation = true): Promise<void> { return this.creates.reconcile(id, allowActivation); }
  reconcileAction(id: string, allowActivation = true): void { this.actions.reconcile(id, allowActivation); }
}
