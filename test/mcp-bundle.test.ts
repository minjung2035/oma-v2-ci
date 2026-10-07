/** Bundled pi-mcp-adapter (the `mcp` proxy tool): the vendored payload is
 * verified byte-for-byte before any vendored module evaluates; the adapter
 * drives upstream's own createMcpAdapter factory through a facade that
 * admits exactly `mcp`; the config is OMA-owned and validated; the
 * child-env scrub, egress pin, credential store and scratch lifecycle are
 * OMA's; and Pi's built-in MCP can never coexist. */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, Server } from "node:net";
import { once } from "node:events";
import {
  MCP_CONFIG_FILE_NAME, MCP_STATE_DIR_NAME, MCP_TOOL_NAMES,
  mcpChildEnvironment, mcpFacadeDropped, normalizeOmaMcpConfig, registerMcpTools,
} from "../src/extension/mcp-tools.js";
import { admittedChildEnv, CHILD_ENV_SCRATCH_NAMES } from "../src/extension/child-env.js";
import { omaToolNames } from "../src/extension/mail-tools.js";
import { verifyVendorBundle, vendoredBundleDir, VendorIntegrityError } from "../src/extension/vendor-bundle.js";
import {
  ASK_USER_QUESTION_TOOL_NAME, MCP_PROXY_TOOL_NAME,
  planToolSurface, principalToolSurfaceConfig, residentToolSurfaceConfig,
} from "../src/domain/tool-surface.js";

const SRC_BUNDLE = fileURLToPath(new URL("../src/extension/vendor/pi-mcp-adapter/", import.meta.url));
/** The runtime modules the adapter itself loads: the deployed copy
 * (vendoredBundleDir), NOT the source tree -- importing the source copy
 * would evaluate a second module instance whose policy state the
 * adapter's install never reaches. */
const SRC_RUNTIME = (name: string) => join(vendoredBundleDir("pi-mcp-adapter"), "runtime", name);

type Tool = {
  name: string;
  execute(id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, update: undefined, ctx: unknown):
    Promise<{ content: { type: string; text?: string }[]; details?: unknown }>;
};

function tmp(t: import("node:test").TestContext, prefix = "oma-mcp-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A Pi ExtensionAPI stub: tools and event handlers are recorded; the
 * surfaces the facade must refuse (commands, shortcuts, exec, Pi's own
 * MCP namespace) throw if reached, proving the facade never forwards
 * them. */
function fakePi() {
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, ((...args: never[]) => unknown)[]>();
  const pi = {
    tools,
    handlers,
    registerTool(tool: Tool) { tools.set(tool.name, tool); },
    on(event: string, handler: (...args: never[]) => unknown) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    events: { on() {}, emit() { return false; }, off() {} },
    appendEntry() {},
    sendMessage() {},
    sendUserMessage() {},
    getFlag() { return undefined; },
    getActiveTools() { return []; },
    setActiveTools() {},
    getAllTools() { return [...tools.values()].map(tool => ({ name: tool.name })); },
    registerCommand() { throw new Error("facade must have dropped this command"); },
    registerShortcut() { throw new Error("facade must have dropped this shortcut"); },
    registerFlag() { throw new Error("facade must have dropped this flag"); },
    exec() { throw new Error("facade must have refused exec"); },
    // Pi 1.0's built-in MCP API surface -- deliberately absent, so the
    // vendored piSupportsMcp() check is false and no coexistence path
    // (mcp_servers_change mirroring, builtin config sharing) ever arms.
  };
  return pi as never as import("@earendil-works/pi-coding-agent").ExtensionAPI & typeof pi;
}

function withEgress(t: import("node:test").TestContext, present: boolean, port = 47851): void {
  const socket = process.env.OMA_EGRESS_PROXY_SOCKET;
  const priorPort = process.env.OMA_EGRESS_PROXY_PORT;
  if (present) {
    process.env.OMA_EGRESS_PROXY_SOCKET = join(tmp(t), "egress.sock");
    process.env.OMA_EGRESS_PROXY_PORT = String(port);
  } else {
    delete process.env.OMA_EGRESS_PROXY_SOCKET;
    delete process.env.OMA_EGRESS_PROXY_PORT;
  }
  t.after(() => {
    if (socket === undefined) delete process.env.OMA_EGRESS_PROXY_SOCKET; else process.env.OMA_EGRESS_PROXY_SOCKET = socket;
    if (priorPort === undefined) delete process.env.OMA_EGRESS_PROXY_PORT; else process.env.OMA_EGRESS_PROXY_PORT = priorPort;
  });
}

const textOf = (result: { content: { text?: string }[] }) => result.content.map(part => part.text ?? "").join("");

// ---------------------------------------------------------------------------
// Bundle integrity

test("BL5: the vendored pi-mcp-adapter bundle verifies: source tree and the dist copy the adapter loads", () => {
  const source = verifyVendorBundle(SRC_BUNDLE);
  assert.equal(source.package, "pi-mcp-adapter");
  assert.equal(source.version, "5.0.0");
  assert.equal(source.commit, "5783e5eacfe820829b18be5d4de91e5f46e79dbb");
  assert.match(source.bundleSha256, /^[0-9a-f]{64}$/);
  const deployed = verifyVendorBundle(vendoredBundleDir("pi-mcp-adapter"));
  assert.deepEqual(deployed, source, "the dist copy is the same bundle");
  // The runtime dependency closure is inside the verified payload.
  assert.ok(source.files > 2_500, "the manifest covers the whole dependency closure");
  assert.ok(existsSync(join(SRC_BUNDLE, "node_modules", "@modelcontextprotocol", "client", "package.json")));
  assert.ok(existsSync(join(SRC_BUNDLE, "node_modules", "undici", "package.json")));
});

test("BL5: bundle verification fails closed on a changed, missing, extra, linked or malformed member", t => {
  const copy = (label: string): string => {
    const dir = join(tmp(t), label);
    cpSync(SRC_BUNDLE, dir, { recursive: true });
    return dir;
  };
  const fails = (dir: string, reason: RegExp) =>
    assert.throws(() => verifyVendorBundle(dir), (error: unknown) => error instanceof VendorIntegrityError && reason.test(error.message));
  const changed = copy("changed");
  writeFileSync(join(changed, "runtime", "index.js"), `${readFileSync(join(changed, "runtime", "index.js"), "utf8")} `);
  fails(changed, /file changed|digest does not cover/);
  const changedDep = copy("changed-dep");
  writeFileSync(join(changedDep, "node_modules", "undici", "package.json"),
    `${readFileSync(join(changedDep, "node_modules", "undici", "package.json"), "utf8")} `);
  fails(changedDep, /file changed|digest does not cover/);
  const missing = copy("missing");
  rmSync(join(missing, "runtime", "utils.js"));
  fails(missing, /file is missing/);
  const extra = copy("extra");
  writeFileSync(join(extra, "runtime", "smuggled.js"), "x");
  fails(extra, /unlisted file/);
  const linked = copy("linked");
  symlinkSync("index.js", join(linked, "runtime", "linked.js"));
  fails(linked, /linked or special entry|unlisted file/);
  const broken = copy("broken");
  writeFileSync(join(broken, "manifest.json"), "not json");
  fails(broken, /manifest is missing or unreadable/);
});

test("BL5: upstream-tests is the vendored commit's own test tree", () => {
  const stat = statSync(join(SRC_BUNDLE, "upstream-tests"));
  assert.ok(stat.isDirectory(), "the vendored commit's test tree is preserved");
  // The suite surface the manifest documents: the vitest config and the
  // test-runner driver plus a substantial suite — a vendored tree that
  // silently lost its tests would fail here even though it still verifies.
  assert.ok(existsSync(join(SRC_BUNDLE, "upstream-tests", "vitest.config.ts")),
    "upstream's vitest config is vendored");
  assert.ok(existsSync(join(SRC_BUNDLE, "upstream-tests", "test-runner.mjs")),
    "upstream's test runner is vendored");
  const testFiles = readdirSync(join(SRC_BUNDLE, "upstream-tests"), { recursive: true })
    .filter(name => /\.test\.(ts|mts|mjs)$/.test(String(name)));
  assert.ok(testFiles.length >= 150,
    `expected the commit's own suite (got ${testFiles.length} test files)`);
});

// ---------------------------------------------------------------------------
// Registration, facade and surface

test("BL5: registerMcpTools registers exactly `mcp` and drops upstream's commands, flag and shortcuts", async () => {
  const pi = fakePi();
  await registerMcpTools(pi, { config: { mcpServers: {} }, agentDir: undefined });
  assert.deepEqual([...pi.tools.keys()], [...MCP_TOOL_NAMES], "exactly the one proxy tool");
  assert.deepEqual(MCP_TOOL_NAMES, ["mcp"]);
  // Upstream's slash surfaces were recorded and refused, never registered.
  const droppedCommands = mcpFacadeDropped.filter(entry => entry.kind === "command").map(entry => entry.name).sort();
  assert.deepEqual(droppedCommands, ["mcp", "mcp-adapter", "mcp-auth"]);
  const droppedFlags = mcpFacadeDropped.filter(entry => entry.kind === "flag").map(entry => entry.name);
  assert.deepEqual(droppedFlags, ["mcp-config"], "the --mcp-config flag was dropped");
  // The lifecycle hooks upstream owns are forwarded through the facade.
  for (const event of ["session_start", "session_shutdown"])
    assert.ok(pi.handlers.has(event), `expected a forwarded ${event} hook`);
});

test("BL5: the vendored adapter exposes no Pi built-in MCP coexistence path", async () => {
  // The facade offers no registerMcpServer/getMcpServers, so vendored
  // piSupportsMcp() is false: the pi-builtin-mcp lazy import never runs,
  // setPiMcpConfigEnabled is skipped under programmatic config, and
  // mcp_servers_change mirroring never arms. Combined with OMA's spawn
  // contract (--no-extensions filters `builtin:` extension paths), Pi's
  // built-in MCP cannot load beside the adapter.
  const pi = fakePi();
  await registerMcpTools(pi, { config: { mcpServers: {} }, agentDir: undefined });
  const mcp = pi.tools.get("mcp")!;
  const status = await mcp.execute("c", { action: "status" }, undefined, undefined, { hasUI: false });
  assert.match(textOf(status), /MCP: 0\/0 servers/, "the adapter runs against the facade");
});

test("BL5: a bundle that fails verification registers no tools and refuses the session", async t => {
  const dir = join(tmp(t), "corrupt");
  cpSync(SRC_BUNDLE, dir, { recursive: true });
  rmSync(join(dir, "runtime", "index.js"));
  const pi = fakePi();
  const exits: number[] = [];
  const realExit = process.exit;
  (process as { exit: typeof process.exit }).exit = ((code?: number) => { exits.push(code ?? 0); throw new Error("exit"); }) as never;
  try {
    await registerMcpTools(pi, { config: { mcpServers: {} }, bundleDir: dir });
    assert.equal(pi.tools.size, 0, "no tool survives a failed verification");
    const start = pi.handlers.get("session_start")?.[0];
    assert.ok(start, "the refusal is wired to session start");
    assert.throws(() => (start as () => void)(), /exit/);
    assert.deepEqual(exits, [1]);
  } finally {
    (process as { exit: typeof process.exit }).exit = realExit;
  }
});

test("BL5: both role surface plans name `mcp` DIRECT and no group wraps it", () => {
  const base = ["read", "write", "edit", "bash", "grep", "find", "ls",
    "lsp_diagnostics", "lsp_fix", "lsp_status", "replace", "replace_within", "insert",
    "web_search", "source_check", "fetch_content", "get_search_content"];
  const residentRegistered = new Set([...base, ...omaToolNames(false), ...MCP_TOOL_NAMES]);
  const resident = planToolSurface(residentToolSurfaceConfig());
  for (const name of [...resident.direct, ...resident.disabled, ...resident.grouped])
    assert.ok(residentRegistered.has(name), `resident surface names unregistered ${name}`);
  const principalRegistered = new Set([...base, ...omaToolNames(true), ...MCP_TOOL_NAMES, ASK_USER_QUESTION_TOOL_NAME]);
  const principal = planToolSurface(principalToolSurfaceConfig());
  for (const name of [...principal.direct, ...principal.disabled, ...principal.grouped])
    assert.ok(principalRegistered.has(name), `principal surface names unregistered ${name}`);
  for (const plan of [resident, principal]) {
    assert.ok(plan.direct.includes(MCP_PROXY_TOOL_NAME), "mcp is DIRECT on the surface");
    assert.ok(plan.groups.every(group => !group.children.includes("mcp")), "no OMA grouping layer wraps mcp");
  }
  assert.equal(MCP_PROXY_TOOL_NAME, "mcp", "the domain constant binds the facade's pinned name");
});

// ---------------------------------------------------------------------------
// OMA-owned configuration

test("BL5: config validation forbids the surfaces, sinks and escapes upstream defaults allow", t => {
  const stateDir = tmp(t, "oma-mcp-cfg-");
  const rejects: [string, unknown, RegExp][] = [
    ["npx command", { mcpServers: { s: { command: "npx", args: ["-y", "srv"] } } }, /fetch packages/],
    ["npm command", { mcpServers: { s: { command: "npm" } } }, /fetch packages/],
    // The no-fetch rule matches the command's basename -- a path-qualified
    // or win32-shimmed spelling is the same admission, not a bypass.
    ["posix-path npx", { mcpServers: { s: { command: "/usr/bin/npx" } } }, /fetch packages/],
    ["posix-path npm", { mcpServers: { s: { command: "/usr/local/bin/npm" } } }, /fetch packages/],
    ["relative-path npx", { mcpServers: { s: { command: "./node_modules/.bin/npx" } } }, /fetch packages/],
    ["win32-path npm.cmd", { mcpServers: { s: { command: "C:\\Tools\\npm.cmd" } } }, /fetch packages/],
    ["win32-path npx.exe", { mcpServers: { s: { command: "C:\\Program Files\\nodejs\\npx.EXE" } } }, /fetch packages/],
    ["win32 npm.ps1", { mcpServers: { s: { command: "npm.ps1" } } }, /fetch packages/],
    ["win32 npx.bat", { mcpServers: { s: { command: "npx.bat" } } }, /fetch packages/],
    ["uppercase NPM", { mcpServers: { s: { command: "NPM" } } }, /fetch packages/],
    // win32 strips a name's trailing dots and spaces before resolving it, so
    // the same fetcher arrives under a spelling the one-shot shim strip
    // missed -- "npx." resolves to npx, "npx.cmd." to npx.cmd, "npx.." to
    // npx. The admission collapses those suffixes to a fixpoint first.
    ["win32 npx.", { mcpServers: { s: { command: "npx." } } }, /fetch packages/],
    ["win32 npx.cmd.", { mcpServers: { s: { command: "npx.cmd." } } }, /fetch packages/],
    ["win32 npx..", { mcpServers: { s: { command: "npx.." } } }, /fetch packages/],
    ["win32 npx.exe.", { mcpServers: { s: { command: "C:\\Tools\\npx.exe." } } }, /fetch packages/],
    ["win32 npm.cmd ", { mcpServers: { s: { command: "npm.cmd " } } }, /fetch packages/],
    ["padded npx", { mcpServers: { s: { command: " npx " } } }, /fetch packages/],
    ["file url", { mcpServers: { s: { url: "file:///etc/passwd" } } }, /protocol file:/],
    ["env command sink", { mcpServers: { s: { command: "srv", env: { K: "!cat /etc/passwd" } } } }, /"!command" secret sinks/],
    ["header command sink", { mcpServers: { s: { url: "https://x", headers: { H: "!x" } } } }, /"!command" secret sinks/],
    ["bearer command sink", { mcpServers: { s: { url: "https://x", bearerToken: "!x" } } }, /"!command" bearerToken/],
    ["oauth clientSecret sink", { mcpServers: { s: { url: "https://x", oauth: { clientSecret: "!x" } } } }, /oauth\.clientSecret/],
    ["provider auth", { mcpServers: { s: { url: "https://x", auth: { provider: "github" } } } }, /provider credentials/],
    ["server directTools", { mcpServers: { s: { command: "srv", directTools: true } } }, /key "directTools"/],
    ["server caFile", { mcpServers: { s: { url: "https://x", caFile: "/etc/ssl/x.pem" } } }, /key "caFile"/],
    ["server requestHeadersCommand", { mcpServers: { s: { url: "https://x", requestHeadersCommand: { command: "x" } } } }, /requestHeadersCommand/],
    ["settings directTools", { settings: { directTools: true } }, /settings\.directTools/],
    ["settings scriptMode", { settings: { scriptMode: true } }, /settings\.scriptMode/],
    ["settings autoAuth", { settings: { autoAuth: true } }, /settings\.autoAuth/],
    ["settings allowInstall", { settings: { allowInstall: true } }, /settings\.allowInstall/],
    ["settings hostConfigDiscovery", { settings: { hostConfigDiscovery: "auto" } }, /settings\.hostConfigDiscovery/],
    ["settings ancestorConfigRoots", { settings: { ancestorConfigRoots: ["/"] } }, /settings\.ancestorConfigRoots/],
    ["imports", { imports: ["cursor"] }, /key "imports"/],
    ["claudePlugins", { claudePlugins: ["/x"] }, /key "claudePlugins"/],
    ["unknown top-level key", { extra: true }, /key "extra"/],
    ["unknown settings key", { settings: { invented: 1 } }, /settings\.invented/],
    ["unknown server key", { mcpServers: { s: { command: "srv", invented: 1 } } }, /key "invented"/],
    ["bad server name", { mcpServers: { "a/b": { command: "srv" } } }, /invalid server name/],
    ["ambiguous transport", { mcpServers: { s: { command: "srv", url: "https://x" } } }, /mutually exclusive/],
    ["relative socket", { mcpServers: { s: { socket: "./s.sock" } } }, /absolute path/],
    ["sampling without interactive", { settings: { sampling: true } }, /sampling\/elicitation/],
  ];
  for (const [label, config, reason] of rejects)
    assert.throws(() => normalizeOmaMcpConfig(config, { stateDir }), (error: unknown) =>
      error instanceof Error && /E_OMA_MCP_CONFIG/.test(error.message) && reason.test(error.message), `${label} must refuse`);

  // The accepted shape: OMA pins are applied, pass-throughs carry, the
  // oauth dir lands under the OMA state root.
  const ok = normalizeOmaMcpConfig({
    mcpServers: { srv: { command: "server-bin", env: { LANG: "C" } } },
    settings: { outputGuard: { maxBytes: 1024 }, notifyOnStartupConnect: false },
  }, { stateDir });
  assert.equal((ok.mcpServers.srv as { command: string }).command, "server-bin");
  // Path-qualified or shim-adjacent commands that are not the package
  // fetchers pass through untouched -- including names whose trailing-dot
  // collapse lands on something other than npx/npm.
  for (const command of ["/usr/local/bin/server-bin", "npm-helper", "npx-serve", "srv.CMD", "xnpm.cmd.", "npm-helper."])
    assert.equal((normalizeOmaMcpConfig({ mcpServers: { s: { command } } }, { stateDir })
      .mcpServers.s as { command: string }).command, command, `${command} admitted`);
  const settings = ok.settings as Record<string, unknown>;
  for (const pin of ["directTools", "namespaceProxyTools", "scriptMode", "autoAuth", "allowInstall", "exposeResources"])
    assert.equal(settings[pin], false, `${pin} pinned off`);
  assert.equal(settings.hostConfigDiscovery, "off");
  assert.equal(settings.oauthCredentialStore, "encrypted-file");
  assert.equal(settings.oauthDir, join(stateDir, "oauth"));
  assert.deepEqual(settings.outputGuard, { maxBytes: 1024 });
  // The trace file is OMA-owned regardless of what a config names.
  const traced = normalizeOmaMcpConfig({ settings: { trace: { enabled: true, file: "/tmp/evil.log" } } }, { stateDir });
  assert.equal((traced.settings as { trace: { file: string } }).trace.file, join(stateDir, "mcp-trace.jsonl"));
  // Sampling passes through where a human sits at the session UI.
  const interactive = normalizeOmaMcpConfig({ settings: { sampling: true, elicitation: true } }, { interactive: true, stateDir });
  assert.equal((interactive.settings as { sampling: boolean }).sampling, true);
  const nonInteractive = normalizeOmaMcpConfig({ settings: {} }, { interactive: false, stateDir });
  assert.equal((nonInteractive.settings as { sampling: boolean }).sampling, false);
});

test("BL5: the OMA-owned config file is read from the engine's own agent dir, and a malformed file fails closed", async t => {
  const agentDir = tmp(t, "oma-mcp-agent-");
  // No file: empty config, `mcp` still registers.
  const pi = fakePi();
  await registerMcpTools(pi, { agentDir });
  assert.deepEqual([...pi.tools.keys()], ["mcp"]);
  assert.ok(existsSync(join(agentDir, MCP_STATE_DIR_NAME)), "the OMA state dir was created under the agent dir");

  // A declared server in the OMA-owned file is carried.
  writeFileSync(join(agentDir, MCP_CONFIG_FILE_NAME), JSON.stringify({ mcpServers: { docs: { url: "https://mcp.example.com/" } } }));
  const pi2 = fakePi();
  await registerMcpTools(pi2, { agentDir });
  assert.deepEqual([...pi2.tools.keys()], ["mcp"]);

  // A malformed file is a boundary error, not a degraded startup.
  writeFileSync(join(agentDir, MCP_CONFIG_FILE_NAME), "{ not json");
  await assert.rejects(registerMcpTools(fakePi(), { agentDir }), /E_OMA_MCP_CONFIG.*not valid JSON/);
});

test("BL5: inaccessible state is an observable error -- only ENOENT means absent", async t => {
  const agentDir = tmp(t, "oma-mcp-agent-");
  const configPath = join(agentDir, MCP_CONFIG_FILE_NAME);
  const eacces = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === "EACCES";

  // An unreadable config file refuses; existsSync would have conflated the
  // EACCES with absence and booted on an empty config.
  writeFileSync(configPath, JSON.stringify({ mcpServers: {} }));
  chmodSync(configPath, 0o000);
  await assert.rejects(registerMcpTools(fakePi(), { agentDir }), eacces);
  chmodSync(configPath, 0o600);

  // A non-file config path refuses with the boundary error, not absence.
  rmSync(configPath);
  mkdirSync(configPath);
  await assert.rejects(registerMcpTools(fakePi(), { agentDir }), /E_OMA_MCP_CONFIG.*not a regular file/);
  rmSync(configPath, { recursive: true });

  // An unreadable state root refuses too (stat EACCES), still not absence.
  chmodSync(agentDir, 0o000);
  await assert.rejects(registerMcpTools(fakePi(), { agentDir }), eacces);
  chmodSync(agentDir, 0o755);

  // An unreadable OAuth key refuses instead of rotating a fresh key that
  // would silently orphan the sealed credential store.
  const stateDir = join(agentDir, MCP_STATE_DIR_NAME);
  mkdirSync(stateDir, { recursive: true });
  const keyPath = join(stateDir, "oauth-file-key");
  const sealed = "a2VlcHRoZWtleWZyb21ydW5uaW5nc3RvcmU=\n";
  writeFileSync(keyPath, sealed, { mode: 0o600 });
  chmodSync(keyPath, 0o000);
  await assert.rejects(registerMcpTools(fakePi(), { agentDir, config: { mcpServers: {} } }), eacces);
  chmodSync(keyPath, 0o600);
  assert.equal(readFileSync(keyPath, "utf8"), sealed, "the denied read never rewrote the key");
});

test("BL5: OMA-owned state holds the credential key and scratch; shutdown removes scratch", async t => {
  const agentDir = tmp(t, "oma-mcp-agent-");
  const pi = fakePi();
  await registerMcpTools(pi, { agentDir, config: { mcpServers: {} } });
  const stateDir = join(agentDir, MCP_STATE_DIR_NAME);
  const keyPath = join(stateDir, "oauth-file-key");
  assert.ok(existsSync(keyPath), "the encrypted-file key was provisioned");
  const key = readFileSync(keyPath, "utf8").trim();
  assert.match(key, /^[A-Za-z0-9+/]{43}=$/, "canonical base64 of 32 bytes");
  assert.equal(statSync(keyPath).mode & 0o777, 0o600, "the key file is owner-only");
  const scratch = join(stateDir, "scratch");
  assert.ok(existsSync(join(scratch, "spill")), "the output-guard spill root exists");
  writeFileSync(join(scratch, "stale"), "x");
  // handlers[0] is OMA's -- the adapter registers its scratch lifecycle
  // before upstream's factory adds upstream's own session hooks.
  const start = pi.handlers.get("session_start")?.[0] as (() => void) | undefined;
  assert.ok(start, "OMA's session_start hook is registered");
  start();
  assert.ok(!existsSync(join(scratch, "stale")), "session_start rotates the scratch");
  assert.ok(existsSync(scratch));
  const shutdown = pi.handlers.get("session_shutdown")?.[0] as (() => void) | undefined;
  assert.ok(shutdown, "OMA's session_shutdown hook is registered");
  shutdown();
  assert.ok(!existsSync(scratch), "session_shutdown removes the scratch");
});

// ---------------------------------------------------------------------------
// Child env scrub

test("BL5: the stdio child env is the shared scrub -- allowlist, declared filter, scratch redirects", t => {
  withEgress(t, true, 47861);
  const scratch = join(tmp(t), "scratch");
  const priorSecret = process.env.OMA_TEST_MCP_SECRET;
  const priorPath = process.env.PATH;
  process.env.OMA_TEST_MCP_SECRET = "sekret";
  t.after(() => {
    if (priorSecret === undefined) delete process.env.OMA_TEST_MCP_SECRET; else process.env.OMA_TEST_MCP_SECRET = priorSecret;
    if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
  });
  const env = mcpChildEnvironment({
    API_KEY: "declared-secret",        // not on the allowlist -- stripped
    HTTPS_PROXY: "http://evil:8080",   // not the pin -- stripped
    https_proxy: "http://127.0.0.1:47861", // the pin itself -- carried
    LANG: "C.UTF-8",                   // allowlisted -- carried
    "LC_ALL": "C",                     // LC_* prefix grant -- carried
    "B\u0000AD": "x",                  // NUL name -- refused
    TZ: "..",                          // traversal -- refused
    HOME: "/home/attacker",            // not inheritable -- scratch wins
  }, scratch);
  assert.equal(env.API_KEY, undefined);
  assert.equal(env.HTTPS_PROXY, undefined);
  assert.equal(env.https_proxy, "http://127.0.0.1:47861");
  assert.equal(env.LANG, "C.UTF-8");
  assert.equal(env.LC_ALL, "C");
  assert.equal(env.TZ, undefined);
  assert.equal(env.HOME, scratch, "HOME is the OMA scratch, never inherited or declared");
  assert.equal(env.XDG_CACHE_HOME, scratch);
  assert.equal(env.TMPDIR, scratch);
  assert.equal(env.OMA_TEST_MCP_SECRET, undefined, "ambient secrets are denied by absence");
  assert.equal(env.PATH, priorPath, "PATH survives the allowlist");
  assert.ok(!Object.values(env).includes(""), "no empty-string tombstones");
  // Names the vendored SDK's getDefaultEnvironment() would union beneath
  // this map carry an explicit `undefined` tombstone instead -- the key
  // overrides the underlay inside the union, and spawn drops the pair.
  for (const name of ["SHELL", "HOMEDRIVE", "HOMEPATH", "PROCESSOR_ARCHITECTURE", "PROGRAMFILES"]) {
    assert.ok(Object.hasOwn(env, name), `${name} is tombstoned, not merely absent`);
    assert.equal(env[name], undefined, `${name} tombstone`);
  }
  assert.ok(!Object.hasOwn(env, "API_KEY"), "a non-underlay denied name is absent outright");
});

test("BL5: through the vendored SDK transport's underlay union, denied names stay absent in a real child", async t => {
  // StdioClientTransport spawns with `{ ...getDefaultEnvironment(), ...env }`:
  // ambient HOME/LOGNAME/PATH/SHELL/TERM/USER (win32: the other list) would
  // resurface beneath the adapter's env unless each unsanctioned underlay
  // name carries an `undefined` tombstone -- Node's spawn drops those
  // pairs. This drives the vendored transport itself, so the assertion is
  // what the spawned process actually saw.
  const { StdioClientTransport } = await import(
    join(vendoredBundleDir("pi-mcp-adapter"), "node_modules", "@modelcontextprotocol", "client", "dist", "stdio.mjs")) as {
      StdioClientTransport: new (params: { command: string; args?: string[]; env?: Record<string, string>; stderr?: "pipe" | "inherit" }) => {
        start(): Promise<void>;
        close(): Promise<void>;
        onclose?: (() => void) | undefined;
        onerror?: ((error: Error) => void) | undefined;
      };
    };
  const runProbe = async (envMap: Record<string, string | undefined>, out: string): Promise<Record<string, string>> => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.env))`],
      env: envMap as Record<string, string>,
      stderr: "pipe",
    });
    transport.onerror = () => {};
    await transport.start();
    const deadline = Date.now() + 10_000;
    while (!existsSync(out) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 25));
    await transport.close().catch(() => {});
    assert.ok(existsSync(out), "the probe child ran and wrote its env");
    return JSON.parse(readFileSync(out, "utf8")) as Record<string, string>;
  };

  const priorShell = process.env.SHELL;
  process.env.SHELL = "/bin/oma-sentinel";
  t.after(() => { if (priorShell === undefined) delete process.env.SHELL; else process.env.SHELL = priorShell; });
  const scratch = join(tmp(t), "scratch");
  const env = mcpChildEnvironment({ LANG: "C" }, scratch);

  const seen = await runProbe(env, join(tmp(t), "env-after.json"));
  assert.equal(seen.SHELL, undefined, "denied SHELL stays absent through the SDK underlay union");
  for (const name of ["HOMEDRIVE", "HOMEPATH", "PROCESSOR_ARCHITECTURE", "PROGRAMFILES"])
    assert.equal(seen[name], undefined, `${name} absent`);
  assert.equal(seen.HOME, scratch, "HOME is the OMA scratch, not the underlay's ambient value");
  assert.equal(seen.LANG, "C", "a declared allowlisted name is carried");
  assert.equal(seen.PATH, process.env.PATH, "sanctioned PATH survives the union");

  // Control: the same map without tombstones proves the leak was real --
  // the underlay resurfaces the ambient SHELL into the spawned child.
  const stripped = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const control = await runProbe(stripped, join(tmp(t), "env-control.json"));
  assert.equal(control.SHELL, "/bin/oma-sentinel",
    "control: without tombstones the SDK union resurfaces the ambient SHELL");
});

test("BL5: every SDK stdio underlay name has an OMA disposition -- a vendored SDK bump cannot silently re-open the ambient leak", async t => {
  // SDK_STDIO_ENV_UNDERLAY in mcp-tools.ts is a hand-mirrored copy of the
  // vendored SDK's DEFAULT_INHERITED_ENV_VARS. The SDK export is a
  // platform ternary, so one import yields only this host's list; the
  // win32 list would go unobserved on a POSIX runner. Read BOTH branch
  // lists out of the verified vendored bytes (ESM and CJS builds), pin
  // the builds to each other and to the live export for this platform,
  // then require every listed name to carry a disposition: an explicit
  // `undefined` tombstone, a sanctioned carried value, a scratch-owned
  // name, or a name the shared child-env predicate would admit. A bump
  // that adds a name lands in none of those and fails here until the
  // underlay names it -- verified below with OMA_DRIFT_PROBE.
  verifyVendorBundle(SRC_BUNDLE);
  const sdkDist = join(SRC_BUNDLE, "node_modules", "@modelcontextprotocol", "client", "dist");
  const branchLists = (file: string): { win32: string[]; posix: string[] } => {
    const source = readFileSync(join(sdkDist, file), "utf8");
    const ternary = /DEFAULT_INHERITED_ENV_VARS\s*=\s*[^?]*\?\s*\[([^\]]*)\]\s*:\s*\[([^\]]*)\]/.exec(source);
    assert.ok(ternary, `${file}: DEFAULT_INHERITED_ENV_VARS platform ternary not found`);
    const names = (list: string): string[] => [...list.matchAll(/"([^"]+)"/g)].map(match => match[1]!);
    return { win32: names(ternary[1]!), posix: names(ternary[2]!) };
  };
  const esm = branchLists("stdio.mjs");
  const cjs = branchLists("stdio.cjs");
  for (const platform of ["win32", "posix"] as const) {
    assert.ok(esm[platform].length > 0, `the vendored SDK's ${platform} underlay list is empty`);
    assert.deepEqual([...cjs[platform]].sort(), [...esm[platform]].sort(),
      `the vendored SDK's ESM and CJS ${platform} underlay lists diverged`);
  }
  // The parse reads the same names the SDK itself would export on this
  // host -- the static read is pinned to the live module, not to a guess.
  const live = await import(
    join(vendoredBundleDir("pi-mcp-adapter"), "node_modules", "@modelcontextprotocol", "client", "dist", "stdio.mjs")) as {
      DEFAULT_INHERITED_ENV_VARS: string[];
    };
  assert.deepEqual([...live.DEFAULT_INHERITED_ENV_VARS].sort(),
    [...esm[process.platform === "win32" ? "win32" : "posix"]].sort(),
    "the live SDK export does not match the vendored bytes this host runs");

  const env = mcpChildEnvironment({}, join(tmp(t), "scratch"));
  const undisposed = (names: Iterable<string>): string[] => [...names].filter(name => {
    const tombstoned = Object.hasOwn(env, name) && env[name] === undefined;
    const carried = typeof env[name] === "string";
    const sanctioned = CHILD_ENV_SCRATCH_NAMES.includes(name) ||
      admittedChildEnv(name, "oma-env-disposition-probe");
    return !tombstoned && !carried && !sanctioned;
  });
  assert.deepEqual(undisposed(new Set([...esm.win32, ...esm.posix])), [],
    "an SDK underlay name reaches a child with no tombstone and no sanction -- add it to SDK_STDIO_ENV_UNDERLAY");
  // The oracle fires on the drift it exists for: an underlay name the
  // tombstone list and the scrub both miss is reported, not passed.
  assert.deepEqual(undisposed([...esm.posix, "OMA_DRIFT_PROBE"]), ["OMA_DRIFT_PROBE"],
    "a vendored bump adding an uncovered underlay name must fail");
});

// ---------------------------------------------------------------------------
// Policy seam inside the vendored runtime

test("BL5: the installed policy is live inside the vendored runtime", async t => {
  withEgress(t, false);
  const agentDir = tmp(t, "oma-mcp-agent-");
  const pi = fakePi();
  await registerMcpTools(pi, { agentDir, config: { mcpServers: {} } });
  const utils = await import(SRC_RUNTIME("utils.js"));
  // The ambient view vendored code reads is empty: operator-exported knobs
  // cannot reach vendored behavior.
  assert.deepEqual(utils.omaAmbientEnv(), {});
  assert.equal(utils.omaPolicyActive(), true);
  // Every permit is denied by default.
  for (const name of ["credential-command", "browser-open", "os-keyring", "ui-session"])
    assert.equal(utils.omaPermits(name), false, `${name} denied`);
  // The interactive-UI refusal predicate is closed under the policy.
  assert.equal(utils.omaUiSessionsRefused(), true);
  // The `!command` credential sink refuses before any shell runs -- the
  // runtime splice behind the config-side rejection.
  assert.throws(() => utils.resolveCommandSecret("!cat /etc/passwd", "test"), /E_OMA_MCP_AUTHORITY/);
  // Env interpolation resolves against the empty ambient view.
  assert.equal(utils.interpolateEnvVars("${OMA_TEST_MCP_SECRET}"), "");
  // The OS keyring store is the closed shape.
  const keyring = await import(SRC_RUNTIME("secure-keyring.js"));
  const store = keyring.createSecureKeyringStore("pi-mcp-adapter.test");
  assert.throws(() => store.read("acct"), /OS secure credential storage is unavailable/);
  // getAgentDir resolves the OMA-owned state dir, never the host's.
  const agentDirMod = await import(SRC_RUNTIME("agent-dir.js"));
  assert.equal(agentDirMod.getAgentDir(), join(agentDir, MCP_STATE_DIR_NAME));
  // The child-env finish filters a merged map, layers the scratch and
  // tombstones every SDK-underlay name the scrub did not sanction.
  const finished = utils.omaChildEnvFinish({ API_KEY: "declared-secret", LANG: "C" });
  assert.equal(finished.API_KEY, undefined);
  assert.equal(finished.LANG, "C");
  assert.equal(typeof finished.HOME, "string", "scratch HOME was layered");
  assert.ok(Object.hasOwn(finished, "SHELL") && finished.SHELL === undefined,
    "an unsanctioned underlay name is an explicit tombstone");
});

test("BL5: with egress wiring the vendored fetch leaf rides the pin; loopback stays direct", async t => {
  withEgress(t, true, 47871);
  const agentDir = tmp(t, "oma-mcp-agent-");
  const pi = fakePi();
  await registerMcpTools(pi, { agentDir, config: { mcpServers: {} } });
  const utils = await import(SRC_RUNTIME("utils.js"));
  // A non-loopback request is carried to the pinned CONNECT forwarder: with
  // nothing listening there, the observable failure is the refused connect
  // to 127.0.0.1:<pin> -- proof the dispatcher is the proxy, not direct.
  const refused = await utils.omaPinnedFetch("https://example.com/x", { signal: AbortSignal.timeout(4000) }).then(
    () => "unexpected success",
    (error: unknown) => {
      const cause = (error as { cause?: { code?: string; port?: number } }).cause;
      return `${cause?.code}:${cause?.port}`;
    });
  assert.equal(refused, "ECONNREFUSED:47871", "non-loopback traffic dialed the pinned proxy");
  // Loopback stays direct (the OAuth callback listener and local MCP
  // servers must never round-trip the proxy).
  const loopback = await utils.omaPinnedFetch("http://127.0.0.1:1/x", { signal: AbortSignal.timeout(3000) }).then(
    () => "unexpected success",
    () => "direct-refused");
  assert.equal(loopback, "direct-refused");
});

test("BL5: without egress wiring the leaf is upstream's own fetch", async t => {
  withEgress(t, false);
  const agentDir = tmp(t, "oma-mcp-agent-");
  const pi = fakePi();
  await registerMcpTools(pi, { agentDir, config: { mcpServers: {} } });
  const utils = await import(SRC_RUNTIME("utils.js"));
  // No pin: omaCaFetch stands upstream's own "no CA leaf" (undefined) --
  // no proxy dispatcher is synthesized.
  assert.equal(utils.omaCaFetch(undefined), undefined);
});

// ---------------------------------------------------------------------------
// Interactive-UI refusal (the "ui-session" permit, deny-by-default)

test("BL5: maybeStartUiSession and the glimpse viewer refuse before any host work runs", async t => {
  withEgress(t, false);
  const agentDir = tmp(t, "oma-mcp-agent-");
  const pi = fakePi();
  await registerMcpTools(pi, { agentDir, config: { mcpServers: {} } });
  const uiSession = await import(SRC_RUNTIME("ui-session.js")) as {
    maybeStartUiSession(state: unknown, request: { serverName: string; toolName: string; toolArgs: unknown; uiResourceUri: string }): Promise<unknown>;
  };
  // The permit gate is the function's first statement: a state object that
  // throws on ANY property access proves nothing underneath it -- the
  // ui-resource read, the `who` remote-login probe, orca, viewer
  // resolution or a browser open -- was reached.
  const untouchableState = new Proxy({}, { get: () => { throw new Error("ui-session state was touched before the refusal"); } });
  await assert.rejects(
    uiSession.maybeStartUiSession(untouchableState, { serverName: "srv", toolName: "tool", toolArgs: {}, uiResourceUri: "ui://x/app" }),
    /E_OMA_MCP_AUTHORITY.*ui-session/);
  const glimpse = await import(SRC_RUNTIME("glimpse-ui.js")) as {
    openGlimpseWindow(html: string, options: Record<string, unknown>): Promise<unknown>;
  };
  // The permit gate precedes the `glimpseui` dynamic import, so a rejected
  // call is also proof no host-global package was resolved or imported.
  await assert.rejects(glimpse.openGlimpseWindow("<html/>", {}), /E_OMA_MCP_AUTHORITY/);
});

test("BL5: a uiResourceUri tool call returns the structured refusal; the server sees no UI machinery", async t => {
  // A real stdio MCP server (spawned through the vendored transport, so the
  // child env is also the F1 oracle) that logs every request method it
  // receives. A `ui://` tool call must come back as a structured
  // ui_session_refused result with the refusal firing before the adapter
  // ever asks the server for the UI resource or calls the tool -- the
  // point at which upstream would next spawn `who`, resolve a viewer or
  // open a browser.
  const dir = tmp(t, "oma-mcp-probe-");
  const envOut = join(dir, "probe-env.json");
  const logOut = join(dir, "probe-requests.log");
  const probePath = join(dir, "probe-server.cjs");
  writeFileSync(probePath, `'use strict';
const fs = require("node:fs");
const readline = require("node:readline");
const envOut = process.argv[2];
const logOut = process.argv[3];
fs.writeFileSync(envOut, JSON.stringify(process.env));
readline.createInterface({ input: process.stdin, terminal: false }).on("line", line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return; // notifications need no answer
  fs.appendFileSync(logOut, String(msg.method) + "\\n");
  const respond = result => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
  if (msg.method === "initialize")
    return respond({ protocolVersion: msg.params && msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "probe", version: "0.0.0" } });
  if (msg.method === "tools/list")
    return respond({ tools: [
      { name: "ui_tool", description: "interactive", inputSchema: { type: "object", properties: {} }, _meta: { ui: { resourceUri: "ui://probe/app" } } },
      { name: "plain_tool", description: "no ui", inputSchema: { type: "object", properties: {} } },
    ] });
  if (msg.method === "tools/call")
    return respond({ content: [{ type: "text", text: "plain result" }] });
  if (msg.method === "resources/read")
    return respond({ contents: [{ uri: msg.params && msg.params.uri, text: "the UI resource was fetched" }] });
  respond({});
});
`);
  const agentDir = tmp(t, "oma-mcp-agent-");
  const priorShell = process.env.SHELL;
  process.env.SHELL = "/bin/oma-sentinel";
  t.after(() => { if (priorShell === undefined) delete process.env.SHELL; else process.env.SHELL = priorShell; });
  const pi = fakePi();
  await registerMcpTools(pi, {
    agentDir,
    config: { mcpServers: { probe: { command: process.execPath, args: [probePath, envOut, logOut] } } },
  });
  // The spawned probe server outlives the call until the session's own
  // shutdown owner kills it -- fire every registered session_shutdown
  // handler so the stdio child cannot keep the test process alive.
  const shutdown = async () => {
    for (const handler of pi.handlers.get("session_shutdown") ?? [])
      await (handler as () => Promise<unknown> | void)();
  };
  t.after(shutdown);
  const mcp = pi.tools.get("mcp")!;

  const refused = await mcp.execute("c", { tool: "ui_tool", server: "probe", args: {} }, undefined, undefined, { hasUI: false });
  const details = refused.details as { error?: string; mode?: string } | undefined;
  assert.equal(details?.error, "ui_session_refused", "the structured refusal came back");
  assert.match(textOf(refused), /refused at the OMA boundary/);

  // The refusal fired before the UI machinery: the probe server never saw
  // a resources/read for the ui:// URI (the step upstream runs before
  // `who`, orca/npm resolution or any browser open) and never saw the
  // tools/call itself.
  const log = readFileSync(logOut, "utf8");
  assert.ok(log.includes("initialize"), "the probe server completed the handshake");
  assert.ok(log.includes("tools/list"), "tool metadata was fetched");
  assert.ok(!log.includes("resources/read"), "the UI resource was never fetched");
  assert.ok(!log.includes("tools/call"), "the UI tool was never invoked");

  // A non-UI tool on the same server still runs -- the refusal is specific
  // to the ui:// surface, not a broken adapter.
  const plain = await mcp.execute("c2", { tool: "plain_tool", server: "probe", args: {} }, undefined, undefined, { hasUI: false });
  assert.equal((plain.details as { error?: string } | undefined)?.error, undefined);
  assert.match(textOf(plain), /plain result/);

  // The spawned probe's environment is the OMA map through the real SDK
  // union: denied ambient names absent, scratch redirects applied.
  const childEnv = JSON.parse(readFileSync(envOut, "utf8")) as Record<string, string>;
  assert.equal(childEnv.SHELL, undefined, "ambient SHELL never reached the spawned server");
  assert.equal(childEnv.HOMEDRIVE, undefined, "no underlay win32 names either");
  assert.equal(childEnv.HOME, join(agentDir, MCP_STATE_DIR_NAME, "scratch"), "HOME is the OMA scratch");
});

// ---------------------------------------------------------------------------
// Post-listen 'error' absorption (the vendored listen boundaries)

/** Every server that binds while the patch is installed, captured through
 * the prototype the vendored `http.createServer` results inherit: the
 * vendored listeners are module-/closure-internal, so the emit oracle
 * reaches them only via the shared listen path. */
function captureListens(t: import("node:test").TestContext): Server[] {
  const original = Server.prototype.listen;
  const bound: Server[] = [];
  Server.prototype.listen = function (this: Server, ...args: never[]) {
    bound.push(this);
    return Reflect.apply(original, this, args) as Server;
  } as typeof Server.prototype.listen;
  t.after(() => { Server.prototype.listen = original; });
  return bound;
}

/** The journal each vendored listener writes through console.error. */
function errorJournal(t: import("node:test").TestContext): string[] {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  t.after(() => { console.error = original; });
  return lines;
}

/** What an unhandled emit would escalate to -- recorded, never fatal here. */
function uncaught(t: import("node:test").TestContext): unknown[] {
  const escaped: unknown[] = [];
  const onUncaught = (error: Error) => { escaped.push(error); };
  process.once("uncaughtException", onUncaught);
  t.after(() => { process.off("uncaughtException", onUncaught); });
  return escaped;
}

/** The shape a kernel accept failure takes. */
const vendoredAcceptError = (): Error => Object.assign(new Error("accept failed"), { code: "EMFILE" });

/** The socket still answers a dial after the emit: the name stayed bound. */
async function stillDialing(port: number): Promise<void> {
  const probe = connect({ host: "127.0.0.1", port });
  probe.on("error", () => {});
  await once(probe, "connect");
  probe.destroy();
}

test("BL5: the OAuth callback listener absorbs post-listen errors -- the first is journaled, the second cannot escape", async t => {
  // Upstream armed a `once("error", reject)` for the server's whole life:
  // the first post-listen error was silently consumed by the settled
  // reject and a second met zero listeners and escaped its emit as the
  // hosting engine's death. The divergence removes the startup
  // once-listener exactly when the listen resolves and keeps a permanent
  // guarded journal beside it -- reachable via the allowed auth:"oauth"
  // path (mcp-auth-flow → ensureCallbackServer).
  const bound = captureListens(t);
  const lines = errorJournal(t);
  const escaped = uncaught(t);
  const mod = await import(SRC_RUNTIME("mcp-callback-server.js")) as {
    ensureCallbackServer(options?: { strictPort?: boolean }): Promise<void>;
    stopCallbackServer(): Promise<void>;
    isCallbackServerRunning(): boolean;
  };
  const provider = await import(SRC_RUNTIME("mcp-oauth-provider.js")) as { getOAuthCallbackPort(): number };
  t.after(() => mod.stopCallbackServer());
  await mod.ensureCallbackServer({ strictPort: false });
  const server = bound.find(candidate => candidate.listening);
  assert.ok(server, "the callback listener bound");
  assert.equal((server.address() as { port: number }).port, provider.getOAuthCallbackPort(),
    "the captured listener is the OAuth callback server");
  assert.equal(server.listenerCount("error"), 1,
    "the permanent listener alone -- the startup once-listener is gone");
  // The first post-listen error reaches the journal instead of being
  // swallowed by the settled reject, and the second -- upstream's
  // uncovered emit -- is absorbed the same way.
  server.emit("error", vendoredAcceptError());
  server.emit("error", vendoredAcceptError());
  assert.equal(server.listening, true, "the socket stays bound for the kernel to retry");
  assert.equal(mod.isCallbackServerRunning(), true);
  assert.equal(lines.filter(line => line.includes("accept failed")).length, 2, "each error reached the journal");
  await stillDialing(provider.getOAuthCallbackPort());
  assert.deepEqual(escaped, []);
});

test("BL5: both vendored UI-session listeners absorb post-listen errors", async t => {
  // The host server's retry loop re-arms a once-listener per port
  // candidate and drops it on success; the sandbox proxy's once-listener
  // is dropped the same way -- two instances of the class the sweep fixed
  // everywhere else. Under OMA the ui-session permit refuses this module;
  // the permanent listeners are the bare-load defense, exercised here
  // through the module's own start.
  const bound = captureListens(t);
  const lines = errorJournal(t);
  const escaped = uncaught(t);
  const uiServer = await import(SRC_RUNTIME("ui-server.js")) as {
    startUiServer(options: Record<string, unknown>): Promise<{ port: number; proxyPort: number; close(reason?: string): void }>;
  };
  const handle = await uiServer.startUiServer({
    serverName: "srv", toolName: "tool", port: 0,
    resource: { meta: {} },
    manager: { getConnection: () => undefined, touch: () => {} },
    consentManager: { requiresPrompt: () => false, shouldCacheConsent: () => false, ensureApproved: () => {} },
  });
  t.after(() => handle.close("test done"));
  const byPort = (port: number) => bound.find(candidate =>
    candidate.listening && (candidate.address() as { port?: number } | null)?.port === port);
  const host = byPort(handle.port);
  const proxy = byPort(handle.proxyPort);
  assert.ok(host, "the host server bound");
  assert.ok(proxy, "the sandbox proxy bound");
  assert.notEqual(host, proxy);
  for (const [name, server] of [["host", host], ["proxy", proxy]] as const) {
    assert.equal(server.listenerCount("error"), 1, `${name}: one permanent listener, the startup once-listener gone`);
    server.emit("error", vendoredAcceptError());
    assert.equal(server.listening, true, `${name}: the socket stays bound`);
  }
  assert.equal(lines.filter(line => line.includes("accept failed")).length, 2, "each listener journaled its error");
  await stillDialing(handle.port);
  await stillDialing(handle.proxyPort);
  assert.deepEqual(escaped, []);
});
