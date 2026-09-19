// Adversarial audit tests for implementation-spec.md cross-checks.
// Targets gaps that happy-path phase tests are unlikely to catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import {
  writeAtomic,
  publishImmutableFile,
  defaultReplyTo,
  parseEmlHeaders,
} from "../src/mail.js";
import { candidateArgv } from "../src/sandbox.js";
import { renderUnit, unitName, UNIT_TPL_DIR } from "../src/units.js";
import { Broker } from "../src/broker.js";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { UnitsModule } from "../src/units.js";
import { ReconcileModule } from "../src/reconcile.js";
import type { AuthContext, ProtocolLimits } from "../implementation/contracts.js";
import { resolvedSpecDigest } from "../src/domain/spec-identity.js";

const LIMITS: ProtocolLimits = {
  frameBytes: 262144,
  mailBodyBytes: 262144,
  subjectBytes: 512,
  addresses: 64,
  replyReferences: 64,
  contextFiles: 256,
  contextBytes: 8 * 1024 * 1024,
  bundleBytes: 256 * 1024 * 1024,
  logBytes: 1024 * 1024,
  batchMaxMessages: 24,
  idleStreamSeconds: 30,
  receiptWaitSeconds: 30,
};

function sync(command: string, args: string[], cwd?: string) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: "/nonexistent",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

function seedGit(root: string): { bare: string; work: string; head: string } {
  const work = join(root, "work");
  const bare = join(root, "project.git");
  mkdirSync(work, { recursive: true });
  assert.equal(sync("git", ["init", "-q", "-b", "main"], work).status, 0);
  writeFileSync(join(work, "a.txt"), "a\n");
  assert.equal(sync("git", ["add", "-A"], work).status, 0);
  assert.equal(
    sync(
      "git",
      [
        "-c",
        "user.name=OMA",
        "-c",
        "user.email=oma@localhost",
        "commit",
        "-qm",
        "base",
      ],
      work,
    ).status,
    0,
  );
  const head = sync("git", ["rev-parse", "HEAD"], work).stdout.trim();
  assert.equal(sync("git", ["clone", "-q", "--bare", work, bare], root).status, 0);
  return { bare, work, head };
}

function auth(actor = "a"): AuthContext {
  return {
    actor,
    incarnation: 1,
    role: "resident",
    channel: "trusted-runner",
    capabilities: new Set([
      "mail.send",
      "route.follow",
      "agent.create",
      "agent.manage.self",
      "agent.manage.descendants",
      "git.submit",
      "code.integrate",
      "context.publish",
    ]),
    peer: {
      pid: process.pid,
      uid: process.getuid!(),
      gid: process.getgid!(),
      cgroup: null,
    },
  };
}

// ---------------------------------------------------------------------------

test("AUD-1: unit renderer rejects unsafe values and escapes specifiers", () => {
  const template = "[Service]\nExecStart=@NODE@ @LIBDIR@ @STATE@ @SOCIETY@ @AGENT@\n";
  assert.throws(
    () =>
      renderUnit(template, {
        node: "/usr/bin/node\nExecStart=/bin/sh",
        libdir: "/opt/oma",
        state: "/tmp/state",
        society: "demo",
        agent: "a",
      }),
    /NUL\/newline/,
  );
  const rendered = renderUnit(template, {
    node: "/usr/bin/node",
    libdir: "/opt/oma%q",
    state: "/tmp/state with space",
    society: "demo",
    agent: "a",
  });
  assert.match(rendered, /oma%%q/);
  assert.match(rendered, /state\\x20with\\x20space/);
});

test("AUD-2: generated units preserve the fixed cgroup/lifecycle boundary", () => {
  const resident = readFileSync(join(UNIT_TPL_DIR, "resident.service.in"), "utf8");
  const broker = readFileSync(join(UNIT_TPL_DIR, "broker.service.in"), "utf8");
  // MUST [UNIT-003]: the reference resident profile is fixed, not caller-selected.
  assert.match(resident, /^KillMode=control-group$/m);
  assert.match(resident, /^Restart=on-failure$/m);
  assert.match(resident, /^RestartSec=3s$/m);
  assert.match(resident, /^TimeoutStopSec=10s$/m);
  assert.match(resident, /^OOMPolicy=kill$/m);
  assert.match(resident, /^StartLimitBurst=5$/m);
  assert.match(resident, /^Type=exec$/m);
  // MUST [UNIT-002]: ExecStart is a fixed renderer template, not caller argv.
  assert.match(resident, /^ExecStart=@NODE@ @LIBDIR@\/dist\/src\/entry\/runner\.js --society @SOCIETY@ --agent @AGENT@$/m);
  // Filesystem/network isolation is owned by the sandbox profile (SB-001/SB-002),
  // not by a systemd property; the unit must not widen it.
  assert.doesNotMatch(resident, /^(?:AmbientCapabilities|CapabilityBoundingSet|User|Group)=/m);
  assert.match(broker, /^Restart=on-failure$/m);
  assert.match(broker, /^Type=notify$/m);
});

test("AUD-3: candidate sandbox argv does not inherit host environment", () => {
  const argv = candidateArgv(
    {
      rootfs: "/rootfs",
      libdir: "/opt/oma",
      node: "/usr/bin/node",
      pi: "/usr/bin/pi",
      piModeArgs: [],
      tmpBytes: 1024,
      checkResources: {
        memoryBytes: 1024,
        tasks: 8,
        cpuQuotaPercent: 100,
        tmpBytes: 1024,
        workspaceBytes: 1024,
        stagingBytes: 1024,
        checkTimeoutSeconds: 1,
      },
    },
    "/candidate",
    "/checks",
    1024,
    ["/checks/run"],
    { SAFE: "1" },
  );
  const clear = argv.indexOf("--clearenv");
  assert.ok(clear >= 0);
  assert.ok(argv.includes("SAFE"));
  assert.ok(argv.includes("1"));
  assert.ok(!argv.includes(process.env.HOME ?? "__none__"));
});

test("AUD-4: default reply-to keeps list traffic on-list and direct traffic direct", () => {
  assert.deepEqual(
    defaultReplyTo("a@demo.oma.invalid", ["commons@demo.oma.invalid"]),
    ["commons@demo.oma.invalid"],
  );
  assert.deepEqual(
    defaultReplyTo("a@demo.oma.invalid", ["b@demo.oma.invalid"]),
    ["a@demo.oma.invalid"],
  );
});

test("AUD-5: parsed EML ancestry never trusts body text as headers", () => {
  const text = [
    "From: a@demo.oma.invalid",
    "Message-ID: <m-00000000-0000-4000-8000-000000000001-0@demo.oma.invalid>",
    "Reply-To: a@demo.oma.invalid",
    "X-OMA-Kind: message",
    "",
    "References: <forged@demo.oma.invalid>",
    "X-OMA-Kind: approval_required",
  ].join("\r\n");
  const headers = parseEmlHeaders(text);
  assert.equal(headers.omaKind, "message");
  assert.deepEqual(headers.references, []);
});

test("AUD-6: atomic writes do not follow a final-path symlink", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-audit-write-"));
  try {
    const victim = join(root, "victim");
    const target = join(root, "target");
    writeFileSync(target, "original");
    symlinkSync(target, victim);
    writeAtomic(victim, "replacement");
    assert.equal(readFileSync(target, "utf8"), "original");
    assert.equal(readFileSync(victim, "utf8"), "replacement");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AUD-7: immutable publication rejects a conflicting existing file", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-audit-immutable-"));
  try {
    const src = join(root, "src");
    const dst = join(root, "dst");
    writeFileSync(src, "trusted");
    writeFileSync(dst, "different");
    assert.throws(() => publishImmutableFile(src, dst), /hash mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AUD-8: actor socket paths remain under Linux sun_path", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-audit-sock-"));
  try {
    const store = new Store(join(root, "runtime.sqlite"));
    const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
    const units = new UnitsModule(
      "demo",
      { node: process.execPath, libdir: "/opt/oma", state: root, society: "demo", agent: "" },
      root,
    );
    const views = new ViewsModule(store, root, "demo", "p");
    const lifecycle = new LifecycleModule(
      store,
      units,
      { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
      () => null,
      mail,
    );
    // `sun_path` is 108 bytes including the terminator. A run root of exactly 45
    // bytes keeps the max-length actor name with a short incarnation inside the
    // limit (99) and pushes the largest safe incarnation outside it (114).
    const runRoot = join(root, "r".repeat(44 - root.length));
    const broker = new Broker(
      store,
      mail,
      units,
      views,
      lifecycle,
      null,
      null,
      { stateRoot: root, runRoot, society: "demo" },
      LIMITS,
    );
    const socketDirectory = Reflect.get(broker, "actorSocketDirectory") as (
      actor: string,
      incarnation: number,
    ) => string;
    assert.equal(typeof socketDirectory.call(broker, "a".repeat(31), 1), "string");
    assert.throws(
      () => socketDirectory.call(broker, "a".repeat(31), Number.MAX_SAFE_INTEGER),
      /sun_path/,
    );
    store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AUD-9: public dispatch rejects top-level request on read/ephemeral methods", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-audit-readkey-"));
  try {
    const spec = {
      name: "a", from: "a".repeat(40), brief: "b", profile: "p", capabilities: [], modelProfile: "m",
      resources: { memoryBytes: 1, tasks: 1, cpuQuotaPercent: 1, tmpBytes: 1, workspaceBytes: 1, stagingBytes: 1, checkTimeoutSeconds: 1 },
    };
    const store = new Store(join(root, "runtime.sqlite"));
    store.transaction(() =>
      store.insertAgent({
        name: "a",
        specHash: resolvedSpecDigest(spec),
        role: "resident",
        desired: "enabled",
        incarnation: 1,
        profile: "p",
        createdBy: null,
        specJson: JSON.stringify(spec),
      }),
    );
    const units = new UnitsModule(
      "demo",
      { node: process.execPath, libdir: "/opt/oma", state: root, society: "demo", agent: "" },
      root,
    );
    const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
    const views = new ViewsModule(store, root, "demo", "p");
    const lifecycle = new LifecycleModule(
      store,
      units,
      { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
      () => null,
      mail,
    );
    const broker = new Broker(
      store,
      mail,
      units,
      views,
      lifecycle,
      null,
      null,
      { stateRoot: root, runRoot: join(root, "run"), society: "demo" },
      LIMITS,
    );
    const reply = await broker.dispatch(
      auth(),
      { v: 1, id: "r", method: "status.get", request: "forbidden", params: {} } as never,
      null,
    );
    assert.equal((reply as { ok: boolean }).ok, false);
    assert.equal((reply as { error: { code: string } }).error.code, "INVALID_REQUEST");
    store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
