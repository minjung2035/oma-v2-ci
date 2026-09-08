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
  OperationResult,
} from "../implementation/contracts.js";
import { Store, StoreError, reused, type OperationRow } from "./store.js";
import { UnitsModule } from "./units.js";
import { generateOperationId } from "./ids.js";
import { requestHash } from "./hash.js";

export interface LifecyclePaths {
  stateRoot: string;
  projectGit: string; // S/repos/project.git
  society: string;
  hasGoal: () => boolean; // world/context/current exists
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

const cloneEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
};

export class LifecycleModule {
  constructor(
    private readonly store: Store,
    private readonly units: UnitsModule,
    private readonly paths: LifecyclePaths,
    private readonly resolveSpec: SpecResolver,
  ) {}

  /** T-ack (DB-007): self delivery acknowledged; op succeeded. */
  ack(auth: AuthContext, message: MessageId, key: string): Receipt {
    // MUST [IPC-004/005]: ack is a durable mutation; it needs a request key
    // and the canonical idempotency claim.
    const newHash = requestHash("mail.ack", { message });
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    const opId = generateOperationId();
    const result: OperationResult = {
      kind: "mail.ack",
      message,
      acknowledged: true,
    };
    const claimOut = { txClaim: "inserted" as "inserted" | "retry" };
    this.store.transaction((_tx) => {
      claimOut.txClaim = this.store.claimOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: newHash,
        kind: "mail.ack",
        payloadJson: JSON.stringify({ message }),
        planJson: JSON.stringify({
          kind: "mail.ack",
          recipient: auth.actor,
          message,
        }),
      });
      if (claimOut.txClaim === "retry") return;
      const d = this.store.getDelivery(message, auth.actor);
      if (!d)
        throw new StoreError(
          "REQUEST_NOT_FOUND",
          `no delivery of ${message} to ${auth.actor}`,
        );
      this.store.markAcknowledged(message, auth.actor);
      this.store.setOperationSucceeded(opId, JSON.stringify(result));
    });
    if (claimOut.txClaim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    return { operation: opId, state: "succeeded", result };
  }

  /** T-route (DB-007): own subscription change. */
  follow(
    auth: AuthContext,
    topic: string,
    subscribe: boolean,
    key: string,
  ): Receipt {
    // MUST [IPC-004/005]: follow/unfollow is a durable mutation; it needs a
    // request key and the canonical idempotency claim.
    const kind = subscribe ? "route.follow" : "route.unfollow";
    const newHash = requestHash(kind, { topic });
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    const opId = generateOperationId();
    const claimOut = { txClaim: "inserted" as "inserted" | "retry" };
    this.store.transaction((_tx) => {
      claimOut.txClaim = this.store.claimOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: newHash,
        kind,
        payloadJson: JSON.stringify({ topic }),
        planJson: JSON.stringify({ kind, topic, agent: auth.actor }),
      });
      if (claimOut.txClaim === "retry") return;
      if (subscribe) this.store.follow(topic, auth.actor);
      else this.store.unfollow(topic, auth.actor);
      this.store.setOperationSucceeded(
        opId,
        JSON.stringify({ kind, topic, subscribed: subscribe }),
      );
    });
    if (claimOut.txClaim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    return {
      operation: opId,
      state: "succeeded",
      result: { kind, topic, subscribed: subscribe } as OperationResult,
    };
  }

  /** MUST [AUTH-002]: manage only self (agent.manage.self) or own descendants. */
  private requireManage(auth: AuthContext, target: Actor): void {
    if (target === auth.actor) {
      if (!auth.capabilities.has("agent.manage.self"))
        throw new StoreError("CAPABILITY_DENIED", "no agent.manage.self");
      return;
    }
    if (!auth.capabilities.has("agent.manage.descendants"))
      throw new StoreError("CAPABILITY_DENIED", "no agent.manage.descendants");
    let cur = this.store.getAgent(target);
    while (cur?.createdBy) {
      if (cur.createdBy === auth.actor) return;
      cur = this.store.getAgent(cur.createdBy);
    }
    throw new StoreError(
      "CAPABILITY_DENIED",
      `${target} is not a descendant of ${auth.actor}`,
    );
  }

  /** MUST [LIFE-004]: start — retired rejected; death confirmed; GOAL gate. */
  start(auth: AuthContext, agent: Actor, key: string): Receipt {
    // MUST [IPC-005]: claim before any physical check or side effect.
    const newHash = requestHash("agent.start", { agent });
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    this.requireManage(auth, agent);
    const target = this.store.getAgent(agent);
    if (!target) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${agent}`);
    if (target.desired === "retired")
      throw new StoreError("AGENT_RETIRED", `${agent} is retired`);
    const prev = target.incarnation;
    if (!this.units.confirmDead(agent, prev)) {
      throw new StoreError(
        "RUN_TERMINATION_UNKNOWN",
        `previous cgroup of ${agent} not confirmed dead`,
      );
    }
    if (!this.paths.hasGoal()) {
      throw new StoreError("GOAL_REQUIRED", "shared GOAL not published yet");
    }
    const opId = generateOperationId();
    let result: OperationResult;
    // SAFETY: object property escapes the tx callback's closure narrowing.
    const claimOut = { txClaim: "inserted" as "inserted" | "retry" };
    this.store.transaction((_tx) => {
      claimOut.txClaim = this.store.claimOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: newHash,
        kind: "agent.start",
        payloadJson: JSON.stringify({ agent }),
        planJson: JSON.stringify({
          kind: "agent.start",
          agent,
          previousIncarnation: prev,
          desired: "enabled",
          remainingOperations: [],
        }),
      });
      if (claimOut.txClaim === "retry") return;
      const now = this.store.getAgent(agent)!;
      const alreadyEnabled = now.desired === "enabled";
      this.store.updateAgent({ name: agent, desired: "enabled" });
      const remaining = this.store.recoverableOperations().length;
      result = {
        kind: "agent.start",
        agent,
        desired: "enabled",
        remainingOperations: [],
      };
      void remaining;
      this.store.setOperationSucceeded(opId, JSON.stringify(result));
      if (!alreadyEnabled) {
        // physical start happens after commit; the path/service enable follows
        void now;
      }
    });
    if (claimOut.txClaim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    this.units.start(agent, true);
    return { operation: opId, state: "succeeded", result: result! };
  }

  /** MUST [LIFE-003]: stop — path first, then service; cgroup death required. */
  stop(auth: AuthContext, agent: Actor, key: string): Receipt {
    // MUST [IPC-005]: claim before any physical effect.
    const newHash = requestHash("agent.stop", { agent });
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    this.requireManage(auth, agent);
    const target = this.store.getAgent(agent);
    if (!target) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${agent}`);
    const prev = target.incarnation;
    const opId = generateOperationId();
    let rem: string[] = [];
    // SAFETY: object property escapes the tx callback's closure narrowing.
    const claimOut = { txClaim: "inserted" as "inserted" | "retry" };
    this.store.transaction((_tx) => {
      claimOut.txClaim = this.store.claimOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: newHash,
        kind: "agent.stop",
        payloadJson: JSON.stringify({ agent }),
        planJson: JSON.stringify({
          kind: "agent.stop",
          agent,
          previousIncarnation: prev,
          desired: "stopped",
          remainingOperations: [],
        }),
      });
      if (claimOut.txClaim === "retry") return;
      this.store.updateAgent({ name: agent, desired: "stopped" });
    });
    if (claimOut.txClaim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (!this.units.confirmDead(agent, prev)) {
      const obs = this.units.stop(agent, prev);
      if (
        obs.activeState === "failed" ||
        obs.subState === "failed" ||
        !this.units.confirmDead(agent, prev)
      ) {
        throw new StoreError(
          "RUN_TERMINATION_UNKNOWN",
          `could not confirm cgroup death of ${agent}`,
        );
      }
    }
    const result: OperationResult = {
      kind: "agent.stop",
      agent,
      desired: "stopped",
      remainingOperations: rem,
    };
    this.store.transaction((_tx) => {
      rem = this.store.recoverableOperations();
      this.store.setOperationSucceeded(
        opId,
        JSON.stringify({ ...result, remainingOperations: rem }),
      );
    });
    return {
      operation: opId,
      state: "succeeded",
      result: { ...result, remainingOperations: rem },
    };
  }

  /** MUST [CREATE-002/003, LIFE-001/002, LIFE-007]: full create flow. */
  async create(
    auth: AuthContext,
    input: AgentCreateInput,
    key: string,
  ): Promise<Receipt> {
    // MUST [IPC-005]: claim the request key BEFORE any resolution/provisioning.
    const newHash = requestHash("agent.create", {
      name: input.name,
      from: input.from,
      brief: input.brief,
    });
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    if (this.store.getAgent(input.name)) {
      throw new StoreError(
        "AGENT_CONFLICT",
        `name ${input.name} already exists`,
      );
    }
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
      .update(
        JSON.stringify({
          name: spec.name,
          from: spec.from,
          brief: spec.brief,
          profile: spec.profile,
          capabilities: spec.capabilities,
        }),
      )
      .digest("hex");

    const opId = generateOperationId();
    const workspaceTmp = join(
      this.paths.stateRoot,
      "agents",
      input.name,
      "workspace.tmp",
    );
    const workspace = join(
      this.paths.stateRoot,
      "agents",
      input.name,
      "workspace",
    );

    // T-create-intent: authoritative in-tx claim first; then agent + op.
    const claimOut = { txClaim: "inserted" as "inserted" | "retry" };
    this.store.transaction((_tx) => {
      claimOut.txClaim = this.store.claimOperation({
        id: opId,
        actor: auth.actor,
        requestKey: key,
        requestHash: newHash,
        kind: "agent.create",
        payloadJson: JSON.stringify(input),
        planJson: JSON.stringify({
          kind: "agent.create",
          spec,
          specHash,
          parent: auth.actor,
          workspacePath: workspace,
          unitNames: [],
          initialMessage: null,
          existingCreation: null,
        }),
      });
      if (claimOut.txClaim === "retry") return;
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
    });
    if (claimOut.txClaim === "retry")
      return receiptOfOp(this.store.getOperation(auth.actor, key)!);

    // physical provisioning: independent clone at workspace.tmp (GIT-002)
    try {
      mkdirSync(workspaceTmp, { recursive: true });
      if (!existsSync(join(workspaceTmp, ".git"))) {
        const r = spawnSync(
          "git",
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
        if (r.status !== 0)
          throw new StoreError("INTERNAL_ERROR", `clone failed: ${r.stderr}`);
      }
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError(
        "INTERNAL_ERROR",
        `provisioning failed: ${(e as Error).message}`,
      );
    }
    mkdirSync(join(this.paths.stateRoot, "agents", input.name, "home"), {
      recursive: true,
    });
    mkdirSync(join(this.paths.stateRoot, "mail", "inboxes", input.name), {
      recursive: true,
    });
    renameSync(workspaceTmp, workspace);
    fsyncDir(join(this.paths.stateRoot, "agents", input.name));

    // units + daemon-reload
    this.units.ensureResident(input.name);

    // T-create-ready
    const desired = this.paths.hasGoal() ? "enabled" : "stopped";
    this.store.transaction((_tx) => {
      this.store.updateAgent({ name: input.name, desired });
      this.store.setOperationSucceeded(
        opId,
        JSON.stringify({
          kind: "agent.create",
          agent: input.name,
          desired,
          remainingOperations: [],
        }),
      );
    });

    const result: OperationResult = {
      kind: "agent.create",
      agent: input.name,
      desired,
      remainingOperations: [],
    };
    return { operation: opId, state: "succeeded", result };
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

/** MUST [IPC-005]: existing accepted op -> receipt (state/result/error preserved). */
function receiptOfOp(op: OperationRow): Receipt {
  const rec: Receipt = { operation: op.id, state: op.state };
  if (op.resultJson) {
    try {
      rec.result = JSON.parse(op.resultJson);
    } catch {
      /* corrupt result; receipt stays minimal */
    }
  }
  if (op.errorCode) {
    rec.error = {
      code: op.errorCode,
      message: op.errorCode,
      retry: "same-key",
    };
  }
  return rec;
}
