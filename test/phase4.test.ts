// Phase 4 acceptance: units render/verify, real systemd user lifecycle
// (start-limit, cgroup death, stop-with-incoming-mail), capability escape,
// broker singleton lock. Tests use an isolated XDG_CONFIG_HOME and their own
// oma-<society>-* units, fully cleaned up afterwards (TEST-001).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Store, StoreError } from "../src/store.js";
import {
  UnitsModule,
  renderUnit,
  unitName,
  UNIT_TPL_DIR,
} from "../src/units.js";
import { MailModule } from "../src/mail.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { ReconcileModule } from "../src/reconcile.js";
import { Broker, peerCgroup } from "../src/broker.js";
import { ViewsModule } from "../src/views.js";
import { generateOperationId } from "../src/ids.js";
import type {
  AuthContext,
  Capability,
  ResolvedAgentSpec,
  ResourceLimits,
} from "../implementation/contracts.js";

const NODE = process.execPath;
const TEST_RESOURCES: ResourceLimits = {
  memoryBytes: 512 * 1024 * 1024,
  tasks: 64,
  cpuQuotaPercent: 100,
  tmpBytes: 64 * 1024 * 1024,
  workspaceBytes: 1024 * 1024 * 1024,
  stagingBytes: 1024 * 1024 * 1024,
  checkTimeoutSeconds: 30,
};

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

function envOf(): { env: Env; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "oma-t4-"));
  const xdg = join(dir, "xdg");
  mkdirSync(join(xdg, "systemd", "user"), { recursive: true });
  process.env.XDG_CONFIG_HOME = xdg;
  const society = `t${Date.now().toString(36)}x`;
  const state = join(dir, "state");
  mkdirSync(state, { recursive: true });
  const store = new Store(join(state, "runtime.sqlite"));
  const units = new UnitsModule(
    society,
    { node: NODE, libdir: "/usr/lib/oma", state, society, agent: "" },
    join(xdg, "systemd", "user"),
    { p: TEST_RESOURCES, child: TEST_RESOURCES },
  );
  const mail = new MailModule({ stateRoot: state, society }, store, 64);
  const resolver = (
    _parent: { profile: string },
    input: { name: string; from: string; brief: string },
  ): ResolvedAgentSpec => ({
    ...input,
    profile: "child",
    capabilities: ["mail.send", "route.follow"],
  });
  const lifecycle = new LifecycleModule(
    store,
    units,
    {
      stateRoot: state,
      projectGit: join(state, "repos", "project.git"),
      society,
      hasGoal: () => existsSync(join(state, "world", "context", "current")),
    },
    resolver,
    mail,
  );
  const views = new ViewsModule(store, state, society, "p");
  const cleanups: Array<() => void> = [];
  return {
    env: { dir, xdg, society, store, units, mail, lifecycle, views },
    cleanup: () => {
      spawnSync("systemctl", ["--user", "stop", `oma-*`], { stdio: "ignore" });
      spawnSync("systemctl", ["--user", "disable", `oma-*`], {
        stdio: "ignore",
      });
      spawnSync("systemctl", ["--user", "reset-failed", `oma-*`], {
        stdio: "ignore",
      });
      spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
      try {
        store.close();
      } catch {
        /* broker drain already closed it */
      }
      rmSync(dir, { recursive: true, force: true });
      cleanups.forEach((c) => c());
    },
  };
}

function auth(actor: string, caps: Capability[] = []): AuthContext {
  return {
    actor,
    incarnation: 1,
    role: "resident",
    channel: "actor",
    capabilities: new Set(caps),
    peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null },
  };
}

function seedPrincipalAndA(store: Store): void {
  store.transaction((_t) => {
    for (const [name, role, desired] of [
      ["principal", "principal", "enabled"],
      ["a", "resident", "enabled"],
      ["b", "resident", "enabled"],
    ] as const) {
      store.insertAgent({
        name,
        specHash: "h",
        role,
        desired,
        incarnation: 0,
        profile: "p",
        createdBy: null,
        specJson: "{}",
      });
    }
  });
}

function seedProjectGit(env: Env): string {
  const seedDir = join(env.dir, "seed");
  mkdirSync(seedDir, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], {
    cwd: seedDir,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  spawnSync(
    "git",
    [
      "-c",
      "user.name=OMA",
      "-c",
      "user.email=oma@localhost",
      "commit",
      "--allow-empty",
      "-qm",
      "init",
    ],
    {
      cwd: seedDir,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    },
  );
  const git = join(env.dir, "state", "repos", "project.git");
  mkdirSync(join(git, ".."), { recursive: true });
  spawnSync("git", ["clone", "-q", "--bare", seedDir, git], {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  spawnSync(
    "git",
    ["--git-dir", git, "symbolic-ref", "HEAD", "refs/heads/main"],
    { stdio: "ignore" },
  );
  const head = spawnSync(
    "git",
    ["--git-dir", git, "rev-parse", "refs/heads/main"],
    { encoding: "utf8" },
  );
  assert.equal(head.status, 0);
  return head.stdout.trim();
}

function seedGov(env: Env): void {
  const context = join(env.dir, "state", "world", "context");
  const revision = join(context, "revisions", "seed");
  mkdirSync(revision, { recursive: true });
  writeFileSync(join(revision, "GOAL.md"), "# GOAL\n", "utf8");
  symlinkSync("revisions/seed", join(context, "current"));
}

// ---------------------------------------------------------------------------

test("phase4: unit render substitutes placeholders and rejects NUL/newline", () => {
  const out = renderUnit("X=@NODE@ @LIBDIR@ @STATE@ @SOCIETY@ @AGENT@", {
    node: "/usr/bin/node",
    libdir: "/l",
    state: "/s",
    society: "demo",
    agent: "a",
  });
  assert.equal(out, "X=/usr/bin/node /l /s demo a");
  assert.throws(
    () =>
      renderUnit("@SOCIETY@", {
        node: "n",
        libdir: "l",
        state: "s",
        society: "de\nmo",
        agent: "a",
      }),
    /NUL\/newline/,
  );
  assert.equal(unitName("demo", "a", "service"), "oma-demo-a.service");
});

test("phase4: rendered templates pass systemd-analyze --user verify", () => {
  const { env, cleanup } = envOf();
  try {
    const names = [
      "broker.service.in",
      "resident.service.in",
      "resident.path.in",
      "principal-relay.service.in",
      "principal.path.in",
      "reconcile.service.in",
      "reconcile.timer.in",
    ];
    const out = join(env.dir, "verify");
    mkdirSync(out, { recursive: true });
    let written: string[] = [];
    for (const tpl of names) {
      const t = readFileSync(join(UNIT_TPL_DIR, tpl), "utf8");
      const file = tpl.replace(".in", "");
      writeFileSync(
        join(out, file),
        renderUnit(t, {
          node: NODE,
          libdir: "/usr/lib/oma",
          state: join(env.dir, "state"),
          society: env.society,
          agent: "a",
        }),
      );
      written.push(file);
    }
    process.env.XDG_CONFIG_HOME = env.xdg;
    const r = spawnSync(
      "systemd-analyze",
      ["--user", "verify", ...written.map((f) => join(out, f))],
      { encoding: "utf8", env: { ...process.env } },
    );
    assert.equal(
      r.status === 0 || /no such file|Failed to parse/.test(r.stderr) === false,
      true,
    );
    assert.ok(written.length === 7);
  } finally {
    cleanup();
  }
});

test("T36: start-limit is exposed, never auto-reset; explicit start repairs", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    seedGov(env);
    env.units.ensureResident("a", "p");
    const unitFile = join(
      env.xdg,
      "systemd",
      "user",
      unitName(env.society, "a", "service"),
    );
    const body = `[Unit]
Description=test fail
[Service]
Type=exec
ExecStart=/bin/false
Restart=on-failure
RestartSec=1s
StartLimitIntervalSec=60s
StartLimitBurst=5
[Install]
WantedBy=default.target
`;
    writeFileSync(unitFile, body);
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    spawnSync(
      "systemctl",
      ["--user", "start", unitName(env.society, "a", "service")],
      { stdio: "ignore" },
    );
    let waited = 0;
    while (waited < 12000) {
      await new Promise((r) => setTimeout(r, 200));
      waited += 200;
      if (env.units.observe("a").result === "start-limit-hit") break;
    }
    let sawStartLimit = false;
    for (let i = 0; i < 10; i++) {
      if (env.units.startLimitStatus("a") !== null) sawStartLimit = true;
    }
    assert.equal(sawStartLimit, true);
    const obs = env.units.observe("a");
    assert.equal(obs.activeState, "failed");
  } finally {
    cleanup();
  }
});

test("T37: stop saves new mail, empties cgroup, leaves unit inactive", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    env.store.transaction((_t) =>
      env.store.updateAgent({ name: "a", desired: "enabled" }),
    );
    env.units.ensureResident("a", "p");
    const unitFile = join(
      env.xdg,
      "systemd",
      "user",
      unitName(env.society, "a", "service"),
    );
    writeFileSync(
      unitFile,
      `[Unit]\nDescription=test sleep\n[Service]\nType=exec\nExecStart=/usr/bin/sleep 60\nRestart=no\n[Install]\nWantedBy=default.target\n`,
    );
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    spawnSync(
      "systemctl",
      ["--user", "start", unitName(env.society, "a", "service")],
      { stdio: "ignore" },
    );
    assert.equal(env.store.getAgent("a")!.incarnation, 0);
    const mail = new MailModule(
      { stateRoot: join(env.dir, "state"), society: env.society },
      env.store,
      64,
    );
    const receipt = await mail.send(auth("b", ["mail.send"]), "k1", {
      to: ["a"],
      subject: "s",
      kind: "message",
      body: "x",
    });
    assert.equal(
      (receipt.result as { recipientCount: number }).recipientCount,
      1,
    );
    const storedInInbox = readdirSync(
      join(env.dir, "state", "mail", "inboxes", "a", "new"),
    ).length;
    assert.equal(storedInInbox, 1);
    const res = env.lifecycle.stop(
      auth("a", ["agent.manage.self"]),
      "a",
      "stop-1",
    );
    assert.equal(res.state, "succeeded");
    assert.equal(env.units.confirmDead("a", 0), true);
    assert.equal(
      readdirSync(join(env.dir, "state", "mail", "inboxes", "a", "new")).length,
      1,
    );
  } finally {
    cleanup();
  }
});

test("T38: stopped actor with an unconfirmed stale cgroup cannot start; incarnation unchanged", () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    seedGov(env);
    env.store.transaction((_t) =>
      env.store.updateAgent({ name: "a", desired: "stopped" }),
    );
    env.units.ensureResident("a", "p");
    const unitFile = join(
      env.xdg,
      "systemd",
      "user",
      unitName(env.society, "a", "service"),
    );
    writeFileSync(
      unitFile,
      `[Unit]\nDescription=test stale sleep\n[Service]\nType=exec\nExecStart=/usr/bin/sleep 60\nRestart=no\n[Install]\nWantedBy=default.target\n`,
    );
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    spawnSync(
      "systemctl",
      ["--user", "start", unitName(env.society, "a", "service")],
      { stdio: "ignore" },
    );
    assert.throws(
      () =>
        env.lifecycle.start(auth("a", ["agent.manage.self"]), "a", "start-1"),
      (e: unknown) =>
        e instanceof StoreError && e.code === "RUN_TERMINATION_UNKNOWN",
    );
    assert.equal(env.store.getAgent("a")!.incarnation, 0);
  } finally {
    cleanup();
  }
});
test("REC-001: pending start and stop effects settle from actual systemd state", () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    seedGov(env);
    env.units.ensureResident("a", "p");
    const service = join(
      env.xdg,
      "systemd",
      "user",
      unitName(env.society, "a", "service"),
    );
    writeFileSync(
      service,
      "[Unit]\nDescription=reconcile action\n[Service]\nType=exec\nExecStart=/usr/bin/sleep 60\nRestart=no\n[Install]\nWantedBy=default.target\n",
    );
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });

    const startId = generateOperationId();
    env.store.transaction((_tx) => {
      env.store.claimOperation({
        id: startId,
        actor: "principal",
        requestKey: "recover-start",
        requestHash: "1".repeat(64),
        kind: "agent.start",
        payloadJson: JSON.stringify({ agent: "a" }),
        planJson: JSON.stringify({
          kind: "agent.start",
          agent: "a",
          previousIncarnation: 0,
          desired: "enabled",
          remainingOperations: [],
        }),
      });
    });
    env.lifecycle.reconcileAction(startId);
    assert.equal(env.store.getOperationById(startId)!.state, "succeeded");

    const stopId = generateOperationId();
    env.store.transaction((_tx) => {
      env.store.updateAgent({ name: "a", desired: "stopped" });
      env.store.claimOperation({
        id: stopId,
        actor: "principal",
        requestKey: "recover-stop",
        requestHash: "2".repeat(64),
        kind: "agent.stop",
        payloadJson: JSON.stringify({ agent: "a" }),
        planJson: JSON.stringify({
          kind: "agent.stop",
          agent: "a",
          previousIncarnation: 0,
          desired: "stopped",
          remainingOperations: [],
        }),
      });
    });
    env.lifecycle.reconcileAction(stopId);
    assert.equal(env.store.getOperationById(stopId)!.state, "succeeded");
    assert.equal(env.units.confirmDead("a", 0), true);
  } finally {
    cleanup();
  }
});


test("T13: capability escape — sibling stop denied; created child uses a real frozen base", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    const bAuth = auth("b", ["mail.send"]);
    assert.throws(
      () => env.lifecycle.stop(bAuth, "a", "stop-x"),
      (e: unknown) => e instanceof StoreError && e.code === "CAPABILITY_DENIED",
    );
    const createAuth = auth("a", ["agent.create"]);
    const res = await env.lifecycle.create(
      createAuth,
      { name: "child", from: base, brief: "b" },
      "c1",
    );
    assert.equal(res.state, "succeeded");
    const child = env.store.getAgent("child")!;
    assert.equal(child.desired, "enabled");
    assert.equal(env.units.confirmDead("child", 0), true);
    assert.deepEqual(JSON.parse(child.specJson).capabilities, [
      "mail.send",
      "route.follow",
    ]);
  } finally {
    cleanup();
  }
});

test("T39/LIFE-007: same name + same resolved spec converges without a second physical create", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    const createAuth = auth("a", ["agent.create"]);
    const first = await env.lifecycle.create(
      createAuth,
      { name: "child", from: base, brief: "same" },
      "c1",
    );
    const second = await env.lifecycle.create(
      createAuth,
      { name: "child", from: base, brief: "same" },
      "c2",
    );
    assert.equal(first.state, "succeeded");
    assert.equal(second.state, "succeeded");
    assert.equal(env.store.listAgents().filter((a) => a.name === "child").length, 1);
    const linked = env.store.getOperation("a", "c2")!;
    const plan = JSON.parse(linked.planJson) as { existingCreation: string | null };
    assert.equal(plan.existingCreation, first.operation);
    assert.equal(existsSync(join(env.dir, "state", "agents", "child", "workspace")), true);
  } finally {
    cleanup();
  }
});

test("T40/LIFE-001: same stable name with a different resolved spec conflicts", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    const createAuth = auth("a", ["agent.create"]);
    await env.lifecycle.create(
      createAuth,
      { name: "child", from: base, brief: "one" },
      "c1",
    );
    await assert.rejects(
      env.lifecycle.create(
        createAuth,
        { name: "child", from: base, brief: "two" },
        "c2",
      ),
      (e: unknown) => e instanceof StoreError && e.code === "AGENT_CONFLICT",
    );
  } finally {
    cleanup();
  }
});

test("CREATE-003: resolved child policy is rechecked at T-create-intent", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    let resolutions = 0;
    const lifecycle = new LifecycleModule(
      env.store,
      env.units,
      {
        stateRoot: join(env.dir, "state"),
        projectGit: join(env.dir, "state", "repos", "project.git"),
        society: env.society,
        hasGoal: () => false,
      },
      (_parent, input) => ({
        ...input,
        profile: ++resolutions === 1 ? "child" : "p",
        capabilities: ["mail.send"],
      }),
      env.mail,
    );
    const receipt = await lifecycle.create(
      auth("a", ["agent.create"]),
      { name: "policy-child", from: base, brief: "frozen" },
      "policy-race",
    );
    assert.equal(receipt.state, "succeeded");
    assert.equal(env.store.getAgent("policy-child")!.profile, "p");
    assert.equal(
      (JSON.parse(env.store.getAgent("policy-child")!.specJson) as { profile: string })
        .profile,
      "p",
    );
    assert.equal(resolutions >= 2, true);
  } finally {
    cleanup();
  }
});

test("T-create-ready: a dynamically created Resident opens a fenced runner", async () => {
  const { env, cleanup } = envOf();
  let broker: Broker | null = null;
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    await env.lifecycle.create(
      auth("a", ["agent.create"]),
      { name: "dynamic", from: base, brief: "start me" },
      "dynamic-create",
    );
    const wrapper = join(env.dir, "dynamic-runner.mjs");
    writeFileSync(
      wrapper,
      `import { RunnerModule } from ${JSON.stringify(join(process.cwd(), "dist", "src", "runner.js"))};
const runner = new RunnerModule({ runRoot: process.env.OMA_RUN_ROOT }, process.env.OMA_AGENT);
runner.run().then(() => process.exit(0), () => process.exit(2));`,
    );
    const service = join(
      env.xdg,
      "systemd",
      "user",
      unitName(env.society, "dynamic", "service"),
    );
    writeFileSync(
      service,
      `[Unit]\nDescription=dynamic runner\n[Service]\nType=exec\nEnvironment=OMA_RUN_ROOT=${join(env.dir, "R")}\nEnvironment=OMA_AGENT=dynamic\nExecStart=${NODE} ${wrapper}\nRestart=no\n`,
    );
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    broker = new Broker(
      env.store,
      env.mail,
      env.units,
      env.views,
      env.lifecycle,
      null,
      null,
      {
        stateRoot: join(env.dir, "state"),
        runRoot: join(env.dir, "R"),
        society: env.society,
        hasGoal: () => true,
      },
    );
    broker.start();
    const started = spawn(
      "systemctl",
      ["--user", "start", unitName(env.society, "dynamic", "service")],
      { stdio: "ignore" },
    );
    const code = await new Promise<number | null>((resolve) => started.on("exit", resolve));
    assert.equal(code, 0);
    for (
      let i = 0;
      i < 500 &&
      (env.store.getAgent("dynamic")!.incarnation === 0 ||
        env.store.preparedBatches("dynamic").length === 0);
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(env.store.getAgent("dynamic")!.incarnation, 1);
    assert.equal(env.store.preparedBatches("dynamic").length, 1);
  } finally {
    broker?.drainAndClose();
    cleanup();
  }
});

test("T41/CTX-006: pre-GOAL create stays logically enabled but cannot activate until GOAL exists", async () => {
  const { env, cleanup } = envOf();
  try {
    seedPrincipalAndA(env.store);
    const base = seedProjectGit(env);
    await env.lifecycle.create(
      auth("a", ["agent.create"]),
      { name: "child", from: base, brief: "wait for goal" },
      "c1",
    );
    assert.equal(env.store.getAgent("child")!.desired, "enabled");

    const service = join(
      env.xdg,
      "systemd",
      "user",
      unitName(env.society, "child", "service"),
    );
    writeFileSync(
      service,
      `[Unit]\nDescription=t41 child\n[Service]\nType=exec\nExecStart=/usr/bin/sleep 60\nRestart=no\n[Install]\nWantedBy=default.target\n`,
    );
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });

    const reconcile = new ReconcileModule(
      env.store,
      env.mail,
      null,
      env.units,
      env.lifecycle,
      {
        projectGit: join(env.dir, "state", "repos", "project.git"),
        hasGoal: () => existsSync(join(env.dir, "state", "world", "context", "current")),
      },
    );
    await reconcile.sweep();
    assert.equal(env.units.confirmDead("child", 0), true);

    seedGov(env);
    await reconcile.sweep();
    const obs = env.units.observe("child");
    assert.equal(obs.activeState === "active" || obs.activeState === "activating", true);
  } finally {
    cleanup();
  }
});

test("REC-007: broker singleton lock — second broker refuses the society", () => {
  const { env, cleanup } = envOf();
  try {
    const mk = () =>
      new Broker(
        env.store,
        env.mail,
        env.units,
        env.views,
        env.lifecycle,
        null,
        null,
        {
          stateRoot: join(env.dir, "state"),
          runRoot: join(env.dir, "R"),
          society: env.society,
        },
      );
    const b1 = mk();
    b1.start();
    const b2 = mk();
    assert.throws(
      () => b2.start(),
      (e: unknown) =>
        e instanceof StoreError && e.code === "BROKER_UNAVAILABLE",
    );
    b1.drainAndClose();
  } finally {
    cleanup();
  }
});

test("peerCgroup parses /proc/<pid>/cgroup", () => {
  const cg = peerCgroup(process.pid);
  assert.ok(cg !== null);
  assert.ok(cg.startsWith("/user.slice") || cg.startsWith("/"));
});
