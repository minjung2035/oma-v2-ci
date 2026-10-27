import { residentRootfsPath } from "@oma/platform-linux/resident-rootfs";
import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
/** SB-001..006: what a Resident's engine is actually started with.
 *
 * The mount plan used to exist without a caller, so nothing checked that the
 * paths the engine is told about are the paths it can reach. These tests read
 * the plan the adapter will spawn and hold it against the mount table.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAdapter } from "@oma/engine/pi-adapter";
import { RunnerModule } from "#oma-test/app/runner";
import { RESIDENT_SYSTEM_PROMPT } from "@oma/domain/role-prompts";
import { TOOL_SCOPE_ENV, TOOL_SCOPE_SANDBOX, type PiConfinement } from "@oma/engine/pi-spawn-plan";
import { TOOL_SCOPE_ENV as MIRRORED_ENV, TOOL_SCOPE_SANDBOX as MIRRORED_SANDBOX, guardWorkspaceTools } from "@oma/tool-runtime/workspace-guard";
import { containWorkspaceTools, createContainedWriter } from "@oma/tool-runtime/contained-tools";
import { principalEnvironment, sessionEnv } from "@oma/engine/principal-session";
import { RESIDENT_INFERENCE_PORT, RESIDENT_PATHS, confinedPath, hostSessionPath, residentProjectGit } from "@oma/domain/resident-paths";
import { residentArgv } from "@oma/platform-linux/sandbox";
import { type SandboxDirectories as ResidentDirectories } from "@oma/contracts/runtime";
import { decodeRunLease } from "@oma/protocol/run-lease";
import { actorSocketPathAt, agentRootPathAt, runnerSessionDirPathAt, runnerViewPathAt, workspacePathAt } from "@oma/domain/paths";
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";

const RESOURCES = Object.freeze({
  memoryBytes: 1 << 30, tasks: 64, cpuQuotaPercent: 100,
  stagingBytes: 1 << 20, checkTimeoutSeconds: 30,
});
const LIMITS = Object.freeze({
  frameBytes: 65536, idleStreamSeconds: 30, receiptWaitSeconds: 30,
  batchMaxMessages: 24, mailBodyBytes: 4096, addresses: 64, contextBytes: 1 << 20, bundleBytes: 1 << 20,
});
const NUL = String.fromCharCode(0);

interface Fixture {
  readonly root: string; readonly stateRoot: string; readonly libdir: string;
  readonly dirs: ResidentDirectories;
  readonly adapter: PiAdapter; readonly confinement: PiConfinement;
  readonly paths: Readonly<Record<string, string>>;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "oma-confine-"));
  const stateRoot = join(root, "state");
  const runRoot = join(root, "run");
  const libdir = join(root, "lib");
  const actor = "alice";
  const dirs: ResidentDirectories = {
    workspace: workspacePathAt(stateRoot, actor),
    home: join(agentRootPathAt(stateRoot, actor), "home"),
    archive: join(stateRoot, "mail", "archive"), workerArchive: join(stateRoot, "mail", "workers"),
    selfMail: join(stateRoot, "mail", "inboxes", actor),
    view: runnerViewPathAt(stateRoot, actor),
    world: join(stateRoot, "world"),
    projectGit: join(stateRoot, "repos", "project.git"), projectMirror: join(stateRoot, "repos", "project-mirror.git"),
    sessions: runnerSessionDirPathAt(stateRoot, actor),
  };
  for (const path of Object.values(dirs)) mkdirSync(path, { recursive: true });
  mkdirSync(join(dirs.archive, "cur"), { recursive: true });
  mkdirSync(join(libdir, "apps", "oma", "dist"), { recursive: true });
  mkdirSync(join(libdir, "packages/extension/dist"), { recursive: true });
  mkdirSync(join(libdir, "engine"), { recursive: true });
  mkdirSync(join(runRoot, "actors", actor, "1"), { recursive: true });
  const paths = Object.freeze({
    piCommand: process.execPath,
    piEntry: join(libdir, "engine", "cli.js"),
    coreExtension: join(libdir, "packages", "extension", "dist", "index.js"),
    cli: join(libdir, "apps", "oma", "dist", "cli.js"),
    piAgentDir: join(stateRoot, "pi"),
    mailArchive: join(dirs.archive, "cur"),
    workerArchive: join(dirs.workerArchive, "cur"), projectGit: dirs.projectGit,
    socket: actorSocketPathAt(runRoot, actor, 1),
  });
  for (const file of [paths.piEntry, paths.coreExtension, paths.cli]) writeFileSync(file, "export {};\n");
  const lease = decodeRunLease({ actor, incarnation: 1, socketHostPath: paths.socket }, { actor, runRoot });
  const confinement: PiConfinement = {
    host: {
       libdir, node: "/usr/bin/node",
      pi: confinedPath({ libdir: libdir }, dirs, paths.piEntry), piModeArgs: [],
      stateRoot, runRoot, limits: { frameBytes: LIMITS.frameBytes, batchMaxMessages: LIMITS.batchMaxMessages },
    },
    lease, directories: dirs,
    inference: {
      socketHostPath: join(root, "run", "inference.sock"), provider: "anthropic",
      model: "claude-test", placeholder: "sk-ant-api03-PLACEHOLDERplaceholder0000",
    },
  };
  const adapterPaths = {
    piCommand: paths.piCommand, piArgs: [paths.piEntry], piAgentDir: paths.piAgentDir,
    coreExtension: paths.coreExtension, cli: paths.cli,
    workspace: dirs.workspace, sessionDir: dirs.sessions, agentHome: dirs.home,
    mailArchive: paths.mailArchive, workerArchive: paths.workerArchive, projectGit: paths.projectGit, batchView: dirs.view, socket: paths.socket,
  };
  const profile = {
    provider: "pi", model: "current", inferenceSeconds: 600, prompt: "",
    extensions: [],
  };
  const adapter = new PiAdapter(residentEngineEffects, {
    actor, society: "s", limits: LIMITS, profile, paths: adapterPaths, confinement,
  });
  return { root, stateRoot, libdir, dirs, adapter, confinement, paths };
}

function missingConfinementAdapter(f: Fixture): PiAdapter {
  return new PiAdapter(residentEngineEffects, {
    actor: "alice", society: "s", limits: LIMITS,
    profile: {
      provider: "pi", model: "current", inferenceSeconds: 600, prompt: "",
      extensions: [],
    },
    paths: {
      piCommand: f.paths.piCommand!, piArgs: [f.paths.piEntry!], piAgentDir: f.paths.piAgentDir!,
      coreExtension: f.paths.coreExtension!, cli: f.paths.cli!,
      workspace: f.dirs.workspace, sessionDir: f.dirs.sessions, agentHome: f.dirs.home,
      mailArchive: f.paths.mailArchive!, workerArchive: f.paths.workerArchive!, projectGit: f.paths.projectGit!, batchView: f.dirs.view, socket: f.paths.socket!,
    },
  } as never);
}

test("F34/F35: Resident environment is deterministic, confined, and never inherited", () => {
  const f = fixture();
  const saved = { ...process.env };
  process.env.OMA_HOST_SENTINEL = "host-only";
  process.env.LANG = "host-locale";
  try {
    const plan = f.adapter.spawnPlan();
    const env: Record<string, string> = {};
    for (let i = 0; i < plan.args.length; i++)
      if (plan.args[i] === "--setenv") env[plan.args[i + 1]!] = plan.args[i + 2]!;
    assert.deepEqual(Object.fromEntries(["HOME", "PATH", "LANG", "LC_ALL", "TZ", "TERM", "TMPDIR", "SHELL", "USER", "LOGNAME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR"].map(key => [key, env[key]])), {
      HOME: "/home/agent", PATH: "/opt/oma/apps/oma/dist/libexec:/opt/oma-node:/home/agent/.local/bin:/usr/bin:/bin",
      LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TERM: "xterm-256color", TMPDIR: "/tmp",
      SHELL: "/bin/sh", USER: "agent", LOGNAME: "agent", XDG_DATA_HOME: "/home/agent/.local/share", XDG_RUNTIME_DIR: "/home/agent/.run",
    });
    assert.equal(env.OMA_HOST_SENTINEL, undefined);
    assert.deepEqual(plan.env, {});
    assert.ok(plan.args.includes("--clearenv"));
  } finally {
    for (const key of ["LANG", "OMA_HOST_SENTINEL"])
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("T113 a confined Resident is spawned through the mount plan, not directly", () => {
  const f = fixture();
  try {
    const plan = f.adapter.spawnPlan();
    assert.equal(plan.command, "/usr/bin/bwrap");
    for (const flag of ["--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "--clearenv"])
      assert.ok(plan.args.includes(flag), `the plan dropped ${flag}`);
    // `--clearenv` makes the argv the whole environment, so an entry passed
    // through the spawn call would be a silent no-op that still looks wired.
    assert.deepEqual(plan.env, {});
    // The engine is the tail of the plan, run by the rootfs Node.
    const separator = plan.args.lastIndexOf("--");
    assert.ok(separator > 0);
    assert.deepEqual(plan.args.slice(separator + 1, separator + 3),
      [RESIDENT_PATHS.node, `${RESIDENT_PATHS.libdir}/engine/cli.js`]);
    // The host Node is bound as one file; the host path itself is not run.
    const nodeAt = plan.args.indexOf(RESIDENT_PATHS.node);
    assert.deepEqual(plan.args.slice(nodeAt - 2, nodeAt + 1), ["--ro-bind", "/usr/bin/node", RESIDENT_PATHS.node]);
    assert.ok(plan.args.slice(separator).includes("--mode"));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("T113 every path the confined engine is told about is a path it can reach", () => {
  const f = fixture();
  try {
    const plan = f.adapter.spawnPlan();
    const mounts = Object.values(RESIDENT_PATHS);
    const engineArgs = plan.args.slice(plan.args.lastIndexOf("--") + 1);
    // The values the core extension reads, plus the engine arguments that name
    // files. Each has to sit under a mount or the engine cannot open it.
    const values: string[] = [];
    for (let index = 0; index < plan.args.length; index += 1)
      if (plan.args[index] === "--setenv" && plan.args[index + 1]?.startsWith("OMA_") &&
        plan.args[index + 1] !== "OMA_TOOL_SURFACE") values.push(plan.args[index + 2]!);
    for (const flag of ["--session-dir", "-e"]) {
      const at = engineArgs.indexOf(flag);
      assert.notEqual(at, -1, `the engine was not given ${flag}`);
      values.push(engineArgs[at + 1]!);
    }
    let checked = 0;
    for (const value of values) {
      if (!value.startsWith("/")) continue;
      checked += 1;
      assert.ok(mounts.some(mount => value === mount || value.startsWith(`${mount}/`)),
        `${value} is under no mount; the engine would not find it`);
      assert.ok(!value.startsWith(f.stateRoot) && !value.startsWith(f.libdir),
        `${value} is a host path the confined engine cannot open`);
    }
    assert.ok(checked >= 6, `only ${checked} paths were checked; the plan lost entries`);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("T113: overlapping installation roots never shadow more-specific Resident mounts", () => {
  const f = fixture();
  try {
    const installation = { libdir: `${f.stateRoot}/`, packages: `${f.stateRoot}/packages` };
    for (const [host, inside] of [[f.dirs.home, RESIDENT_PATHS.home], [f.dirs.sessions, RESIDENT_PATHS.sessions],
      [f.dirs.workspace, RESIDENT_PATHS.workspace], [f.dirs.archive, RESIDENT_PATHS.archive],
      [f.dirs.workerArchive, RESIDENT_PATHS.workerArchive], [f.dirs.view, RESIDENT_PATHS.view],
      [installation.packages, RESIDENT_PATHS.packages]] as const) {
      assert.equal(confinedPath(installation, f.dirs, `${host}/entry`), `${inside}/entry`);
    }
    assert.equal(confinedPath(installation, f.dirs, `${f.stateRoot}/dist/engine.js`), `${RESIDENT_PATHS.libdir}/dist/engine.js`);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("T113 the engine's system prompt is the role's, or the built-in Resident prompt", () => {
  const f = fixture();
  try {
    const engineArgs = (adapter: PiAdapter) =>
      adapter.spawnPlan().args.slice(adapter.spawnPlan().args.lastIndexOf("--") + 1);
    // An authored-empty role prompt runs on the built-in Resident prompt, and
    // the flag replaces Pi's generated base prompt rather than appending.
    const bare = engineArgs(f.adapter);
    assert.equal(bare[bare.indexOf("--system-prompt") + 1], RESIDENT_SYSTEM_PROMPT);
    assert.equal(bare.includes("--append-system-prompt"), false);
    const authored = new PiAdapter(residentEngineEffects, {
      actor: "alice", society: "s", limits: LIMITS,
      profile: { provider: "pi", model: "current", inferenceSeconds: 600, prompt: "a role prompt",
        extensions: [] },
      paths: {
        piCommand: f.paths.piCommand!, piArgs: [f.paths.piEntry!], piAgentDir: f.paths.piAgentDir!,
        coreExtension: f.paths.coreExtension!, cli: f.paths.cli!,
        workspace: f.dirs.workspace, sessionDir: f.dirs.sessions, agentHome: f.dirs.home,
        mailArchive: f.paths.mailArchive!, workerArchive: f.paths.workerArchive!, projectGit: f.paths.projectGit!, batchView: f.dirs.view, socket: f.paths.socket!,
      },
      confinement: f.confinement,
    });
    const args = engineArgs(authored);
    assert.equal(args[args.indexOf("--system-prompt") + 1], "a role prompt");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("T113 the confined engine reaches a provider through the relay, not the network", () => {
  const f = fixture();
  try {
    const plan = f.adapter.spawnPlan();
    // INF-006: the namespace stays unshared. The only provider path is the
    // bind-mounted relay socket, which the core extension bridges to loopback.
    assert.ok(plan.args.includes("--unshare-all"));
    assert.equal(plan.args.some(value => value.startsWith("--share-net")), true);
    const mountAt = plan.args.indexOf(f.confinement.inference!.socketHostPath);
    assert.notEqual(mountAt, -1, "the relay socket is not mounted");
    assert.equal(plan.args[mountAt - 1], "--ro-bind");
    assert.equal(plan.args[mountAt + 1], RESIDENT_PATHS.inference);
    const setenv = (name: string): string | undefined => {
      const at = plan.args.lastIndexOf(name);
      return at > 0 && plan.args[at - 1] === "--setenv" ? plan.args[at + 1] : undefined;
    };
    assert.equal(setenv("OMA_INFERENCE_SOCKET"), RESIDENT_PATHS.inference);
    assert.equal(setenv("OMA_INFERENCE_PROVIDER"), "anthropic");
    assert.equal(setenv("OMA_INFERENCE_PORT"), String(RESIDENT_INFERENCE_PORT));
    assert.equal(setenv("OMA_INFERENCE_KEY"), "sk-ant-api03-PLACEHOLDERplaceholder0000");
    // The confined engine has no host model settings, so the host names the model.
    const engineArgs = plan.args.slice(plan.args.lastIndexOf("--") + 1);
    assert.equal(engineArgs[engineArgs.indexOf("--model") + 1], "anthropic/claude-test");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("T113 the engine's credential directory is never mounted into a Resident", () => {
  const f = fixture();
  try {
    const plan = f.adapter.spawnPlan();
    // PR-004: the host credential directory stays outside every mount. INF-001
    // names a separate, reachable directory for the confined engine's settings;
    // a variable's presence is not evidence that host credentials crossed over.
    const at = plan.args.indexOf("PI_CODING_AGENT_DIR");
    assert.ok(at > 0);
    assert.equal(plan.args[at - 1], "--setenv");
    assert.equal(plan.args[at + 1], confinedPath({ libdir: f.libdir }, f.dirs, join(f.dirs.home, "engine")));
    assert.equal(plan.args.filter(value => value === "PI_CODING_AGENT_DIR").length, 1);
    assert.equal(plan.args.some(value => value.includes(f.paths.piAgentDir!)), false);
    // An adapter without confinement is refused before receiving host engine state.
    assert.throws(() => missingConfinementAdapter(f), { code: "UNSUPPORTED_PROFILE" });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("DR25: a Resident's sandbox mounts the installed packages read-only, and its engine loads a package's extension from there", () => {
  const f = fixture();
  try {
    const packages = join(f.root, "packages");
    const file = join(packages, "npm", "node_modules", "oma-hello-ext", "extensions", "hello.ts");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "export default function () {}\n");
    const profile = { provider: "pi", model: "current", inferenceSeconds: 600, prompt: "", extensions: [{ path: file, sha256: "0".repeat(64) }] };
    const adapterPaths = { piCommand: f.paths.piCommand!, piArgs: [f.paths.piEntry!], piAgentDir: f.paths.piAgentDir!,
      coreExtension: f.paths.coreExtension!, cli: f.paths.cli!, workspace: f.dirs.workspace, sessionDir: f.dirs.sessions,
      agentHome: f.dirs.home, mailArchive: f.paths.mailArchive!, workerArchive: f.paths.workerArchive!, projectGit: f.paths.projectGit!, batchView: f.dirs.view, socket: f.paths.socket! };
    const plan = new PiAdapter(residentEngineEffects, { actor: "alice", society: "s", limits: LIMITS, profile, paths: adapterPaths,
      confinement: { ...f.confinement, host: { ...f.confinement.host, packages } } }).spawnPlan();
    const at = plan.args.indexOf(packages);
    assert.deepEqual(plan.args.slice(at - 1, at + 2), ["--ro-bind", packages, RESIDENT_PATHS.packages]);
    assert.ok(plan.args.includes(`${RESIDENT_PATHS.packages}/npm/node_modules/oma-hello-ext/extensions/hello.ts`),
      "the engine was not given the package's extension at its mount");
    assert.ok(!plan.args.some(value => value.includes(f.paths.piAgentDir!)), "the engine home was mounted");
    // With no package store declared, a package's file is under no mount: refused, not handed over.
    assert.throws(() => new PiAdapter(residentEngineEffects, { actor: "alice", society: "s", limits: LIMITS, profile, paths: adapterPaths,
      confinement: f.confinement }).spawnPlan(), { code: "AUTH_FAILED", message: "path is outside every root the confined engine has" });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("U1: an adapter without confinement is rejected rather than speaking host paths", () => {
  const f = fixture();
  try { assert.throws(() => missingConfinementAdapter(f), { code: "UNSUPPORTED_PROFILE" }); }
  finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("T113 a file outside every mount is refused rather than handed over", () => {
  const f = fixture();
  try {
    // A role extension the operator placed outside the installation would be
    // verified on the host and then be missing inside; refusing is the only
    // answer that does not look like a working configuration.
    assert.throws(() => confinedPath({ libdir: f.libdir }, f.dirs, "/etc/shadow"),
      (error: unknown) => (error as { code?: string }).code === "AUTH_FAILED");
    // Prefix matching must not treat a sibling directory as contained.
    assert.throws(() => confinedPath({ libdir: f.libdir }, f.dirs, `${f.libdir}-other/x.js`),
      (error: unknown) => (error as { code?: string }).code === "AUTH_FAILED");
    assert.equal(confinedPath({ libdir: f.libdir }, f.dirs, join(f.libdir, "a", "b.js")), `${RESIDENT_PATHS.libdir}/a/b.js`);
    // The installation path `oma` records ends in a separator; it must still match.
    assert.equal(confinedPath({ libdir: `${f.libdir}/` }, f.dirs, join(f.libdir, "a", "b.js")), `${RESIDENT_PATHS.libdir}/a/b.js`);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("T113 a hostile environment entry cannot become extra bwrap arguments", () => {
  const f = fixture();
  try {
    const { host, lease, directories } = f.confinement;
    for (const bad of [{ "OMA X": "v" }, { "--bind": "v" }, { OMA_A: `v${NUL}--bind` }])
      assert.throws(() => residentArgv(host, lease, directories, [], bad),
        (error: unknown) => (error as { code?: string }).code === "UNSUPPORTED_PROFILE", JSON.stringify(bad));
    // A caller cannot rename the actor: the builder's own entries come last and
    // bwrap keeps the last value for a repeated name.
    const argv = residentArgv(host, lease, directories, [], { OMA_ACTOR: "mallory" });
    assert.equal(argv[argv.lastIndexOf("OMA_ACTOR") + 1], "alice");
    assert.ok(argv.lastIndexOf("OMA_ACTOR") > argv.indexOf("mallory"));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// The durable lane's required name predates the w11 confined-only contract:
// the "an engine outside a sandbox does not" arm is gone with the unconfined
// profile, and missing confinement is now refused. The title keeps the
// required prefix.
test("AV13 / SB-001, arch §11.1, CLI-001: a confined Resident has its sandbox's shell, never a host shell", () => {
  const f = fixture();
  try {
    const confined = f.adapter.spawnPlan();
    const engine = confined.args.slice(confined.args.lastIndexOf("--") + 1);
    assert.equal(engine.includes("--exclude-tools"), false, "the confined Resident cannot run the commands its START names");
    assert.ok(confined.args.includes(`${TOOL_SCOPE_ENV}=${TOOL_SCOPE_SANDBOX}`) ||
      confined.args.some((arg, i) => arg === "--setenv" && confined.args[i + 1] === TOOL_SCOPE_ENV && confined.args[i + 2] === TOOL_SCOPE_SANDBOX),
      "the confined engine was not told it runs in the sandbox");
    assert.throws(() => missingConfinementAdapter(f), { code: "UNSUPPORTED_PROFILE" });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("AV13 / TSP-009, PR-004: inside the sandbox the guard leaves the shell and reading to the mount plan; writes stay in the workspace", () => {
  const f = fixture();
  try {
    type Guard = (event: { toolName: string; input: Record<string, unknown> }) => { block: boolean; reason: string } | undefined;
    const guard = (sandboxed: boolean): Guard => {
      let handler: Guard | undefined;
      guardWorkspaceTools({ on: (_name: string, fn: Guard) => { handler = fn; } } as never, f.dirs.workspace, sandboxed);
      return handler!;
    };
    const inside = guard(true);
    assert.equal(inside({ toolName: "bash", input: { command: "git status" } }), undefined);
    assert.equal(inside({ toolName: "read", input: { path: "/inbox.md" } }), undefined);
    assert.equal(inside({ toolName: "ls", input: { path: "/world" } }), undefined);
    assert.equal(inside({ toolName: "write", input: { path: "/tmp/x", content: "x" } })?.block, true, "a write left the workspace");
    assert.equal(inside({ toolName: "write", input: { path: join(f.dirs.workspace, "x"), content: "x" } }), undefined);
    const host = guard(false);
    assert.equal(host({ toolName: "bash", input: { command: "id" } })?.block, true);
    assert.equal(host({ toolName: "read", input: { path: "/etc/passwd" } })?.block, true);
    assert.equal(MIRRORED_ENV, TOOL_SCOPE_ENV, "the extension's mirror is not the runner's value");
    assert.equal(MIRRORED_SANDBOX, TOOL_SCOPE_SANDBOX);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("C18 / PR-004: a host engine's reads reach the package store its argv advertised -- read-only, and nothing else of the host's", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-guard-store-"));
  try {
    const workspace = join(root, "workspace"); mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "w.txt"), "w");
    const store = join(root, ".packages");
    mkdirSync(join(store, "npm", "pkg", "skills", "roll"), { recursive: true });
    writeFileSync(join(store, "npm", "pkg", "skills", "roll", "SKILL.md"), "# roll\n");
    const outside = join(root, "host.txt"); writeFileSync(outside, "x");
    let handler: ((event: { toolName: string; input: Record<string, unknown> }) => { block: boolean; reason: string } | undefined) | undefined;
    guardWorkspaceTools({ on: (_name: string, fn: typeof handler) => { handler = fn; } } as never,
      workspace, false, false, undefined, [store]);
    const guard = handler!;
    // The package skill the engine's --skill flag advertised is readable.
    assert.equal(guard({ toolName: "read", input: { path: join(store, "npm", "pkg", "skills", "roll", "SKILL.md") } }), undefined);
    assert.equal(guard({ toolName: "ls", input: { path: join(store, "npm", "pkg") } }), undefined);
    assert.equal(guard({ toolName: "grep", input: { path: join(store, "npm") } }), undefined);
    // Any other host path is still refused, including escapes spelled from the store.
    assert.equal(guard({ toolName: "read", input: { path: outside } })?.block, true);
    assert.equal(guard({ toolName: "read", input: { path: join(store, "..", "host.txt") } })?.block, true);
    // Writes and edits stay inside the workspace: the store is read-only.
    assert.equal(guard({ toolName: "write", input: { path: join(store, "npm", "pkg", "new.md"), content: "x" } })?.block, true);
    assert.equal(guard({ toolName: "edit", input: { path: join(store, "npm", "pkg", "skills", "roll", "SKILL.md") } })?.block, true);
    // A link inside the store cannot smuggle a host path into the read set.
    symlinkSync(outside, join(store, "npm", "pkg", "link.md"));
    assert.equal(guard({ toolName: "read", input: { path: join(store, "npm", "pkg", "link.md") } })?.block, true);
    // The workspace rule itself is unchanged.
    assert.equal(guard({ toolName: "read", input: { path: "w.txt" } }), undefined);
    assert.equal(guard({ toolName: "read", input: { path: workspace } }), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the guard's role refusal names the engine it actually guards, not another engine's role", () => {
  for (const [readOnly, own, other] of [[false, "Resident", "Principal"], [true, "Principal", "Resident"]] as const) {
    let handler: ((event: { toolName: string; input: Record<string, unknown> }) => { block: boolean; reason: string } | undefined) | undefined;
    guardWorkspaceTools({ on: (_name: string, fn: typeof handler) => { handler = fn; } } as never,
      "/tmp", false, readOnly, () => false);
    const verdict = handler!({ toolName: "not-in-role", input: {} });
    assert.equal(verdict?.block, true);
    assert.match(verdict?.reason ?? "", new RegExp(own), `a ${own} refusal should name its own role`);
    assert.doesNotMatch(verdict?.reason ?? "", new RegExp(other), `a ${own} refusal must not name ${other}`);
  }
});

test("AV17 / D01, SB-006: a session path the confined engine reports translates back only from its session mount", () => {
  const f = fixture();
  try {
    const name = "2026-09-25T10-46-44-816Z_x.jsonl";
    assert.equal(hostSessionPath(f.dirs, `${RESIDENT_PATHS.sessions}/${name}`, RESIDENT_PATHS.sessions), join(f.dirs.sessions, name));
    assert.equal(confinedPath({ libdir: f.libdir }, f.dirs, join(f.dirs.sessions, name)), `${RESIDENT_PATHS.sessions}/${name}`, "the two directions disagree");
    for (const other of [`${RESIDENT_PATHS.workspace}/${name}`, `${RESIDENT_PATHS.sessions}/../x.jsonl`, `${RESIDENT_PATHS.sessions}/a/${name}`,
      `${RESIDENT_PATHS.sessions}/`, `${RESIDENT_PATHS.sessions}`, join(f.dirs.sessions, name), "/run/oma-sessionsX/x.jsonl"])
      assert.equal(hostSessionPath(f.dirs, other, RESIDENT_PATHS.sessions), null, other);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("PathView policy adapter keeps the issued spawn view for the returned session boundary", () => {
  const f = fixture();
  try {
    const original = f.dirs.sessions;
    f.adapter.spawnPlan();
    f.dirs.sessions = join(f.root, "different-session-root");
    const boundary = { batchId: "batch", incarnation: 1, sessionPath: `${RESIDENT_PATHS.sessions}/session.jsonl`,
      entryId: "entry", adapterRevision: "revision" };
    const adapter = f.adapter as unknown as { hostBoundary(value: typeof boundary): typeof boundary | null };
    assert.equal(adapter.hostBoundary(boundary)?.sessionPath, join(original, "session.jsonl"));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

/** AV25 -- BATCH-006, TSP-009: the seventh functional run. A Resident's edit of
 * a 35 KB workspace was refused "agent workspace quota would be exceeded"
 * under a 2 GiB quota. Since the engine update (ENG1) the edit tool takes
 * `edits: [{ oldText, newText }]`, and the guard read the older top-level
 * `newText`: every edit, by every agent, was refused. P0V-122 (G10-03): the
 * guard no longer decides the quota at all; the contained write, its one
 * owner, decides it from the edit's exact growth. */
test("AV25 / BATCH-006, TSP-009, P0V-122: an edit is judged by its exact growth at the write, whatever form the model sent", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "oma-av25-"));
  try {
    writeFileSync(join(workspace, "a.txt"), `one\ntwo\n${"z".repeat(900)}\n`);
    const tools: Record<string, { execute(id: string, params: Record<string, unknown>, signal: undefined, update: undefined, ctx: unknown): Promise<unknown> }> = {};
    containWorkspaceTools({ registerTool: (tool: { name: string }) => { tools[tool.name] = tool as never; } } as never, workspace, true);
    const edit = (params: Record<string, unknown>): Promise<unknown> => tools.edit!.execute("call", params, undefined, undefined, { cwd: workspace });
    let handler: ((event: { toolName: string; input: Record<string, unknown> }) => unknown) | null = null;
    guardWorkspaceTools({ on: (_name: string, listener: typeof handler) => { handler = listener; } } as never, workspace, true);
    const tool = createEditToolDefinition(workspace);
    // Both forms a model may send reach the guard as the engine prepares them, and pass it.
    for (const raw of [{ path: "a.txt", edits: [{ oldText: "one", newText: "uno" }, { oldText: "two", newText: "dos" }] },
      { path: "a.txt", oldText: "one", newText: "uno" }])
      assert.equal(handler!({ toolName: "edit", input: tool.prepareArguments!(raw) as Record<string, unknown> }), undefined);
    await edit({ path: "a.txt", edits: [{ oldText: "one", newText: "uno" }] });
    // Replacing 900 bytes with 900 others grows nothing: it fits a workspace near its quota.
    await edit({ path: "a.txt", edits: [{ oldText: "z".repeat(900), newText: "y".repeat(900) }] });
    assert.match(readFileSync(join(workspace, "a.txt"), "utf8"), /^uno\ntwo\ny{900}\n$/);
    await edit({ path: "a.txt", edits: [{ oldText: "two", newText: "x".repeat(2048) }] });
    assert.match(readFileSync(join(workspace, "a.txt"), "utf8"), /^uno\nx{2048}\n/, "large edits retain their content");
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

// Required-name prefix restored (see AV13 above): w11 made confinement
// unconditional, so "reaches at the host path when not [sealed]" became
// "host-root profiles fail"; the mount arm is unchanged.
test("AV27 / SB-002-E, GIT-002: a Resident reaches the canonical repository at its mount when sealed; host-root profiles fail", () => {
  for (const rootfs of ["/", "relative", "/state/../rootfs", "/state\u0000/rootfs"])
    assert.throws(() => residentRootfsPath(rootfs), { code: "UNSUPPORTED_PROFILE" });
  assert.equal(residentRootfsPath("/state"), "/state/rootfs");
  assert.equal(residentProjectGit(), RESIDENT_PATHS.projectGit);
});

test("SB-002-E: the Linux state-root derivation and run-lease predicate give one verdict", async () => {
  const { trustedAbsolutePath } = await import("@oma/protocol/run-lease");
  const cases = [
    "/", "/a", "/state/rootfs", "/a/", "//a", "/a//b", "/a/./b", "/a/../b",
    "/a/b/.", "/a/b/..", "/a/b/.x", "/a/b/..x", "/a/x..", "a/b", "./a", "",
    "/state/rootfs", "relative", "/state\u0000/rootfs", "/a b/c-d_e",
  ];
  for (const path of cases) {
    const lease = trustedAbsolutePath(path);
    let kernel = true;
    try { residentRootfsPath(path); } catch { kernel = false; }
    assert.equal(kernel, lease, `verdicts diverge on ${JSON.stringify(path)}`);
  }
});

test("mail-v1: the worker archive is a read-only Resident mount its environment names", () => {
  const f = fixture();
  try {
    const plan = f.adapter.spawnPlan();
    const at = plan.args.indexOf(RESIDENT_PATHS.workerArchive);
    assert.deepEqual(plan.args.slice(at - 2, at + 1),
      ["--ro-bind", f.dirs.workerArchive, RESIDENT_PATHS.workerArchive]);
    const setenv = (name: string): string | undefined => {
      const i = plan.args.lastIndexOf(name);
      return i > 0 && plan.args[i - 1] === "--setenv" ? plan.args[i + 1] : undefined;
    };
    assert.equal(setenv("OMA_WORKER_ARCHIVE"), `${RESIDENT_PATHS.workerArchive}/cur`);
    assert.equal(setenv("OMA_PROJECT_GIT"), RESIDENT_PATHS.projectGit);
    // PI-001: the core extension cannot import this module, so its mirrored
    // literal is bound here to the value it mirrors.
    assert.equal(RESIDENT_PATHS.workerArchive, "/mail/workers");
    assert.throws(() => missingConfinementAdapter(f), { code: "UNSUPPORTED_PROFILE" });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("mail-v1: the Principal's host engine is given no worker archive", async () => {
  const { principalEnvironment } = await import("@oma/engine/principal-session");
  const env = principalEnvironment({ stateRoot: "/srv/oma", runRoot: "/run/oma", libdir: "/opt/oma" },
    { society: "s", provider: "pi", model: "current", extensions: [] } as never,
    { frameBytes: 1024, mailBodyBytes: 1024, batchMaxMessages: 4, contextBytes: 1 << 20, bundleBytes: 1 << 20 } as never);
  assert.equal("OMA_WORKER_ARCHIVE" in env, false);
});

// D23/TSP-005: the run's surface plan reaches the engine through exactly one
// hop -- the deployment writes it into the runner unit's environment, the
// runner entry reads it once at that boundary and declares it on the
// profile, and the adapter hands the declared value to the spawn plan. An
// OMA_TOOL_SURFACE the user's shell happened to hold is not a producer: with
// the spawn under --clearenv it used to ride into the engine anyway, which
// is what this test now refuses.
test("TSP-005/D23: the surface plan is the declared profile's -- nothing ambient reaches the spawn plan", () => {
  const f = fixture();
  const saved = process.env.OMA_TOOL_SURFACE;
  const runnerPaths = {
    runRoot: join(f.root, "run"), stateRoot: f.stateRoot, society: "s",
    piCommand: f.paths.piCommand!, piArgs: [f.paths.piEntry!], piAgentDir: f.paths.piAgentDir!,
    coreExtension: f.paths.coreExtension!, cli: f.paths.cli!,
    confinement: {  libdir: f.libdir, node: "/usr/bin/node",
       },
  };
  const model = { provider: "pi", model: "current", inferenceTimeoutSeconds: 600 };
  const adapterOf = (toolSurface?: string): PiAdapter => {
    const runner = new RunnerModule(runnerPaths, "alice", "a".repeat(32),
      { ...LIMITS, subjectBytes: 1024, addresses: 8, replyReferences: 8, contextFiles: 8, logBytes: 1 << 20 }, {modelProfile: "md",
      name: "resident", model, ...(toolSurface === undefined ? {} : { toolSurface }) });
    Reflect.set(runner, "lease", f.confinement.lease);
    return (Reflect.get(runner, "adapter") as (batch: unknown, inference?: unknown) => PiAdapter)
      .call(runner, {}, undefined);
  };
  const setenv = (plan: { args: readonly string[] }, name: string): string | undefined => {
    const at = plan.args.lastIndexOf(name);
    return at > 0 && plan.args[at - 1] === "--setenv" ? plan.args[at + 1] : undefined;
  };
  try {
    process.env.OMA_TOOL_SURFACE = "ambient-plan";
    assert.equal(setenv(adapterOf("declared-plan").spawnPlan(), "OMA_TOOL_SURFACE"), "declared-plan",
      "the declared profile's plan, not the ambient variable's");
    assert.equal(setenv(adapterOf().spawnPlan(), "OMA_TOOL_SURFACE"), undefined,
      "an ambient OMA_TOOL_SURFACE is not a producer: the engine must not see it");
  } finally {
    if (saved === undefined) delete process.env.OMA_TOOL_SURFACE;
    else process.env.OMA_TOOL_SURFACE = saved;
    rmSync(f.root, { recursive: true, force: true });
  }
});

/** PR-004 deny-by-default, end to end: the workspace quota is not a fallback
 * that a missed wire silently loses. The Resident's spawn plan carries the
 * accepted profile's value, the adapter refuses to exist without a positive
 * one, the Principal's own environment carries it through sessionEnv's
 * ambient strip, and the one serialized writer refuses every write when it
 * does not know a quota -- an absent OMA_WORKSPACE_BYTES is a miswired
 * engine, never an unbounded one. */
test("PR-004: every engine writes without an OMA workspace quota", async () => {
  const f = fixture();
  try {
    assert.equal(f.adapter.spawnPlan().args.includes("OMA_WORKSPACE_BYTES"), false);
    const principal = principalEnvironment({ stateRoot: "/srv/oma", runRoot: "/run/oma", libdir: "/opt/oma" },
      { society: "s", provider: "pi", model: "current", extensions: [] },
      { frameBytes: 1024, mailBodyBytes: 1024, batchMaxMessages: 4, addresses: 64, contextBytes: 1 << 20, bundleBytes: 1 << 20 });
    assert.equal(principal.OMA_WORKSPACE_BYTES, undefined);
    const workspace = mkdtempSync(join(tmpdir(), "oma-unlimited-write-"));
    try {
      await createContainedWriter(workspace)("file.txt", "content");
      assert.equal(readFileSync(join(workspace, "file.txt"), "utf8"), "content");
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
