import { testBroker } from "./helpers/broker-fixture.js";
import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
// Phase 4 acceptance: units render/verify, real systemd user lifecycle
// (start-limit, cgroup death, stop-with-incoming-mail), capability escape,
// broker singleton lock. XDG_CONFIG_HOME alone does not isolate a live manager.
// These opt-in tests require a disposable user and verify exact owned-unit cleanup.
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
import { UnitsModule, renderUnit, unitName, UNIT_TPL_DIR } from "@oma/platform-linux/units";
import { MailModule } from "@oma/mail";
import { LifecycleModule } from "@oma/lifecycle";
import { ReconcileModule } from "@oma/reconcile";
import { Broker, peerCgroup } from "@oma/broker";
import { ViewsModule } from "#oma-test/app/views";
import { generateOperationId } from "@oma/native/identity";
import { requestHash } from "@oma/domain/request-identity";

import { encodedResidentToolSurface } from "@oma/domain/tool-surface";
import { runnerReceiptPathAt } from "@oma/domain/paths";
import { StatusRefresh } from "@oma/broker/status-refresh";
import { makeValidAgent } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import type { AuthContext, Capability, ResolvedAgentSpec } from "@oma/contracts";

import { cleanupOwnedSystemdUnits, requireSystemdTestManager } from "./fixtures/systemd.js";
import { goalPublishedAt } from "./fixtures/goal.js";
requireSystemdTestManager();
const NODE = process.execPath;
interface Env {
  dir: string;
  xdg: string;
  society: string;
  store: Store;
  units: UnitsModule;
  mail: MailModule;
  lifecycle: LifecycleModule;
  views: ViewsModule;
}
/** P0V-59: a unit a test writes in place of a Resident's rendered one carries
 * the identity lines that one does -- its Description and its owner, the state
 * tree -- so the units module takes it for this society's unit, as it would a
 * unit it rendered. A unit without them is another owner's, and no effect of
 * this society reaches it. */
function ownedBy(env: Env, agent: string): string {
  const lines = readFileSync(join(UNIT_TPL_DIR, "resident.service.in"), "utf8").split("\n")
    .filter(line => line.startsWith("Description=") || line.startsWith("X-OMA-Owner="));
  const state = join(env.dir, "state");
  return renderUnit(lines.join("\n"), { node: NODE, libdir: "/usr/lib/oma", state, society: env.society, agent,
    config: join(state, "config.json"), run: join(state, "oma", env.society) });
}

function envOf(): { env: Env; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "oma-t4-"));
  const xdg = join(dir, "xdg");
  mkdirSync(join(xdg, "systemd", "user"), { recursive: true });
  const oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  const society = `t${Date.now().toString(36)}x`;
  const state = join(dir, "state");
  mkdirSync(state, { recursive: true });
  const store = new Store(join(state, "runtime.sqlite"));
  const units = new UnitsModule(society,
    { node: NODE, libdir: "/usr/lib/oma", state, society, agent: "", config: join(state, "config.json"), run: join(state, "oma", society) },
    join(xdg, "systemd", "user"));
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
    env: { dir, xdg, society, store, units, mail, lifecycle, views },
    cleanup: () => {
      try {
        cleanupOwnedSystemdUnits(dir, society);
        try { store.close(); } catch { /* awaited broker drain already closed it */ }
        rmSync(dir, { recursive: true, force: true });
      } finally {
        if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = oldXdg;
      }
    },
  };
}
// Domain fixtures represent an already authenticated incarnation with a complete stored spec.
function auth(actor: string, caps: Capability[] = []): AuthContext {
  return {
    actor, incarnation: actor === "principal" ? 0 : 1,
    role: actor === "principal" ? "principal" : "resident",
    channel: actor === "principal" ? "host" : "actor",
    capabilities: new Set(caps), peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null },
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

test("phase4: unit render substitutes placeholders and rejects NUL/newline", () => {
  const out = renderUnit("X=@NODE@ @LIBDIR@ @STATE@ @SOCIETY@ @AGENT@", {
    node: "/usr/bin/node", libdir: "/l", state: "/s", society: "demo", agent: "a",
  });
  assert.equal(out, "X=/usr/bin/node /l /s demo a");
  assert.throws(() => renderUnit("@SOCIETY@", {
    node: "n", libdir: "l", state: "s", society: "de\nmo", agent: "a",
  }), /NUL\/newline/);
  assert.equal(unitName("demo", "a", "service"), "oma-demo-a.service");
});

test("phase4: rendered templates pass systemd-analyze --user verify", () => {
  const { env, cleanup } = envOf();
  try {
    const names = ["resident.service.in", "resident.path.in",
      "principal-relay.service.in", "principal.path.in"];
    // Unit dependencies (BindsTo/After) resolve through the user unit search
    // path, so the rendered set is written where systemd looks for it.
    const out = join(env.xdg, "systemd", "user");
    mkdirSync(out, { recursive: true });
    const fileFor = (tpl: string): string => {
      const [kind, suffix] = tpl.replace(".in", "").split(".") as [string, "service" | "path" | "timer"];
      return unitName(env.society, kind === "resident" ? "a" : kind, suffix);
    };
    // The product runs the broker itself, so there is one deployment shape:
    // units bound to no fixed broker unit.
    const written: string[] = [];
    for (const tpl of names) {
      const text = readFileSync(join(UNIT_TPL_DIR, tpl), "utf8");
      const file = fileFor(tpl);
      writeFileSync(join(out, file), renderUnit(text, {
        node: NODE, libdir: process.cwd(), state: join(env.dir, "state"), society: env.society, agent: "a",
        config: join(env.dir, "config.json"), run: join(env.dir, "run", "oma", env.society),
        profileHex: Buffer.from("p").toString("hex"), modelProfileHex: Buffer.from("md").toString("hex"),
        // The same canonical plan UnitsModule installs (D23/TSP-005) -- the
        // renderer requires the input the template names.
        toolSurfaceHex: Buffer.from(encodedResidentToolSurface(), "utf8").toString("hex"),
      }));
      written.push(file);
    }
    process.env.XDG_CONFIG_HOME = env.xdg;
    const r = spawnSync("systemd-analyze", ["--user", "verify", ...written.map(file => join(out, file))],
      { encoding: "utf8", env: { ...process.env }, timeout: 30000, maxBuffer: 1048576, killSignal: "SIGKILL" });
    assert.equal(r.error, undefined);
    assert.equal(r.signal, null);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(written.length, 4);
  } finally { cleanup(); }
});

test("UNIT-002: systemd executes literal paths containing spaces and specifiers", () => {
  const { env, cleanup } = envOf();
  try {
    env.units.ensureResident("a", "p", "md");
    const libdir = join(env.dir, 'space % $HOME "quote"');
    mkdirSync(libdir);
    const output = join(env.dir, "literal-path.json");
    const script = join(libdir, "probe.mjs");
    writeFileSync(script, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv[1]));`);
    const service = join(env.xdg, "systemd", "user", unitName(env.society, "a", "service"));
    writeFileSync(service, renderUnit("[Service]\nType=oneshot\nExecStart=@NODE@ @LIBDIR@/probe.mjs\n", {
      node: process.execPath, libdir, state: env.dir, society: env.society, agent: "a",
    }));
    const reload = spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8" });
    assert.equal(reload.status, 0, reload.stderr);
    const run = spawnSync("systemctl", ["--user", "start", unitName(env.society, "a", "service")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(readFileSync(output, "utf8")), script);
  } finally { cleanup(); }
});

test("T36: explicit start-limit evidence is exposed; ambiguous failure stays ambiguous without reset", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    seedGov(env);
    env.units.ensureResident("a", "p", "md");
    const unitFile = join(env.xdg, "systemd", "user", unitName(env.society, "a", "service"));
    writeFileSync(unitFile, `[Unit]
${ownedBy(env, "a")}
StartLimitIntervalSec=60s
StartLimitBurst=5
[Service]
Type=exec
ExecStart=/bin/false
Restart=on-failure
RestartSec=1s
[Install]
WantedBy=default.target
`);
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    spawnSync("systemctl", ["--user", "start", unitName(env.society, "a", "service")], { stdio: "ignore" });
    let waited = 0;
    while (waited < 12000) {
      await new Promise(resolve => setTimeout(resolve, 200));
      waited += 200;
      if (env.units.observe("a").activeState === "failed") break;
    }
    const failed = env.units.observe("a");
    assert.equal(failed.activeState, "failed");
    const explicit = failed.result === "start-limit-hit";
    assert.ok(explicit || failed.result === "exit-code");
    for (let i = 0; i < 10; i++) assert.equal(env.units.startLimitStatus("a"), explicit ? "start_limit" : null);
    // DR27/P0-5 supersedes WP25's cumulative-counter heuristic. Some managers
    // retain exit-code: expose that failure, not a guessed cause or a repair.
    assert.throws(() => env.units.start("a", false), (error: unknown) => error instanceof StoreError &&
      error.code === (env.units.startLimitStatus("a") === "start_limit" ? "START_LIMIT" : "INTERNAL_ERROR"));
    assert.equal(env.units.observe("a").activeState, "failed", "a refused start reset the failed state");
  } finally { cleanup(); }
});

test("T37: stop saves new mail, empties cgroup, leaves unit inactive", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    env.store.transaction(tx => tx.updateAgent({ name: "a", desired: "enabled" }));
    env.units.ensureResident("a", "p", "md");
    const unitFile = join(env.xdg, "systemd", "user", unitName(env.society, "a", "service"));
    writeFileSync(unitFile, `[Unit]\n${ownedBy(env, "a")}\n[Service]\nType=exec\nExecStart=/usr/bin/sleep 60\nRestart=no\n[Install]\nWantedBy=default.target\n`);
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    spawnSync("systemctl", ["--user", "start", unitName(env.society, "a", "service")], { stdio: "ignore" });
    assert.equal(env.store.getAgent("a")!.incarnation, 1);
    const mail = createMailModule({ stateRoot: join(env.dir, "state"), society: env.society }, env.store, 64);
    const receipt = await mail.send(auth("b", ["mail.send"]), "k1", { to: ["a"], subject: "s", kind: "message", body: "x" });
    assert.equal((receipt.result as { recipientCount: number }).recipientCount, 1);
    assert.equal(readdirSync(join(env.dir, "state", "mail", "inboxes", "a", "new")).length, 1);
    const res = env.lifecycle.stop(auth("a", ["agent.manage.self"]), "a", "stop-1");
    assert.equal(res.state, "succeeded");
    assert.equal(env.units.confirmDead("a", 1), true);
    assert.equal(env.units.observe("a").activeState, "inactive");
    assert.equal(env.store.getAgent("a")!.desired, "stopped");
    assert.equal(readdirSync(join(env.dir, "state", "mail", "inboxes", "a", "new")).length, 1);
  } finally { cleanup(); }
});

test("T38: stopped actor with an unconfirmed stale cgroup cannot start; incarnation unchanged", () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    seedGov(env);
    env.store.transaction(tx => tx.updateAgent({ name: "a", desired: "stopped" }));
    env.units.ensureResident("a", "p", "md");
    const unitFile = join(env.xdg, "systemd", "user", unitName(env.society, "a", "service"));
    writeFileSync(unitFile, `[Unit]\n${ownedBy(env, "a")}\n[Service]\nType=exec\nExecStart=/usr/bin/sleep 60\nRestart=no\n[Install]\nWantedBy=default.target\n`);
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    spawnSync("systemctl", ["--user", "start", unitName(env.society, "a", "service")], { stdio: "ignore" });
    // A separate current manager reaches the death oracle; the stopped target's
    // own actor credentials would correctly fail earlier with STALE_RUN.
    assert.throws(() => env.lifecycle.start(auth("principal", ["agent.manage.descendants"]), "a", "start-1"),
      (error: unknown) => error instanceof StoreError && error.code === "RUN_TERMINATION_UNKNOWN");
    assert.equal(env.store.getAgent("a")!.incarnation, 1);
  } finally { cleanup(); }
});

test("REC-001: pending start and stop effects settle from actual systemd state", () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    seedGov(env);
    env.units.ensureResident("a", "p", "md");
    const service = join(env.xdg, "systemd", "user", unitName(env.society, "a", "service"));
    writeFileSync(service, `[Unit]\n${ownedBy(env, "a")}\n[Service]\nType=exec\nExecStart=/usr/bin/sleep 60\nRestart=no\n[Install]\nWantedBy=default.target\n`);
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    const startId = generateOperationId();
    env.store.transaction(tx => tx.acceptOperation({
      id: startId, actor: "principal", requestKey: "recover-start",
      requestHash: requestHash("agent.start", { agent: "a" }), kind: "agent.start",
      payloadJson: JSON.stringify({ agent: "a" }),
      planJson: serializePlanIntent({ kind: "agent.start", agent: "a", previousIncarnation: 1, desired: "enabled", remainingOperations: [] }),
    }));
    env.lifecycle.reconcileAction(startId);
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
    env.lifecycle.reconcileAction(stopId);
    assert.equal(env.store.getOperationById(stopId)!.state, "succeeded");
    assert.equal(env.units.confirmDead("a", 1), true);
  } finally { cleanup(); }
});

test("T13: capability escape — sibling stop denied; created child uses a real frozen base", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    assert.throws(() => env.lifecycle.stop(auth("b", ["mail.send"]), "a", "stop-x"),
      (error: unknown) => error instanceof StoreError && error.code === "CAPABILITY_DENIED");
    const res = await env.lifecycle.create(auth("a", ["agent.create"]), { name: "child", from: base, brief: "b" }, "c1");
    assert.equal(res.state, "succeeded");
    const child = env.store.getAgent("child")!;
    assert.equal(child.desired, "enabled");
    assert.equal(env.units.confirmDead("child", 0), true);
    assert.deepEqual(JSON.parse(child.specJson).capabilities, ["mail.send", "route.follow"]);
  } finally { cleanup(); }
});

test("SEQ-002: unknown old-run death stops startup before mail reconciliation", async () => {
  const { env, cleanup } = envOf();
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
  } finally { cleanup(); }
});

test("LIFE-009: bootstrap freezes all seeds before effects and never reseeds a ready registry", async () => {
  const { env, cleanup } = envOf();
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
  } finally { cleanup(); }
});

test("T39/LIFE-007: same name + same resolved spec converges without a second physical create", async () => {
  const { env, cleanup } = envOf();
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
  } finally { cleanup(); }
});

test("LIFE-007 race: concurrent stable-name creates publish only one mail object", async () => {
  const { env, cleanup } = envOf();
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
  } finally { cleanup(); }
});

test("T40/LIFE-001: same stable name with a different resolved spec conflicts", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    const createAuth = auth("a", ["agent.create"]);
    await env.lifecycle.create(createAuth, { name: "child", from: base, brief: "one" }, "c1");
    await assert.rejects(env.lifecycle.create(createAuth, { name: "child", from: base, brief: "two" }, "c2"),
      (error: unknown) => error instanceof StoreError && error.code === "AGENT_CONFLICT");
  } finally { cleanup(); }
});

test("CREATE-003: resolved child policy is rechecked at T-create-intent", async () => {
  const { env, cleanup } = envOf();
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
  } finally { cleanup(); }
});

test("T-create-ready: a dynamically created Resident opens a fenced runner", async () => {
  const { env, cleanup } = envOf();
  let broker: Broker | null = null;
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    await env.lifecycle.create(auth("a", ["agent.create"]), { name: "dynamic", from: base, brief: "start me" }, "dynamic-create");
    const wrapper = join(env.dir, "dynamic-runner.mjs");
    // The wrapper records its own outcome so a failed handoff is diagnosable
    // instead of only appearing as a unit exit code.
    const wrapperLog = join(env.dir, "dynamic-runner.log");
    writeFileSync(wrapper, `import { writeFileSync } from "node:fs";
const log = (text) => { try { writeFileSync(${JSON.stringify(wrapperLog)}, text + "\\n"); } catch { /* diagnostic only */ } };
try {
  const { RunnerModule } = await import(${JSON.stringify(join(process.cwd(), "apps", "oma", "dist", "runner.js"))});
  const runner = new RunnerModule({ runRoot: process.env.OMA_RUN_ROOT }, process.env.OMA_AGENT);
  await runner.run();
  log("ok"); process.exit(0);
} catch (error) { log(String(error?.code ?? "") + " " + String(error?.message ?? error)); process.exit(2); }`);
    const service = join(env.xdg, "systemd", "user", unitName(env.society, "dynamic", "service"));
    writeFileSync(service, `[Unit]\n${ownedBy(env, "dynamic")}\n[Service]\nType=exec\nEnvironment=OMA_RUN_ROOT=${join(env.dir, "R")}\nEnvironment=OMA_AGENT=dynamic\nExecStart=${NODE} ${wrapper}\nRestart=no\n`);
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    broker = testBroker({ store: env.store, mail: env.mail, units: env.units, views: env.views, lifecycle: env.lifecycle, git: null, reviews: null, reconcile: null, paths: {
      stateRoot: join(env.dir, "state"), runRoot: join(env.dir, "R"), society: env.society, hasGoal: () => true,
    } });
    await broker.start();
    const started = spawn("systemctl", ["--user", "start", unitName(env.society, "dynamic", "service")], { stdio: "ignore" });
    const code = await new Promise<number | null>(resolve => started.on("exit", resolve));
    assert.equal(code, 0);
    for (let i = 0; i < 500 && (env.store.getAgent("dynamic")!.incarnation === 0 || env.store.preparedBatches("dynamic").length === 0); i++)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(env.store.getAgent("dynamic")!.incarnation, 1,
      `runner handoff failed: ${existsSync(wrapperLog) ? readFileSync(wrapperLog, "utf8").trim() : "no runner log"}; unit=${JSON.stringify(env.units.observe("dynamic"))}`);
    assert.equal(env.store.preparedBatches("dynamic").length, 1,
      `runner handoff: ${existsSync(wrapperLog) ? readFileSync(wrapperLog, "utf8").trim() : "no runner log"}; unit=${JSON.stringify(env.units.observe("dynamic"))}; pending=${env.store.pendingDeliveries("dynamic").length}`);
    const prepared = env.store.preparedBatches("dynamic")[0]!;
    for (let i = 0; i < 500 && env.units.observe("dynamic").activeState !== "failed"; i++)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(env.units.observe("dynamic").activeState, "failed");
    assert.equal(env.units.observe("dynamic").execMainStatus, 2, "an unverified Pi adapter must not report a successful run");
    assert.equal(env.store.pendingDeliveries("dynamic").length, 0);
    assert.equal(readdirSync(join(env.dir, "state", "mail", "inboxes", "dynamic", "new")).length, 0);
    const reconcile = createReconcileModule(env.store, env.mail, null, null, env.units, env.lifecycle, {
      activationAllowed: () => true,
      projectGit: join(env.dir, "state", "repos", "project.git"), hasGoal: () => true,
    });
    await reconcile.sweep();
    assert.equal(env.store.getAgent("dynamic")!.incarnation, 1, "a failed gated profile is not silently restarted");
    env.units.stop("dynamic", 1);
    const gatedWrapper = readFileSync(wrapper, "utf8");
    writeFileSync(wrapper, "process.exit(0);\n"); // Isolated idle-unit fixture, not Pi consumption.
    env.units.start("dynamic", false);
    for (let i = 0; i < 500 && env.units.observe("dynamic").activeState !== "inactive"; i++)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(env.units.observe("dynamic").activeState, "inactive");
    writeFileSync(wrapper, gatedWrapper);
    await reconcile.sweep();
    for (let i = 0; i < 500 && env.store.getAgent("dynamic")!.incarnation === 1; i++)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(env.store.getAgent("dynamic")!.incarnation, 2);
    assert.equal(env.store.preparedBatches("dynamic")[0]!.id, prepared.id);
    assert.equal(env.store.preparedBatches("dynamic")[0]!.messageIdsJson, prepared.messageIdsJson);
    for (let i = 0; i < 500 && !env.units.confirmDead("dynamic", 2); i++)
      await new Promise(resolve => setTimeout(resolve, 20));
    const readyFile = join(env.dir, "connection-ready");
    const closedFile = join(env.dir, "connection-closed");
    const originalWrapper = readFileSync(wrapper, "utf8");
    writeFileSync(wrapper, `
import { BrokerChannel } from ${JSON.stringify(join(process.cwd(), "apps", "oma", "dist", "runner.js"))};
import { FrameParser, encodeFrame } from ${JSON.stringify(join(process.cwd(), "apps", "oma", "dist", "frame.js"))};
import { connect } from 'node:net';
import { writeFileSync } from 'node:fs';
try {
const admin = new BrokerChannel();
await admin.connect(process.env.OMA_RUN_ROOT + '/admin.sock');
const lease = await admin.call('runner.open', {agent: process.env.OMA_AGENT, invocationId: process.env.INVOCATION_ID});
if (!lease.ok) throw new Error(JSON.stringify(lease));
const probe = (call) => call.then(reply => reply, error => ({ ok: false, error: { code: error?.code ?? 'UNKNOWN' } }));
const probes = {
  pending: await probe(admin.call('runner.pending', {})),
  invalid: await probe(admin.call('runner.pending', {agent:'dynamic'})),
  observe: await probe(admin.call('runner.observe', {reason:'test',observedAtMs:Date.now()})),
  unknown: await probe(admin.call('not.a.method', {})),
  extension: await probe(admin.call('batch.read', {batchId:'forged'})),
};
const parser = new FrameParser(262144);
const socket = connect(lease.result.socketHostPath, () => socket.write(encodeFrame({v:1,id:'hold',method:'status.get',params:{}})));
socket.on('data', bytes => { for (const frame of parser.feed(bytes)) if (frame.raw.ok) writeFileSync(${JSON.stringify(readyFile)}, JSON.stringify(probes)); });
socket.on('error', () => {});
socket.on('close', async () => {
  // The revoked lease must fail closed; record the outcome even when a call
  // rejects, so the observation file is always written.
  const outcome = async (call) => call.then(reply => reply, error => ({ ok: false, error: { code: error?.code ?? 'UNKNOWN', message: String(error?.message ?? error) } }));
  const reopen = await outcome(admin.call('runner.open', {agent: process.env.OMA_AGENT, invocationId: process.env.INVOCATION_ID}));
  const prepare = await outcome(admin.call('batch.prepare', {}));
  writeFileSync(${JSON.stringify(closedFile)}, JSON.stringify({reopen, prepare}));
});
setInterval(() => {}, 1000);
} catch (error) { writeFileSync(${JSON.stringify(readyFile)}, JSON.stringify({ probeError: String(error?.code ?? "") + " " + String(error?.message ?? error) })); setInterval(() => {}, 1000); }
`);
    const hold = spawn("systemctl", ["--user", "start", unitName(env.society, "dynamic", "service")], { stdio: "ignore" });
    assert.equal(await new Promise(resolve => hold.on("exit", resolve)), 0);
    for (let i = 0; i < 500 && !existsSync(readyFile); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(existsSync(readyFile), true,
      `probe runner did not report: ${existsSync(readyFile) ? readFileSync(readyFile, "utf8") : "no file"}`);
    const probes = JSON.parse(readFileSync(readyFile, "utf8"));
    assert.ok(probes.pending?.result, `probe failure: ${JSON.stringify(probes)}`);
    assert.deepEqual(probes.pending.result.recoverableBatchIds, [prepared.id]);
    assert.equal(probes.invalid.error.code, "INVALID_REQUEST");
    assert.deepEqual(probes.observe.result, { accepted: true });
    assert.equal(probes.unknown.error.code, "UNKNOWN_METHOD");
    // A trusted-only method is refused by the channel client before it reaches
    // the broker; no other code is a closed refusal of this boundary.
    assert.equal(probes.extension.error.code, "AUTH_FAILED", JSON.stringify(probes.extension));
    assert.equal(env.store.getAgent("dynamic")!.incarnation, 3);
    const oldFd = Reflect.get(broker, "runLeases").get("dynamic").cgroupFd;
    env.units.onRevokeRun!("dynamic");
    for (let i = 0; i < 500 && !existsSync(closedFile); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(existsSync(closedFile), true, "existing authenticated socket must close on revocation");
    const revokedReplies = JSON.parse(readFileSync(closedFile, "utf8"));
    assert.equal(revokedReplies.reopen.error.code, "STALE_RUN");
    assert.equal(revokedReplies.prepare.error.code, "STALE_RUN");
    assert.equal(env.store.getAgent("dynamic")!.incarnation, 3);
    assert.equal(env.units.observe("dynamic").activeState, "active");
    assert.match(readFileSync(`/proc/self/fd/${oldFd}/cgroup.events`, "utf8"), /^populated 1$/m);
    env.units.stop("dynamic", 3);
    assert.equal(env.units.confirmDead("dynamic", 3), true);
    env.units.stop("dynamic", 3);
    writeFileSync(wrapper, originalWrapper);
    env.units.start("dynamic", false);
    for (let i = 0; i < 500 && env.store.getAgent("dynamic")!.incarnation === 3; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(env.store.getAgent("dynamic")!.incarnation, 4);
    assert.equal(env.store.preparedBatches("dynamic")[0]!.id, prepared.id);
    for (let i = 0; i < 500 && !env.units.confirmDead("dynamic", 4); i++) await new Promise(resolve => setTimeout(resolve, 20));
    // The stray file this once planted where the incarnation's socket
    // directory must be is no longer a failure: owned-directory repair (P0-8)
    // collects oma-owned strays, which is itself required behavior. The open's
    // failure moves to settlement instead -- a receipt that conflicts with the
    // still-prepared batch holds it (P0-2), so the endpoint is never set up.
    const failedReceipt = runnerReceiptPathAt(join(env.dir, "state"), "dynamic", prepared.id);
    mkdirSync(dirname(failedReceipt), { recursive: true });
    writeFileSync(failedReceipt, "not a receipt\n");
    const failureFile = join(env.dir, "failed-listener");
    writeFileSync(wrapper, `
import { BrokerChannel } from ${JSON.stringify(join(process.cwd(), "apps", "oma", "dist", "runner.js"))};
import { writeFileSync } from 'node:fs';
const admin = new BrokerChannel();
await admin.connect(process.env.OMA_RUN_ROOT + '/admin.sock');
const params = {agent: process.env.OMA_AGENT, invocationId: process.env.INVOCATION_ID};
const first = await admin.call('runner.open', params);
const retry = await admin.call('runner.open', params);
writeFileSync(${JSON.stringify(failureFile)}, JSON.stringify({first, retry}));
setInterval(() => {}, 1000);
`);
    env.units.start("dynamic", false);
    for (let i = 0; i < 500 && !existsSync(failureFile); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(existsSync(failureFile), true);
    const failedReplies = JSON.parse(readFileSync(failureFile, "utf8"));
    assert.equal(failedReplies.first.error.code, "BATCH_CONFLICT");
    assert.equal(failedReplies.retry.error.code, "STALE_RUN");
    // P0V-113: a failed endpoint takes no incarnation, but its invocation
    // remains fenced until the pinned cgroup is proven dead.
    assert.equal(env.store.getAgent("dynamic")!.incarnation, 4);
    const failedRun = Reflect.get(broker, "runLeases").get("dynamic");
    assert.equal(failedRun.phase, "revoked-awaiting-death");
    assert.equal(failedRun.lease, null);
    const failedFd = failedRun.cgroupFd;
    assert.match(readFileSync(`/proc/self/fd/${failedFd}/cgroup.events`, "utf8"), /^populated 1$/m);
    env.units.stop("dynamic", 4);
    assert.equal(env.units.confirmDead("dynamic", 4), true);
    rmSync(failedReceipt);
    writeFileSync(wrapper, originalWrapper);
    env.units.start("dynamic", false);
    for (let i = 0; i < 500 && env.store.getAgent("dynamic")!.incarnation === 4; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(env.store.getAgent("dynamic")!.incarnation, 5);
    assert.equal(env.store.preparedBatches("dynamic")[0]!.id, prepared.id);
  } finally {
    await broker?.drainAndClose();
    cleanup();
  }
});

test("T41/CTX-006: pre-GOAL create stays logically enabled but cannot activate until GOAL exists", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    await env.lifecycle.create(auth("a", ["agent.create"]), { name: "child", from: base, brief: "wait for goal" }, "c1");
    assert.equal(env.store.getAgent("child")!.desired, "enabled");
    const service = join(env.xdg, "systemd", "user", unitName(env.society, "child", "service"));
    writeFileSync(service, `[Unit]\n${ownedBy(env, "child")}\n[Service]\nType=exec\nExecStart=/usr/bin/sleep 60\nRestart=no\n[Install]\nWantedBy=default.target\n`);
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
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
  } finally { cleanup(); }
});

test("REC-007: broker singleton lock — second broker refuses the society", async () => {
  const { env, cleanup } = envOf();
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
    cleanup();
  }
});

test("peerCgroup parses /proc/<pid>/cgroup", () => {
  const cg = peerCgroup(process.pid);
  assert.ok(cg !== null);
  assert.ok(cg.startsWith("/user.slice") || cg.startsWith("/"));
});

test("V25A: start/stop intents accepted for an earlier incarnation cannot act on the current run; a current stop can", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    seedGov(env);
    env.store.transaction(tx => tx.updateAgent({ name: "a", desired: "enabled" }));
    env.units.ensureResident("a", "p", "md");
    const service = unitName(env.society, "a", "service");
    const unitFile = join(env.xdg, "systemd", "user", service);
    writeFileSync(unitFile, `[Unit]\n${ownedBy(env, "a")}\n[Service]\nType=exec\nExecStart=/usr/bin/sleep 60\nRestart=no\n[Install]\nWantedBy=default.target\n`);
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
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
    env.lifecycle.reconcileAction(oldStart);
    assert.equal(env.store.getOperationById(oldStart)!.state, "unknown", "the old start settled as if it applied");
    assert.equal(env.units.observe("a").activeState, "inactive", "the old start started a run for incarnation 2");
    // The current run is up.
    spawnSync("systemctl", ["--user", "start", service], { stdio: "ignore" });
    const running = env.units.observe("a");
    assert.equal(running.activeState, "active");
    const principal = auth("principal", ["agent.manage.descendants"]);
    env.lifecycle.reconcileAction(oldStop);
    assert.equal(env.store.getOperationById(oldStop)!.state, "unknown", "the old stop settled as if it applied");
    // Retrying either old key reports the old intent, unconfirmed, and does nothing.
    assert.equal(env.lifecycle.stop(principal, "a", "old-stop").state, "unknown");
    assert.equal(env.lifecycle.start(principal, "a", "old-start").state, "unknown");
    const after = env.units.observe("a");
    assert.equal(after.activeState, "active", "an old intent stopped the current run");
    assert.equal(after.invocationId, running.invocationId, "an old intent restarted the current run");
    assert.equal(env.store.getAgent("a")!.incarnation, 2, "an old intent rewrote the current incarnation");
    assert.equal(env.store.getAgent("a")!.desired, "enabled");
    // The current, explicit stop acts under current authority and proves death.
    const current = env.lifecycle.stop(principal, "a", "stop-now");
    assert.equal(current.state, "succeeded");
    assert.equal(env.units.confirmDead("a", 2), true);
    assert.equal(env.units.observe("a").activeState, "inactive");
  } finally { cleanup(); }
});



test("V23B: a status snapshot is display only; start, stop and death proof observe the unit again", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    seedGov(env);
    env.store.transaction(tx => tx.updateAgent({ name: "a", desired: "stopped" }));
    env.units.ensureResident("a", "p", "md");
    const service = unitName(env.society, "a", "service");
    writeFileSync(join(env.xdg, "systemd", "user", service), `[Unit]\n${ownedBy(env, "a")}\n[Service]\nType=exec\nExecStart=/usr/bin/sleep 60\nRestart=no\n[Install]\nWantedBy=default.target\n`);
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    // One real batched observation of every agent: a is stopped, b has no unit.
    const refresh = new StatusRefresh(() => env.store.agentNames(), agents => env.units.observeStatus(agents));
    const snapshot = await refresh.request();
    assert.equal(snapshot.failure, null);
    const unitOf = (value: ReturnType<typeof snapshot.units.get>) => { assert.ok(value !== undefined && value !== "no-unit"); return value; };
    assert.equal(unitOf(snapshot.units.get("a")).activeState, "inactive");
    // AV9 / INV02: a unit systemd does not have is not one that ran and exited.
    assert.equal(snapshot.units.get("b"), "no-unit");
    const shown = env.views.statusOf(snapshot, "a")[0]!;
    assert.equal(shown.activeState, "inactive");
    // After the snapshot the unit really starts.
    spawnSync("systemctl", ["--user", "start", service], { stdio: "ignore" });
    assert.equal(env.units.observe("a").activeState, "active");
    // The display still says what it saw, and when -- it is not current.
    assert.equal(env.views.statusOf(snapshot, "a")[0]!.activeState, "inactive");
    assert.ok(snapshot.observedAtMs <= Date.now());
    // Negative control: taking the cached "inactive" as death proof would
    // authorize acting on a live run.
    const cachedDeathProof = (agent: string) => unitOf(snapshot.units.get(agent)).activeState === "inactive";
    assert.equal(cachedDeathProof("a"), true, "the control does not reproduce the cached claim");
    assert.ok(env.units.cgroupProcs("a").length > 0, "the run the cached view calls inactive is alive");
    // The effect paths observe again and refuse.
    assert.equal(env.units.confirmDead("a", 1), false);
    assert.throws(() => env.lifecycle.start(auth("principal", ["agent.manage.descendants"]), "a", "v23b-start"),
      (error: unknown) => error instanceof StoreError && error.code === "RUN_TERMINATION_UNKNOWN");
    assert.equal(env.store.getAgent("a")!.incarnation, 1);
    // A later refresh sees the change.
    assert.equal(unitOf((await refresh.request()).units.get("a")).activeState, "active");
    spawnSync("systemctl", ["--user", "stop", service], { stdio: "ignore" });
  } finally { cleanup(); }
});
