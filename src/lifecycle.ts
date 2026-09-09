// MUST [LIFE-001..007]/[CREATE-001..003]: agent create/start/stop + routes/ack.
// Physical effects (git clone, units, systemd) run outside DB transactions;
// each step re-enters to compare actual state (DB-007).
import {
  mkdirSync,
  renameSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  Capability,
  Actor,
  AuthContext,
  Receipt,
  ResolvedAgentSpec,
  AgentCreateInput,
  MessageId,
  OperationPlan,
  OperationResult,
} from "../implementation/contracts.js";
import { Store, StoreError, reused, type OperationRow } from "./store.js";
import { UnitsModule, unitName } from "./units.js";
import { MailModule } from "./mail.js";
import { generateOperationId } from "./ids.js";
import { requestHash } from "./hash.js";

export interface LifecyclePaths {
  stateRoot: string;
  projectGit: string;
  society: string;
  hasGoal: () => boolean;
}

export interface SpecResolver {
  (
    parent: {
      name: Actor;
      profile: string;
      role: "resident" | "principal";
      desired: string;
      capabilities: readonly Capability[];
    },
    input: AgentCreateInput,
  ): ResolvedAgentSpec | null;
}

type CreatePlan = Extract<OperationPlan, { kind: "agent.create" }>;

const cloneEnv: NodeJS.ProcessEnv = {
  HOME: "/nonexistent",
  PATH: "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "core.hooksPath",
  GIT_CONFIG_VALUE_0: "/dev/null",
};

export class LifecycleModule {
  constructor(
    private readonly store: Store,
    private readonly units: UnitsModule,
    private readonly paths: LifecyclePaths,
    private readonly resolveSpec: SpecResolver,
    private readonly mail: MailModule | null = null,
  ) {}

  ack(auth: AuthContext, message: MessageId, key: string): Receipt {
    const hash = requestHash("mail.ack", { message });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    const opId = generateOperationId();
    const result: OperationResult = {
      kind: "mail.ack",
      message,
      acknowledged: true,
    };
    const outcome = { claim: "inserted" as "inserted" | "retry" };
    this.store.transaction((_tx) => {
      outcome.claim = this.store.claimOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: hash,
        kind: "mail.ack",
        payloadJson: JSON.stringify({ message }),
        planJson: JSON.stringify({
          kind: "mail.ack",
          recipient: auth.actor,
          message,
        }),
      });
      if (outcome.claim === "retry") return;
      if (!this.store.getDelivery(message, auth.actor))
        throw new StoreError(
          "REQUEST_NOT_FOUND",
          `no delivery of ${message} to ${auth.actor}`,
        );
      this.store.markAcknowledged(message, auth.actor);
      this.store.setOperationSucceeded(opId, JSON.stringify(result));
    });
    if (outcome.claim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    return { operation: opId, state: "succeeded", result };
  }

  follow(
    auth: AuthContext,
    topic: string,
    subscribe: boolean,
    key: string,
  ): Receipt {
    const kind = subscribe ? "route.follow" : "route.unfollow";
    const hash = requestHash(kind, { topic });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    const opId = generateOperationId();
    const outcome = { claim: "inserted" as "inserted" | "retry" };
    this.store.transaction((_tx) => {
      outcome.claim = this.store.claimOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: hash,
        kind,
        payloadJson: JSON.stringify({ topic }),
        planJson: JSON.stringify({ kind, topic, agent: auth.actor }),
      });
      if (outcome.claim === "retry") return;
      if (subscribe) this.store.follow(topic, auth.actor);
      else this.store.unfollow(topic, auth.actor);
      this.store.setOperationSucceeded(
        opId,
        JSON.stringify({ kind, topic, subscribed: subscribe }),
      );
    });
    if (outcome.claim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    return {
      operation: opId,
      state: "succeeded",
      result: { kind, topic, subscribed: subscribe } as OperationResult,
    };
  }

  private requireManage(auth: AuthContext, target: Actor): void {
    if (target === auth.actor) {
      if (!auth.capabilities.has("agent.manage.self"))
        throw new StoreError("CAPABILITY_DENIED", "no agent.manage.self");
      return;
    }
    if (!auth.capabilities.has("agent.manage.descendants"))
      throw new StoreError("CAPABILITY_DENIED", "no agent.manage.descendants");
    let current = this.store.getAgent(target);
    while (current?.createdBy) {
      if (current.createdBy === auth.actor) return;
      current = this.store.getAgent(current.createdBy);
    }
    throw new StoreError(
      "CAPABILITY_DENIED",
      `${target} is not a descendant of ${auth.actor}`,
    );
  }

  /** MUST [LIFE-004/LIFE-007]: terminal success follows proven systemd effect. */
  start(auth: AuthContext, agent: Actor, key: string): Receipt {
    const hash = requestHash("agent.start", { agent });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "reused") throw reused(auth.actor, key);

    this.requireManage(auth, agent);
    const target = this.store.getAgent(agent);
    if (!target) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${agent}`);
    if (target.desired === "provisioning")
      throw new StoreError("AGENT_NOT_READY", `${agent} is provisioning`);
    if (target.desired === "retired")
      throw new StoreError("AGENT_RETIRED", `${agent} is retired`);
    if (!this.paths.hasGoal())
      throw new StoreError("GOAL_REQUIRED", "shared GOAL not published yet");

    const prior =
      claim === "retry" ? this.store.getOperation(auth.actor, key)! : null;
    if (prior && prior.state !== "pending" && prior.state !== "unknown")
      return receiptOfOp(prior);

    const observed = this.units.observe(agent);
    const alreadyRunning =
      target.desired === "enabled" &&
      (observed.activeState === "active" ||
        observed.activeState === "activating");
    if (!alreadyRunning && !this.units.confirmDead(agent, target.incarnation))
      throw new StoreError(
        "RUN_TERMINATION_UNKNOWN",
        `previous cgroup of ${agent} not confirmed dead`,
      );

    const opId = prior?.id ?? generateOperationId();
    if (!prior) {
      const outcome = { claim: "inserted" as "inserted" | "retry" };
      this.store.transaction((_tx) => {
        outcome.claim = this.store.claimOperation({
          id: opId,
          actor: auth.actor,
          requestKey: key,
          requestHash: hash,
          kind: "agent.start",
          payloadJson: JSON.stringify({ agent }),
          planJson: JSON.stringify({
            kind: "agent.start",
            agent,
            previousIncarnation: target.incarnation,
            desired: "enabled",
            remainingOperations: [],
          }),
        });
        if (outcome.claim === "retry") return;
        this.store.updateAgent({ name: agent, desired: "enabled" });
      });
      if (outcome.claim === "retry")
        return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    }

    if (!alreadyRunning) this.units.start(agent, true);
    const result: OperationResult = {
      kind: "agent.start",
      agent,
      desired: "enabled",
      remainingOperations: [],
    };
    this.store.transaction((_tx) =>
      this.store.setOperationSucceeded(opId, JSON.stringify(result)),
    );
    return { operation: opId, state: "succeeded", result };
  }

  /** MUST [LIFE-003]: intent -> stop effects -> cgroup death -> success. */
  stop(auth: AuthContext, agent: Actor, key: string): Receipt {
    const hash = requestHash("agent.stop", { agent });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "reused") throw reused(auth.actor, key);

    this.requireManage(auth, agent);
    const target = this.store.getAgent(agent);
    if (!target) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${agent}`);
    if (target.desired === "provisioning")
      throw new StoreError("AGENT_NOT_READY", `${agent} is provisioning`);

    const prior =
      claim === "retry" ? this.store.getOperation(auth.actor, key)! : null;
    if (prior && prior.state !== "pending" && prior.state !== "unknown")
      return receiptOfOp(prior);

    const opId = prior?.id ?? generateOperationId();
    if (!prior) {
      const outcome = { claim: "inserted" as "inserted" | "retry" };
      this.store.transaction((_tx) => {
        outcome.claim = this.store.claimOperation({
          id: opId,
          actor: auth.actor,
          requestKey: key,
          requestHash: hash,
          kind: "agent.stop",
          payloadJson: JSON.stringify({ agent }),
          planJson: JSON.stringify({
            kind: "agent.stop",
            agent,
            previousIncarnation: target.incarnation,
            desired: "stopped",
            remainingOperations: [],
          }),
        });
        if (outcome.claim === "retry") return;
        this.store.updateAgent({ name: agent, desired: "stopped" });
      });
      if (outcome.claim === "retry")
        return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    }

    if (!this.units.confirmDead(agent, target.incarnation)) {
      this.units.stop(agent, target.incarnation);
      if (!this.units.confirmDead(agent, target.incarnation)) {
        this.store.transaction((_tx) => this.store.setOperationUnknown(opId));
        throw new StoreError(
          "RUN_TERMINATION_UNKNOWN",
          `could not confirm cgroup death of ${agent}`,
        );
      }
    }
    const remaining = this.store
      .recoverableOperations()
      .filter((id) => id !== opId);
    const result: OperationResult = {
      kind: "agent.stop",
      agent,
      desired: "stopped",
      remainingOperations: remaining,
    };
    this.store.transaction((_tx) =>
      this.store.setOperationSucceeded(opId, JSON.stringify(result)),
    );
    return { operation: opId, state: "succeeded", result };
  }

  /** MUST [CREATE-002/003,LIFE-001/002/007]: accept one frozen physical plan. */
  async create(
    auth: AuthContext,
    input: AgentCreateInput,
    key: string,
  ): Promise<Receipt> {
    const hash = requestHash("agent.create", {
      name: input.name,
      from: input.from,
      brief: input.brief,
    });
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);

    const parent = this.store.getAgent(auth.actor);
    if (!parent) throw new StoreError("AUTH_FAILED", "parent identity missing");
    const spec = this.resolveSpec(
      {
        name: parent.name,
        profile: parent.profile,
        role: parent.role,
        desired: parent.desired,
        capabilities: [...auth.capabilities],
      },
      input,
    );
    if (!spec)
      throw new StoreError("CAPABILITY_DENIED", "no delegable child profile");
    const specHash = createHash("sha256")
      .update(JSON.stringify({
        name: spec.name,
        from: spec.from,
        brief: spec.brief,
        profile: spec.profile,
        capabilities: spec.capabilities,
      }))
      .digest("hex");

    const existing = this.store.getAgent(input.name);
    if (existing) {
      if (existing.specHash !== specHash)
        throw new StoreError(
          "AGENT_CONFLICT",
          `name ${input.name} already exists with a different resolved spec`,
        );
      const original = this.store.findPhysicalCreate(input.name, specHash);
      if (!original)
        throw new StoreError(
          "STORE_CORRUPT",
          `agent ${input.name} has no physical create operation`,
        );
      const opId = generateOperationId();
      const outcome = { claim: "inserted" as "inserted" | "retry" };
      const plan: CreatePlan = {
        kind: "agent.create",
        spec,
        specHash,
        parent: auth.actor,
        workspacePath: join(this.paths.stateRoot, "agents", input.name, "workspace"),
        unitNames: [
          unitName(this.paths.society, input.name, "service"),
          unitName(this.paths.society, input.name, "path"),
        ],
        initialMessage: null,
        existingCreation: original.id,
      };
      this.store.transaction((_tx) => {
        outcome.claim = this.store.claimOperation({
          id: opId,
          actor: auth.actor,
          requestKey: key,
          requestHash: hash,
          kind: "agent.create",
          payloadJson: JSON.stringify(input),
          planJson: JSON.stringify(plan),
        });
      });
      if (outcome.claim === "retry")
        return receiptOfOp(this.store.getOperation(auth.actor, key)!);
      return this.settleLinkedCreate(opId, original.id, input.name);
    }

    this.assertCanonicalBase(input.from);
    if (!this.mail)
      throw new StoreError("INTERNAL_ERROR", "create mail boundary unavailable");

    const opId = generateOperationId();
    const workspaceRoot = join(this.paths.stateRoot, "agents", input.name);
    const workspace = join(workspaceRoot, "workspace");
    const initialMessage = await this.mail.freezeCreateInitial(
      auth,
      opId,
      input.name,
      input.brief,
    );
    const physicalPlan: CreatePlan = {
      kind: "agent.create",
      spec,
      specHash,
      parent: auth.actor,
      workspacePath: workspace,
      unitNames: [
        unitName(this.paths.society, input.name, "service"),
        unitName(this.paths.society, input.name, "path"),
      ],
      initialMessage,
      existingCreation: null,
    };

    const outcome = {
      claim: "inserted" as "inserted" | "retry",
      linked: null as string | null,
    };
    this.store.transaction((_tx) => {
      const raced = this.store.getAgent(input.name);
      if (raced) {
        if (raced.specHash !== specHash)
          throw new StoreError(
            "AGENT_CONFLICT",
            `name ${input.name} already exists with a different resolved spec`,
          );
        const original = this.store.findPhysicalCreate(input.name, specHash);
        if (!original)
          throw new StoreError(
            "STORE_CORRUPT",
            `agent ${input.name} has no physical create operation`,
          );
        outcome.linked = original.id;
        outcome.claim = this.store.claimOperation({
          id: opId,
          actor: auth.actor,
          requestKey: key,
          requestHash: hash,
          kind: "agent.create",
          payloadJson: JSON.stringify(input),
          planJson: JSON.stringify({
            ...physicalPlan,
            initialMessage: null,
            existingCreation: original.id,
          } satisfies CreatePlan),
        });
        return;
      }

      outcome.claim = this.store.claimOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: hash,
        kind: "agent.create",
        payloadJson: JSON.stringify(input),
        planJson: JSON.stringify(physicalPlan),
      });
      if (outcome.claim === "retry") return;
      this.store.insertAgent({
        name: input.name,
        specHash,
        role: "resident",
        desired: "provisioning",
        incarnation: 0,
        profile: spec.profile,
        createdBy: auth.actor,
        specJson: JSON.stringify(spec),
      });
      this.store.insertDeliveries([
        {
          messageId: initialMessage.id,
          recipient: input.name,
          operationId: opId,
        },
      ]);
    });
    if (outcome.claim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (outcome.linked)
      return this.settleLinkedCreate(opId, outcome.linked, input.name);
    return this.finishCreate(opId);
  }

  /** Mechanical create recovery: re-check the frozen plan; never re-render mail. */
  async reconcileCreate(operationId: string): Promise<void> {
    const op = this.store.getOperationById(operationId);
    if (!op || op.kind !== "agent.create") return;
    if (op.state !== "pending" && op.state !== "unknown") return;
    const plan = parseCreatePlan(op);
    if (plan.existingCreation) {
      this.settleLinkedCreate(operationId, plan.existingCreation, plan.spec.name);
      return;
    }
    if (!plan.initialMessage)
      throw new StoreError(
        "STORE_CORRUPT",
        `accepted create ${operationId} has no frozen initial message`,
      );
    await this.finishCreate(operationId, plan);
  }

  private settleLinkedCreate(
    operationId: string,
    originalId: string,
    name: Actor,
  ): Receipt {
    const original = this.store.getOperationById(originalId as never);
    if (!original || original.kind !== "agent.create")
      throw new StoreError("STORE_CORRUPT", "missing existingCreation");
    const linked = this.store.getOperationById(operationId as never);
    if (!linked)
      throw new StoreError("STORE_CORRUPT", "linked create operation missing");
    if (original.state === "succeeded") {
      const agent = this.store.getAgent(name);
      if (!agent) throw new StoreError("STORE_CORRUPT", "converged agent missing");
      const result: OperationResult = {
        kind: "agent.create",
        agent: agent.name,
        desired: agent.desired,
        remainingOperations: [],
      };
      this.store.transaction((_tx) =>
        this.store.setOperationSucceeded(linked.id, JSON.stringify(result)),
      );
    } else if (original.state === "failed") {
      if (!original.errorCode)
        throw new StoreError("STORE_CORRUPT", "failed create has no error code");
      this.store.transaction((_tx) =>
        this.store.setOperationFailed(linked.id, original.errorCode!),
      );
    }
    return receiptOfOp(this.store.getOperationById(linked.id)!);
  }

  private async finishCreate(
    operationId: string,
    acceptedPlan?: CreatePlan,
  ): Promise<Receipt> {
    if (!this.mail)
      throw new StoreError("INTERNAL_ERROR", "create mail boundary unavailable");
    const op = this.store.getOperationById(operationId as never);
    if (!op || op.kind !== "agent.create")
      throw new StoreError("REQUEST_NOT_FOUND", `no create operation ${operationId}`);
    if (op.state === "succeeded" || op.state === "failed") return receiptOfOp(op);
    const plan = acceptedPlan ?? parseCreatePlan(op);
    if (plan.existingCreation)
      throw new StoreError("AGENT_NOT_READY", "linked create awaits original creation");
    if (!plan.initialMessage)
      throw new StoreError("STORE_CORRUPT", "create plan has no initial message");

    const agent = this.store.getAgent(plan.spec.name);
    if (!agent || agent.specHash !== plan.specHash)
      throw new StoreError("STORE_CORRUPT", "create agent/spec mismatch");
    this.ensureWorkspace(plan);
    const root = join(this.paths.stateRoot, "agents", plan.spec.name);
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(join(this.paths.stateRoot, "mail", "inboxes", plan.spec.name), {
      recursive: true,
    });
    this.units.ensureResident(plan.spec.name, plan.spec.profile);

    let desired = agent.desired;
    if (desired === "provisioning") {
      // CTX-006/T41: logical enablement survives a missing GOAL; only physical
      // activation is gated, so the first context publication can wake it.
      desired = "enabled";
      this.store.transaction((_tx) =>
        this.store.updateAgent({ name: plan.spec.name, desired }),
      );
    }

    await this.mail.publishGated(op.id);
    if (desired === "enabled" && this.paths.hasGoal())
      this.units.start(plan.spec.name, false);

    const result: OperationResult = {
      kind: "agent.create",
      agent: plan.spec.name,
      desired,
      remainingOperations: [],
    };
    this.store.transaction((_tx) =>
      this.store.setOperationSucceeded(op.id, JSON.stringify(result)),
    );
    return { operation: op.id, state: "succeeded", result };
  }

  private ensureWorkspace(plan: CreatePlan): void {
    this.assertCanonicalBase(plan.spec.from);
    const workspace = plan.workspacePath;
    const workspaceRoot = join(this.paths.stateRoot, "agents", plan.spec.name);
    const workspaceTmp = join(workspaceRoot, "workspace.tmp");
    if (!existsSync(workspace)) {
      mkdirSync(workspaceTmp, { recursive: true });
      if (!existsSync(join(workspaceTmp, ".git"))) {
        const cloned = spawnSync(
          "/usr/bin/git",
          [
            "clone",
            "--no-local",
            "--single-branch",
            "--branch",
            "main",
            this.paths.projectGit,
            workspaceTmp,
          ],
          { env: cloneEnv, encoding: "utf8" },
        );
        if (cloned.status !== 0)
          throw new StoreError("INTERNAL_ERROR", `clone failed: ${cloned.stderr}`);
      }
      const haveBase = spawnSync(
        "/usr/bin/git",
        ["-C", workspaceTmp, "cat-file", "-e", `${plan.spec.from}^{commit}`],
        { env: cloneEnv, encoding: "utf8" },
      );
      if (haveBase.status !== 0)
        throw new StoreError(
          "PREREQUISITE_MISSING",
          `cloned workspace does not contain frozen base ${plan.spec.from}`,
        );
      const checkout = spawnSync(
        "/usr/bin/git",
        ["-C", workspaceTmp, "checkout", "--detach", plan.spec.from],
        { env: cloneEnv, encoding: "utf8" },
      );
      if (checkout.status !== 0)
        throw new StoreError("INTERNAL_ERROR", `base checkout failed: ${checkout.stderr}`);
      renameSync(workspaceTmp, workspace);
      fsyncDir(workspaceRoot);
    }
    const head = spawnSync(
      "/usr/bin/git",
      ["-C", workspace, "rev-parse", "HEAD"],
      { env: cloneEnv, encoding: "utf8" },
    );
    if (head.status !== 0 || head.stdout.trim() !== plan.spec.from)
      throw new StoreError(
        "STORE_CORRUPT",
        `workspace base mismatch for ${plan.spec.name}`,
      );
  }

  private assertCanonicalBase(oid: string): void {
    const r = spawnSync(
      "/usr/bin/git",
      ["--git-dir", this.paths.projectGit, "cat-file", "-e", `${oid}^{commit}`],
      { env: cloneEnv, encoding: "utf8" },
    );
    if (r.status !== 0)
      throw new StoreError(
        "PREREQUISITE_MISSING",
        `create base ${oid} is not present in the canonical repository`,
      );
  }
}

function parseCreatePlan(op: OperationRow): CreatePlan {
  try {
    const plan = JSON.parse(op.planJson) as CreatePlan;
    if (
      plan.kind !== "agent.create" ||
      !plan.spec ||
      typeof plan.spec.name !== "string" ||
      typeof plan.spec.from !== "string" ||
      typeof plan.specHash !== "string" ||
      !Array.isArray(plan.unitNames)
    ) {
      throw new Error("invalid create plan");
    }
    return plan;
  } catch (e) {
    throw new StoreError(
      "STORE_CORRUPT",
      `operation ${op.id} has corrupt create plan: ${(e as Error).message}`,
    );
  }
}

function fsyncDir(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function receiptOfOp(op: OperationRow): Receipt {
  const receipt: Receipt = { operation: op.id, state: op.state };
  if (op.resultJson) {
    try {
      receipt.result = JSON.parse(op.resultJson);
    } catch {
      /* corrupt result remains visible through the minimal receipt */
    }
  }
  if (op.errorCode) {
    receipt.error = {
      code: op.errorCode,
      message: op.errorCode,
      retry: "same-key",
    };
  }
  return receipt;
}