/** mcp: the bundled pi-mcp-adapter extension (vendored byte-pinned under
 * `src/extension/vendor/pi-mcp-adapter/`) exposed as exactly one OMA tool
 * -- `mcp`, upstream's own proxy surface -- inside OMA's authority model
 * rather than upstream's "host pi extension" model.
 *
 * What OMA owns, and where it lives:
 *
 * - Integrity: `verifyVendorBundle` runs at registration, and only after
 *   it passes is any vendored module evaluated -- every runtime import
 *   here is a dynamic `await import()` behind that check (this module
 *   itself only type-imports vendored declarations, which erase at
 *   compile). A tampered or incomplete payload refuses the session, it
 *   does not degrade.
 * - Surface: OMA drives upstream's own `createMcpAdapter` factory through
 *   a facade ExtensionAPI. The facade forwards `registerTool` only for
 *   the pinned name `mcp` -- a renamed, extra or missing registration
 *   fails startup. `registerCommand`, `registerFlag` and
 *   `registerShortcut` are recorded, not registered: upstream's /mcp,
 *   /mcp-adapter and /mcp-auth surfaces stay closed because every auth
 *   action the proxy tool offers is reached through `mcp` params instead.
 *   `exec` is refused (its only call sites are browser/path opening);
 *   `registerMcpServer`/`getMcpServers` are absent from the facade, so
 *   `piSupportsMcp(pi)` is false inside vendored code -- Pi's built-in
 *   MCP can never run beside the adapter, and the mcp_servers_change
 *   mirroring path is never armed. There is no OMA grouping layer: the
 *   surface plan names `mcp` directly. Posture: `pi.events` is forwarded
 *   unchanged and upstream's `pi-mcp-adapter:runtime-register` channel
 *   registers a runtime server without normalizeOmaMcpConfig -- the
 *   boundary validator (command basename rules included) does not see
 *   it. It is in-process only and no other OMA extension can emit it, so
 *   it is recorded as a posture note rather than closed; the runtime
 *   refusals (ui-session, credential-command) still bind what registers.
 * - Config: the only config source is OMA-owned -- a programmatic
 *   `McpConfig` object supplied to `createMcpAdapter`, built by
 *   `normalizeOmaMcpConfig` from the OMA-owned mcp-adapter.json in the engine's
 *   own PI_CODING_AGENT_DIR (or the `config` option in tests). `configPath`
 *   is never offered to upstream, so no discovery path (Pi global config,
 *   project config, host config, package/claude-plugin loaders, argv
 *   flags) can run. The validator rejects `imports`, `claudePlugins` and
 *   every settings key outside the allowed subset; it forbids the
 *   surface-altering settings (directTools, namespaceProxyTools,
 *   scriptMode, autoAuth, allowInstall, hostConfigDiscovery,
 *   disableProxyTool, ancestorConfigRoots, agentPluginPaths,
 *   projectServers) rather than clamping them, because an OMA-owned file
 *   asking for a forbidden surface is a violation, not a preference.
 * - Server entries: command is rejected when its basename -- directory
 *   prefixes, the win32 `.cmd`/`.exe`/`.bat`/`.ps1` shims and trailing
 *   dots/spaces stripped to a fixpoint, case-folded -- is "npx"/"npm"
 *   (upstream's resolver would fetch packages at connect time); `url` must be http(s); `socket` must be
 *   absolute; `caFile`, `requestHeadersCommand`, `pluginDataDir`,
 *   `literalEnv` and per-server `directTools` are rejected outright;
 *   `!`-command secret sinks in env/headers/bearerToken/oauth.clientSecret
 *   are rejected at the boundary AND refused at runtime by the vendored
 *   splice (defense in depth). A `uiResourceUri` tool call fails closed
 *   with a structured refusal inside the vendored runtime -- no `who`
 *   probe, `npm root -g` resolution, host-package import or browser open
 *   may run for it (the deny-by-default `ui-session`/`browser-open`
 *   permits; upstream's UI session machinery stays unreachable).
 * - Policy seam: before the factory runs, `omaInstallMcpPolicy` installs
 *   the OMA contract inside the vendored runtime: deny-by-default permits
 *   (browser-open, os-keyring and ui-session never granted), an empty
 *   ambient-env
 *   view (MCP_DIRECT_TOOLS, MCP_OAUTH_*, NPM_CONFIG_CACHE, BROWSER, the
 *   Jev/SystemOne vars and the PI_MCP_ADAPTER_* selectors cannot reach
 *   vendored code), the OMA-owned agent dir every getAgentPath-derived
 *   write lands under, the scratch root for output-guard spills, the
 *   stdio child env scrub, and the pinned credential store. The vendored
 *   MCP SDK's StdioClientTransport unions its own
 *   `getDefaultEnvironment()` beneath `serverParams.env` (POSIX: HOME,
 *   LOGNAME, PATH, SHELL, TERM, USER; win32: APPDATA, HOMEDRIVE,
 *   HOMEPATH, LOCALAPPDATA, PATH, PROCESSOR_ARCHITECTURE, SYSTEMDRIVE,
 *   SYSTEMROOT, TEMP, USERNAME, USERPROFILE, PROGRAMFILES), so the
 *   child-env finish also writes an explicit `undefined` tombstone for
 *   every underlay name it did not sanction -- the key overrides the
 *   ambient default inside the union and Node's spawn drops
 *   `undefined`-valued entries entirely, preserving denied-by-absence
 *   through the union. The vendored dependency bytes stay exact.
 * - Egress: when the Resident sandbox's egress wiring is present, the pin
 *   `http://127.0.0.1:<OMA_EGRESS_PROXY_PORT>` is installed and every
 *   upstream HTTP leaf (MCP stream fetches, OAuth/auth service requests,
 *   endpoint probes, semantic-search calls) rides the vendored undici's
 *   ProxyAgent -- loopback stays direct. Stdio children receive only the
 *   reproduced pin values through the shared child-env allowlist, never
 *   an inherited or config-declared proxy. Without the wiring there is
 *   no pin and no dispatcher -- upstream's own direct-fetch semantics.
 * - Credentials: the OAuth secret store is pinned to the encrypted-file
 *   backend keyed by an OMA-generated file under the OMA-owned state dir
 *   (or a memory store when no state dir exists); the OS keyring is
 *   unreachable, so no host credential is read, imported or recovered.
 * - Lifecycle: upstream's own session_start/session_shutdown owners are
 *   forwarded through the facade -- connections abort, OAuth runtimes
 *   shut down and the runtime owner's AbortController chains exactly as
 *   upstream intends; OMA's own scratch dir is rotated on session_start
 *   and removed on session_shutdown.
 * - Dependencies: the bundle's own node_modules resolves every vendored
 *   dependency import; nothing reaches a user-installed package.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { vendoredBundleDir, verifyVendorBundle } from "./vendor-bundle.js";
import { buildChildEnv, egressProxyValue } from "./child-env.js";
// Type-only: erased at compile, so this never evaluates the vendored
// module before verification.
import type { OmaMcpPolicy } from "./vendor/pi-mcp-adapter/runtime/utils.js";
import type { McpConfig, McpSettings } from "./vendor/pi-mcp-adapter/runtime/types.js";
import type { McpAdapterOptions } from "./vendor/pi-mcp-adapter/runtime/index.js";

/** The MCP surface, verbatim: the one tool the facade admits and the
 * surface plan names. No second grouping layer is added -- upstream's
 * `mcp` IS the proxy surface. */
export const MCP_TOOL_NAMES = Object.freeze(["mcp"] as const);

/** Registrations the facade refused, in order -- every command, flag and
 * shortcut upstream would register. Exported read-only for the boundary
 * tests; reset on each registration. */
export const mcpFacadeDropped: ReadonlyArray<{ kind: "command" | "flag" | "shortcut"; name: string }> = [];
const dropped = mcpFacadeDropped as { kind: "command" | "flag" | "shortcut"; name: string }[];

export interface McpToolsOptions {
  /** The OMA-owned programmatic config. When absent, the OMA-owned file
   * `<PI_CODING_AGENT_DIR>/mcp-adapter.json` is read; when that is absent too, an
   * empty config is used (the `mcp` tool still registers -- status and
   * runtime-registered servers keep working). A path may never reach
   * upstream: this is OMA's own read, upstream's discovery never runs. */
  readonly config?: unknown;
  /** OMA-owned engine agent dir -- defaults to PI_CODING_AGENT_DIR. When
   * neither exists the adapter runs on an ephemeral scratch state dir and
   * credentials cannot persist (authStore falls back to memory). */
  readonly agentDir?: string | undefined;
  /** The bundle root to verify -- defaults to the deployed vendored copy
   * beside this module. Tests point it at a copy they may corrupt. */
  readonly bundleDir?: string | undefined;
  /** true where a human sits at the session UI (the Principal's attached
   * engine): sampling and elicitation settings pass through; they are
   * stripped to false everywhere else. */
  readonly interactive?: boolean;
}

/* ------------------------------------------------------------------ */
/* OMA-owned config normalization.                                      */
/* ------------------------------------------------------------------ */

/** Settings keys OMA honors verbatim. Everything else in `settings` is a
 * boundary error: a forbidden surface asks for failure, not a clamp. */
const ALLOWED_SETTINGS: ReadonlySet<string> = new Set([
  "outputGuard", "toolResultRendering", "collapsedResultLines",
  "mcpFooterStatus", "showStatusIcon", "notifyOnStartupConnect",
  "deferWithMissingMetadata", "approveTools", "authRequiredMessage",
  "idleTimeout", "requestTimeoutMs", "trace", "jev",
  "sampling", "elicitation",
]);

/** Server-entry keys OMA accepts. `directTools`, `caFile`,
 * `requestHeadersCommand`, `pluginDataDir` and `literalEnv` are absent --
 * the surface clamp, the host-CA read, the per-request header command and
 * the plugin-data path have no OMA counterpart, and literalEnv exists only
 * for plugin env rules. */
const ALLOWED_SERVER_KEYS: ReadonlySet<string> = new Set([
  "description", "command", "args", "cwd", "env", "inheritEnv",
  "url", "socket", "headers", "auth", "bearerToken", "bearerTokenEnv",
  "bearerTokenStore", "oauth", "lifecycle", "idleTimeout",
  "requestTimeoutMs", "includeTools", "excludeTools", "searchKeywords",
  "exposeResources", "approveTools", "debug", "trace", "httpTransport",
  "protocolVersion", "tasks", "disabled",
]);

const ALLOWED_OAUTH_KEYS: ReadonlySet<string> = new Set([
  "grantType", "clientId", "clientSecret", "clientMetadataUrl", "scope",
  "authorizationParams", "redirectUri", "clientName", "clientUri",
  "logoUri", "authServerMetadataUrl", "skipIssuerMetadataValidation",
]);

const MCP_SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function configError(detail: string): Error {
  return new Error(`[E_OMA_MCP_CONFIG] ${detail}`);
}

/** A `!value` string marks an upstream command-secret sink (a spawned
 * shell); `!!` is the upstream literal escape and stays harmless. */
function isCommandSink(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("!") && !value.startsWith("!!");
}

function rejectCommandSinks(record: unknown, where: string): void {
  if (record === null || typeof record !== "object") return;
  for (const [key, value] of Object.entries(record as Record<string, unknown>))
    if (isCommandSink(value)) throw configError(`${where}.${key}: "!command" secret sinks are not permitted`);
}

function normalizeServer(name: string, raw: unknown): Record<string, unknown> {
  if (!MCP_SERVER_NAME.test(name))
    throw configError(`invalid server name ${JSON.stringify(name)}`);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw configError(`server ${JSON.stringify(name)} must be an object`);
  const entry = raw as Record<string, unknown>;
  for (const key of Object.keys(entry))
    if (!ALLOWED_SERVER_KEYS.has(key)) throw configError(`server ${JSON.stringify(name)}: key ${JSON.stringify(key)} is not permitted`);

  const kinds = [entry.command, entry.url, entry.socket].filter(v => v !== undefined).length;
  if (kinds > 1) throw configError(`server ${JSON.stringify(name)}: command, url and socket are mutually exclusive`);

  if (entry.command !== undefined) {
    if (typeof entry.command !== "string" || entry.command.trim() === "")
      throw configError(`server ${JSON.stringify(name)}: command must be a non-empty string`);
    // Package fetchers are refused by basename -- directory prefixes and
    // the win32 .cmd/.exe/.bat/.ps1 shims stripped, case-folded -- so
    // "/usr/bin/npx" or "C:\\tools\\npm.cmd" is the same admission as the
    // bare name, not a bypass of the no-fetch rule. win32 also strips a
    // name's trailing dots and spaces before resolving it, so "npx.",
    // "npx.cmd." or "npx.." still reach npx.cmd: collapse trailing
    // [.\s]+ and the shim extensions to a fixpoint before comparing --
    // over-folding is the safe direction here, it can only refuse more
    // spellings of the same fetcher.
    let commandLeaf = (entry.command.split(/[\\/]/).pop() ?? "").trim().toLowerCase();
    for (;;) {
      const next = commandLeaf.replace(/[.\s]+$/, "").replace(/\.(cmd|exe|bat|ps1)$/, "");
      if (next === commandLeaf) break;
      commandLeaf = next;
    }
    if (commandLeaf === "npx" || commandLeaf === "npm")
      throw configError(`server ${JSON.stringify(name)}: command ${JSON.stringify(entry.command)} would fetch packages at connect time; install the server and name the binary`);
  }
  if (entry.url !== undefined) {
    let parsed: URL;
    try { parsed = new URL(entry.url as string); }
    catch { throw configError(`server ${JSON.stringify(name)}: url is not parseable`); }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      throw configError(`server ${JSON.stringify(name)}: url protocol ${parsed.protocol} is not http(s)`);
  }
  if (entry.socket !== undefined &&
    (typeof entry.socket !== "string" || !isAbsolute(entry.socket)))
    throw configError(`server ${JSON.stringify(name)}: socket must be an absolute path`);
  if (entry.args !== undefined &&
    (!Array.isArray(entry.args) || entry.args.some(a => typeof a !== "string")))
    throw configError(`server ${JSON.stringify(name)}: args must be a string array`);

  // `!command` secret sinks, and the provider-auth channel that would read
  // the host Pi's own provider credentials, are refused here; the vendored
  // splices refuse them again at runtime.
  rejectCommandSinks(entry.env, `server ${JSON.stringify(name)} env`);
  rejectCommandSinks(entry.headers, `server ${JSON.stringify(name)} headers`);
  if (isCommandSink(entry.bearerToken))
    throw configError(`server ${JSON.stringify(name)}: "!command" bearerToken sinks are not permitted`);
  if (typeof entry.auth === "object" && entry.auth !== null)
    throw configError(`server ${JSON.stringify(name)}: auth { provider } would read the host Pi's provider credentials; use bearer/oauth`);
  if (entry.auth !== undefined && !["oauth", "bearer", false].includes(entry.auth as never))
    throw configError(`server ${JSON.stringify(name)}: auth must be "oauth", "bearer" or false`);
  if (entry.oauth !== undefined && entry.oauth !== false) {
    const oauth = entry.oauth as Record<string, unknown>;
    if (oauth === null || typeof oauth !== "object" || Array.isArray(oauth))
      throw configError(`server ${JSON.stringify(name)}: oauth must be an object or false`);
    for (const key of Object.keys(oauth))
      if (!ALLOWED_OAUTH_KEYS.has(key)) throw configError(`server ${JSON.stringify(name)}: oauth.${key} is not permitted`);
    if (isCommandSink(oauth.clientSecret))
      throw configError(`server ${JSON.stringify(name)}: "!command" oauth.clientSecret sinks are not permitted`);
  }
  return { ...entry };
}

/** The settings the vendored adapter sees. OMA-forced pins are applied
 * unconditionally; file-supplied keys outside ALLOWED_SETTINGS are a
 * boundary error. `sampling`/`elicitation` pass through only where a
 * human UI exists. */
function normalizeSettings(raw: unknown, interactive: boolean, stateDir: string): Record<string, unknown> {
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw)))
    throw configError("settings must be an object");
  const file = (raw ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(file))
    if (!ALLOWED_SETTINGS.has(key)) throw configError(`settings.${key} is not permitted`);
  if (!interactive && (file.sampling === true || file.elicitation === true))
    throw configError("settings.sampling/elicitation require an interactive role");
  // OMA pins -- some of these are upstream defaults already, but a file or
  // a drifted upstream default can never re-open them. The file keys are
  // already restricted to ALLOWED_SETTINGS above, so the spread can only
  // add pass-throughs, never re-open a pin.
  const settings: Record<string, unknown> = {
    directTools: false,
    namespaceProxyTools: false,
    scriptMode: false,
    autoAuth: false,
    allowInstall: false,
    hostConfigDiscovery: "off",
    exposeResources: false,
    // The credential and state roots OMA owns.
    oauthDir: join(stateDir, "oauth"),
    oauthCredentialStore: "encrypted-file",
    // Pass-throughs (validated above).
    ...file,
    ...(interactive ? {} : { sampling: false, elicitation: false }),
  };
  // Trace files are OMA-owned regardless of what the file names.
  const trace = settings.trace as Record<string, unknown> | undefined;
  if (trace !== undefined) {
    if (trace === null || typeof trace !== "object" || Array.isArray(trace))
      throw configError("settings.trace must be an object");
    settings.trace = { ...trace, file: join(stateDir, "mcp-trace.jsonl") };
  }
  return settings;
}

/** The config the vendored adapter sees: { mcpServers, settings } only.
 * `imports` and `claudePlugins` are rejected -- no host/package/plugin
 * config path exists under OMA. */
export function normalizeOmaMcpConfig(raw: unknown, options?: { interactive?: boolean; stateDir?: string }): McpConfig {
  const stateDir = options?.stateDir ?? join(tmpdir(), "oma-mcp-state");
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw configError("config must be an object");
  const file = raw as Record<string, unknown>;
  for (const key of Object.keys(file))
    if (key !== "mcpServers" && key !== "settings") throw configError(`key ${JSON.stringify(key)} is not permitted`);
  const servers = file.mcpServers;
  if (servers !== undefined && (servers === null || typeof servers !== "object" || Array.isArray(servers)))
    throw configError("mcpServers must be an object");
  const mcpServers: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries((servers ?? {}) as Record<string, unknown>))
    mcpServers[name] = normalizeServer(name, entry);
  return {
    mcpServers: mcpServers as McpConfig["mcpServers"],
    settings: normalizeSettings(file.settings, options?.interactive === true, stateDir) as McpSettings,
  };
}

/* ------------------------------------------------------------------ */
/* OMA-owned state dir + credential key.                                */
/* ------------------------------------------------------------------ */

/** The names the vendored MCP SDK's StdioClientTransport unions beneath
 * `serverParams.env` at spawn (its `getDefaultEnvironment()`): the POSIX
 * list plus every win32 spelling, so the tombstone binds whichever list
 * applies — and a config that reaches the other platform's runtime cannot
 * leak its names either. This list mirrors the vendored
 * DEFAULT_INHERITED_ENV_VARS by hand; the boundary test parses both
 * platform lists out of the verified bundle bytes and fails the moment a
 * vendored SDK bump adds a name this underlay does not tombstone and the
 * child-env posture does not sanction. */
const SDK_STDIO_ENV_UNDERLAY: ReadonlyArray<string> = [
  "HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER",
  "APPDATA", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "PROCESSOR_ARCHITECTURE",
  "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "USERNAME", "USERPROFILE", "PROGRAMFILES",
];

/** The env map handed to the vendored transport: the scrubbed entries plus
 * an explicit `undefined` tombstone on every underlay name the scrub did
 * not sanction. Inside the SDK's `{ ...getDefaultEnvironment(), ...env }`
 * union (the same expression in its ESM and CJS builds) the tombstone key
 * overrides the ambient default, and Node's spawn drops `undefined`-valued
 * entries entirely — denial by absence survives the union without touching
 * the vendored dependency bytes. */
function withSdkEnvTombstones(env: Record<string, string>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  for (const name of SDK_STDIO_ENV_UNDERLAY)
    if (!Object.hasOwn(out, name)) out[name] = undefined;
  return out;
}

function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(path, 0o700);
}

/** The encrypted-file store key: persisted under the OMA state dir when
 * one exists, else generated per process (matching the memory store the
 * ephemeral policy falls back to). Never an env read. */
function oauthFileKey(stateDir: string): string {
  const keyPath = join(stateDir, "oauth-file-key");
  let raw: string | undefined;
  try {
    raw = readFileSync(keyPath, "utf8").trim();
  } catch (error) {
    // Absent means ENOENT only: an unreadable key file must refuse, never
    // rotate a fresh key that silently orphans the sealed store.
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") raw = undefined;
    else throw error;
  }
  if (raw !== undefined) {
    // Canonical base64 of exactly 32 bytes -- the same contract upstream's
    // own encrypted-file store enforces.
    if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) return raw;
    throw new Error(`[E_OMA_MCP_STATE] ${keyPath} is not a canonical 32-byte base64 key`);
  }
  const key = randomBytes(32).toString("base64");
  writeFileSync(keyPath, `${key}\n`, { encoding: "utf8", mode: 0o600 });
  return key;
}

/* ------------------------------------------------------------------ */
/* The facade.                                                          */
/* ------------------------------------------------------------------ */

interface VendoredIndex {
  createMcpAdapter(options: McpAdapterOptions): (pi: ExtensionAPI) => void;
}
interface VendoredUtils {
  omaInstallMcpPolicy(policy: OmaMcpPolicy | undefined): void;
}

/** The ExtensionAPI upstream's factory is allowed to see. `mcp` is the
 * only tool name that may register; commands, flags and shortcuts are
 * recorded, not registered; `exec` is refused (browser opening is its
 * only call site); `registerMcpServer`/`getMcpServers` are absent so
 * vendored `piSupportsMcp` is false and Pi's built-in MCP can never run
 * beside this adapter. Session plumbing -- `on`, `events`, `appendEntry`,
 * `sendMessage`, `sendUserMessage`, `getFlag`, the active-tools accessors
 * upstream's lazy-tool management needs -- is forwarded unchanged. */
function mcpFacade(pi: ExtensionAPI, registered: Set<string>): ExtensionAPI {
  const optional = (name: "unregisterTool" | "appendEntry" | "sendMessage" | "sendUserMessage" | "getFlag" | "getActiveTools" | "setActiveTools" | "getAllTools") => {
    const value = (pi as unknown as Record<string, unknown>)[name];
    return typeof value === "function" ? (value as Function).bind(pi) : undefined;
  };
  const facade = {
    registerTool(definition: { name: string }) {
      if (!(MCP_TOOL_NAMES as readonly string[]).includes(definition.name))
        throw new Error(`[E_OMA_MCP_SURFACE] vendored pi-mcp-adapter tried to register unlisted tool ${JSON.stringify(definition.name)}`);
      if (registered.has(definition.name))
        throw new Error(`[E_OMA_MCP_SURFACE] vendored pi-mcp-adapter registered ${definition.name} twice`);
      registered.add(definition.name);
      return pi.registerTool(definition as Parameters<ExtensionAPI["registerTool"]>[0]);
    },
    registerCommand(name: string) { dropped.push({ kind: "command", name }); },
    registerFlag(name: string) { dropped.push({ kind: "flag", name: String(name) }); },
    registerShortcut(name: string) { dropped.push({ kind: "shortcut", name: String(name) }); },
    on: pi.on.bind(pi),
    events: (pi as unknown as { events?: unknown }).events,
    unregisterTool: optional("unregisterTool"),
    appendEntry: optional("appendEntry"),
    sendMessage: optional("sendMessage"),
    sendUserMessage: optional("sendUserMessage"),
    getFlag: optional("getFlag"),
    getActiveTools: optional("getActiveTools"),
    setActiveTools: optional("setActiveTools"),
    getAllTools: optional("getAllTools"),
    exec() {
      throw new Error("[E_OMA_SUBPROCESS] vendored pi-mcp-adapter asked for pi.exec -- the only call sites are browser/path opening, which OMA does not expose");
    },
  };
  return facade as unknown as ExtensionAPI;
}

/** The deployment's egress pin -- the Resident sandbox's loopback CONNECT
 * forwarder -- derived exactly as the spawn plan derives the env proxies. */
function egressPinnedProxy(): string | null {
  return egressProxyValue("https_proxy") ?? null;
}

export async function registerMcpTools(pi: ExtensionAPI, options?: McpToolsOptions): Promise<void> {
  const bundleDir = options?.bundleDir ?? vendoredBundleDir("pi-mcp-adapter");
  try {
    verifyVendorBundle(bundleDir);
  } catch (error) {
    pi.on("session_start", () => {
      try {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`bundled pi-mcp-adapter payload failed integrity verification; refusing session: ${message}\n`);
      } catch { /* best effort */ }
      process.exit(1);
    });
    return;
  }

  // OMA-owned state. The durable root is the engine's own agent dir; when
  // none was provisioned the adapter gets an ephemeral scratch instead --
  // either way, upstream's ~/.pi/agent discovery can never run.
  const agentRoot = options?.agentDir ?? process.env.PI_CODING_AGENT_DIR;
  const durable = agentRoot !== undefined && isAbsolute(agentRoot);
  const stateDir = durable
    ? join(agentRoot as string, "mcp-adapter")
    : join(tmpdir(), `oma-mcp-${process.pid}-${randomBytes(4).toString("hex")}`);
  ensurePrivateDir(stateDir);
  const scratchDir = join(stateDir, "scratch");
  const resetScratch = () => {
    rmSync(scratchDir, { recursive: true, force: true });
    ensurePrivateDir(scratchDir);
    ensurePrivateDir(join(scratchDir, "spill"));
  };
  resetScratch();
  // An ephemeral state dir is removed with the process.
  if (!durable) process.on("exit", () => rmSync(stateDir, { recursive: true, force: true }));

  // The OMA-owned config: the explicit option wins; else the OMA-owned
  // file <agentDir>/mcp-adapter.json, read by OMA itself -- upstream's config
  // discovery never runs, and a missing file is an empty config (the `mcp`
  // tool still registers; runtime-registered servers keep working). A
  // malformed file is a boundary error, not a degraded startup.
  let rawConfig: unknown = options?.config;
  if (rawConfig === undefined && durable) {
    const configPath = join(agentRoot as string, MCP_CONFIG_FILE_NAME);
    // Absent means ENOENT only: an unreadable or non-file path must refuse,
    // never masquerade as an empty config (P0-5: catch the code, not the
    // probe -- existsSync conflates EACCES with absence).
    const stat = (() => {
      try { return statSync(configPath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return undefined;
        throw error;
      }
    })();
    if (stat !== undefined) {
      if (!stat.isFile()) throw new Error(`[E_OMA_MCP_CONFIG] ${configPath} is not a regular file`);
      const bytes = readFileSync(configPath, "utf8");
      try {
        rawConfig = JSON.parse(bytes);
      } catch (error) {
        throw new Error(`[E_OMA_MCP_CONFIG] ${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const config = normalizeOmaMcpConfig(rawConfig ?? { mcpServers: {} }, {
    interactive: options?.interactive === true, stateDir,
  });

  // The credential store: encrypted-file keyed by an OMA-held key under
  // the OMA state dir when the deployment is durable; memory-only when it
  // is not -- the OS keyring is unreachable either way.
  const authStore: "memory" | "encrypted-file" = durable ? "encrypted-file" : "memory";
  const oauthKey = durable ? oauthFileKey(stateDir) : undefined;

  // The OMA contract inside the vendored runtime -- installed before the
  // factory runs, deny-by-default: no permit is set, so `!command` secret
  // sinks, browser opening and the OS keyring all refuse; the ambient-env
  // view is empty, so operator-exported knobs (MCP_DIRECT_TOOLS,
  // MCP_OAUTH_*, NPM_CONFIG_CACHE, BROWSER, SYSTEMONE_*, the
  // PI_MCP_ADAPTER_* selectors) cannot reach vendored code.
  const utils = await import("./vendor/pi-mcp-adapter/runtime/utils.js") as VendoredUtils;
  const policy: OmaMcpPolicy = {
    agentDir: stateDir,
    tmpDir: join(scratchDir, "spill"),
    egressPinned: egressPinnedProxy(),
    env: {},
    childEnv: (base) => buildChildEnv(base),
    childEnvFinish: (merged) => withSdkEnvTombstones(buildChildEnv({}, merged, scratchDir)),
    authStore,
    ...(oauthKey !== undefined ? { oauthFileKey: oauthKey } : {}),
    permits: {},
  };
  utils.omaInstallMcpPolicy(policy);

  // The lifecycle scratch: children inherit HOME/XDG/TMP pointing at it,
  // so per-session respawn means a fresh HOME; the session's shutdown
  // removes it after upstream's owner has killed the children.
  pi.on("session_start", () => resetScratch());
  pi.on("session_shutdown", () => rmSync(scratchDir, { recursive: true, force: true }));

  const vendored = await import("./vendor/pi-mcp-adapter/runtime/index.js") as VendoredIndex;
  dropped.length = 0;
  const registered = new Set<string>();
  const factory = vendored.createMcpAdapter({ config });
  factory(mcpFacade(pi, registered));

  // The surface contract, asserted after the factory ran: exactly `mcp`,
  // once -- a renamed, missing or extra registration is an adapter bug,
  // not a configuration, so it fails the extension load rather than
  // registering half a surface.
  const names = [...registered];
  if (names.length !== MCP_TOOL_NAMES.length ||
    !MCP_TOOL_NAMES.every(name => registered.has(name)))
    throw new Error(`[E_OMA_MCP_SURFACE] vendored pi-mcp-adapter registered [${names.join(", ")}]; expected exactly [${MCP_TOOL_NAMES.join(", ")}]`);
}

/** The exact env map a stdio MCP server's spawn would see for a declared
 * env block -- the same composition the vendored resolveEnv applies
 * through the policy seam (inherited base scrub, declared scrub, scratch
 * redirects), plus the `undefined` tombstones that keep the SDK's
 * getDefaultEnvironment union from re-adding denied ambient names.
 * Exported so the boundary test can pin it without a full MCP handshake.
 * `scratch` is the per-session scratch the caller owns. */
export function mcpChildEnvironment(declared: Record<string, string> | undefined, scratch: string): Record<string, string | undefined> {
  return withSdkEnvTombstones(buildChildEnv(process.env, declared, scratch));
}

/** The adapter's OMA-owned state dir under PI_CODING_AGENT_DIR and the
 * OMA-owned config file name beside it. "mcp-adapter.json" is upstream's
 * own adapter-config name (ADAPTER_CONFIG_NAME) -- deliberately not Pi's
 * "mcp.json", so the file can never double as Pi built-in MCP config. */
export const MCP_STATE_DIR_NAME = "mcp-adapter";
export const MCP_CONFIG_FILE_NAME = "mcp-adapter.json";
