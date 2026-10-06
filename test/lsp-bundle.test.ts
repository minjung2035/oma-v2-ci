/** Bundled pi-lsp (code_intel): the vendored payload is verified
 * byte-for-byte before tools register; the adapter pins OMA's workspace
 * root, keeps upstream's per-call process lifecycle, reports a missing
 * server as unavailable rather than clean, and lets `lsp_fix` reach the
 * filesystem only through OMA's contained writer. */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainedWriter } from "../src/extension/contained-tools.js";
import { registerLspTools, lspChildEnvironment, LSP_TOOL_NAMES, OMA_LSP_CHILD_ENV_ALLOW } from "../src/extension/lsp-tools.js";
import { omaToolNames } from "../src/extension/mail-tools.js";
import { guardWorkspaceTools } from "../src/extension/workspace-guard.js";
import { verifyVendorBundle, vendoredBundleDir, VendorIntegrityError } from "../src/extension/vendor-bundle.js";
import { parseSurfacePlan, registerToolSurface } from "../src/extension/tool-surface.js";
import {
  encodeToolSurfacePlan, encodedPrincipalToolSurface, encodedResidentToolSurface,
  planToolSurface, principalToolSurfaceConfig, residentToolSurfaceConfig,
} from "../src/domain/tool-surface.js";

type Tool = {
  name: string;
  execute(id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, update: undefined, ctx: unknown):
    Promise<{ content: { type: string; text?: string }[]; details?: unknown }>;
};

const FIXTURE_SERVER = fileURLToPath(new URL("../src/extension/vendor/pi-lsp/upstream-tests/fixtures/diagnostics-server.mjs", import.meta.url));
const HOSTILE_SERVER = fileURLToPath(new URL("../../test/fixtures/lsp-hostile-server.mjs", import.meta.url));

function tmp(t: import("node:test").TestContext, prefix = "oma-lsp-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A Pi ExtensionAPI stub: tools and event handlers are recorded, nothing
 * else is modeled. */
function fakePi() {
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, ((...args: never[]) => unknown)[]>();
  const pi = {
    tools,
    handlers,
    registerTool(tool: Tool) { tools.set(tool.name, tool); },
    on(event: string, handler: (...args: never[]) => unknown) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
  };
  return pi as never as import("@earendil-works/pi-coding-agent").ExtensionAPI & typeof pi;
}

const ctxOf = (workspace: string) => ({
  sessionManager: {},
  ui: { setStatus() {} },
  cwd: workspace,
});

/** A pi-lsp.json under a scratch agent dir: one fixture-backed server over
 * the made-up `.tfix` extension, plus one whose command does not exist. */
function agentDirWithConfig(t: import("node:test").TestContext, fixtureScenario: string, extra: Record<string, unknown> = {}): string {
  const dir = join(tmp(t), "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pi-lsp.json"), JSON.stringify({
    servers: {
      fixture: { command: [process.execPath, FIXTURE_SERVER, fixtureScenario, "1"], extensions: [".tfix"], ...extra },
      ghost: { command: ["oma-no-such-lsp-server-binary"], extensions: [".ghost"] },
    },
  }));
  return dir;
}

/** The same world, but the "fixture" server is OMA's hostile fixture --
 * the command override rides the adapter's own env/config channel. */
function agentDirWithHostile(t: import("node:test").TestContext, scenario: string): string {
  return agentDirWithConfig(t, scenario, { command: [process.execPath, HOSTILE_SERVER, scenario, "1"] });
}

function withAgentDir(t: import("node:test").TestContext, dir: string): void {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
}

const textOf = (result: { content: { text?: string }[] }) => result.content.map(part => part.text ?? "").join("");

// ---------------------------------------------------------------------------
// Bundle integrity

test("BL1: the vendored pi-lsp bundle verifies: source tree and the dist copy the adapter loads", () => {
  const source = verifyVendorBundle(fileURLToPath(new URL("../../src/extension/vendor/pi-lsp/", import.meta.url)));
  assert.equal(source.package, "@narumitw/pi-lsp");
  assert.equal(source.version, "0.49.9");
  assert.equal(source.commit, "55d784704cdec1ec1534b59f78f07f139539119e");
  assert.equal(source.files, 48);
  assert.match(source.bundleSha256, /^[0-9a-f]{64}$/);
  const deployed = verifyVendorBundle(vendoredBundleDir("pi-lsp"));
  assert.deepEqual(deployed, source, "the dist copy is the same bundle");
});

test("BL1: bundle verification fails closed on a changed, missing, extra or malformed member", t => {
  const good = fileURLToPath(new URL("../../src/extension/vendor/pi-lsp/", import.meta.url));
  const copy = (label: string): string => {
    const dir = join(tmp(t), label);
    cpSync(good, dir, { recursive: true });
    return dir;
  };
  const fails = (dir: string, reason: RegExp) =>
    assert.throws(() => verifyVendorBundle(dir), (error: unknown) => error instanceof VendorIntegrityError && reason.test(error.message));
  // A changed byte.
  const changed = copy("changed");
  writeFileSync(join(changed, "runtime", "runner.js"), `${readFileSync(join(changed, "runtime", "runner.js"), "utf8")} `);
  fails(changed, /file changed|digest does not cover/);
  // A missing member.
  const missing = copy("missing");
  rmSync(join(missing, "runtime", "lsp-client.js"));
  fails(missing, /file is missing/);
  // An unlisted extra.
  const extra = copy("extra");
  writeFileSync(join(extra, "runtime", "smuggled.js"), "x");
  fails(extra, /unlisted file/);
  // A manifest that does not parse.
  const broken = copy("broken");
  writeFileSync(join(broken, "manifest.json"), "not json");
  fails(broken, /manifest is missing or unreadable/);
  // A manifest whose kind is not the bundle's.
  const rekindled = copy("rekindled");
  const manifest = JSON.parse(readFileSync(join(rekindled, "manifest.json"), "utf8"));
  manifest.kind = "something-else";
  writeFileSync(join(rekindled, "manifest.json"), JSON.stringify(manifest));
  fails(rekindled, /kind/);
});

// ---------------------------------------------------------------------------
// Registration, surface and role boundaries

test("BL1: registerLspTools registers exactly the three code_intel tools and the session lifecycle hooks", async t => {
  const workspace = tmp(t, "oma-lsp-ws-");
  withAgentDir(t, tmp(t, "oma-lsp-agent-"));
  const pi = fakePi();
  await registerLspTools(pi, { workspace, readOnly: false, write: async () => {} });
  assert.deepEqual([...pi.tools.keys()].sort(), [...LSP_TOOL_NAMES].sort());
  assert.ok(pi.handlers.has("session_start") && pi.handlers.has("session_shutdown"));
  // A second registration (extension reload) is idempotent: same names, same hooks.
  const again = fakePi();
  await registerLspTools(again, { workspace, readOnly: false, write: async () => {} });
  assert.deepEqual([...again.tools.keys()].sort(), [...LSP_TOOL_NAMES].sort());
});

test("BL1: a bundle that fails verification registers no tools and refuses the session", async t => {
  const workspace = tmp(t, "oma-lsp-ws-");
  const dir = join(tmp(t), "corrupt");
  cpSync(fileURLToPath(new URL("../src/extension/vendor/pi-lsp/", import.meta.url)), dir, { recursive: true });
  rmSync(join(dir, "runtime", "lsp-client.js"));
  const pi = fakePi();
  // process.exit would end the test process; the refusal is observable as a
  // registered session_start handler and no tools.
  const exits: number[] = [];
  const realExit = process.exit;
  (process as { exit: typeof process.exit }).exit = ((code?: number) => { exits.push(code ?? 0); throw new Error("exit"); }) as never;
  try {
    await registerLspTools(pi, { workspace, readOnly: false, write: async () => {}, bundleDir: dir });
    assert.equal(pi.tools.size, 0, "no tool survives a failed verification");
    const start = pi.handlers.get("session_start")?.[0];
    assert.ok(start, "the refusal is wired to session start");
    assert.throws(() => (start as () => void)(), /exit/);
    assert.deepEqual(exits, [1]);
  } finally {
    (process as { exit: typeof process.exit }).exit = realExit;
  }
});



test("BL1: the declared role surfaces name only tools that exist, and code_intel groups the three", () => {
  // What each engine's registry holds: the builtins its argv keeps, OMA's own
  // tools for the role, and the vendored lsp_* tools. The plan's every named
  // reference must be among them -- the extension refuses startup otherwise.
  const residentRegistered = new Set([
    "read", "bash", "powershell", "edit", "write", "grep", "find", "ls",
    ...omaToolNames(false), ...LSP_TOOL_NAMES,
  ]);
  const resident = planToolSurface(residentToolSurfaceConfig());
  const residentNamed = [...resident.direct, ...resident.disabled, ...resident.grouped];
  for (const name of residentNamed) assert.ok(residentRegistered.has(name), `resident surface names unregistered ${name}`);
  assert.deepEqual(resident.groups.map(group => group.name), ["code_intel"]);
  assert.deepEqual([...resident.groups[0]!.children].sort(), [...LSP_TOOL_NAMES].sort());
  const principalRegistered = new Set([
    "read", "grep", "find", "ls", // host argv excludes bash/powershell/write/edit
    ...omaToolNames(true), ...LSP_TOOL_NAMES,
  ]);
  const principal = planToolSurface(principalToolSurfaceConfig());
  for (const name of [...principal.direct, ...principal.disabled, ...principal.grouped])
    assert.ok(principalRegistered.has(name), `principal surface names unregistered ${name}`);
  // Encoded plans round-trip through the extension-side parser unchanged.
  for (const encoded of [encodedResidentToolSurface(), encodedPrincipalToolSurface()]) {
    const parsed = parseSurfacePlan(encoded);
    assert.equal(parsed.state, "plan");
    if (parsed.state === "plan") assert.equal(encoded, encodeToolSurfacePlan({ version: 1, ...parsed.plan }));
  }
  // The two surfaces are not interchangeable: the resident surface names the
  // worker-only tools, the principal's names the principal-only ones.
  assert.ok(resident.direct.includes("oma_mail_ack") && resident.direct.includes("write"));
  assert.ok(principal.direct.includes("oma_society") && !principal.direct.includes("write"));
});

test("BL1: a surface plan naming a tool the registry lacks refuses startup rather than exposing it", () => {
  const plan = planToolSurface({
    defaultMode: "DIRECT", direct: [], disabled: [],
    groups: [{ name: "code_intel", description: "x", members: [{ tool: "lsp_diagnostics" }, { tool: "lsp_missing" }, { tool: "lsp_status" }] }],
    roots: ["code_intel"],
  });
  const handlers = new Map<string, ((...args: never[]) => unknown)[]>();
  const pi = {
    on(event: string, handler: (...args: never[]) => unknown) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    registerTool() {},
    getAllTools() { return [{ name: "lsp_diagnostics", sourceInfo: { source: "extension", path: "/x" } }]; },
    getActiveTools() { return [] as string[]; },
    setActiveTools() {},
  };
  let fatal: string | null = null;
  const saved = process.env.OMA_TOOL_SURFACE;
  process.env.OMA_TOOL_SURFACE = encodeToolSurfacePlan(plan);
  try {
    registerToolSurface(pi as never, [], { fatal: message => { fatal = message; throw new Error(message); } });
    assert.throws(() => handlers.get("session_start")?.[0]?.(), /lsp_missing/);
    assert.match(fatal ?? "", /unknown tool "lsp_missing"/);
  } finally {
    if (saved === undefined) delete process.env.OMA_TOOL_SURFACE; else process.env.OMA_TOOL_SURFACE = saved;
  }
});

// ---------------------------------------------------------------------------
// Guard: paths[], conditional write, role denial

function guardHook(options: { readOnly?: boolean; sandboxed?: boolean }) {
  let hook: ((event: { toolName: string; input: unknown }) => unknown) | undefined;
  guardWorkspaceTools({ on: (_: string, handler: typeof hook) => { hook = handler; } } as never,
    WORKSPACE, options.sandboxed ?? false, options.readOnly ?? false);
  return hook!;
}
const WORKSPACE = fileURLToPath(new URL("../../", import.meta.url));

test("BL1: guard: lsp_fix is a conditional write -- preview is admitted, write is gated, a read-only role is refused", () => {
  const inside = join(WORKSPACE, "package.json");
  const readOnly = guardHook({ readOnly: true });
  assert.equal(readOnly({ toolName: "lsp_fix", input: { path: inside } }), undefined, "preview is a read");
  const refused = readOnly({ toolName: "lsp_fix", input: { path: inside, write: true } });
  assert.deepEqual(refused, { block: true, reason: "the Principal reviews code but does not write or edit files; publish GOAL through explicit mail intent" });
  const writer = guardHook({});
  assert.equal(writer({ toolName: "lsp_fix", input: { path: inside, write: true } }), undefined, "a resident's write passes the path gate");
});

test("BL1: guard: a path list is gated on every entry, and file_edit members are gated as writes", () => {
  const hook = guardHook({});
  const inside = join(WORKSPACE, "package.json");
  assert.equal(hook({ toolName: "lsp_diagnostics", input: { paths: [inside] } }), undefined);
  const blocked = hook({ toolName: "lsp_diagnostics", input: { paths: [inside, "/etc/passwd"] } });
  assert.deepEqual(blocked, { block: true, reason: "tool path is outside the agent workspace" });
  for (const name of ["replace", "replace_within", "insert"]) {
    assert.deepEqual(hook({ toolName: name, input: { path: "/etc/passwd" } }), { block: true, reason: "tool path is outside the agent workspace" }, name);
  }
  const readOnly = guardHook({ readOnly: true });
  for (const name of ["replace", "replace_within", "insert"])
    assert.deepEqual(readOnly({ toolName: name, input: { path: inside } }), { block: true, reason: "the Principal reviews code but does not write or edit files; publish GOAL through explicit mail intent" }, name);
});

// ---------------------------------------------------------------------------
// Live behavior against the fixture server

async function lspWorld(t: import("node:test").TestContext, scenario: string, readOnly = false, quota = 1024 * 1024) {
  const workspace = tmp(t, "oma-lsp-ws-");
  writeFileSync(join(workspace, "note.tfix"), "hello\n");
  withAgentDir(t, agentDirWithConfig(t, scenario));
  const pi = fakePi();
  const write = createContainedWriter(workspace, quota);
  await registerLspTools(pi, { workspace, readOnly, write });
  return { workspace, tools: pi.tools, run: (name: string, params: Record<string, unknown>, signal?: AbortSignal) =>
    pi.tools.get(name)!.execute("call", params, signal, undefined, ctxOf(workspace)) };
}

async function hostileWorld(t: import("node:test").TestContext, scenario: string, readOnly = false) {
  const workspace = tmp(t, "oma-lsp-ws-");
  writeFileSync(join(workspace, "note.tfix"), "hello\n");
  withAgentDir(t, agentDirWithHostile(t, scenario));
  const pi = fakePi();
  const write = createContainedWriter(workspace, 1024 * 1024);
  await registerLspTools(pi, { workspace, readOnly, write });
  return { workspace, tools: pi.tools, run: (name: string, params: Record<string, unknown>, signal?: AbortSignal) =>
    pi.tools.get(name)!.execute("call", params, signal, undefined, ctxOf(workspace)) };
}

test("BL1: lsp_status reports ready and unavailable servers distinctly; a missing command is never clean", async t => {
  const { tools, run } = await lspWorld(t, "pull-strict-optional-params");
  const result = await run("lsp_status", {});
  const text = textOf(result);
  assert.match(text, /fixture: ready/);
  assert.match(text, /ghost: unavailable/);
  const details = result.details as { servers: { name: string; status: string }[]; summary: { unavailable: number; ready: number } };
  assert.equal(details.servers.find(server => server.name === "ghost")?.status, "unavailable");
  assert.equal(details.servers.find(server => server.name === "fixture")?.status, "ready");
  assert.equal(details.summary.unavailable, 1);
  assert.equal(details.summary.ready, 1);
});

test("BL1: lsp_diagnostics reports a running server's findings; a file the server cleared is clean", async t => {
  const { run } = await lspWorld(t, "pull-strict-optional-params");
  const result = await run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" });
  assert.match(textOf(result), /strict pull diagnostic/);
});

test("BL1: lsp_diagnostics with only missing servers fails as unavailable, not as a clean result", async t => {
  const { workspace, run } = await lspWorld(t, "pull-strict-optional-params");
  writeFileSync(join(workspace, "poc.ghost"), "boo\n");
  await assert.rejects(run("lsp_diagnostics", { paths: ["poc.ghost"], server: ["ghost", "missing-other"] }),
    /unavailable|Unknown LSP server/);
  // Selecting the missing configured server on a file it claims refuses
  // loudly -- the call fails, it never resolves to an empty result.
  await assert.rejects(run("lsp_diagnostics", { paths: ["poc.ghost"], server: "ghost" }),
    error => error instanceof Error && /command not found|unavailable|ENOENT/i.test(error.message));
});

test("BL1: lsp_fix previews by default and writes only through the contained writer", async t => {
  const { workspace, run } = await lspWorld(t, "lifecycle-go");
  const before = readFileSync(join(workspace, "note.tfix"), "utf8");
  const preview = await run("lsp_fix", { path: "note.tfix" });
  assert.equal(readFileSync(join(workspace, "note.tfix"), "utf8"), before, "preview does not write");
  const details = preview.details as { changed: boolean; write: boolean; text?: string; containedWrite?: boolean };
  assert.equal(details.changed, true);
  assert.equal(details.write, false);
  assert.match(details.text ?? "", /\/\/ fixed/);
  const applied = await run("lsp_fix", { path: "note.tfix", write: true });
  const appliedDetails = applied.details as { write: boolean; containedWrite?: boolean };
  assert.equal(appliedDetails.write, true);
  assert.equal(appliedDetails.containedWrite, true, "the write ran through OMA's contained writer");
  assert.equal(readFileSync(join(workspace, "note.tfix"), "utf8"), "// fixed\nhello\n");
});

test("BL1: lsp_fix write is refused for a read-only role before any work runs", async t => {
  const { workspace, run } = await lspWorld(t, "lifecycle-go", true);
  await assert.rejects(run("lsp_fix", { path: "note.tfix", write: true }), /read-only/);
  assert.equal(readFileSync(join(workspace, "note.tfix"), "utf8"), "hello\n", "nothing was written");
});

test("BL1: the contained writer's quota still gates an lsp_fix write", async t => {
  // note.tfix is 6 bytes; the fix grows it to 14 -> growth 8 > quota 5.
  const { workspace, run } = await lspWorld(t, "lifecycle-go", false, 5);
  await assert.rejects(run("lsp_fix", { path: "note.tfix", write: true }), /quota/);
  assert.equal(readFileSync(join(workspace, "note.tfix"), "utf8"), "hello\n");
});

test("BL1: a symlink that escapes the pinned workspace is refused by the vendored realpath wall", async t => {
  const { workspace, run } = await lspWorld(t, "lifecycle-go");
  const outside = join(tmp(t), "outside.tfix");
  writeFileSync(outside, "secret\n");
  symlinkSync(outside, join(workspace, "link.tfix"));
  // The guard already gates the path argument at tool_call; here the
  // realpath wall inside the vendored runtime refuses the resolved target.
  await assert.rejects(run("lsp_diagnostics", { paths: ["link.tfix"], server: "fixture" }),
    /outside workspace root|escapes workspace root|outside the agent workspace/);
  await assert.rejects(run("lsp_fix", { path: "link.tfix", server: "fixture" }),
    /outside workspace root|escapes workspace root|outside the agent workspace/);
  assert.equal(readFileSync(outside, "utf8"), "secret\n", "nothing outside was touched");
});

test("BL1: every lsp_* call runs a fresh server process: no daemon, no reuse", async t => {
  // The child pid rides the wire protocol, not an env channel: the
  // fixture's PI_LSP_TEST_* channels are correctly deny-by-default now,
  // so pid-echo reports process.pid inside the diagnostic and the fix
  // action's title -- the same proof the spawns.log channel gave.
  const { run } = await hostileWorld(t, "pid-echo");
  const first = textOf(await run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }));
  const second = textOf(await run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }));
  const fix = await run("lsp_fix", { path: "note.tfix", server: "fixture" });
  const pids = new Set([
    ...[...first.matchAll(/pid=(\d+)/g)].map(match => match[1]),
    ...[...second.matchAll(/pid=(\d+)/g)].map(match => match[1]),
    ...[...(fix.details as { appliedActions?: { title?: string }[] }).appliedActions ?? []]
      .flatMap(action => [...(action.title ?? "").matchAll(/pid=(\d+)/g)].map(match => match[1])),
  ]);
  assert.equal(pids.size, 3, "three calls, three processes");
});

test("BL1: a hung server's call is cancelled by the caller's abort signal", async t => {
  const { run } = await lspWorld(t, "lifecycle-hang-shutdown");
  const controller = new AbortController();
  const pending = run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }, controller.signal);
  controller.abort();
  await assert.rejects(pending, /abort|aborted/i);
});

/** The test-side restatement of the child env boundary: a charset-clean
 * name (`[A-Za-z0-9_]+` on the raw key -- a name is the `NAME` half of
 * the `NAME=value` the child receives, so the key side can smuggle too),
 * then the exact allowlist names, the one `lc_` prefix, the four proxy
 * names (whose values the source pins to the sandbox's injected
 * loopback), and the scratch-redirected homes. A child env whose keys
 * all satisfy this predicate holds only the sanctioned set -- the
 * deny-by-default oracle. */
const CHILD_SCRATCH_NAMES = new Set(["home", "xdg_cache_home", "xdg_config_home", "xdg_data_home",
  "tmpdir", "temp", "tmp", "userprofile", "appdata", "localappdata"]);
const CHILD_PROXY_NAMES = new Set(["http_proxy", "https_proxy", "all_proxy", "no_proxy"]);
/** The source predicate's name-side gate, restated: a name is the `NAME`
 * half of the `NAME=value` byte string the child receives, so it must be
 * `[A-Za-z0-9_]+` on the RAW key -- folding first would launder a hostile
 * name into the `lc_` prefix (U+212A, the KELVIN SIGN, lowercases to
 * plain `k`). Without it the oracle itself shares the smuggle: it would
 * call `LC_ALL=/etc/evil-locale` sanctioned. */
const CHILD_ENV_KEY_CHARSET = /^[A-Za-z0-9_]+$/;
const sanctionedChildName = (key: string): boolean => {
  if (!CHILD_ENV_KEY_CHARSET.test(key)) return false;
  const lower = key.toLowerCase();
  return OMA_LSP_CHILD_ENV_ALLOW.has(lower) || lower.startsWith("lc_") ||
    CHILD_PROXY_NAMES.has(lower) || CHILD_SCRATCH_NAMES.has(lower);
};

/** Plant every key in `names` (or explicit values) in process.env for
 * the test body, restoring afterwards. */
function plantEnv(t: import("node:test").TestContext, names: readonly string[], value = "probe"): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of names) { saved[key] = process.env[key]; process.env[key] = value; }
  t.after(() => {
    for (const key of Object.keys(saved))
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  });
}

test("BL1: the language-server child env is deny-by-default -- OMA wiring and loader channels are absent, PATH stays", async t => {
  plantEnv(t, ["OMA_SOCKET", "OMA_TOOL_SURFACE", "NODE_OPTIONS"]);
  const env = await lspChildEnvironment({ env: {} } as never);
  assert.equal(env.OMA_SOCKET, undefined, "the broker socket is absent, not emptied");
  assert.equal(env.OMA_TOOL_SURFACE, undefined, "the tool surface is absent, not emptied");
  assert.equal(env.NODE_OPTIONS, undefined, "the OMA preload cannot reach the child");
  assert.ok((env.PATH ?? "").length > 0, "PATH is retained for server lookup");
  for (const key of Object.keys(env))
    assert.ok(sanctionedChildName(key), `${key} is not a sanctioned child name`);
});

test("BL1/F4: deny-by-default -- the whole hostile corpus is stripped from the inherited env AND the adapter env", async t => {
  // The corpus is the union of every survivor class the blind
  // verification found in the denylist (the 84-of-161 probe), the channels
  // each round itself denied, names OMA has never enumerated at all, and
  // hostile-charset names a real process.env can carry. Under
  // deny-by-default the verdict is presence: a denied name must be
  // absent, not emptied -- an empty path-list element still resolves as
  // the current directory to a loader.
  const corpus = [
    // OMA's own wiring and Pi's agent-dir pointers.
    "OMA_SOCKET", "OMA_TOOL_SURFACE", "OMA_BROKER_FD", "OMA_EGRESS_PROXY_SOCKET",
    "OMA_EGRESS_PROXY_PORT", "OMA_INFERENCE_SOCKET", "OMA_ACTOR", "OMA_CPUS",
    "PI_CODING_AGENT_DIR", "PI_OFFLINE", "PI_LSP_CONFIG", "PI_LSP_TEST_LOG", "PI_USER_LSP_COMMAND",
    // Credentials, connection strings, and cloud/database config.
    "DATABASE_URL", "DATABASE_URI", "PGPASSWORD", "PGPASSFILE", "MYSQL_PWD", "MONGO_URI", "REDIS_URL",
    "AWS_SECRET_ACCESS_KEY", "AWS_CONFIG_FILE", "AWS_PROFILE", "AWS_SESSION_TOKEN",
    "AZURE_CLIENT_SECRET", "GCLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS", "CLOUDSDK_CONFIG",
    "GITHUB_TOKEN", "OPENAI_API_KEY", "AUTHTOKEN", "MYAPIKEY", "SECRETKEY", "lowercase_token",
    "npm_config_//registry.npmjs.org/:_authtoken", "npm_config_userconfig", "YARN_NPM_AUTH_TOKEN", "PNPM_HOME",
    // Git plumbing and TLS trust channels.
    "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_EXEC_PATH", "GIT_SSH_COMMAND", "GIT_ASKPASS",
    "GIT_SSL_CAINFO", "GIT_SSL_NO_VERIFY", "GIT_AUTHOR_NAME", "GIT_EDITOR", "GIT_TERMINAL_PROMPT",
    "NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "SSLKEYLOGFILE", "SSL_CERT_FILE", "DENO_CERT",
    // Loader and runtime injection for every toolchain -- the probe's survivors.
    "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT", "LD_DEBUG", "DYLD_INSERT_LIBRARIES", "DYLD_IMAGE_SUFFIX",
    "NODE_OPTIONS", "NODE_PATH", "NODE_REPL_HISTORY",
    "PYTHONPATH", "PYTHONHOME", "PYTHONINSPECT", "PYTHONSTARTUP", "PYTHONBREAKPOINT",
    "PERLLIB", "PERL5LIB", "PERL5OPT", "PERL5DB",
    "GEM_HOME", "GEM_PATH", "RUBYLIB", "RUBYOPT", "BUNDLE_GEMFILE", "BUNDLE_PATH", "BUNDLE_BIN_PATH",
    "CLASSPATH", "JAVA_HOME", "JDK_HOME", "_JAVA_OPTIONS", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS",
    "MAVEN_OPTS", "GRADLE_OPTS", "SBT_OPTS", "ANT_OPTS", "LEIN_JVM_OPTS",
    "DOTNET_ROOT", "NUGET_PACKAGES", "MSBuildExtensionsPath",
    "GOPATH", "GOROOT", "GOBIN", "GOTOOLCHAIN", "GOFLAGS", "GOPROXY", "GOPRIVATE", "GONOSUMDB",
    "GOCACHE", "GOMODCACHE", "GOWORK", "GOENV", "GO111MODULE", "GOSUMDB", "GOAUTH",
    "RUSTC", "RUSTC_WRAPPER", "RUSTFLAGS", "RUSTUP_HOME", "RUSTUP_TOOLCHAIN",
    "CARGO_HOME", "CARGO_NET_GIT_FETCH_WITH_CLI", "CARGO_BUILD_JOBS",
    "VIRTUAL_ENV", "CONDA_PREFIX", "PYENV_ROOT", "NVM_DIR", "VOLTA_HOME", "FNM_DIR", "ASDF_DIR",
    "DENO_DIR", "DENO_TLS_CA_STORE", "BUN_INSTALL", "COREPACK_ENABLE_DOWNLOAD_PROMPT",
    // Compilers and build systems -- a language server shells out to these.
    "CC", "CXX", "AR", "LD", "AS", "NM", "RANLIB", "STRIP",
    "CFLAGS", "CXXFLAGS", "CPPFLAGS", "LDFLAGS", "MAKEFLAGS", "MFLAGS", "MAKE", "MAKELEVEL",
    "CMAKE_PREFIX_PATH", "CMAKE_ARGS", "CMAKE_TOOLCHAIN_FILE",
    "PKG_CONFIG_PATH", "PKG_CONFIG_SYSROOT_DIR", "PKG_CONFIG_LIBDIR",
    "CPATH", "C_INCLUDE_PATH", "CPLUS_INCLUDE_PATH", "LIBRARY_PATH",
    "CONAN_USER_HOME", "CONAN_LOGIN_USERNAME",
    // Package-manager and provisioner config channels.
    "PIP_INDEX_URL", "PIP_EXTRA_INDEX_URL", "PIP_CERT", "PIP_TARGET",
    "POETRY_HTTP_BASIC_PYPI_USERNAME", "POETRY_HTTP_BASIC_PYPI_PASSWORD",
    "NIX_PATH", "NIX_CONFIG", "NIX_SSL_CERT_FILE",
    "ANSIBLE_CONFIG", "ANSIBLE_ROLES_PATH", "TF_CLI_CONFIG_FILE", "TF_WORKSPACE",
    // Session, display, IPC, and agent authority.
    "SSH_AUTH_SOCK", "SSH_AGENT_PID", "SSH_CONNECTION", "GPG_AGENT_INFO", "GNUPGHOME", "KRB5CCNAME",
    "XAUTHORITY", "DISPLAY", "WAYLAND_DISPLAY", "SWAYSOCK", "I3SOCK", "DBUS_SESSION_BUS_ADDRESS",
    "DOCKER_HOST", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "container",
    "KUBECONFIG", "KUBERNETES_SERVICE_HOST", "KUBERNETES_SERVICE_PORT",
    "XDG_RUNTIME_DIR", "XDG_SESSION_ID", "XDG_CONFIG_DIRS", "XDG_DATA_DIRS",
    // Homes and temp locations -- denied outright; the scratch redirect
    // (asserted below) is the only way any of them gets a value.
    "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TMPDIR", "TEMP", "TMP",
    "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "HOMEDRIVE", "HOMEPATH",
    // Shell, pager, and interactive hooks.
    "SHELL", "ENV", "BASH_ENV", "ZDOTDIR", "FPATH", "INPUTRC", "PROMPT_COMMAND", "PS1", "PS2",
    "CDPATH", "IFS", "GLOBIGNORE", "SHELLOPTS", "BASHOPTS", "BASH_VERSION",
    "EDITOR", "VISUAL", "PAGER", "BROWSER", "MANPAGER", "SYSTEMD_PAGER",
    "LESSOPEN", "LESSCLOSE", "LESSSECURE", "LESS", "MANPATH", "INFOPATH",
    "MAIL", "MAILPATH", "MAILRC", "PWD", "OLDPWD", "SHLVL", "TMUX", "STY", "WINDOW", "HISTFILE",
    // Resolver and name-service channels.
    "HOSTALIASES", "RES_OPTIONS", "LOCALDOMAIN", "NSS_WRAPPER_PASSWD", "GSS_KRB5CCNAME",
    // Proxies -- the egress wiring is removed below, so every proxy var
    // is denied regardless of its value.
    "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy",
    "NO_PROXY", "no_proxy", "FTP_PROXY", "SOCKS_PROXY", "WS_PROXY", "proxy",
    // Platform, distro, and subsystem channels.
    "SNAP", "SNAP_NAME", "FLATPAK_ID", "WSLENV", "WSL_DISTRO_NAME", "MSYSTEM", "MSYS2_PATH_TYPE", "CYGWIN",
    "HOMEBREW_PREFIX", "HOMEBREW_CELLAR", "__CF_USER_TEXT_ENCODING", "XPC_SERVICE_NAME", "XPC_FLAGS",
    "GIO_LAUNCHED_DESKTOP_FILE", "GTK_THEME", "QT_QPA_PLATFORM", "GNOME_DESKTOP_SESSION_ID", "KDE_FULL_SESSION",
    // Names OMA has never enumerated -- deny-by-default is what makes
    // "unlisted" mean "denied".
    "NEVER_ENUMERATED_CHANNEL", "SOME_RANDOM_THING_9", "INJECTION_SURFACE_X", "ZERO_KNOWLEDGE_VAR",
    // Hostile-charset names a real process.env CAN carry: `..` and
    // non-ASCII bytes enumerate fine in environ, and a lowercased prefix
    // match must not launder them -- `LC_ÄLL` folds to `lc_äll`, and
    // U+212A (KELVIN SIGN) folds to plain `k`, so `LC_KETCHUP` becomes
    // `lc_ketchup` under toLowerCase. `=` and NUL are NOT here: an
    // environ entry IS `name=value` C string, so those names cannot be
    // planted -- they arrive only through an adapter's declared env and
    // live in hostileKeys below.
    "LC_..EVIL", "..", "LC_ÄLL", "LC_KETCHUP",
  ];
  plantEnv(t, corpus);
  // No egress wiring in this test: every proxy var is denied even when
  // its value looks like the sandbox's loopback.
  const egressSaved = { socket: process.env.OMA_EGRESS_PROXY_SOCKET, port: process.env.OMA_EGRESS_PROXY_PORT };
  delete process.env.OMA_EGRESS_PROXY_SOCKET;
  delete process.env.OMA_EGRESS_PROXY_PORT;
  t.after(() => {
    for (const [key, value] of [["OMA_EGRESS_PROXY_SOCKET", egressSaved.socket], ["OMA_EGRESS_PROXY_PORT", egressSaved.port]] as const)
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  // The same corpus through the adapter channel: a pi-lsp.json env block
  // goes through the identical predicate, so declaring a channel cannot
  // re-arm it.
  const declared = Object.fromEntries(corpus.map(key => [key, "declared"]));
  const env = await lspChildEnvironment({ env: declared } as never);
  for (const key of corpus)
    assert.equal(env[key], undefined, `${key} reached the child`);
  // Nothing beyond the sanctioned set exists for the child at all --
  // the inherited env contributes only allowlisted names.
  for (const key of Object.keys(env))
    assert.ok(sanctionedChildName(key), `${key} is not a sanctioned child name`);
  // The key side is a channel too: a name is the `NAME` half of the
  // `NAME=value` the child receives, so a key can carry what the value
  // guard never sees. `LC_ALL=/etc/evil-locale` lowercases into the
  // `lc_` prefix and spawn serializes it as `LC_ALL=/etc/evil-locale=C`
  // -- a path-shaped value smuggled through the key, admitted before the
  // charset gate existed. `=` and NUL names cannot be planted: an
  // environ entry IS `name=value` C string, so these arrive only
  // through an adapter's declared env (pi-lsp.json keys may carry
  // either). A forged proxy or scratch name is the same class.
  const hostileKeys = [
    "LC_ALL=/etc/evil-locale",          // the smuggle: path value rides the key
    "LC_MESSAGES=../../etc/evil",       // `=` plus traversal in the key
    "LC_ALL\0EVIL",                     // admitted, a NUL name reaches spawn unhandled
    "LC_ÄLL=/x",                        // unicode and `=` together
    "HOME=/attacker/scratch",           // a scratch-supplied name forged in the key
    "http_proxy=http://corp.example:8080", // the proxy class forged in the key
    "no_proxy=,evil.example",
  ];
  const keyed = await lspChildEnvironment({ env: Object.fromEntries(hostileKeys.map(key => [key, "C"])) } as never);
  for (const key of hostileKeys) {
    assert.equal(keyed[key], undefined, `${JSON.stringify(key)} reached the child through its key`);
    assert.equal(sanctionedChildName(key), false, `${JSON.stringify(key)} satisfies the name oracle`);
  }
  for (const key of Object.keys(keyed))
    assert.ok(sanctionedChildName(key), `${key} is not a sanctioned child name`);
  // The value side of the same class: the path-typed names skip
  // tokenValueAllowed, so a NUL value on PATH would ride through the
  // predicate to spawn unhandled -- admitted before the up-front NUL
  // refusal existed. (A NUL in process.env cannot be planted -- the OS
  // truncates at it -- so this is an adapter-channel case only.)
  const nulled = await lspChildEnvironment({
    env: { PATH: "a\0b", SystemRoot: "C:\\Windows\0", LC_ALL: "C\0.UTF-8" },
  } as never);
  // The NUL-carrying adapter values are denied -- PATH keeps its
  // inherited value (denying the adapter's NUL entry does not erase the
  // legit inherited tier), and names with no inherited value are absent.
  assert.notEqual(nulled.PATH, "a\0b", "the adapter's NUL PATH reached the child");
  assert.equal(nulled.SystemRoot, undefined, "SystemRoot carried a NUL value to the child");
  assert.notEqual(nulled.LC_ALL, "C\0.UTF-8", "a token-typed name already refused NUL values");
});

test("BL1/F4: the allowlisted survivors -- PATH, locale, terminal, identity -- keep their values", async t => {
  plantEnv(t, ["LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "NO_COLOR", "USER", "LOGNAME"]);
  process.env.LANG = "en_US.UTF-8";
  process.env.LANGUAGE = "en_US:en";
  process.env.LC_ALL = "C.UTF-8";
  process.env.LC_CTYPE = "C.UTF-8";
  process.env.TZ = "America/New_York";
  process.env.TERM = "xterm-256color";
  process.env.NO_COLOR = "1";
  process.env.USER = "agent";
  process.env.LOGNAME = "agent";
  const env = await lspChildEnvironment({ env: {} } as never);
  assert.equal(env.LANG, "en_US.UTF-8");
  assert.equal(env.LANGUAGE, "en_US:en");
  assert.equal(env.LC_ALL, "C.UTF-8", "the LC_ prefix is the one prefix the allowlist grants");
  assert.equal(env.LC_CTYPE, "C.UTF-8");
  assert.equal(env.TZ, "America/New_York", "a zone name's slash is not a path channel");
  assert.equal(env.TERM, "xterm-256color");
  assert.equal(env.NO_COLOR, "1");
  assert.equal(env.USER, "agent");
  assert.equal(env.LOGNAME, "agent");
  assert.ok((env.PATH ?? "").length > 0, "PATH is retained");
});

test("BL1/F4: allowlisted names still refuse path-shaped values -- a token channel cannot smuggle a file path", async t => {
  plantEnv(t, ["LC_ALL", "LC_MESSAGES", "LANG", "TERM", "TZ", "USER"]);
  process.env.LC_ALL = "/tmp/evil-locale";           // glibc resolves LC_* values as locale files
  process.env.LC_MESSAGES = "../../etc/evil";        // traversal under the LC_ prefix
  process.env.LANG = "en_US.UTF-8";                  // a real locale name survives
  process.env.TERM = "../../etc/evil-terminfo";      // ncurses resolves TERM under terminfo dirs
  process.env.TZ = "/etc/localtime";                 // an absolute zone file, not a zone name
  process.env.USER = "../escapee";                   // a name that lands in server-built paths
  const env = await lspChildEnvironment({ env: {} } as never);
  assert.equal(env.LC_ALL, undefined, "a locale name carrying a path is denied");
  assert.equal(env.LC_MESSAGES, undefined, "traversal under the LC_ prefix is denied");
  assert.equal(env.TERM, undefined, "terminfo traversal is denied");
  assert.equal(env.TZ, undefined, "an absolute zone file is denied");
  assert.equal(env.USER, undefined, "path traversal under an identity name is denied");
  assert.equal(env.LANG, "en_US.UTF-8");
});

test("BL1/F4: only the Resident sandbox's own loopback proxies reach the child -- pinned byte-for-byte", async t => {
  plantEnv(t, ["OMA_EGRESS_PROXY_SOCKET", "OMA_EGRESS_PROXY_PORT",
    "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "ALL_PROXY", "all_proxy",
    "NO_PROXY", "no_proxy", "SOCKS_PROXY", "FTP_PROXY"]);
  // The spawn plan's own injection: socket + port + the loopback values.
  process.env.OMA_EGRESS_PROXY_SOCKET = "/run/oma/egress.sock";
  process.env.OMA_EGRESS_PROXY_PORT = "8318";
  process.env.HTTP_PROXY = "http://127.0.0.1:8318";
  process.env.http_proxy = "http://127.0.0.1:8318";
  process.env.HTTPS_PROXY = "http://127.0.0.1:8318";
  process.env.ALL_PROXY = "http://127.0.0.1:8318";
  process.env.all_proxy = "http://127.0.0.1:8318";
  process.env.NO_PROXY = "127.0.0.1,localhost,::1";
  process.env.no_proxy = "127.0.0.1,localhost,::1";
  process.env.SOCKS_PROXY = "http://127.0.0.1:8318"; // a proxy name OMA never injects
  process.env.FTP_PROXY = "http://127.0.0.1:8318";   // same value, unsanctioned name
  const env = await lspChildEnvironment({ env: {} } as never);
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:8318", "the injected loopback survives inside the sandbox");
  assert.equal(env.http_proxy, "http://127.0.0.1:8318");
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:8318");
  assert.equal(env.ALL_PROXY, "http://127.0.0.1:8318");
  assert.equal(env.NO_PROXY, "127.0.0.1,localhost,::1");
  assert.equal(env.SOCKS_PROXY, undefined, "a proxy name OMA does not inject is denied");
  assert.equal(env.FTP_PROXY, undefined, "the pinned value does not rescue an unsanctioned name");
  // A foreign value under a sanctioned name cannot reproduce the pin.
  process.env.HTTPS_PROXY = "http://user:pass@proxy.corp:3128";
  const hostile = await lspChildEnvironment({ env: {} } as never);
  assert.equal(hostile.HTTPS_PROXY, undefined, "a credential-carrying proxy value is denied");
  // The key side cannot forge a proxy var either: a name carrying a
  // proxy spelling plus `=value` is not the name -- the charset gate
  // rejects it before the pin comparison is consulted, so a proxy var
  // survives only under a verbatim-sanctioned name AND the pinned value.
  const forged = await lspChildEnvironment({ env: {
    "http_proxy=http://127.0.0.1:8318": "x",  // the pinned value itself inside the key
    "no_proxy=,evil.example": "x",
  } } as never);
  assert.equal(forged["http_proxy=http://127.0.0.1:8318"], undefined,
    "a proxy spelling inside the key is not the name");
  assert.equal(forged["no_proxy=,evil.example"], undefined);
  // What survives under the real name is the inherited pin, not "x" --
  // the forged key smuggled nothing.
  assert.equal(forged.http_proxy, "http://127.0.0.1:8318");
  // Without the egress wiring every proxy var is denied -- a host engine
  // (or an env carrying only part of the wiring) hands no proxy down.
  delete process.env.OMA_EGRESS_PROXY_SOCKET;
  delete process.env.OMA_EGRESS_PROXY_PORT;
  const bare = await lspChildEnvironment({ env: { HTTP_PROXY: "http://127.0.0.1:8318" } } as never);
  assert.equal(bare.HTTP_PROXY, undefined, "no wiring, no proxy -- not even a loopback-looking value");
});

test("BL1/F4: the adapter's declared env goes through the same allowlist -- and cannot outrank the scratch", async t => {
  const env = await lspChildEnvironment({ env: {
    PATH: "/adapter/bin",            // the documented command-lookup override
    LANG: "C.UTF-8",                 // an allowlisted declared extra
    LC_ALL: "C",                     // declared through the LC_ prefix
    GITHUB_TOKEN: "ghp_x",           // off the allowlist -- denied
    NODE_OPTIONS: "--import x",      // a loader channel -- denied
    HOME: "/attacker/home",          // a scratch name -- denied
  } } as never);
  assert.equal(env.PATH, "/adapter/bin", "the adapter's PATH wins command lookup");
  assert.equal(env.LANG, "C.UTF-8");
  assert.equal(env.LC_ALL, "C");
  assert.equal(env.GITHUB_TOKEN, undefined, "a declared credential is denied like an inherited one");
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.HOME, undefined, "no scratch, no HOME -- the name is denied, not empty");
  const scratched = await lspChildEnvironment({ env: { HOME: "/attacker/home", XDG_CACHE_HOME: "/attacker/xdg" } } as never, "/oma-scratch");
  assert.equal(scratched.HOME, "/oma-scratch", "the scratch redirect wins over any declared home");
  assert.equal(scratched.XDG_CACHE_HOME, "/oma-scratch");
  assert.equal(scratched.TMPDIR, "/oma-scratch");
});

// ---------------------------------------------------------------------------
// F1: bounded server->engine data -- overflow is a clean tool error, never a
// crash, never a truncated result passed off as clean.

test("BL1/F1: a stderr flood is bounded -- the failure message stays small", async t => {
  const { run } = await hostileWorld(t, "stderr-flood");
  const error = await run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" })
    .then(() => { throw new Error("the flooded call must fail"); }, (error: unknown) => error as Error);
  assert.match(error.message, /intentional failure after stderr flood/);
  assert.ok(error.message.length < 80_000, `stderr accumulation is capped: ${error.message.length}`);
});

test("BL1/F1: a declared oversized Content-Length is refused before it buffers", async t => {
  const { run } = await hostileWorld(t, "oversized-frame");
  await assert.rejects(run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }),
    /Content-Length|inbound bound|invalid JSON-RPC/i);
});

test("BL1/F1: bytes that never complete a frame are bounded by accumulation", async t => {
  const { run } = await hostileWorld(t, "frame-drip");
  await assert.rejects(run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }),
    /inbound bound|invalid JSON-RPC|aborted|exceeded/i);
});

test("BL1/F1: pushed diagnostics over the count or message bound fail the call", async t => {
  for (const [scenario, pattern] of [
    ["push-flood", /pushed|diagnostics.*bound/i],
    ["push-big-message", /bound|char/i],
  ] as const) {
    const { run } = await hostileWorld(t, scenario);
    await assert.rejects(run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }), pattern, scenario);
  }
});

test("BL1/F1: pull diagnostics over the count or message bound fail the call", async t => {
  for (const [scenario, pattern] of [
    ["pull-flood", /diagnostics.*bound|1024/i],
    ["pull-big-message", /bound|char/i],
  ] as const) {
    const { run } = await hostileWorld(t, scenario);
    await assert.rejects(run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }), pattern, scenario);
  }
});

test("BL1/F1: a code-action flood is refused before the resolve loop starts", async t => {
  const { run } = await hostileWorld(t, "actions-flood");
  await assert.rejects(run("lsp_fix", { path: "note.tfix", server: "fixture" }), /code actions.*256|bound/i);
});

test("BL1/F1: an aggregate per-call deadline bounds a hanging route regardless of its own timeout", async t => {
  const workspace = tmp(t, "oma-lsp-ws-");
  writeFileSync(join(workspace, "note.tfix"), "hello\n");
  withAgentDir(t, agentDirWithConfig(t, "lifecycle-hang-textDocument/diagnostic"));
  const pi = fakePi();
  // The deadline is what must end this -- the per-request timeout stays huge.
  await registerLspTools(pi, { workspace, readOnly: false, write: async () => {}, callDeadlineMs: 300 });
  await assert.rejects(
    pi.tools.get("lsp_diagnostics")!.execute("call", { paths: ["note.tfix"], server: "fixture" }, undefined, undefined, ctxOf(workspace)),
    /aggregate call deadline/);
});

// ---------------------------------------------------------------------------
// F2: a language server is an ambient-authority child. Its home/cache/temp
// variables point at a per-call scratch, and a read-only role never spawns.

test("BL1/F2: the child's HOME/XDG/TMP land in a per-call scratch that is removed afterwards", async t => {
  const { run } = await hostileWorld(t, "env-echo");
  const result = await run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" });
  const text = textOf(result);
  const homes = [...text.matchAll(/(?:HOME|XDG_CACHE_HOME|TMPDIR)=(\S+)/g)].map(match => match[1]!);
  assert.ok(homes.length >= 3, `env echo reports redirected vars: ${text}`);
  for (const dir of homes) {
    assert.match(dir, /oma-lsp-/, `${dir} is an OMA scratch dir`);
    assert.notEqual(dir, process.env.HOME, "the user's real HOME is not handed down");
    assert.equal(existsSync(dir), false, `${dir} is removed when the call ends`);
  }
});

test("BL1/F4: the live child is deny-by-default -- planted channels are absent inside the spawned server", async t => {
  // lspChildEnvironment proves the map; env-probe proves the spawned
  // process: the fixture reports which env names actually arrived. The
  // adapter's own pi-lsp.json env block goes through the same allowlist
  // -- PROBED_ADAPTER is declared here and must still be absent.
  const planted = ["OMA_SOCKET", "OMA_TOOL_SURFACE", "NODE_OPTIONS", "GOPRIVATE",
    "PERLLIB", "RUSTFLAGS", "HTTP_PROXY", "PI_LSP_TEST_LOG", "SSH_AUTH_SOCK", "BASH_ENV"];
  plantEnv(t, planted);
  const workspace = tmp(t, "oma-lsp-ws-");
  writeFileSync(join(workspace, "note.tfix"), "hello\n");
  withAgentDir(t, agentDirWithConfig(t, "env-probe", {
    command: [process.execPath, HOSTILE_SERVER, "env-probe", "1"],
    env: { PROBED_ADAPTER: "yes", LC_ALL: "C" },
  }));
  const pi = fakePi();
  await registerLspTools(pi, { workspace, readOnly: false, write: async () => {} });
  const result = await pi.tools.get("lsp_diagnostics")!.execute("call",
    { paths: ["note.tfix"], server: "fixture" }, undefined, undefined, ctxOf(workspace));
  const text = textOf(result);
  for (const key of planted)
    assert.match(text, new RegExp(`\\b${key}=absent`), `${key} reached the live child`);
  assert.match(text, /PROBED_ADAPTER=absent/, "a pi-lsp.json env block cannot bypass the allowlist");
  assert.match(text, /LC_ALL=present/, "an allowlisted declared extra does reach the child");
  assert.match(text, /PATH=present/);
  assert.match(text, /HOME=present/, "the scratch redirect supplies HOME");
  assert.match(text, /TMPDIR=present/);
});

test("BL1/F2: a read-only role never spawns a language server -- diagnostics and fix refuse, status still works", async t => {
  const { run } = await lspWorld(t, "pull-strict-optional-params", true);
  await assert.rejects(run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }), /read-only role/);
  await assert.rejects(run("lsp_fix", { path: "note.tfix", server: "fixture" }), /read-only role/);
  const status = await run("lsp_status", {});
  assert.match(textOf(status), /configured server/);
});

// ---------------------------------------------------------------------------
// F3: nothing vendored evaluates before verifyVendorBundle has passed.

test("BL1/F3: no compiled extension module statically imports vendored code -- every vendored load sits behind verification", () => {
  // Round 1 scanned lsp-tools.js only; the invariant is the whole compiled
  // extension: any module holding a static vendored edge would evaluate
  // unverified bytes when loaded. Dynamic import() behind verification is
  // the one sanctioned load (the extension-dynamic-load architecture rule
  // enforces the same boundary on sources).
  const extensionDir = fileURLToPath(new URL("../src/extension/", import.meta.url));
  const compiledModules: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "vendor") walk(absolute); }
      else if (entry.name.endsWith(".js")) compiledModules.push(absolute);
    }
  };
  walk(extensionDir);
  assert.ok(compiledModules.length >= 15, `the scan sees the compiled extension modules, got ${compiledModules.length}`);
  for (const file of compiledModules) {
    const name = relative(extensionDir, file);
    const compiled = readFileSync(file, "utf8");
    assert.doesNotMatch(compiled, /^import\s[^;]*["'][^"']*vendor\//m,
      `${name}: a static vendored import would evaluate before verification`);
    assert.doesNotMatch(compiled, /^export\s[^;]*from\s*["'][^"']*vendor\//m,
      `${name}: a vendored re-export would evaluate before verification`);
  }
  // And the dynamic imports are still present -- the runtime loads, just late.
  const adapter = readFileSync(join(extensionDir, "lsp-tools.js"), "utf8");
  assert.match(adapter, /import\(["'][^"']*vendor\/pi-lsp\/runtime\//);
});

// ---------------------------------------------------------------------------
// F5: --check verifies the manifest's own metadata, not just file bytes.

test("BL1/F5: the bundle check refuses a manifest whose metadata drifted from the declared pins", async () => {
  // File bytes and the bundle digest were always compared; round 2 adds the
  // manifest's own words: generated.divergences against the script's
  // OMA_DIVERGENCES and package.* against the pinned upstream identity.
  const specifier = "../../scripts/vendor-pi-lsp.mjs";
  const { manifestMetadataProblems } = await import(specifier) as {
    manifestMetadataProblems: (manifest: { generated?: { divergences?: unknown }; package?: unknown }) => string[];
  };
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../src/extension/vendor/pi-lsp/manifest.json", import.meta.url)), "utf8"));
  assert.deepEqual(manifestMetadataProblems(manifest), [], "the checked-in manifest matches its declared metadata");
  const driftedReason = structuredClone(manifest);
  driftedReason.generated.divergences["runner.js"].reason = "something other than the declared reason";
  assert.match(manifestMetadataProblems(driftedReason).join("\n"), /divergences/, "a divergence-reason edit is caught");
  const droppedDivergence = structuredClone(manifest);
  delete droppedDivergence.generated.divergences["files.js"];
  assert.match(manifestMetadataProblems(droppedDivergence).join("\n"), /divergences/, "a dropped divergence record is caught");
  const driftedCommit = structuredClone(manifest);
  driftedCommit.package.commit = "0".repeat(40);
  assert.match(manifestMetadataProblems(driftedCommit).join("\n"), /package|pinned/, "a commit drift is caught");
  const driftedNpm = structuredClone(manifest);
  driftedNpm.package.npm.integrity = "sha512-forged";
  assert.match(manifestMetadataProblems(driftedNpm).join("\n"), /package|pinned/, "an npm integrity drift is caught");
});
