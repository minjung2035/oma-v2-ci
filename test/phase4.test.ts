import { testBroker } from "./helpers/broker-fixture.js";
import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
// Lifecycle/data acceptance with actual native namespace/journal effects.
// Trusted keepalive test programs grant no runner authentication. Full product
// Worker/Pi and physical backoff/argv oracles run in the separate native suites.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync,
  mkdirSync, readFileSync, symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { nativeLifecycleExecution, type NativeLifecycleExecution } from "./fixtures/native-lifecycle-execution.js";
import { MailModule } from "@oma/mail";
import { LifecycleModule } from "@oma/lifecycle";
import { ReconcileModule } from "@oma/reconcile";
import { Broker } from "@oma/broker";
import { ViewsModule } from "#oma-test/app/views";
import { generateOperationId } from "@oma/native/identity";
import { requestHash } from "@oma/domain/request-identity";

import { encodedResidentToolSurface } from "@oma/domain/tool-surface";
import { runnerReceiptPathAt } from "@oma/domain/paths";
import { StatusRefresh } from "@oma/broker/status-refresh";
import { makeValidAgent } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import type { AuthContext, Capability, ResolvedAgentSpec } from "@oma/contracts";

import { goalPublishedAt } from "./fixtures/goal.js";
const NODE = process.execPath;
interface Env {
  dir: string;
  society: string;
  store: Store;
  units: NativeLifecycleExecution;
  mail: MailModule;
  lifecycle: LifecycleModule;
  views: ViewsModule;
}
async function envOf(): Promise<{ env: Env; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), "oma-t4-"));
  const society = `t${Date.now().toString(36)}x`;
  const state = join(dir, "state");
  mkdirSync(state, { recursive: true });
  const store = new Store(join(state, "runtime.sqlite"));
  const units = await nativeLifecycleExecution(store, state);
  // Batch views require the host-configured frame and manifest limits; without
  // them the preparation boundary fails closed with UNSUPPORTED_PROFILE.
  const mail = createMailModule({ stateRoot: state, society }, store, 64, TEST_VIEW_LIMITS.batchMaxMessages, TEST_VIEW_LIMITS);
  const resolver = (_parent: { profile: string }, input: { name: string; from: string; brief: string }): ResolvedAgentSpec => ({
    ...input, modelProfile: "m", profile: "child", capabilities: ["mail.send", "route.follow"],
  });
  const lifecycle = createLifecycleModule(store, units, {
    stateRoot: state, projectGit: join(state, "repos", "project.git"), society,
    hasGoal: () => existsSync(join(state, "world", "context", "current")),
    activationAllowed: () => true,
  }, resolver, mail);
  const views = new ViewsModule(store, state, society, "p");
  return {
    env: { dir, society, store, units, mail, lifecycle, views },
    cleanup: async () => {
      await units.closeExecution();
      try { store.close(); } catch { /* awaited broker drain already closed it */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
// Domain fixtures represent an already authenticated incarnation with a complete stored spec.
function auth(actor: string, caps: Capability[] = []): AuthContext {
  return {
    actor, incarnation: actor === "principal" ? 0 : 1,
    role: actor === "principal" ? "principal" : "resident",
    channel: actor === "principal" ? "host" : "actor",
    capabilities: new Set(caps), peer: { pid: 1, uid: 1000, gid: 1000 },
  };
}
function seedPrincipalAndA(store: Store): void {
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    for (const name of ["a", "b"]) tx.insertAgent(makeValidAgent(name, { createdBy: "principal" }));
  });
  // Exercise the exact production read boundary before any negative/kernel oracle.
  for (const name of ["principal", "a", "b"]) {
    const row = store.getAgent(name);
    assert.ok(row);
    assert.equal(JSON.parse(row.specJson).name, name);
    assert.match(row.specHash, /^[0-9a-f]{64}$/);
  }
}
function seedProjectGit(env: Env): string {
  const seedDir = join(env.dir, "seed");
  mkdirSync(seedDir, { recursive: true });
  const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const run = (args: string[], cwd = seedDir) => {
    const result = spawnSync("git", args, { cwd, env: gitEnv, encoding: "utf8", timeout: 30000, maxBuffer: 4194304, killSignal: "SIGKILL" });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  run(["init", "-q", "-b", "main"]);
  run(["-c", "user.name=OMA", "-c", "user.email=oma@localhost", "commit", "--allow-empty", "-qm", "init"]);
  const git = join(env.dir, "state", "repos", "project.git");
  mkdirSync(join(git, ".."), { recursive: true });
  run(["clone", "-q", "--bare", seedDir, git]);
  run(["--git-dir", git, "symbolic-ref", "HEAD", "refs/heads/main"]);
  return run(["--git-dir", git, "rev-parse", "refs/heads/main"]);
}
function seedGov(env: Env): void {
  const context = join(env.dir, "state", "world", "context");
  const revision = join(context, "revisions", "seed");
  mkdirSync(revision, { recursive: true });
  writeFileSync(join(revision, "GOAL.md"), "# GOAL\n", "utf8");
  symlinkSync("revisions/seed", join(context, "current"));
}





test("T37: stop saves new mail, empties the actual scope, leaves execution inactive", async () => {
  const { env, cleanup } = await envOf();
  try {
    seedPrincipalAndA(env.store);
    env.store.transaction(tx => tx.updateAgent({ name: "a", desired: "enabled" }));
    await env.units.start("a", false);
    assert.equal(env.store.getAgent("a")!.incarnation, 1);
    const mail = createMailModule({ stateRoot: join(env.dir, "state"), society: env.society }, env.store, 64);
    const receipt = await mail.send(auth("b", ["mail.send"]), "k1", { to: ["a"], subject: "s", kind: "message", body: "x" });
    assert.equal((receipt.result as { recipientCount: number }).recipientCount, 1);
    assert.equal(readdirSync(join(env.dir, "state", "mail", "inboxes", "a", "new")).length, 1);
    const res = await env.lifecycle.stop(auth("a", ["agent.manage.self"]), "a", "stop-1");
    assert.equal(res.state, "succeeded");
    assert.equal(env.units.confirmDead("a", 1), true);
    assert.equal(env.units.observe("a").activeState, "inactive");
    assert.equal(env.store.getAgent("a")!.desired, "stopped");
    assert.equal(readdirSync(join(env.dir, "state", "mail", "inboxes", "a", "new")).length, 1);
  } finally { await cleanup(); }
});

test("T38: stopped actor with an unconfirmed stale scope cannot start; incarnation unchanged", async () => {
  const { env, cleanup } = await envOf();
  try {
    seedPrincipalAndA(env.store);
    seedGov(env);
    env.store.transaction(tx => tx.updateAgent({ name: "a", desired: "stopped" }));
    await env.units.start("a", false);
    // A separate current manager reaches the death oracle; the stopped target's
    // own actor credentials would correctly fail earlier with STALE_RUN.
    await assert.rejects(async () => env.lifecycle.start(auth("principal", ["agent.manage.descendants"]), "a", "start-1"),
      (error: unknown) => error instanceof StoreError && error.code === "RUN_TERMINATION_UNKNOWN");
    assert.equal(env.store.getAgent("a")!.incarnation, 1);
  } finally { await cleanup(); }
});

test("REC-001: pending start and stop effects settle from actual native scope state", async () => {
  const { env, cleanup } = await envOf();
  try {
    seedPrincipalAndA(env.store);
    seedGov(env);
    const startId = generateOperationId();
    env.store.transaction(tx => tx.acceptOperation({
      id: startId, actor: "principal", requestKey: "recover-start",
      requestHash: requestHash("agent.start", { agent: "a" }), kind: "agent.start",
      payloadJson: JSON.stringify({ agent: "a" }),
      planJson: serializePlanIntent({ kind: "agent.start", agent: "a", previousIncarnation: 1, desired: "enabled", remainingOperations: [] }),
    }));
    await env.lifecycle.reconcileAction(startId);
    assert.equal(env.store.getOperationById(startId)!.state, "succeeded");
    const stopId = generateOperationId();
    env.store.transaction(tx => {
      tx.updateAgent({ name: "a", desired: "stopped" });
      tx.acceptOperation({
        id: stopId, actor: "principal", requestKey: "recover-stop",
        requestHash: requestHash("agent.stop", { agent: "a" }), kind: "agent.stop",
        payloadJson: JSON.stringify({ agent: "a" }),
        planJson: serializePlanIntent({ kind: "agent.stop", agent: "a", previousIncarnation: 1, desired: "stopped", remainingOperations: [] }),
      });
    });
    await env.lifecycle.reconcileAction(stopId);
    assert.equal(env.store.getOperationById(stopId)!.state, "succeeded");
    assert.equal(env.units.confirmDead("a", 1), true);
  } finally { await cleanup(); }
});

test("T13: capability escape — sibling stop denied; created child uses a real frozen base", async () => {
  const { env, cleanup } = await envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    await assert.rejects(async () => env.lifecycle.stop(auth("b", ["mail.send"]), "a", "stop-x"),
      (error: unknown) => error instanceof StoreError && error.code === "CAPABILITY_DENIED");
    const res = await env.lifecycle.create(auth("a", ["agent.create"]), { name: "child", from: base, brief: "b" }, "c1");
    assert.equal(res.state, "succeeded");
    const child = env.store.getAgent("child")!;
    assert.equal(child.desired, "enabled");
    assert.equal(env.units.confirmDead("child", 0), true);
    assert.deepEqual(JSON.parse(child.specJson).capabilities, ["mail.send", "route.follow"]);
  } finally { await cleanup(); }
});

test("SEQ-002: unknown old-run death stops startup before mail reconciliation", async () => {
  const { env, cleanup } = await envOf();
  try {
    seedPrincipalAndA(env.store);
    Reflect.set(env.units, "confirmDead", () => false);
    Reflect.set(env.units, "stop", () => { throw new StoreError("RUN_TERMINATION_UNKNOWN", "injected unknown death"); });
    Reflect.set(env.mail, "reconcilePending", () => assert.fail("mail reconciled before death proof"));
    const reconcile = createReconcileModule(env.store, env.mail, null, null, env.units, env.lifecycle, { projectGit: join(env.dir, "state", "repos", "project.git"), hasGoal: () => true, activationAllowed: () => true });
    // Every Resident gets its stop attempt, so the seeded pair's failures
    // arrive aggregated under the typed outer error -- not collapsed into
    // the first attempt's message. The cause carries each injected death.
    await assert.rejects(reconcile.startup(false), (error: unknown) => {
      assert.ok(error instanceof StoreError && error.code === "RUN_TERMINATION_UNKNOWN", String(error));
      assert.match(error.message, /cannot confirm every Resident stopped/);
      assert.ok(error.cause instanceof AggregateError, "multiple stop failures arrive aggregated");
      assert.equal(error.cause.errors.length, 2);
      for (const entry of error.cause.errors)
        assert.ok(entry instanceof StoreError && entry.code === "RUN_TERMINATION_UNKNOWN" &&
          /injected unknown death/.test(entry.message), String(entry));
      return true;
    });
  } finally { await cleanup(); }
});

test("LIFE-009: bootstrap freezes all seeds before effects and never reseeds a ready registry", async () => {
  const { env, cleanup } = await envOf();
  try {
    const from = seedProjectGit(env);
    const config: Parameters<LifecycleModule["bootstrap"]>[0] = {
      principalProfile: "p", initialResidents: [{ name: "child", profile: "p", brief: "seed" }],
      modelProfiles: { m: { provider: "none", model: "none", inferenceTimeoutSeconds: 1 } },
      agentProfiles: { p: { modelProfile: "m", capabilities: ["mail.send"], delegable: [], childProfile: null } },
    };
    await env.lifecycle.bootstrap(config);
    const op = env.store.getOperation("principal", "bootstrap-child")!;
    assert.equal(op.state, "pending");
    assert.equal(env.store.getAgent("child")!.desired, "provisioning");
    assert.equal(JSON.parse(op.planJson).intent.spec.from, from);
    assert.equal(existsSync(join(env.dir, "state", "agents", "child", "workspace")), false);
    await assert.rejects(env.lifecycle.bootstrap({ ...config, initialResidents: [] }), /seed set changed/);
    await assert.rejects(env.lifecycle.bootstrap({ ...config, initialResidents: [{ name: "child", profile: "p", brief: "changed" }] }), /seed spec changed/);
    await env.lifecycle.bootstrap(config);
    assert.equal(env.store.getOperation("principal", "bootstrap-child")!.id, op.id);
    const goal = join(env.dir, "state", "world", "context", "current");
    mkdirSync(goal, { recursive: true });
    const start = env.units.start.bind(env.units);
    Reflect.set(env.units, "start", () => assert.fail("activation before broker READY"));
    const reconcile = createReconcileModule(env.store, env.mail, null, null, env.units, env.lifecycle, { projectGit: join(env.dir, "state", "repos", "project.git"), hasGoal: () => true, activationAllowed: () => true });
    await reconcile.startup(false);
    assert.equal(env.store.getOperationById(op.id)!.state, "pending");
    assert.equal(env.store.getAgent("child")!.desired, "enabled");
    assert.equal(env.store.pendingDeliveries("child").length, 1);
    Reflect.set(env.units, "start", start);
    rmSync(goal, { recursive: true });
    await env.lifecycle.reconcileCreate(op.id);
    assert.equal(env.store.getOperationById(op.id)!.state, "succeeded");
    assert.equal(env.store.pendingDeliveries("child").length, 1);
    await env.lifecycle.bootstrap({ ...config, initialResidents: [{ name: "another", profile: "p", brief: "not a new seed" }] });
    assert.equal(env.store.getAgent("another"), null);
    assert.equal(env.store.getAgent("principal")!.role, "principal");
  } finally { await cleanup(); }
});

test("T39/LIFE-007: same name + same resolved spec converges without a second physical create", async () => {
  const { env, cleanup } = await envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    const createAuth = auth("a", ["agent.create"]);
    const first = await env.lifecycle.create(createAuth, { name: "child", from: base, brief: "same" }, "c1");
    const second = await env.lifecycle.create(createAuth, { name: "child", from: base, brief: "same" }, "c2");
    assert.equal(first.state, "succeeded");
    assert.equal(second.state, "succeeded");
    assert.equal(env.store.listAgents().filter(agent => agent.name === "child").length, 1);
    const linked = env.store.getOperation("a", "c2")!;
    const plan = JSON.parse(linked.planJson).intent as { existingCreation: string | null };
    assert.equal(plan.existingCreation, first.operation);
    assert.equal(existsSync(join(env.dir, "state", "agents", "child", "workspace")), true);
  } finally { await cleanup(); }
});

test("LIFE-007 race: concurrent stable-name creates publish only one mail object", async () => {
  const { env, cleanup } = await envOf();
  try {
    seedPrincipalAndA(env.store);
    const from = seedProjectGit(env);
    const receipts = await Promise.all(["race-1", "race-2"].map(key => env.lifecycle.create(auth("a", ["agent.create"]),
      { name: "child", from, brief: "same" }, key)));
    const plans = receipts.map(receipt => JSON.parse(env.store.getOperationById(receipt.operation)!.planJson).intent);
    assert.equal(plans.filter(plan => plan.existingCreation === null).length, 1);
    assert.equal(plans.filter(plan => plan.initialMessage !== null).length, 1);
    // Each racing attempt freezes its own initial EML before its intent
    // transaction. WP17/WP20: the loser's preaccept scope owns exactly the
    // object it froze and settles it as not accepted, so only the winner's
    // published object remains (FS-007 without a leak).
    const objects = readdirSync(join(env.dir, "state", "mail", "objects"));
    const winner = plans.find(plan => plan.initialMessage !== null)!.initialMessage.id as string;
    assert.deepEqual(objects, [`${winner}.eml`]);
    assert.equal(env.store.pendingDeliveries("child").length, 1);
  } finally { await cleanup(); }
});

test("T40/LIFE-001: same stable name with a different resolved spec conflicts", async () => {
  const { env, cleanup } = await envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    const createAuth = auth("a", ["agent.create"]);
    await env.lifecycle.create(createAuth, { name: "child", from: base, brief: "one" }, "c1");
    await assert.rejects(env.lifecycle.create(createAuth, { name: "child", from: base, brief: "two" }, "c2"),
      (error: unknown) => error instanceof StoreError && error.code === "AGENT_CONFLICT");
  } finally { await cleanup(); }
});

test("CREATE-003: resolved child policy is rechecked at T-create-intent", async () => {
  const { env, cleanup } = await envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    let resolutions = 0;
    const lifecycle = createLifecycleModule(env.store, env.units, {
      stateRoot: join(env.dir, "state"), projectGit: join(env.dir, "state", "repos", "project.git"), society: env.society, hasGoal: () => false,
      activationAllowed: () => true,
    }, (_parent, input) => ({
      ...input, modelProfile: "m",
      profile: ++resolutions === 1 ? "child" : "p", capabilities: ["mail.send"],
    }), env.mail);
    const receipt = await lifecycle.create(auth("a", ["agent.create"]), { name: "policy-child", from: base, brief: "frozen" }, "policy-race");
    assert.equal(receipt.state, "succeeded");
    assert.equal(env.store.getAgent("policy-child")!.profile, "p");
    assert.equal((JSON.parse(env.store.getAgent("policy-child")!.specJson) as { profile: string }).profile, "p");
    assert.equal(resolutions >= 2, true);
  } finally { await cleanup(); }
});


test("T41/CTX-006: pre-GOAL create stays logically enabled but cannot activate until GOAL exists", async () => {
  const { env, cleanup } = await envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    await env.lifecycle.create(auth("a", ["agent.create"]), { name: "child", from: base, brief: "wait for goal" }, "c1");
    assert.equal(env.store.getAgent("child")!.desired, "enabled");
    const reconcile = createReconcileModule(env.store, env.mail, null, null, env.units, env.lifecycle, {
      activationAllowed: () => true,
      projectGit: join(env.dir, "state", "repos", "project.git"),
      hasGoal: () => existsSync(join(env.dir, "state", "world", "context", "current")),
    });
    await reconcile.sweep();
    assert.equal(env.units.confirmDead("child", 0), true);
    seedGov(env);
    await reconcile.sweep();
    const obs = env.units.observe("child");
    assert.equal(obs.activeState === "active" || obs.activeState === "activating", true);
  } finally { await cleanup(); }
});

test("REC-007: broker singleton lock — second broker refuses the society", async () => {
  const { env, cleanup } = await envOf();
  let b1: Broker | null = null;
  try {
    const mk = () => testBroker({ store: env.store, mail: env.mail, units: env.units, views: env.views, lifecycle: env.lifecycle, git: null, reviews: null, reconcile: null, paths: {
      stateRoot: join(env.dir, "state"), runRoot: join(env.dir, "R"), society: env.society, hasGoal: goalPublishedAt(join(env.dir, "state")),
    } });
    b1 = mk();
    await b1.start();
    // A second broker refuses at the first ownership boundary it reaches: the
    // per-store admission gate inside one process, the OS lock across
    // processes. Both report BROKER_UNAVAILABLE.
    assert.throws(() => { const b2 = mk(); void b2.start(); },
      (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE");
  } finally {
    await b1?.drainAndClose();
    await cleanup();
  }
});


test("V25A: start/stop intents accepted for an earlier incarnation cannot act on the current run; a current stop can", async () => {
  const { env, cleanup } = await envOf();
  try {
    seedPrincipalAndA(env.store);
    seedGov(env);
    env.store.transaction(tx => tx.updateAgent({ name: "a", desired: "enabled" }));
    // A start and a stop accepted while incarnation 1 ran, left unconfirmed.
    const accepted = (key: string, kind: "agent.start" | "agent.stop", desired: "enabled" | "stopped") => {
      const id = generateOperationId();
      env.store.transaction(tx => tx.acceptOperation({ id, actor: "principal", requestKey: key,
        requestHash: requestHash(kind, { agent: "a" }), kind, payloadJson: JSON.stringify({ agent: "a" }),
        planJson: serializePlanIntent({ kind, agent: "a", previousIncarnation: 1, desired, remainingOperations: [] }) }));
      return id;
    };
    const oldStart = accepted("old-start", "agent.start", "enabled");
    const oldStop = accepted("old-stop", "agent.stop", "stopped");
    // Since then incarnation 2 opened and is enabled; its unit is not running yet.
    env.store.transaction(tx => tx.updateAgent({ name: "a", incarnation: 2, desired: "enabled" }));
    await env.lifecycle.reconcileAction(oldStart);
    assert.equal(env.store.getOperationById(oldStart)!.state, "unknown", "the old start settled as if it applied");
    assert.equal(env.units.observe("a").activeState, "inactive", "the old start started a run for incarnation 2");
    // The current run is up.
    await env.units.start("a", false);
    const running = env.units.observe("a");
    assert.equal(running.activeState, "active");
    const principal = auth("principal", ["agent.manage.descendants"]);
    await env.lifecycle.reconcileAction(oldStop);
    assert.equal(env.store.getOperationById(oldStop)!.state, "unknown", "the old stop settled as if it applied");
    // Retrying either old key reports the old intent, unconfirmed, and does nothing.
    assert.equal((await env.lifecycle.stop(principal, "a", "old-stop")).state, "unknown");
    assert.equal((await env.lifecycle.start(principal, "a", "old-start")).state, "unknown");
    const after = env.units.observe("a");
    assert.equal(after.activeState, "active", "an old intent stopped the current run");
    assert.equal(after.invocationId, running.invocationId, "an old intent restarted the current run");
    assert.equal(env.store.getAgent("a")!.incarnation, 2, "an old intent rewrote the current incarnation");
    assert.equal(env.store.getAgent("a")!.desired, "enabled");
    // The current, explicit stop acts under current authority and proves death.
    const current = await env.lifecycle.stop(principal, "a", "stop-now");
    assert.equal(current.state, "succeeded");
    assert.equal(env.units.confirmDead("a", 2), true);
    assert.equal(env.units.observe("a").activeState, "inactive");
  } finally { await cleanup(); }
});



test("V23B: a status snapshot is display only; start, stop and death proof observe the scope again", async () => {
  const { env, cleanup } = await envOf();
  try {
    seedPrincipalAndA(env.store);
    seedGov(env);
    env.store.transaction(tx => tx.updateAgent({ name: "a", desired: "stopped" }));
    // One real batched observation of every agent: a is stopped, b has no unit.
    const refresh = new StatusRefresh(() => env.store.agentNames(), agents => env.units.observeStatus(agents));
    const snapshot = await refresh.request();
    assert.equal(snapshot.failure, null);
    const unitOf = (value: ReturnType<typeof snapshot.units.get>) => { assert.ok(value !== undefined && value !== "no-unit"); return value; };
    // AV9 / INV02: a recovered empty slot is not an execution that exited.
    assert.equal(snapshot.units.get("a"), "no-unit");
    assert.equal(snapshot.units.get("b"), "no-unit");
    const shown = env.views.statusOf(snapshot, "a")[0]!;
    assert.equal(shown.activeState, null); assert.equal(shown.execMainStatus, null);
    // After the snapshot the unit really starts.
    await env.units.start("a", false);
    assert.equal(env.units.observe("a").activeState, "active");
    // The display still says what it saw, and when -- it is not current.
    assert.equal(env.views.statusOf(snapshot, "a")[0]!.activeState, null);
    assert.ok(snapshot.observedAtMs <= Date.now());
    // Negative control: taking the cached "inactive" as death proof would
    // authorize acting on a live run.
    const cachedDeathProof = (agent: string) => snapshot.units.get(agent) === "no-unit";
    assert.equal(cachedDeathProof("a"), true, "the control does not reproduce the cached claim");
    const pin = env.units.pin(env.units.observe("a").scope);
    try { assert.equal(pin.population(), "populated", "the stale view cannot prove current death"); } finally { pin.close(); }
    // The effect paths observe again and refuse.
    assert.equal(env.units.confirmDead("a", 1), false);
    await assert.rejects(async () => env.lifecycle.start(auth("principal", ["agent.manage.descendants"]), "a", "v23b-start"),
      (error: unknown) => error instanceof StoreError && error.code === "RUN_TERMINATION_UNKNOWN");
    assert.equal(env.store.getAgent("a")!.incarnation, 1);
    // A later refresh sees the change.
    assert.equal(unitOf((await refresh.request()).units.get("a")).activeState, "active");
    await env.units.stop("a", 1);
  } finally { await cleanup(); }
});

// Retired service rendering/start-limit and service-launched runner cases are
// preserved in the raw archive. Actual native runtime/topology/Pi tests own
// those mechanisms with new IDs rather than reassigning historical UNIT IDs.
