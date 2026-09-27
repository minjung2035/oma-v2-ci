/** SB-001..006: what a Resident's engine is actually started with.
 *
 * The mount plan used to exist without a caller, so nothing checked that the
 * paths the engine is told about are the paths it can reach. These tests read
 * the plan the adapter will spawn and hold it against the mount table.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAdapter } from "../src/runtime/pi-adapter.js";
import { TOOL_SCOPE_ENV, TOOL_SCOPE_SANDBOX, type PiConfinement } from "../src/runtime/pi-spawn-plan.js";
import { TOOL_SCOPE_ENV as MIRRORED_ENV, TOOL_SCOPE_SANDBOX as MIRRORED_SANDBOX, guardWorkspaceTools } from "../src/extension/workspace-guard.js";
import { RESIDENT_INFERENCE_PORT, RESIDENT_PATHS, confinedPath, hostSessionPath, residentArgv, residentProjectGit, residentsConfined, type ResidentDirectories } from "../src/sandbox.js";
import { decodeRunLease } from "../src/protocol/run-lease.js";
import { actorSocketPathAt, agentRootPathAt, runnerSessionDirPathAt, runnerViewPathAt, workspacePathAt } from "../src/storage/paths.js";
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";

const RESOURCES = Object.freeze({
  memoryBytes: 1 << 30, tasks: 64, cpuQuotaPercent: 100,
  tmpBytes: 1 << 20, workspaceBytes: 1 << 20, stagingBytes: 1 << 20, checkTimeoutSeconds: 30,
});
const LIMITS = Object.freeze({
  frameBytes: 65536, idleStreamSeconds: 30, receiptWaitSeconds: 30,
  batchMaxMessages: 24, mailBodyBytes: 4096, contextBytes: 1 << 20, bundleBytes: 1 << 20,
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
    archive: join(stateRoot, "mail", "archive"),
    selfMail: join(stateRoot, "mail", "inboxes", actor),
    view: runnerViewPathAt(stateRoot, actor),
    world: join(stateRoot, "world"),
    projectGit: join(stateRoot, "repos", "project.git"),
    sessions: runnerSessionDirPathAt(stateRoot, actor),
  };
  for (const path of Object.values(dirs)) mkdirSync(path, { recursive: true });
  mkdirSync(join(dirs.archive, "cur"), { recursive: true });
  mkdirSync(join(libdir, "dist", "src"), { recursive: true });
  mkdirSync(join(libdir, "engine"), { recursive: true });
  mkdirSync(join(runRoot, "actors", actor, "1"), { recursive: true });
  const paths = Object.freeze({
    piCommand: process.execPath,
    piEntry: join(libdir, "engine", "cli.js"),
    coreExtension: join(libdir, "dist", "src", "pi-extension.js"),
    cli: join(libdir, "dist", "src", "cli.js"),
    piAgentDir: join(stateRoot, "pi"),
    mailArchive: join(dirs.archive, "cur"),
    socket: actorSocketPathAt(runRoot, actor, 1),
  });
  for (const file of [paths.piEntry, paths.coreExtension, paths.cli]) writeFileSync(file, "export {};\n");
  const lease = decodeRunLease({ actor, incarnation: 1, socketHostPath: paths.socket }, { actor, runRoot });
  const confinement: PiConfinement = {
    host: {
      rootfs: join(root, "rootfs"), libdir, node: "/usr/bin/node",
      pi: confinedPath(libdir, dirs, paths.piEntry), piModeArgs: [],
      tmpBytes: RESOURCES.tmpBytes, checkResources: RESOURCES,
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
    mailArchive: paths.mailArchive, batchView: dirs.view, socket: paths.socket,
  };
  const profile = {
    provider: "pi", model: "current", turnSeconds: 600, prompt: "",
    workspaceBytes: RESOURCES.workspaceBytes, extensions: [],
  };
  const adapter = new PiAdapter({
    actor, society: "s", limits: LIMITS, profile, paths: adapterPaths, confinement,
  });
  return { root, stateRoot, libdir, dirs, adapter, confinement, paths };
}

function unconfinedAdapter(f: Fixture): PiAdapter {
  return new PiAdapter({
    actor: "alice", society: "s", limits: LIMITS,
    profile: {
      provider: "pi", model: "current", turnSeconds: 600, prompt: "",
      workspaceBytes: RESOURCES.workspaceBytes, extensions: [],
    },
    paths: {
      piCommand: f.paths.piCommand!, piArgs: [f.paths.piEntry!], piAgentDir: f.paths.piAgentDir!,
      coreExtension: f.paths.coreExtension!, cli: f.paths.cli!,
      workspace: f.dirs.workspace, sessionDir: f.dirs.sessions, agentHome: f.dirs.home,
      mailArchive: f.paths.mailArchive!, batchView: f.dirs.view, socket: f.paths.socket!,
    },
  });
}

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

test("T113 the confined engine reaches a provider through the relay, not the network", () => {
  const f = fixture();
  try {
    const plan = f.adapter.spawnPlan();
    // INF-006: the namespace stays unshared. The only provider path is the
    // bind-mounted relay socket, which the core extension bridges to loopback.
    assert.ok(plan.args.includes("--unshare-all"));
    assert.equal(plan.args.some(value => value.startsWith("--share-net")), false);
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
    // The confined engine has no settings, so the host names the model.
    const engineArgs = plan.args.slice(plan.args.lastIndexOf("--") + 1);
    assert.equal(engineArgs[engineArgs.indexOf("--model") + 1], "anthropic/claude-test");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("T113 the engine's credential directory is never mounted into a Resident", () => {
  const f = fixture();
  try {
    const plan = f.adapter.spawnPlan();
    // PR-004: provider credentials must not reach a model-facing sandbox. The
    // agent directory holds them, so neither the variable naming it nor the
    // directory itself may appear anywhere in the plan.
    assert.equal(plan.args.includes("PI_CODING_AGENT_DIR"), false);
    assert.equal(plan.args.some(value => value.includes(f.paths.piAgentDir!)), false);
    // The unconfined adapter does pass it, so the absence above is the
    // confinement's doing and not a variable that stopped being set at all.
    assert.equal(unconfinedAdapter(f).spawnPlan().env.PI_CODING_AGENT_DIR, f.paths.piAgentDir);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("T113 an unconfined adapter is unchanged and still speaks host paths", () => {
  const f = fixture();
  try {
    const plan = unconfinedAdapter(f).spawnPlan();
    assert.equal(plan.command, f.paths.piCommand);
    assert.equal(plan.args[0], f.paths.piEntry);
    assert.equal(plan.env.OMA_CLI_PATH, f.paths.cli);
    assert.equal(plan.env.OMA_AGENT_HOME, f.dirs.home);
    assert.ok(plan.args.includes(f.dirs.sessions));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("T113 a file outside every mount is refused rather than handed over", () => {
  const f = fixture();
  try {
    // A role extension the operator placed outside the installation would be
    // verified on the host and then be missing inside; refusing is the only
    // answer that does not look like a working configuration.
    assert.throws(() => confinedPath(f.libdir, f.dirs, "/etc/shadow"),
      (error: unknown) => (error as { code?: string }).code === "AUTH_FAILED");
    // Prefix matching must not treat a sibling directory as contained.
    assert.throws(() => confinedPath(f.libdir, f.dirs, `${f.libdir}-other/x.js`),
      (error: unknown) => (error as { code?: string }).code === "AUTH_FAILED");
    assert.equal(confinedPath(f.libdir, f.dirs, join(f.libdir, "a", "b.js")), `${RESIDENT_PATHS.libdir}/a/b.js`);
    // The installation path `oma` records ends in a separator; it must still match.
    assert.equal(confinedPath(`${f.libdir}/`, f.dirs, join(f.libdir, "a", "b.js")), `${RESIDENT_PATHS.libdir}/a/b.js`);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("T113 a hostile environment entry cannot become extra bwrap arguments", () => {
  const f = fixture();
  try {
    const { host, lease, directories } = f.confinement;
    for (const bad of [{ "OMA X": "v" }, { "--bind": "v" }, { OMA_A: `v${NUL}--bind` }])
      assert.throws(() => residentArgv(host, lease, directories, bad),
        (error: unknown) => (error as { code?: string }).code === "UNSUPPORTED_PROFILE", JSON.stringify(bad));
    // A caller cannot rename the actor: the builder's own entries come last and
    // bwrap keeps the last value for a repeated name.
    const argv = residentArgv(host, lease, directories, { OMA_ACTOR: "mallory" });
    assert.equal(argv[argv.lastIndexOf("OMA_ACTOR") + 1], "alice");
    assert.ok(argv.lastIndexOf("OMA_ACTOR") > argv.indexOf("mallory"));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("AV13 / SB-001, arch §11.1, CLI-001: a confined Resident has its sandbox's shell; an engine outside a sandbox does not", () => {
  const f = fixture();
  try {
    const confined = f.adapter.spawnPlan();
    const engine = confined.args.slice(confined.args.lastIndexOf("--") + 1);
    assert.equal(engine.includes("--exclude-tools"), false, "the confined Resident cannot run the commands its START names");
    assert.ok(confined.args.includes(`${TOOL_SCOPE_ENV}=${TOOL_SCOPE_SANDBOX}`) ||
      confined.args.some((arg, i) => arg === "--setenv" && confined.args[i + 1] === TOOL_SCOPE_ENV && confined.args[i + 2] === TOOL_SCOPE_SANDBOX),
      "the confined engine was not told it runs in the sandbox");
    const host = unconfinedAdapter(f).spawnPlan();
    assert.equal(host.args[host.args.indexOf("--exclude-tools") + 1], "bash,powershell", "an unsealed engine got a host shell");
    assert.equal(host.env[TOOL_SCOPE_ENV], undefined);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("AV13 / TSP-009, PR-004: inside the sandbox the guard leaves the shell and reading to the mount plan; writes stay in the workspace", () => {
  const f = fixture();
  try {
    type Guard = (event: { toolName: string; input: Record<string, unknown> }) => { block: boolean; reason: string } | undefined;
    const guard = (sandboxed: boolean): Guard => {
      let handler: Guard | undefined;
      guardWorkspaceTools({ on: (_name: string, fn: Guard) => { handler = fn; } } as never, f.dirs.workspace, 1 << 20, sandboxed);
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

test("AV17 / D01, SB-006: a session path the confined engine reports translates back only from its session mount", () => {
  const f = fixture();
  try {
    const name = "2026-09-25T10-46-44-816Z_x.jsonl";
    assert.equal(hostSessionPath(f.dirs, `${RESIDENT_PATHS.sessions}/${name}`), join(f.dirs.sessions, name));
    assert.equal(confinedPath(f.libdir, f.dirs, join(f.dirs.sessions, name)), `${RESIDENT_PATHS.sessions}/${name}`, "the two directions disagree");
    for (const other of [`${RESIDENT_PATHS.workspace}/${name}`, `${RESIDENT_PATHS.sessions}/../x.jsonl`, `${RESIDENT_PATHS.sessions}/a/${name}`,
      `${RESIDENT_PATHS.sessions}/`, `${RESIDENT_PATHS.sessions}`, join(f.dirs.sessions, name), "/run/oma-sessionsX/x.jsonl"])
      assert.equal(hostSessionPath(f.dirs, other), null, other);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

/** AV25 -- BATCH-006, TSP-009: the seventh functional run. A Resident's edit of
 * a 35 KB workspace was refused "agent workspace quota would be exceeded"
 * under a 2 GiB quota. Since the engine update (ENG1) the edit tool takes
 * `edits: [{ oldText, newText }]`, and the guard read the older top-level
 * `newText`: every edit, by every agent, was refused. The guard is bound here
 * to the input the pinned engine's own edit tool hands a tool_call handler. */
test("AV25 / BATCH-006, TSP-009: the guard reads the edit input the pinned engine hands it", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "oma-av25-"));
  try {
    writeFileSync(join(workspace, "a.txt"), "one\ntwo\n");
    const tool = createEditToolDefinition(workspace);
    let handler: ((event: { toolName: string; input: Record<string, unknown> }) => unknown) | null = null;
    guardWorkspaceTools({ on: (_name: string, listener: typeof handler) => { handler = listener; } } as never, workspace, 1024, true);
    // Both forms a model may send reach a handler as the engine prepares them.
    for (const raw of [{ path: "a.txt", edits: [{ oldText: "one", newText: "uno" }, { oldText: "two", newText: "dos" }] },
      { path: "a.txt", oldText: "one", newText: "uno" }]) {
      const input = tool.prepareArguments!(raw) as Record<string, unknown>;
      assert.equal(handler!({ toolName: "edit", input }), undefined, `a small edit was refused: ${JSON.stringify(input)}`);
    }
    const large = tool.prepareArguments!({ path: "a.txt", edits: [{ oldText: "one", newText: "x".repeat(2048) }] }) as Record<string, unknown>;
    assert.deepEqual(handler!({ toolName: "edit", input: large }), { block: true, reason: "agent workspace quota would be exceeded" });
    // An input the engine would not have validated is refused, not guessed at.
    assert.equal((handler!({ toolName: "edit", input: { path: "a.txt", edits: [] } }) as { block?: boolean }).block, true);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("AV27 / SB-002-E, GIT-002: a Resident reaches the canonical repository at its mount when sealed, at the host path when not", () => {
  assert.equal(residentsConfined("/"), false);
  assert.equal(residentsConfined("/state/rootfs"), true);
  assert.equal(residentProjectGit("/state/rootfs", "/state/repos/project.git"), RESIDENT_PATHS.projectGit);
  assert.equal(residentProjectGit("/", "/state/repos/project.git"), "/state/repos/project.git");
});
