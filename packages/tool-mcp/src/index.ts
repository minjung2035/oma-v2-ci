/** Bundled MCP adapter on OMA's single proxy tool surface. Explicit npm/npx
 * servers, credential/header commands, custom CAs, OAuth, auto-auth and install
 * use upstream capabilities. Installs persist in this engine's OMA config.
 * OMA supplies owned credentials/scratch and the scrubbed child environment;
 * automatic host provider/keyring discovery and separate UI-session tools keep
 * their own boundaries. Verified bytes load before registration, and session
 * hooks retain upstream connection and cleanup ownership. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { buildChildEnv, egressProxyValue } from "@oma/tool-runtime/child-env";
import { SDK_STDIO_ENV_UNDERLAY } from "./mcp-sdk-env.js";
import { vendoredBundleDir, verifyVendorBundle } from "@oma/tool-runtime/vendor-bundle";
// Type-only: erased at compile, so this never evaluates the vendored
// module before verification.
import type { McpAdapterOptions } from "./vendor/pi-mcp-adapter/runtime/index.js";
import type { McpConfig, McpSettings } from "./vendor/pi-mcp-adapter/runtime/types.js";
import type { OmaMcpPolicy } from "./vendor/pi-mcp-adapter/runtime/utils.js";

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
   * empty config is used (status and runtime-registered servers still work).
   * Upstream receives the owned destination for installs; ambient config
   * discovery does not replace the OMA config. */
  readonly config?: unknown;
  /** OMA-owned engine agent dir -- defaults to PI_CODING_AGENT_DIR. When
   * neither exists the adapter runs on an ephemeral scratch state dir and
   * credentials cannot persist (authStore falls back to memory). */
  readonly agentDir?: string | undefined;
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
  "sampling", "elicitation", "autoAuth", "allowInstall",
]);

/** Explicit server command/env/headers/auth/CA settings pass through. Direct
 * tool registration and plugin-specific data/env discovery keep their separate
 * surfaces; the MCP proxy owns OMA's declared model tool surface. */
const ALLOWED_SERVER_KEYS: ReadonlySet<string> = new Set([
  "description", "command", "args", "cwd", "env", "inheritEnv", "caFile", "requestHeadersCommand",
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

  // Provider-auth discovery stays separate from explicit MCP credentials.
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
    autoAuth: true,
    allowInstall: true,
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
      // The proxy refreshes its metadata after connect/install. Pi replaces
      // that same tool definition; the one-name surface stays unchanged.
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
    exec: pi.exec.bind(pi),
  };
  return facade as unknown as ExtensionAPI;
}

/** The deployment's egress pin -- the Resident sandbox's loopback CONNECT
 * forwarder -- derived exactly as the spawn plan derives the env proxies. */
function egressPinnedProxy(): string | null {
  return egressProxyValue("https_proxy") ?? null;
}

export async function registerMcpTools(pi: ExtensionAPI, options?: McpToolsOptions): Promise<void> {
  const bundleDir = vendoredBundleDir("pi-mcp-adapter", new URL("./", import.meta.url));
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
    permits: { "credential-command": true, "browser-open": true },
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
  const factory = vendored.createMcpAdapter({ config, ...(durable ? { configPath: join(agentRoot as string, MCP_CONFIG_FILE_NAME) } : {}) });
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
