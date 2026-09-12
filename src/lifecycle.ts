// MUST [LIFE-001..007]/[CREATE-001..003]: physical effects stay outside DB intent.
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { spawnSync as nodeSpawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import type { HostConfigV1, Capability, Actor, AuthContext, Receipt, ResolvedAgentSpec, AgentCreateInput, MessageId, OperationPlan, OperationResult } from "../implementation/contracts.js";
import { Store, reused } from "./store.js";
import type { ValidatedPlan } from "./storage/operation-codec.js";
import { StoreError } from "./domain/errors.js";
import { LineageSnapshot, assertCreateCapacity } from "./domain/lineage.js";
import { resolvedSpecDigest as specDigest } from "./domain/spec-identity.js";
import { receiptOfOperation as receiptOfOp } from "./protocol/receipts.js";
import { UnitsModule } from "./units.js";
import { MailModule } from "./mail.js";
import { generateOperationId, isValidFullOid } from "./ids.js";
import { residentUnitsFor } from "./domain/derived.js";
import { workspacePathAt, agentRootPathAt, isWorkspacePathFor } from "./storage/paths.js";
import { ensureDurableDirectory, fsyncDir } from "./storage/durable-fs.js";
import { publishStagedDirectory } from "./storage/staged-tree.js";
import { assertDirectory } from "./storage/directory.js";
import { requestHash } from "./hash.js";
import { resolvedSpecOf, assertActorIdentity, assertCurrentActor, effectiveCapabilitiesOf } from "./authority.js";

export interface LifecyclePaths { stateRoot: string; projectGit: string; society: string; hasGoal: () => boolean }
export interface SpecResolver {
  (parent: { name: Actor; profile: string; role: "resident" | "principal"; desired: string; capabilities: readonly Capability[] }, input: AgentCreateInput): ResolvedAgentSpec | null;
  /** Optional host refresh must run outside T; the callable itself is pure. */
  refresh?: () => void;
  revision?: () => string;
}
type CreatePlan = Extract<OperationPlan, { kind: "agent.create" }>;
type AgentQuota = Pick<HostConfigV1["quota"], "societyAgents" | "lineageAgents">;
const cloneEnv: NodeJS.ProcessEnv = {
  HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_CONFIG_COUNT: "3",
  GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null",
  GIT_CONFIG_KEY_1: "core.fsync", GIT_CONFIG_VALUE_1: "all", GIT_CONFIG_KEY_2: "core.fsyncMethod", GIT_CONFIG_VALUE_2: "fsync",
};
function boundedSpawnSync(command: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string> {
  const result = nodeSpawnSync(command, [...args], { timeout: 120000, maxBuffer: 4 * 1024 * 1024, killSignal: "SIGKILL", ...options });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") throw new StoreError("DEADLINE_EXCEEDED", `${command} timed out`);
    if (code === "ENOBUFS") throw new StoreError("LIMIT_EXCEEDED", `${command} output exceeded the bound`);
    throw new StoreError("INTERNAL_ERROR", `${command} spawn failed: ${result.error.message}`);
  }
  return result;
}

export class LifecycleModule {
  constructor(
    private readonly store: Store, private readonly units: UnitsModule, private readonly paths: LifecyclePaths,
    private readonly resolveSpec: SpecResolver, private readonly mail: MailModule | null = null,
    private readonly agentQuota: AgentQuota | null = null,
  ) {
    store.bindRepositoryIdentity({ society: paths.society });
    units.bindIncarnationReader(agent => store.getAgent(agent)?.incarnation ?? null);
  }
  private receipt(id: string): Receipt {
    const operation = this.store.getOperationById(id);
    if (!operation) throw new StoreError("STORE_CORRUPT", "accepted lifecycle operation missing");
    return receiptOfOp(operation);
  }
  ack(auth: AuthContext, message: MessageId, key: string): Receipt {
    assertActorIdentity(this.store, auth);
    const hash = requestHash("mail.ack", { message });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    const id = generateOperationId();
    const outcome = this.store.transaction(tx => {
      assertCurrentActor(this.store, auth);
      const accepted = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "mail.ack",
        payloadJson: JSON.stringify({ message }), planJson: JSON.stringify({ kind: "mail.ack", recipient: auth.actor, message }) });
      if (accepted === "retry") return accepted;
      if (!this.store.getDelivery(message, auth.actor)) throw new StoreError("REQUEST_NOT_FOUND", `no delivery of ${message} to ${auth.actor}`);
      tx.markAcknowledged(message, auth.actor);
      tx.setOperationSucceeded(id, JSON.stringify({ kind: "mail.ack", message, acknowledged: true }));
      return accepted;
    });
    return outcome === "retry" ? receiptOfOp(this.store.getOperation(auth.actor, key)!) : this.receipt(id);
  }
  follow(auth: AuthContext, topic: string, subscribe: boolean, key: string): Receipt {
    assertActorIdentity(this.store, auth);
    const kind = subscribe ? "route.follow" : "route.unfollow";
    const hash = requestHash(kind, { topic });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    const id = generateOperationId();
    const outcome = this.store.transaction(tx => {
      assertCurrentActor(this.store, auth);
      const accepted = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind,
        payloadJson: JSON.stringify({ topic }), planJson: JSON.stringify({ kind, topic, agent: auth.actor }) });
      if (accepted === "retry") return accepted;
      if (subscribe) tx.follow(topic, auth.actor); else tx.unfollow(topic, auth.actor);
      tx.setOperationSucceeded(id, JSON.stringify({ kind, topic, subscribed: subscribe }));
      return accepted;
    });
    return outcome === "retry" ? receiptOfOp(this.store.getOperation(auth.actor, key)!) : this.receipt(id);
  }
  private requireManage(auth: AuthContext, target: Actor): void {
    const capability = target === auth.actor ? "agent.manage.self" : "agent.manage.descendants";
    assertCurrentActor(this.store, auth, capability);
    if (target === auth.actor) return;
    if (!this.store.getAgent(target)) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${target}`);
    const graph = new LineageSnapshot(this.store.listAgents());
    if (!graph.isDescendant(target, auth.actor)) throw new StoreError("CAPABILITY_DENIED", `${target} is not a descendant of ${auth.actor}`);
  }
  private enforceCreateQuota(parent: Actor): void {
    if (this.agentQuota) assertCreateCapacity(new LineageSnapshot(this.store.listAgents()), parent, this.agentQuota);
  }
  private refreshPolicy(): string | null {
    this.resolveSpec.refresh?.();
    return this.resolveSpec.revision?.() ?? null;
  }
  private assertPolicy(revision: string | null): void {
    if (revision !== null && this.resolveSpec.revision?.() !== revision) throw new StoreError("POLICY_CHANGED", "child policy changed before acceptance");
  }
  start(auth: AuthContext, agent: Actor, key: string): Receipt {
    assertActorIdentity(this.store, auth);
    const hash = requestHash("agent.start", { agent });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "reused") throw reused(auth.actor, key);
    this.requireManage(auth, agent);
    const target = this.store.getAgent(agent);
    if (!target) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${agent}`);
    if (target.desired === "provisioning") throw new StoreError("AGENT_NOT_READY", `${agent} is provisioning`);
    if (target.desired === "retired") throw new StoreError("AGENT_RETIRED", `${agent} is retired`);
    if (!this.paths.hasGoal()) throw new StoreError("GOAL_REQUIRED", "shared GOAL not published yet");
    const prior = claim === "retry" ? this.store.getOperation(auth.actor, key)! : null;
    if (prior && prior.state !== "pending" && prior.state !== "unknown") return receiptOfOp(prior);
    const observed = this.units.observe(agent);
    const alreadyRunning = target.desired === "enabled" && ["active", "activating"].includes(observed.activeState);
    if (!alreadyRunning && !this.units.confirmDead(agent, target.incarnation)) throw new StoreError("RUN_TERMINATION_UNKNOWN", `previous cgroup of ${agent} not confirmed dead`);
    const id = prior?.id ?? generateOperationId();
    if (!prior) {
      const accepted = this.store.transaction(tx => {
        this.requireManage(auth, agent);
        const result = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.start",
          payloadJson: JSON.stringify({ agent }), planJson: JSON.stringify({ kind: "agent.start", agent, previousIncarnation: target.incarnation, desired: "enabled", remainingOperations: [] }) });
        if (result !== "retry") tx.updateAgent({ name: agent, desired: "enabled" });
        return result;
      });
      if (accepted === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    }
    try { if (!alreadyRunning) this.units.start(agent, true); }
    catch { this.store.transaction(tx => tx.setOperationUnknown(id)); return this.receipt(id); }
    this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify({ kind: "agent.start", agent, desired: "enabled", remainingOperations: [] })));
    return this.receipt(id);
  }
  stop(auth: AuthContext, agent: Actor, key: string): Receipt {
    assertActorIdentity(this.store, auth);
    const hash = requestHash("agent.stop", { agent });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "reused") throw reused(auth.actor, key);
    this.requireManage(auth, agent);
    const target = this.store.getAgent(agent);
    if (!target) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${agent}`);
    if (target.desired === "provisioning") throw new StoreError("AGENT_NOT_READY", `${agent} is provisioning`);
    if (target.desired === "retired") throw new StoreError("AGENT_RETIRED", `${agent} is retired`);
    const prior = claim === "retry" ? this.store.getOperation(auth.actor, key)! : null;
    if (prior && prior.state !== "pending" && prior.state !== "unknown") return receiptOfOp(prior);
    const id = prior?.id ?? generateOperationId();
    if (!prior) {
      const accepted = this.store.transaction(tx => {
        this.requireManage(auth, agent);
        const result = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.stop",
          payloadJson: JSON.stringify({ agent }), planJson: JSON.stringify({ kind: "agent.stop", agent, previousIncarnation: target.incarnation, desired: "stopped", remainingOperations: [] }) });
        if (result !== "retry") tx.updateAgent({ name: agent, desired: "stopped" });
        return result;
      });
      if (accepted === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    }
    try { this.units.stop(agent, target.incarnation); }
    catch { this.store.transaction(tx => tx.setOperationUnknown(id)); return this.receipt(id); }
    if (!this.units.confirmDead(agent, target.incarnation)) { this.store.transaction(tx => tx.setOperationUnknown(id)); return this.receipt(id); }
    const remainingOperations = this.store.recoverableOperations().filter(value => value !== id);
    this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify({ kind: "agent.stop", agent, desired: "stopped", remainingOperations })));
    return this.receipt(id);
  }
  /** LIFE-009: complete host seed set in one T; startup owns physical recovery. */
  async bootstrap(config: Pick<HostConfigV1, "initialResidents" | "principalProfile" | "agentProfiles" | "modelProfiles">): Promise<void> {
    if (this.paths.hasGoal()) return;
    const agents = this.store.listAgents();
    const recorded = agents.flatMap(agent => {
      const operation = this.store.getOperation("principal", `bootstrap-${agent.name}`);
      return operation?.kind === "agent.create" ? [operation] : [];
    });
    const resolve = (name: string, profile: string, brief: string, from: string): ResolvedAgentSpec => {
      const selected = config.agentProfiles[profile];
      if (!selected || !config.modelProfiles[selected.modelProfile]) throw new StoreError("UNSUPPORTED_PROFILE", `unsupported bootstrap profile ${profile}`);
      return { name, profile, brief, from, modelProfile: selected.modelProfile, capabilities: [...new Set(selected.capabilities)].sort(), resources: { ...selected.resources } };
    };
    if (agents.length > 0) {
      if (!recorded.some(operation => operation.state === "pending" || operation.state === "unknown")) return;
      if (recorded.length !== config.initialResidents.length) throw new StoreError("AGENT_CONFLICT", "bootstrap seed set changed during recovery");
      for (const operation of recorded) {
        const seed = config.initialResidents.find(value => value.name === operation.plan.spec.name);
        if (!seed || specDigest(resolve(seed.name, seed.profile, seed.brief, operation.plan.spec.from)) !== operation.plan.specHash)
          throw new StoreError("AGENT_CONFLICT", "bootstrap seed spec changed during recovery");
      }
      return;
    }
    if (!this.mail) throw new StoreError("INTERNAL_ERROR", "bootstrap mail boundary unavailable");
    if (this.agentQuota && config.initialResidents.length > this.agentQuota.societyAgents) throw new StoreError("QUOTA_EXCEEDED", "bootstrap exceeds society agent quota");
    const base = boundedSpawnSync("/usr/bin/git", ["--git-dir", this.paths.projectGit, "rev-parse", "refs/heads/main^{commit}"], { env: cloneEnv, encoding: "utf8" });
    if (base.status !== 0 || !isValidFullOid(base.stdout.trim())) throw new StoreError("STORE_CORRUPT", "bootstrap requires a host-pinned canonical main");
    const from = base.stdout.trim(); this.assertCanonicalBase(from);
    const principal = resolve("principal", config.principalProfile, "Principal", from);
    const auth: AuthContext = { actor: "principal", incarnation: 0, role: "principal", channel: "host", capabilities: new Set(principal.capabilities), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
    const plans = await Promise.all(config.initialResidents.map(async seed => {
      const spec = resolve(seed.name, seed.profile, seed.brief, from);
      const id = generateOperationId();
      const initialMessage = await this.mail!.freezeCreateInitial(auth, id, seed.name, seed.brief);
      const plan: CreatePlan = { kind: "agent.create", spec, specHash: specDigest(spec), parent: "principal", workspacePath: workspacePathAt(this.paths.stateRoot, seed.name), unitNames: residentUnitsFor(this.paths.society, seed.name), initialMessage, existingCreation: null };
      return { id, plan };
    }));
    this.store.transaction(tx => {
      tx.insertAgent({ name: "principal", specHash: specDigest(principal), role: "principal", desired: "enabled", incarnation: 0, profile: principal.profile, createdBy: null, specJson: JSON.stringify(principal) });
      for (const { id, plan } of plans) {
        const input = { name: plan.spec.name, from, brief: plan.spec.brief };
        tx.acceptOperation({ id, actor: "principal", requestKey: `bootstrap-${plan.spec.name}`, requestHash: requestHash("agent.create", input), kind: "agent.create", payloadJson: JSON.stringify(input), planJson: JSON.stringify(plan) });
        tx.insertAgent({ name: plan.spec.name, specHash: plan.specHash, role: "resident", desired: "provisioning", incarnation: 0, profile: plan.spec.profile, createdBy: "principal", specJson: JSON.stringify(plan.spec) });
        tx.insertDeliveries([{ messageId: plan.initialMessage!.id, recipient: plan.spec.name, operationId: id }]);
      }
    });
  }
  private resolveCreate(auth: AuthContext, input: AgentCreateInput): { spec: ResolvedAgentSpec; specHash: string } {
    const parent = assertCurrentActor(this.store, auth, "agent.create");
    const spec = this.resolveSpec({ name: parent.name, profile: parent.profile, role: parent.role, desired: parent.desired, capabilities: effectiveCapabilitiesOf(auth, parent) }, input);
    if (!spec) throw new StoreError("CAPABILITY_DENIED", "no delegable child profile");
    return { spec, specHash: specDigest(spec) };
  }
  async create(auth: AuthContext, input: AgentCreateInput, key: string): Promise<Receipt> {
    assertActorIdentity(this.store, auth);
    const hash = requestHash("agent.create", { name: input.name, from: input.from, brief: input.brief });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    let policy = this.refreshPolicy();
    let { spec, specHash } = this.resolveCreate(auth, input);
    const existing = this.store.getAgent(input.name);
    if (existing) {
      if (existing.specHash !== specHash) throw new StoreError("AGENT_CONFLICT", `name ${input.name} already exists with a different resolved spec`);
      const original = this.store.findPhysicalCreate(input.name, specHash);
      if (!original) throw new StoreError("STORE_CORRUPT", `agent ${input.name} has no physical create operation`);
      const id = generateOperationId();
      const accepted = this.store.transaction(tx => {
        this.assertPolicy(policy);
        ({ spec, specHash } = this.resolveCreate(auth, input));
        if (this.store.getAgent(input.name)?.specHash !== specHash) throw new StoreError("AGENT_CONFLICT", "existing child spec changed before acceptance");
        const plan: CreatePlan = { kind: "agent.create", spec, specHash, parent: auth.actor, workspacePath: workspacePathAt(this.paths.stateRoot, input.name), unitNames: residentUnitsFor(this.paths.society, input.name), initialMessage: null, existingCreation: original.id };
        return tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.create", payloadJson: JSON.stringify(input), planJson: JSON.stringify(plan) });
      });
      if (accepted === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
      return this.settleLinkedCreate(id, original.id, input.name);
    }
    this.assertCanonicalBase(input.from);
    if (!this.mail) throw new StoreError("INTERNAL_ERROR", "create mail boundary unavailable");
    const id = generateOperationId();
    const initialMessage = await this.mail.freezeCreateInitial(auth, id, input.name, input.brief);
    policy = this.refreshPolicy(); // fresh host observation after the last asynchronous preparation
    const accepted = this.store.transaction(tx => {
      this.assertPolicy(policy);
      ({ spec, specHash } = this.resolveCreate(auth, input));
      const plan: CreatePlan = { kind: "agent.create", spec, specHash, parent: auth.actor, workspacePath: workspacePathAt(this.paths.stateRoot, input.name), unitNames: residentUnitsFor(this.paths.society, input.name), initialMessage, existingCreation: null };
      const raced = this.store.getAgent(input.name);
      if (raced) {
        if (raced.specHash !== specHash) throw new StoreError("AGENT_CONFLICT", `name ${input.name} already exists with a different resolved spec`);
        const original = this.store.findPhysicalCreate(input.name, specHash);
        if (!original) throw new StoreError("STORE_CORRUPT", `agent ${input.name} has no physical create operation`);
        const outcome = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.create", payloadJson: JSON.stringify(input), planJson: JSON.stringify({ ...plan, initialMessage: null, existingCreation: original.id } satisfies CreatePlan) });
        return { outcome, linked: original.id };
      }
      const outcome = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.create", payloadJson: JSON.stringify(input), planJson: JSON.stringify(plan) });
      if (outcome === "inserted") {
        this.enforceCreateQuota(auth.actor);
        tx.insertAgent({ name: input.name, specHash, role: "resident", desired: "provisioning", incarnation: 0, profile: spec.profile, createdBy: auth.actor, specJson: JSON.stringify(spec) });
        tx.insertDeliveries([{ messageId: initialMessage.id, recipient: input.name, operationId: id }]);
      }
      return { outcome, linked: null };
    });
    if (accepted.outcome === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (accepted.linked) return this.settleLinkedCreate(id, accepted.linked, input.name);
    return this.finishCreate(id);
  }
  reconcileAction(id: string, allowActivation = true): void {
    const operation = this.store.getOperationById(id);
    if (!operation || (operation.kind !== "agent.start" && operation.kind !== "agent.stop") || !["pending", "unknown"].includes(operation.state)) return;
    const plan = operation.plan;
    const agent = this.store.getAgent(plan.agent);
    if (!agent) throw new StoreError("STORE_CORRUPT", `missing agent ${plan.agent}`);
    if (plan.kind === "agent.start") {
      if (!allowActivation || agent.desired !== "enabled" || !this.paths.hasGoal()) return;
      const observed = this.units.observe(plan.agent);
      if (!["active", "activating"].includes(observed.activeState)) {
        if (!this.units.confirmDead(plan.agent, plan.previousIncarnation)) { this.store.transaction(tx => tx.setOperationUnknown(id)); return; }
        this.units.start(plan.agent, false);
      }
    } else {
      if (agent.desired !== "stopped") return;
      this.units.stop(plan.agent, plan.previousIncarnation);
      if (!this.units.confirmDead(plan.agent, plan.previousIncarnation)) { this.store.transaction(tx => tx.setOperationUnknown(id)); return; }
    }
    const remainingOperations = this.store.recoverableOperations().filter(value => value !== id);
    const result: OperationResult = { kind: plan.kind, agent: plan.agent, desired: plan.desired, remainingOperations };
    this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify(result)));
  }
  async reconcileCreate(id: string, allowActivation = true): Promise<void> {
    const operation = this.store.getOperationById(id);
    if (!operation || operation.kind !== "agent.create" || !["pending", "unknown"].includes(operation.state)) return;
    const plan = operation.plan;
    if (plan.existingCreation) { this.settleLinkedCreate(id, plan.existingCreation, plan.spec.name); return; }
    if (!plan.initialMessage) throw new StoreError("STORE_CORRUPT", `accepted create ${id} has no frozen initial message`);
    await this.finishCreate(id, allowActivation);
  }
  private settleLinkedCreate(id: string, originalId: string, name: Actor): Receipt {
    const original = this.store.getOperationById(originalId);
    if (!original || original.kind !== "agent.create") throw new StoreError("STORE_CORRUPT", "missing existingCreation");
    const linked = this.store.getOperationById(id);
    if (!linked) throw new StoreError("STORE_CORRUPT", "linked create operation missing");
    if (original.state === "succeeded") {
      const agent = this.store.getAgent(name);
      if (!agent) throw new StoreError("STORE_CORRUPT", "converged agent missing");
      this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify({ kind: "agent.create", agent: name, desired: agent.desired, remainingOperations: [] })));
    } else if (original.state === "failed") this.store.transaction(tx => tx.setOperationFailed(id, original.errorCode));
    return this.receipt(id);
  }
  private async finishCreate(id: string, allowActivation = true): Promise<Receipt> {
    if (!this.mail) throw new StoreError("INTERNAL_ERROR", "create mail boundary unavailable");
    const operation = this.store.getOperationById(id);
    if (!operation || operation.kind !== "agent.create") throw new StoreError("REQUEST_NOT_FOUND", `no create operation ${id}`);
    if (operation.state === "succeeded" || operation.state === "failed") return receiptOfOp(operation);
    const plan = operation.plan;
    if (plan.existingCreation) throw new StoreError("AGENT_NOT_READY", "linked create awaits original creation");
    if (!plan.initialMessage) throw new StoreError("STORE_CORRUPT", "create plan has no initial message");
    const expectedUnits = residentUnitsFor(this.paths.society, plan.spec.name);
    if (!isWorkspacePathFor(plan.workspacePath, { stateRoot: this.paths.stateRoot, actor: plan.spec.name }) || plan.unitNames.length !== expectedUnits.length || plan.unitNames.some((name, index) => name !== expectedUnits[index])) throw new StoreError("STORE_CORRUPT", "create path/unit identity mismatch");
    const agent = this.store.getAgent(plan.spec.name);
    if (!agent || agent.specHash !== plan.specHash || specDigest(resolvedSpecOf(agent)) !== plan.specHash) throw new StoreError("STORE_CORRUPT", "create agent/spec mismatch");
    this.mail.publishCreateInitial(plan.initialMessage);
    this.ensureWorkspace(plan);
    const root = agentRootPathAt(this.paths.stateRoot, plan.spec.name);
    ensureDurableDirectory(join(root, "home"));
    ensureDurableDirectory(join(this.paths.stateRoot, "mail", "inboxes", plan.spec.name));
    this.units.ensureResident(plan.spec.name, plan.spec.profile, plan.spec.resources);
    let desired = agent.desired;
    if (desired === "provisioning") { desired = "enabled"; this.store.transaction(tx => tx.updateAgent({ name: plan.spec.name, desired })); }
    await this.mail.publishGated(id);
    if (desired === "enabled" && this.paths.hasGoal()) {
      if (!allowActivation) return this.receipt(id);
      this.units.start(plan.spec.name, false);
    }
    this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify({ kind: "agent.create", agent: plan.spec.name, desired, remainingOperations: [] })));
    return this.receipt(id);
  }
  private ensureWorkspace(plan: ValidatedPlan<"agent.create">): void {
    this.assertCanonicalBase(plan.spec.from);
    const workspace = plan.workspacePath;
    const root = agentRootPathAt(this.paths.stateRoot, plan.spec.name);
    const temporary = join(root, "workspace.tmp");
    ensureDurableDirectory(root);
    const verify = (path: string): void => {
      assertDirectory(path); assertDirectory(join(path, ".git"));
      const head = boundedSpawnSync("/usr/bin/git", ["-C", path, "rev-parse", "HEAD"], { env: cloneEnv, encoding: "utf8" });
      if (head.status !== 0 || head.stdout.trim() !== plan.spec.from) throw new StoreError("STORE_CORRUPT", `workspace base mismatch for ${plan.spec.name}`);
    };
    const existing = lstatSync(workspace, { throwIfNoEntry: false });
    if (existing) {
      if (!existing.isDirectory()) throw new StoreError("STORE_CORRUPT", "workspace destination is not a directory");
      verify(workspace); fsyncDir(root); return;
    }
    ensureDurableDirectory(temporary);
    if (!existsSync(join(temporary, ".git"))) {
      const cloned = boundedSpawnSync("/usr/bin/git", ["clone", "--no-local", "--single-branch", "--branch", "main", this.paths.projectGit, temporary], { env: cloneEnv, encoding: "utf8" });
      if (cloned.status !== 0) throw new StoreError("INTERNAL_ERROR", `clone failed: ${cloned.stderr}`);
    }
    assertDirectory(join(temporary, ".git"));
    let haveBase = boundedSpawnSync("/usr/bin/git", ["-C", temporary, "cat-file", "-e", `${plan.spec.from}^{commit}`], { env: cloneEnv, encoding: "utf8" });
    if (haveBase.status !== 0) {
      const fetched = boundedSpawnSync("/usr/bin/git", ["-C", temporary, "fetch", "--no-tags", this.paths.projectGit, plan.spec.from], { env: cloneEnv, encoding: "utf8" });
      haveBase = boundedSpawnSync("/usr/bin/git", ["-C", temporary, "cat-file", "-e", `${plan.spec.from}^{commit}`], { env: cloneEnv, encoding: "utf8" });
      if (fetched.status !== 0 || haveBase.status !== 0) throw new StoreError("PREREQUISITE_MISSING", `cloned workspace does not contain frozen base ${plan.spec.from}`);
    }
    const checkout = boundedSpawnSync("/usr/bin/git", ["-C", temporary, "checkout", "--detach", plan.spec.from], { env: cloneEnv, encoding: "utf8" });
    if (checkout.status !== 0) throw new StoreError("INTERNAL_ERROR", `base checkout failed: ${checkout.stderr}`);
    publishStagedDirectory(temporary, workspace, verify, "workspace-links");
  }
  private assertCanonicalBase(oid: string): void {
    const result = boundedSpawnSync("/usr/bin/git", ["--git-dir", this.paths.projectGit, "cat-file", "-e", `${oid}^{commit}`], { env: cloneEnv, encoding: "utf8" });
    if (result.status !== 0) throw new StoreError("PREREQUISITE_MISSING", `create base ${oid} is not present in the canonical repository`);
  }
}
