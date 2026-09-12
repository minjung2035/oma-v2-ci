// MUST [LIFE-001..007]/[CREATE-001..003]: agent create/start/stop + routes/ack.
// Physical effects run outside DB transactions; each step compares actual state.
import { mkdirSync, renameSync, existsSync, openSync, fsyncSync, closeSync } from "node:fs";
import { join } from "node:path";
import { spawnSync as nodeSpawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import type { HostConfigV1, Capability, Actor, AuthContext, Receipt, ResolvedAgentSpec, AgentCreateInput, MessageId, OperationPlan, OperationResult } from "../implementation/contracts.js";
import { Store, reused } from "./store.js";
import type { ValidatedPlan } from "./storage/operation-codec.js";
import { StoreError } from "./domain/errors.js";
import { receiptOfOperation as receiptOfOp } from "./protocol/receipts.js";
import { UnitsModule } from "./units.js";
import { MailModule } from "./mail.js";
import { generateOperationId, isValidFullOid } from "./ids.js";
import { residentUnitsFor } from "./domain/derived.js";
import { workspacePathAt, agentRootPathAt, isWorkspacePathFor } from "./storage/paths.js";
import { requestHash, canonicalJson } from "./hash.js";
import { capabilitiesOf, resolvedSpecOf, assertCurrentActor } from "./authority.js";

export interface LifecyclePaths { stateRoot: string; projectGit: string; society: string; hasGoal: () => boolean }
export interface SpecResolver {
  (parent: { name: Actor; profile: string; role: "resident" | "principal"; desired: string; capabilities: readonly Capability[] }, input: AgentCreateInput): ResolvedAgentSpec | null;
}
type CreatePlan = Extract<OperationPlan, { kind: "agent.create" }>;
type AgentQuota = Pick<HostConfigV1["quota"], "societyAgents" | "lineageAgents">;
const cloneEnv: NodeJS.ProcessEnv = {
  HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_CONFIG_COUNT: "3",
  GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null",
  GIT_CONFIG_KEY_1: "core.fsync", GIT_CONFIG_VALUE_1: "all",
  GIT_CONFIG_KEY_2: "core.fsyncMethod", GIT_CONFIG_VALUE_2: "fsync",
};
function checkedSpawn(result: SpawnSyncReturns<string>, operation: string): SpawnSyncReturns<string> {
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") throw new StoreError("DEADLINE_EXCEEDED", `${operation} timed out`);
    if (code === "ENOBUFS") throw new StoreError("LIMIT_EXCEEDED", `${operation} output exceeded the bound`);
    throw new StoreError("INTERNAL_ERROR", `${operation} spawn failed: ${result.error.message}`);
  }
  return result;
}
function boundedSpawnSync(command: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string> {
  const bounded: SpawnSyncOptionsWithStringEncoding = { timeout: 120_000, maxBuffer: 4 * 1024 * 1024, killSignal: "SIGKILL", ...options };
  return checkedSpawn(nodeSpawnSync(command, [...args], bounded), command);
}
function specDigest(spec: ResolvedAgentSpec): string {
  return createHash("sha256").update(canonicalJson({ ...spec, resources: { ...spec.resources }, capabilities: [...new Set(spec.capabilities)].sort() })).digest("hex");
}

export class LifecycleModule {
  constructor(
    private readonly store: Store, private readonly units: UnitsModule, private readonly paths: LifecyclePaths,
    private readonly resolveSpec: SpecResolver, private readonly mail: MailModule | null = null,
    private readonly agentQuota: AgentQuota | null = null,
  ) {
    this.store.bindRepositoryIdentity({ society: paths.society });
    this.units.bindIncarnationReader(agent => this.store.getAgent(agent)?.incarnation ?? null);
  }
  private receipt(operationId: string): Receipt {
    const operation = this.store.getOperationById(operationId);
    if (!operation) throw new StoreError("STORE_CORRUPT", "accepted lifecycle operation missing");
    return receiptOfOp(operation);
  }
  ack(auth: AuthContext, message: MessageId, key: string): Receipt {
    const hash = requestHash("mail.ack", { message });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    const opId = generateOperationId();
    const result: OperationResult = { kind: "mail.ack", message, acknowledged: true };
    const outcome = { claim: "inserted" as "inserted" | "retry" };
    this.store.transaction(_tx => {
      outcome.claim = this.store.claimOperation({
        id: opId, actor: auth.actor, requestKey: key, requestHash: hash, kind: "mail.ack",
        payloadJson: JSON.stringify({ message }), planJson: JSON.stringify({ kind: "mail.ack", recipient: auth.actor, message }),
      });
      if (outcome.claim === "retry") return;
      if (!this.store.getDelivery(message, auth.actor)) throw new StoreError("REQUEST_NOT_FOUND", `no delivery of ${message} to ${auth.actor}`);
      this.store.markAcknowledged(message, auth.actor);
      this.store.setOperationSucceeded(opId, JSON.stringify(result));
    });
    if (outcome.claim === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    return this.receipt(opId);
  }
  follow(auth: AuthContext, topic: string, subscribe: boolean, key: string): Receipt {
    const kind = subscribe ? "route.follow" : "route.unfollow";
    const hash = requestHash(kind, { topic });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    const opId = generateOperationId();
    const outcome = { claim: "inserted" as "inserted" | "retry" };
    this.store.transaction(_tx => {
      outcome.claim = this.store.claimOperation({
        id: opId, actor: auth.actor, requestKey: key, requestHash: hash, kind,
        payloadJson: JSON.stringify({ topic }), planJson: JSON.stringify({ kind, topic, agent: auth.actor }),
      });
      if (outcome.claim === "retry") return;
      if (subscribe) this.store.follow(topic, auth.actor); else this.store.unfollow(topic, auth.actor);
      this.store.setOperationSucceeded(opId, JSON.stringify({ kind, topic, subscribed: subscribe }));
    });
    if (outcome.claim === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    return this.receipt(opId);
  }
  private requireManage(auth: AuthContext, target: Actor): void {
    if (target === auth.actor) {
      if (!auth.capabilities.has("agent.manage.self")) throw new StoreError("CAPABILITY_DENIED", "no agent.manage.self");
      return;
    }
    if (!auth.capabilities.has("agent.manage.descendants")) throw new StoreError("CAPABILITY_DENIED", "no agent.manage.descendants");
    let current = this.store.getAgent(target);
    while (current?.createdBy) {
      if (current.createdBy === auth.actor) return;
      current = this.store.getAgent(current.createdBy);
    }
    throw new StoreError("CAPABILITY_DENIED", `${target} is not a descendant of ${auth.actor}`);
  }
  /** AUTH-002: provisioning/retired rows still consume durable agent quota. */
  private enforceCreateQuota(parentName: Actor): void {
    if (!this.agentQuota) return;
    const agents = this.store.listAgents();
    const byName = new Map(agents.map(agent => [agent.name, agent]));
    const residents = agents.filter(agent => agent.role === "resident");
    if (residents.length >= this.agentQuota.societyAgents) throw new StoreError("QUOTA_EXCEEDED", "society agent quota exhausted");
    const descendsFrom = (rowName: Actor, ancestorName: Actor): boolean => {
      let current = byName.get(rowName);
      const seen = new Set<string>();
      while (current?.createdBy) {
        if (current.createdBy === ancestorName) return true;
        if (!seen.add(current.name)) throw new StoreError("STORE_CORRUPT", "agent ancestry cycle detected");
        current = byName.get(current.createdBy);
        if (!current) throw new StoreError("STORE_CORRUPT", "agent ancestry references a missing parent");
      }
      return false;
    };
    let ancestor = byName.get(parentName);
    const ancestry = new Set<string>();
    while (ancestor && ancestor.role === "resident") {
      if (!ancestry.add(ancestor.name)) throw new StoreError("STORE_CORRUPT", "agent ancestry cycle detected");
      const descendants = residents.filter(row => descendsFrom(row.name, ancestor!.name)).length;
      if (descendants >= this.agentQuota.lineageAgents) throw new StoreError("QUOTA_EXCEEDED", `lineage agent quota exhausted at ${ancestor.name}`);
      if (!ancestor.createdBy) break;
      ancestor = byName.get(ancestor.createdBy);
      if (!ancestor) throw new StoreError("STORE_CORRUPT", "agent ancestry references a missing parent");
    }
  }
  /** MUST [LIFE-004/LIFE-007]: terminal success follows proven systemd effect. */
  start(auth: AuthContext, agent: Actor, key: string): Receipt {
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
    const alreadyRunning = target.desired === "enabled" && (observed.activeState === "active" || observed.activeState === "activating");
    if (!alreadyRunning && !this.units.confirmDead(agent, target.incarnation))
      throw new StoreError("RUN_TERMINATION_UNKNOWN", `previous cgroup of ${agent} not confirmed dead`);
    const opId = prior?.id ?? generateOperationId();
    if (!prior) {
      const outcome = { claim: "inserted" as "inserted" | "retry" };
      this.store.transaction(_tx => {
        outcome.claim = this.store.claimOperation({
          id: opId, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.start",
          payloadJson: JSON.stringify({ agent }), planJson: JSON.stringify({
            kind: "agent.start", agent, previousIncarnation: target.incarnation, desired: "enabled", remainingOperations: [],
          }),
        });
        if (outcome.claim === "retry") return;
        this.store.updateAgent({ name: agent, desired: "enabled" });
      });
      if (outcome.claim === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    }
    try { if (!alreadyRunning) this.units.start(agent, true); }
    catch {
      // The physical start may have happened. The accepted row, not the thrown
      // exception, determines both this response and subsequent same-key lookups.
      this.store.transaction(_tx => this.store.setOperationUnknown(opId));
      return this.receipt(opId);
    }
    const result: OperationResult = { kind: "agent.start", agent, desired: "enabled", remainingOperations: [] };
    this.store.transaction(_tx => this.store.setOperationSucceeded(opId, JSON.stringify(result)));
    return this.receipt(opId);
  }
  /** MUST [LIFE-003]: intent -> stop effects -> cgroup death -> success. */
  stop(auth: AuthContext, agent: Actor, key: string): Receipt {
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
    const opId = prior?.id ?? generateOperationId();
    if (!prior) {
      const outcome = { claim: "inserted" as "inserted" | "retry" };
      this.store.transaction(_tx => {
        outcome.claim = this.store.claimOperation({
          id: opId, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.stop",
          payloadJson: JSON.stringify({ agent }), planJson: JSON.stringify({
            kind: "agent.stop", agent, previousIncarnation: target.incarnation, desired: "stopped", remainingOperations: [],
          }),
        });
        if (outcome.claim === "retry") return;
        this.store.updateAgent({ name: agent, desired: "stopped" });
      });
      if (outcome.claim === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    }
    try { this.units.stop(agent, target.incarnation); }
    catch {
      this.store.transaction(_tx => this.store.setOperationUnknown(opId));
      return this.receipt(opId);
    }
    if (!this.units.confirmDead(agent, target.incarnation)) {
      this.store.transaction(_tx => this.store.setOperationUnknown(opId));
      return this.receipt(opId);
    }
    const remaining = this.store.recoverableOperations().filter(id => id !== opId);
    const result: OperationResult = { kind: "agent.stop", agent, desired: "stopped", remainingOperations: remaining };
    this.store.transaction(_tx => this.store.setOperationSucceeded(opId, JSON.stringify(result)));
    return this.receipt(opId);
  }
  /** LIFE-009: accept the complete host seed set atomically; startup owns recovery. */
  async bootstrap(config: Pick<HostConfigV1, "initialResidents" | "principalProfile" | "agentProfiles" | "modelProfiles">): Promise<void> {
    if (this.paths.hasGoal()) return;
    const agents = this.store.listAgents();
    const recorded = agents.flatMap(agent => {
      const op = this.store.getOperation("principal", `bootstrap-${agent.name}`);
      return op?.kind === "agent.create" ? [op] : [];
    });
    const resolve = (name: string, profile: string, brief: string, from: string): ResolvedAgentSpec => {
      const selected = config.agentProfiles[profile];
      if (!selected || !config.modelProfiles[selected.modelProfile]) throw new StoreError("UNSUPPORTED_PROFILE", `unsupported bootstrap profile ${profile}`);
      return { name, profile, brief, from, modelProfile: selected.modelProfile, capabilities: [...new Set(selected.capabilities)].sort(), resources: { ...selected.resources } };
    };
    if (agents.length > 0) {
      if (!recorded.some(op => op.state === "pending" || op.state === "unknown")) return;
      if (recorded.length !== config.initialResidents.length) throw new StoreError("AGENT_CONFLICT", "bootstrap seed set changed during recovery");
      for (const op of recorded) {
        const plan = op.plan;
        const seed = config.initialResidents.find(value => value.name === plan.spec.name);
        if (!seed || specDigest(resolve(seed.name, seed.profile, seed.brief, plan.spec.from)) !== plan.specHash)
          throw new StoreError("AGENT_CONFLICT", "bootstrap seed spec changed during recovery");
      }
      return;
    }
    if (!this.mail) throw new StoreError("INTERNAL_ERROR", "bootstrap mail boundary unavailable");
    if (this.agentQuota && config.initialResidents.length > this.agentQuota.societyAgents) throw new StoreError("QUOTA_EXCEEDED", "bootstrap exceeds society agent quota");
    const base = boundedSpawnSync("/usr/bin/git", ["--git-dir", this.paths.projectGit, "rev-parse", "refs/heads/main^{commit}"], { env: cloneEnv, encoding: "utf8" });
    if (base.status !== 0 || !isValidFullOid(base.stdout.trim())) throw new StoreError("STORE_CORRUPT", "bootstrap requires a host-pinned canonical main");
    const from = base.stdout.trim();
    this.assertCanonicalBase(from);
    const principal = resolve("principal", config.principalProfile, "Principal", from);
    const auth: AuthContext = { actor: "principal", incarnation: 0, role: "principal", channel: "host", capabilities: new Set(principal.capabilities), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
    const plans = await Promise.all(config.initialResidents.map(async seed => {
      const spec = resolve(seed.name, seed.profile, seed.brief, from);
      const id = generateOperationId();
      const initialMessage = await this.mail!.freezeCreateInitial(auth, id, seed.name, seed.brief);
      const plan: CreatePlan = { kind: "agent.create", spec, specHash: specDigest(spec), parent: "principal", workspacePath: workspacePathAt(this.paths.stateRoot, seed.name), unitNames: residentUnitsFor(this.paths.society, seed.name), initialMessage, existingCreation: null };
      return { id, plan };
    }));
    this.store.transaction(() => {
      this.store.insertAgent({ name: "principal", specHash: specDigest(principal), role: "principal", desired: "enabled", incarnation: 0, profile: principal.profile, createdBy: null, specJson: JSON.stringify(principal) });
      for (const { id, plan } of plans) {
        const input = { name: plan.spec.name, from, brief: plan.spec.brief };
        this.store.claimOperation({ id, actor: "principal", requestKey: `bootstrap-${plan.spec.name}`, requestHash: requestHash("agent.create", input), kind: "agent.create", payloadJson: JSON.stringify(input), planJson: JSON.stringify(plan) });
        this.store.insertAgent({ name: plan.spec.name, specHash: plan.specHash, role: "resident", desired: "provisioning", incarnation: 0, profile: plan.spec.profile, createdBy: "principal", specJson: JSON.stringify(plan.spec) });
        this.store.insertDeliveries([{ messageId: plan.initialMessage!.id, recipient: plan.spec.name, operationId: id }]);
      }
    });
  }
  private resolveCreate(auth: AuthContext, input: AgentCreateInput): { spec: ResolvedAgentSpec; specHash: string } {
    const parent = this.store.getAgent(auth.actor);
    if (!parent) throw new StoreError("AUTH_FAILED", "parent identity missing");
    const durableCaps = capabilitiesOf(parent);
    const spec = this.resolveSpec({ name: parent.name, profile: parent.profile, role: parent.role, desired: parent.desired, capabilities: [...auth.capabilities].filter(cap => durableCaps.has(cap)) }, input);
    if (!spec) throw new StoreError("CAPABILITY_DENIED", "no delegable child profile");
    return { spec, specHash: specDigest(spec) };
  }
  /** MUST [CREATE-002/003,LIFE-001/002/007]: accept one frozen physical plan. */
  async create(auth: AuthContext, input: AgentCreateInput, key: string): Promise<Receipt> {
    const hash = requestHash("agent.create", { name: input.name, from: input.from, brief: input.brief });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    let { spec, specHash } = this.resolveCreate(auth, input);
    const existing = this.store.getAgent(input.name);
    if (existing) {
      if (existing.specHash !== specHash) throw new StoreError("AGENT_CONFLICT", `name ${input.name} already exists with a different resolved spec`);
      const original = this.store.findPhysicalCreate(input.name, specHash);
      if (!original) throw new StoreError("STORE_CORRUPT", `agent ${input.name} has no physical create operation`);
      const opId = generateOperationId();
      const outcome = { claim: "inserted" as "inserted" | "retry" };
      const plan: CreatePlan = {
        kind: "agent.create", spec, specHash, parent: auth.actor,
        workspacePath: workspacePathAt(this.paths.stateRoot, input.name), unitNames: residentUnitsFor(this.paths.society, input.name), initialMessage: null, existingCreation: original.id,
      };
      this.store.transaction(_tx => {
        ({ spec, specHash } = this.resolveCreate(auth, input));
        if (existing.specHash !== specHash) throw new StoreError("AGENT_CONFLICT", `name ${input.name} already exists with a different resolved spec`);
        plan.spec = spec; plan.specHash = specHash;
        outcome.claim = this.store.claimOperation({ id: opId, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.create", payloadJson: JSON.stringify(input), planJson: JSON.stringify(plan) });
      });
      if (outcome.claim === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
      return this.settleLinkedCreate(opId, original.id, input.name);
    }
    this.assertCanonicalBase(input.from);
    if (!this.mail) throw new StoreError("INTERNAL_ERROR", "create mail boundary unavailable");
    const opId = generateOperationId();
    const workspace = workspacePathAt(this.paths.stateRoot, input.name);
    const initialMessage = await this.mail.freezeCreateInitial(auth, opId, input.name, input.brief);
    const physicalPlan: CreatePlan = { kind: "agent.create", spec, specHash, parent: auth.actor, workspacePath: workspace, unitNames: residentUnitsFor(this.paths.society, input.name), initialMessage, existingCreation: null };
    const outcome = { claim: "inserted" as "inserted" | "retry", linked: null as string | null };
    this.store.transaction(_tx => {
      assertCurrentActor(this.store, auth, "agent.create");
      ({ spec, specHash } = this.resolveCreate(auth, input));
      physicalPlan.spec = spec; physicalPlan.specHash = specHash;
      const raced = this.store.getAgent(input.name);
      if (raced) {
        if (raced.specHash !== specHash) throw new StoreError("AGENT_CONFLICT", `name ${input.name} already exists with a different resolved spec`);
        const original = this.store.findPhysicalCreate(input.name, specHash);
        if (!original) throw new StoreError("STORE_CORRUPT", `agent ${input.name} has no physical create operation`);
        outcome.linked = original.id;
        outcome.claim = this.store.claimOperation({ id: opId, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.create", payloadJson: JSON.stringify(input), planJson: JSON.stringify({ ...physicalPlan, initialMessage: null, existingCreation: original.id } satisfies CreatePlan) });
        return;
      }
      outcome.claim = this.store.claimOperation({ id: opId, actor: auth.actor, requestKey: key, requestHash: hash, kind: "agent.create", payloadJson: JSON.stringify(input), planJson: JSON.stringify(physicalPlan) });
      if (outcome.claim === "retry") return;
      this.enforceCreateQuota(auth.actor);
      this.store.insertAgent({ name: input.name, specHash, role: "resident", desired: "provisioning", incarnation: 0, profile: spec.profile, createdBy: auth.actor, specJson: JSON.stringify(spec) });
      this.store.insertDeliveries([{ messageId: initialMessage.id, recipient: input.name, operationId: opId }]);
    });
    if (outcome.claim === "retry") return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (outcome.linked) return this.settleLinkedCreate(opId, outcome.linked, input.name);
    return this.finishCreate(opId);
  }
  /** MUST [REC-001/LIFE-003/004]: settle accepted lifecycle effects by observation. */
  reconcileAction(operationId: string, allowActivation = true): void {
    const op = this.store.getOperationById(operationId);
    if (!op || (op.kind !== "agent.start" && op.kind !== "agent.stop")) return;
    if (op.state !== "pending" && op.state !== "unknown") return;
    const plan = op.plan;
    const agent = this.store.getAgent(plan.agent);
    if (!agent) throw new StoreError("STORE_CORRUPT", `missing agent ${plan.agent}`);
    if (plan.kind === "agent.start") {
      if (!allowActivation) return;
      if (agent.desired !== "enabled" || !this.paths.hasGoal()) return;
      const observed = this.units.observe(plan.agent);
      if (!["active", "activating"].includes(observed.activeState)) {
        if (!this.units.confirmDead(plan.agent, plan.previousIncarnation)) { this.store.transaction(_tx => this.store.setOperationUnknown(op.id)); return; }
        this.units.start(plan.agent, false);
      }
    } else {
      if (agent.desired !== "stopped") return;
      this.units.stop(plan.agent, plan.previousIncarnation);
      if (!this.units.confirmDead(plan.agent, plan.previousIncarnation)) { this.store.transaction(_tx => this.store.setOperationUnknown(op.id)); return; }
    }
    const remaining = this.store.recoverableOperations().filter(id => id !== op.id);
    const result: OperationResult = { kind: plan.kind, agent: plan.agent, desired: plan.desired, remainingOperations: remaining };
    this.store.transaction(_tx => this.store.setOperationSucceeded(op.id, JSON.stringify(result)));
  }
  /** Mechanical create recovery uses only Store-decoded plans. */
  async reconcileCreate(operationId: string, allowActivation = true): Promise<void> {
    const op = this.store.getOperationById(operationId);
    if (!op || op.kind !== "agent.create") return;
    if (op.state !== "pending" && op.state !== "unknown") return;
    const plan = op.plan;
    if (plan.existingCreation) { this.settleLinkedCreate(operationId, plan.existingCreation, plan.spec.name); return; }
    if (!plan.initialMessage) throw new StoreError("STORE_CORRUPT", `accepted create ${operationId} has no frozen initial message`);
    await this.finishCreate(operationId, allowActivation);
  }
  private settleLinkedCreate(operationId: string, originalId: string, name: Actor): Receipt {
    const original = this.store.getOperationById(originalId);
    if (!original || original.kind !== "agent.create") throw new StoreError("STORE_CORRUPT", "missing existingCreation");
    const linked = this.store.getOperationById(operationId);
    if (!linked) throw new StoreError("STORE_CORRUPT", "linked create operation missing");
    if (original.state === "succeeded") {
      const agent = this.store.getAgent(name);
      if (!agent) throw new StoreError("STORE_CORRUPT", "converged agent missing");
      const result: OperationResult = { kind: "agent.create", agent: agent.name, desired: agent.desired, remainingOperations: [] };
      this.store.transaction(_tx => this.store.setOperationSucceeded(linked.id, JSON.stringify(result)));
    } else if (original.state === "failed") {
      this.store.transaction(_tx => this.store.setOperationFailed(linked.id, original.errorCode));
    }
    return this.receipt(linked.id);
  }
  private async finishCreate(operationId: string, allowActivation = true): Promise<Receipt> {
    if (!this.mail) throw new StoreError("INTERNAL_ERROR", "create mail boundary unavailable");
    const op = this.store.getOperationById(operationId);
    if (!op || op.kind !== "agent.create") throw new StoreError("REQUEST_NOT_FOUND", `no create operation ${operationId}`);
    if (op.state === "succeeded" || op.state === "failed") return receiptOfOp(op);
    const plan = op.plan;
    if (plan.existingCreation) throw new StoreError("AGENT_NOT_READY", "linked create awaits original creation");
    if (!plan.initialMessage) throw new StoreError("STORE_CORRUPT", "create plan has no initial message");
    const expectedUnits = residentUnitsFor(this.paths.society, plan.spec.name);
    if (!isWorkspacePathFor(plan.workspacePath, { stateRoot: this.paths.stateRoot, actor: plan.spec.name }) || plan.unitNames.length !== expectedUnits.length || plan.unitNames.some((name, index) => name !== expectedUnits[index]))
      throw new StoreError("STORE_CORRUPT", "create path/unit identity mismatch");
    const agent = this.store.getAgent(plan.spec.name);
    if (!agent || agent.specHash !== plan.specHash || specDigest(resolvedSpecOf(agent)) !== plan.specHash) throw new StoreError("STORE_CORRUPT", "create agent/spec mismatch");
    this.mail.publishCreateInitial(plan.initialMessage);
    this.ensureWorkspace(plan);
    const root = agentRootPathAt(this.paths.stateRoot, plan.spec.name);
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(join(this.paths.stateRoot, "mail", "inboxes", plan.spec.name), { recursive: true });
    this.units.ensureResident(plan.spec.name, plan.spec.profile, plan.spec.resources);
    let desired = agent.desired;
    if (desired === "provisioning") {
      desired = "enabled";
      this.store.transaction(_tx => this.store.updateAgent({ name: plan.spec.name, desired }));
    }
    await this.mail.publishGated(op.id);
    if (desired === "enabled" && this.paths.hasGoal()) {
      if (!allowActivation) return this.receipt(op.id);
      this.units.start(plan.spec.name, false);
    }
    const result: OperationResult = { kind: "agent.create", agent: plan.spec.name, desired, remainingOperations: [] };
    this.store.transaction(_tx => this.store.setOperationSucceeded(op.id, JSON.stringify(result)));
    return this.receipt(op.id);
  }
  private ensureWorkspace(plan: ValidatedPlan<"agent.create">): void {
    this.assertCanonicalBase(plan.spec.from);
    const workspace = plan.workspacePath;
    const workspaceRoot = agentRootPathAt(this.paths.stateRoot, plan.spec.name);
    const workspaceTmp = join(workspaceRoot, "workspace.tmp");
    if (!existsSync(workspace)) {
      mkdirSync(workspaceTmp, { recursive: true });
      if (!existsSync(join(workspaceTmp, ".git"))) {
        const cloned = boundedSpawnSync("/usr/bin/git", ["clone", "--no-local", "--single-branch", "--branch", "main", this.paths.projectGit, workspaceTmp], { env: cloneEnv, encoding: "utf8" });
        if (cloned.status !== 0) throw new StoreError("INTERNAL_ERROR", `clone failed: ${cloned.stderr}`);
      }
      let haveBase = boundedSpawnSync("/usr/bin/git", ["-C", workspaceTmp, "cat-file", "-e", `${plan.spec.from}^{commit}`], { env: cloneEnv, encoding: "utf8" });
      if (haveBase.status !== 0) {
        const fetched = boundedSpawnSync("/usr/bin/git", ["-C", workspaceTmp, "fetch", "--no-tags", this.paths.projectGit, plan.spec.from], { env: cloneEnv, encoding: "utf8" });
        haveBase = boundedSpawnSync("/usr/bin/git", ["-C", workspaceTmp, "cat-file", "-e", `${plan.spec.from}^{commit}`], { env: cloneEnv, encoding: "utf8" });
        if (fetched.status !== 0 || haveBase.status !== 0) throw new StoreError("PREREQUISITE_MISSING", `cloned workspace does not contain frozen base ${plan.spec.from}`);
      }
      const checkout = boundedSpawnSync("/usr/bin/git", ["-C", workspaceTmp, "checkout", "--detach", plan.spec.from], { env: cloneEnv, encoding: "utf8" });
      if (checkout.status !== 0) throw new StoreError("INTERNAL_ERROR", `base checkout failed: ${checkout.stderr}`);
      renameSync(workspaceTmp, workspace);
      fsyncDir(workspaceRoot);
    }
    const head = boundedSpawnSync("/usr/bin/git", ["-C", workspace, "rev-parse", "HEAD"], { env: cloneEnv, encoding: "utf8" });
    if (head.status !== 0 || head.stdout.trim() !== plan.spec.from) throw new StoreError("STORE_CORRUPT", `workspace base mismatch for ${plan.spec.name}`);
  }
  private assertCanonicalBase(oid: string): void {
    const result = boundedSpawnSync("/usr/bin/git", ["--git-dir", this.paths.projectGit, "cat-file", "-e", `${oid}^{commit}`], { env: cloneEnv, encoding: "utf8" });
    if (result.status !== 0) throw new StoreError("PREREQUISITE_MISSING", `create base ${oid} is not present in the canonical repository`);
  }
}
function fsyncDir(dir: string): void {
  const fd = openSync(dir, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
