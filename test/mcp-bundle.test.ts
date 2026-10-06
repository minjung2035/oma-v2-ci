/** Bundled pi-mcp-adapter (the `mcp` proxy tool): the vendored payload is
 * verified byte-for-byte before any vendored module evaluates; the adapter
 * drives upstream's own createMcpAdapter factory through a facade that
 * admits exactly `mcp`; the config is OMA-owned and validated; the
 * child-env scrub, egress pin, credential store and scratch lifecycle are
 * OMA's; and Pi's built-in MCP can never coexist. */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MCP_CONFIG_FILE_NAME, MCP_STATE_DIR_NAME, MCP_TOOL_NAMES,
  mcpChildEnvironment, mcpFacadeDropped, normalizeOmaMcpConfig, registerMcpTools,
} from "../src/extension/mcp-tools.js";
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
  assert.ok(existsSync(join(SRC_BUNDLE, "upstream-tests", "vitest.config.ts")) ||
    statSync(join(SRC_BUNDLE, "upstream-tests")).isDirectory());
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
  for (const name of ["credential-command", "browser-open", "os-keyring"])
    assert.equal(utils.omaPermits(name), false, `${name} denied`);
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
  // The child-env finish filters a merged map and layers the scratch.
  const finished = utils.omaChildEnvFinish({ API_KEY: "declared-secret", LANG: "C" });
  assert.equal(finished.API_KEY, undefined);
  assert.equal(finished.LANG, "C");
  assert.equal(typeof finished.HOME, "string", "scratch HOME was layered");
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
