/** code_intel: the bundled pi-lsp extension (vendored byte-pinned under
 * `src/extension/vendor/pi-lsp/`) exposed as exactly three OMA tools --
 * `lsp_diagnostics`, `lsp_fix`, `lsp_status` -- inside OMA's authority
 * model rather than upstream's "any agent cwd" model.
 *
 * What OMA owns, and where it lives:
 *
 * - Integrity: `verifyVendorBundle` runs at registration, and only after it
 *   passes is any vendored module evaluated -- every runtime import here is
 *   a dynamic `await import()` behind that check (this module itself only
 *   type-imports the vendored types, which erase at compile). A tampered or
 *   incomplete payload refuses the session, it does not degrade.
 * - Workspace root: every call resolves against the realpath'd workspace
 *   the engine was started on (pinned at extension load by
 *   `pi-extension.ts`), never `ctx.cwd`, never a model-supplied root --
 *   upstream's `root` parameter is not exposed. Upstream's own realpath
 *   containment then refuses symlink escapes inside that root a second
 *   time.
 * - Process lifecycle: per call, one LspClient per route -- spawn,
 *   JSON-RPC, shutdown, kill -- exactly as upstream's runner does it.
 *   There is no daemon: a resident's lease dies with its sandbox anyway,
 *   and a daemon would hold no authority a per-call process does not.
 *   `scope.run` links the call's AbortSignal to client.close(); session
 *   start resets the scope and session shutdown drains it, which aborts
 *   every in-flight operation (upstream's lifecycle, kept).
 * - Environment: a language server is not an OMA client, and a denylist
 *   for its env cannot converge -- the child shells out to toolchains,
 *   so every surviving name is a live injection channel (the blind
 *   verification of the rule-table denylist this replaces left 84
 *   survivors in a 161-name corpus, every one a real channel). The
 *   boundary is an allowlist,
 *   deny-by-default: the vendored `mergeEnvironment` itself no longer
 *   unions `process.env` (an OMA splice in command.js), so the map
 *   `hardenedAdapter` builds IS the child's whole environment. It
 *   admits the named allowlist -- `PATH` (the engine's or the adapter's
 *   declared one), locale/terminal identity (`LANG`, `LANGUAGE`,
 *   `LC_*`, `TZ`, `TERM`, `NO_COLOR`), login identity, Windows process
 *   plumbing -- plus the per-call scratch `HOME`/`XDG_*`/`TMPDIR`
 *   redirects so server-internal caches never land in the user's real
 *   home, and -- only when the engine's own egress wiring is present --
 *   the Resident sandbox's injected loopback proxy values, reproduced
 *   byte-for-byte. Adapter-declared env goes through the same
 *   predicate: a pi-lsp.json `env` block cannot name a channel the
 *   allowlist does not, so `GOPRIVATE` or `NODE_OPTIONS` declared there
 *   is stripped exactly as if inherited -- and the NAME itself must be
 *   `[A-Za-z0-9_]+` on the raw key: a key is the `NAME` half of the
 *   `NAME=value` string the child receives, so `LC_ALL=/etc/evil-locale`
 *   would otherwise serialize a path-shaped value straight past the
 *   token guard, and a NUL name is an unhandled ERR_INVALID_ARG_VALUE
 *   at spawn. Everything else --
 *   credentials, loader preloads, toolchain config, session/IPC
 *   authority, OMA/PI wiring, every other `*_proxy` -- is denied by
 *   absence, not emptied: loaders treat empty path-list elements as the
 *   current directory, so an empty-string tombstone would still be a
 *   channel.
 * - Server filesystem rights: the child process still carries ambient
 *   filesystem authority, and env redirection cannot stop a server that
 *   writes beside the files it indexes (clangd's project-root `.cache`
 *   is the observed case). OMA's answer is layered: HOME/XDG/TMP point at
 *   a per-call scratch that is removed when the call ends, and a
 *   read-only role -- the Principal, which must not write anywhere --
 *   is refused before any spawn: `lsp_status` still works, the two
 *   spawn-capable tools do not run under a role that cannot tolerate a
 *   server's internal writes.
 * - Mutation: `lsp_fix` is preview-only by default (`write` absent or
 *   false returns the computed text, like upstream). `write: true`
 *   reaches the filesystem only through OMA's contained writer -- the
 *   same byte-budgeted, workspace-contained serialized path the `write`
 *   tool uses -- never through upstream's own writeFileSync branch, which
 *   stays armed at `write: false`.
 * - Authority: the workspace guard lists `lsp_fix` in its conditional
 *   write gate, so a read-only role (the Principal) is refused before
 *   execute runs; the checks here are defense in depth, the guard is
 *   the gate.
 * - Availability: a configured server whose command is not on PATH is
 *   `unavailable`. The diagnostics aggregate is refused loud when every
 *   applicable server is unavailable -- "no diagnostics" is a state a
 *   server reports, not a state OMA invents for a server it never ran.
 * - Bounds: file count, file bytes (at admission and again after the
 *   read, so a file grown between stat and read is still refused), path
 *   list, timeout, configured server count, stderr accumulation, the
 *   inbound JSON-RPC frame buffer, per-file diagnostic count and message
 *   length, code-action count, workspace-walk depth, and an aggregate
 *   per-call deadline across routes are all clamped to OMA limits
 *   regardless of what `pi-lsp.json` or a server asks for. Over a bound
 *   the call fails as a tool error; nothing is silently truncated.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WorkspaceRefusal } from "./contained-files.js";
import { textResult } from "./shared.js";
import { vendoredBundleDir, verifyVendorBundle, type VendorVerification } from "./vendor-bundle.js";
// Type-only: erased at compile, so this never evaluates the vendored
// module before verification (PI-001 keeps runtime imports out too).
import type { LspServerAdapter } from "./vendor/pi-lsp/runtime/types.js";

export const LSP_TOOL_NAMES = Object.freeze(["lsp_diagnostics", "lsp_fix", "lsp_status"] as const);

/** OMA bounds over the upstream defaults: the model may narrow them,
 * never widen them. */
const LSP_MAX_FILES = 100;
const LSP_MAX_PATHS = 64;
const LSP_FILE_BYTES = 1_048_576;
const LSP_TIMEOUT_MS = 120_000;
const LSP_MAX_SERVERS = 64;
/** One tool call may fan out to several server routes; each route's own
 * request timeout still applies, but the whole call dies at this deadline
 * regardless of route count. */
const LSP_CALL_DEADLINE_MS = 300_000;
/** Pull-path mirror of the pushed-diagnostic bounds the vendored client
 * enforces (see generated.divergences in the bundle manifest). */
const LSP_MAX_DIAGNOSTICS_PER_FILE = 1_024;
const LSP_MAX_DIAGNOSTIC_MESSAGE_CHARS = 8_192;

const STATUS_KEY = "lsp";

export interface LspToolOptions {
  /** realpath'd workspace root the engine was started on. */
  readonly workspace: string;
  /** true for the Principal's engine -- write authority is refused, and a
   * language server (an ambient-authority child whose own caches can land
   * in the workspace it indexes) is never spawned for it. */
  readonly readOnly: boolean;
  /** OMA's contained serialized writer (the same seam `write` uses). */
  readonly write: (path: string, content: string) => Promise<void>;
  /** The bundle root to verify -- defaults to the deployed vendored copy
   * beside this module. Tests point it at a copy they may corrupt. */
  readonly bundleDir?: string | undefined;
  /** Aggregate per-call deadline across every route a call fans out to;
   * defaults to LSP_CALL_DEADLINE_MS. Tests shrink it to prove the bound. */
  readonly callDeadlineMs?: number | undefined;
}

interface LspRuntime {
  readonly adapters: LspServerAdapter[];
  readonly timeoutMs: number;
  readonly configNotice: string | undefined;
}

/** The exact environment names OMA hands a language-server child --
 * deny-by-default. A name absent from this table does not exist for the
 * child: the rule-table denylist this replaced enumerated known-bad
 * channels and verification proved it cannot converge (an independent
 * 161-name probe left 84 survivors, every one a toolchain config or
 * injection channel the child or its spawned toolchains would honor).
 * An allowlist is the only posture where an unenumerated channel is dead
 * on arrival instead of waiting for its name to be learned.
 *
 * Names are matched on the lowercased key; nothing is implied beyond the
 * table. The table is what a language server and the toolchains it
 * shells out to legitimately read: `path` for command lookup (the
 * engine's PATH or the adapter's declared one), `lang`/`language`/`tz`
 * and the `lc_` prefix for the locale its messages arrive in, `term`/
 * `no_color` for what its stderr may format, `user`/`logname`/`username`
 * for the login identity some servers stamp into log lines and paths,
 * and the Windows plumbing a spawned process cannot start without
 * (`systemroot`, `windir`, `systemdrive`, `comspec`, `pathext`).
 *
 * HOME, the XDG homes and the temp names are deliberately NOT in the
 * table: they are never inherited -- the per-call scratch supplies them
 * below so a server's user-level caches land where OMA removes them, and
 * neither the engine env nor a pi-lsp.json `env` block can point a
 * server's home elsewhere. `*_proxy` is not here either; see
 * `egressProxyValue` for the only proxy values a child may carry.
 * Exported so the boundary test can assert the child's keys are exactly
 * the sanctioned set. */
export const OMA_LSP_CHILD_ENV_ALLOW: ReadonlySet<string> = new Set([
  "path",
  "lang", "language", "tz", "term", "no_color",
  "user", "logname", "username",
  "systemroot", "windir", "systemdrive", "comspec", "pathext",
]);

/** The one name prefix the allowlist grants: `LC_*` locale-category
 * overrides (`LC_ALL`, `LC_CTYPE`, ...). The LC_ namespace carries
 * locale names -- values are guarded below -- so a prefix is honest
 * where an enumeration would silently miss a category. */
const OMA_LSP_CHILD_ENV_PREFIXES: ReadonlyArray<string> = ["lc_"];

/** Allowlist names whose values are paths or path-shaped by definition;
 * every other admitted name gets the token guard below. */
const CHILD_ENV_PATH_TYPED: ReadonlySet<string> = new Set([
  "path", "systemroot", "windir", "systemdrive", "comspec",
]);

/** A `/`, `\` or NUL inside a token value is a path channel wearing a
 * locale or identity name: glibc resolves `LC_*`/`LANG` values as locale
 * files, ncurses resolves `TERM` under its terminfo dirs, and a server
 * building paths from `USER` inherits whatever it was handed. `tz`
 * legitimately carries `Area/City` zone names, so only absolute paths,
 * the `:`-prefixed implementation form and parent traversal are refused
 * for it. `..` and NUL are refused for every token. */
function tokenValueAllowed(lower: string, value: string): boolean {
  if (value.includes("\0") || value.includes("..")) return false;
  if (lower === "tz") return !value.startsWith("/") && !value.startsWith(":");
  return !value.includes("/") && !value.includes("\\");
}

/** The proxy names OMA's Resident sandbox injects (pi-spawn-plan.ts),
 * lowercased -- the only `*_proxy` spellings a child may carry, and then
 * only the value `egressProxyValue` reproduces. */
const CHILD_PROXY_NAMES: ReadonlySet<string> = new Set([
  "http_proxy", "https_proxy", "all_proxy", "no_proxy",
]);

/** The one value a proxy var may carry: the Resident sandbox's own
 * injected loopback, recomputed from the engine's egress wiring. The
 * spawn plan's injection is `http://127.0.0.1:<OMA_EGRESS_PROXY_PORT>`
 * and a fixed `no_proxy` literal, and it exists only beside
 * `OMA_EGRESS_PROXY_SOCKET` (an absolute path): a host engine, or an env
 * carrying only part of the wiring, derives no pin and every proxy var
 * is denied. A credential-carrying or redirecting value cannot
 * reproduce the pin; inside the sandbox the child keeps exactly the
 * egress every other Resident tool has -- the CONNECT allowlist still
 * decides what it may dial, and no other route out exists. An
 * adapter-declared proxy goes through the same comparison, so
 * pi-lsp.json cannot re-arm a proxy channel either. */
function egressProxyValue(lower: string): string | undefined {
  const socket = process.env.OMA_EGRESS_PROXY_SOCKET;
  const port = process.env.OMA_EGRESS_PROXY_PORT;
  if (socket === undefined || !isAbsolute(socket) ||
    port === undefined || !/^\d+$/.test(port)) return undefined;
  return lower === "no_proxy" ? "127.0.0.1,localhost,::1" : `http://127.0.0.1:${Number(port)}`;
}

/** The one charset a child env name may be written in. A name is not
 * inert labeling: it is the `NAME` half of the `NAME=value` byte string
 * the child receives, so a key can carry what the value guard never
 * sees -- `LC_ALL=/etc/evil-locale` lowercases into the `lc_` prefix
 * and serializes as `LC_ALL=/etc/evil-locale=C`, a path smuggled
 * through the key side, and a NUL name is the same class (reaching
 * spawn as an unhandled ERR_INVALID_ARG_VALUE). Checked on the RAW key
 * before any folding: U+212A (KELVIN SIGN) lowercases to plain `k`, so
 * folding first would launder a hostile name into the `lc_` prefix.
 * `=` and NUL cannot be planted in process.env -- an environ entry is a
 * `name=value` C string -- so they arrive only through an adapter's
 * declared env; `..` and non-ASCII names ride either channel. */
const CHILD_ENV_KEY_CHARSET = /^[A-Za-z0-9_]+$/;

/** A name reaches the child only through the allowlist -- or, for the
 * four proxy names, only when its value is the sandbox's own injected
 * loopback byte-for-byte -- and only in the sanctioned name charset.
 * Case-insensitive, so a case-variant of an unlisted name inherits the
 * same verdict. Both `hardenedAdapter` tiers -- the inherited
 * process.env loop and the adapter's declared env -- funnel through
 * this one predicate; the per-call scratch names bypass it as compiler
 * constants. A NUL value is refused for every name up front -- the
 * path-typed names skip `tokenValueAllowed`, so without this line a
 * `PATH: "a\0b"` would reach spawn as an unhandled
 * ERR_INVALID_ARG_VALUE, the same class the key charset closed on the
 * name side. */
function admittedChildEnv(key: string, value: string): boolean {
  if (!CHILD_ENV_KEY_CHARSET.test(key) || value.includes("\0")) return false;
  const lower = key.toLowerCase();
  if (CHILD_PROXY_NAMES.has(lower)) return value === egressProxyValue(lower);
  const named = OMA_LSP_CHILD_ENV_ALLOW.has(lower) ||
    OMA_LSP_CHILD_ENV_PREFIXES.some(prefix => lower.startsWith(prefix));
  if (!named) return false;
  return CHILD_ENV_PATH_TYPED.has(lower) || tokenValueAllowed(lower, value);
}

/** The environment the language-server child gets, complete: the
 * vendored client's `mergeEnvironment` no longer unions `process.env`
 * (its OMA divergence in command.js), so this map IS the child's
 * environment -- deny-by-default, with no empty-string tombstones. An
 * emptied name is not a denied name: loaders treat empty path-list
 * elements as the current directory (`LD_LIBRARY_PATH=""` searches the
 * workspace), so a denied name must be absent, not blanked.
 *
 * The map is built in three tiers: the engine's allowlisted inherited
 * names first, the adapter's declared env second (an adapter-declared
 * PATH is the documented command-lookup override), the per-call
 * scratch's HOME/XDG/TMP redirects last. A same-spelling collision goes
 * to the later tier; a case-variant collision is the vendored merge's
 * own win32 dedup below, so a declared `Path` stays inert litter on
 * POSIX rather than shadowing PATH -- exactly upstream's platform
 * semantics. The scratch names are not allowlisted, so nothing else can
 * supply them: when a scratch exists they hold its value, and when none
 * does they are absent like everything else. */
function hardenedAdapter(adapter: LspServerAdapter, scratch?: string): LspServerAdapter {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (typeof value === "string" && admittedChildEnv(key, value)) env[key] = value;
  for (const [key, value] of Object.entries(adapter.env ?? {}))
    if (typeof value === "string" && admittedChildEnv(key, value)) env[key] = value;
  if (scratch !== undefined)
    for (const key of ["HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
      "TMPDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"])
      env[key] = scratch;
  return { ...adapter, env };
}

/** The exact environment the language-server child would get for this
 * adapter -- the vendored client's own `mergeEnvironment` applied to the
 * map `hardenedAdapter` builds. Because the vendored merge itself no
 * longer unions `process.env` (its OMA divergence), the returned keys
 * are exactly the sanctioned set: allowlisted names, plus the per-call
 * scratch redirects when a scratch is passed, plus the sandbox's pinned
 * loopback proxies when the egress wiring is present. Exported so tests
 * can pin the boundary; async because the vendored merge helper is
 * loaded lazily, behind bundle verification -- which runs here too,
 * keeping "no vendored byte evaluates unverified" absolute rather than
 * registration-only. */
export async function lspChildEnvironment(adapter: LspServerAdapter, scratch?: string): Promise<NodeJS.ProcessEnv> {
  verifyVendorBundle(vendoredBundleDir("pi-lsp"));
  const { mergeEnvironment } = await import("./vendor/pi-lsp/runtime/command.js");
  return mergeEnvironment(hardenedAdapter(adapter, scratch).env);
}

function clampTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return LSP_TIMEOUT_MS;
  return Math.min(Math.max(1000, Math.floor(timeoutMs)), LSP_TIMEOUT_MS);
}

/** Files upstream collected for a route, minus the ones OMA will not send
 * over stdio: oversized reads are counted and skipped, never silently. */
function boundedFiles(root: string, files: string[]): { files: string[]; oversized: string[] } {
  const kept: string[] = [];
  const oversized: string[] = [];
  for (const file of files) {
    try {
      const stat = statSync(file);
      if (!stat.isFile()) continue;
      if (stat.size > LSP_FILE_BYTES) { oversized.push(relative(root, file) || file); continue; }
      kept.push(file);
    } catch { /* a file that vanished between collect and open is skipped */ }
  }
  return { files: kept.slice(0, LSP_MAX_FILES), oversized };
}

/** The pull path's copy of the pushed-diagnostic bounds the vendored client
 * enforces: a server that answered `textDocument/diagnostic` with a flood
 * sees the same refusal a flooding `publishDiagnostics` would get. */
function boundDiagnostics(server: string, file: string, diagnostics: unknown): void {
  if (!Array.isArray(diagnostics)) return;
  if (diagnostics.length > LSP_MAX_DIAGNOSTICS_PER_FILE)
    throw new Error(`${server} LSP returned ${diagnostics.length} diagnostics for ${file}; OMA's bound is ${LSP_MAX_DIAGNOSTICS_PER_FILE}.`);
  for (const diagnostic of diagnostics) {
    const message = (diagnostic as { message?: unknown }).message;
    if (typeof message === "string" && message.length > LSP_MAX_DIAGNOSTIC_MESSAGE_CHARS)
      throw new Error(`${server} LSP returned a ${message.length}-char diagnostic message for ${file}; OMA's bound is ${LSP_MAX_DIAGNOSTIC_MESSAGE_CHARS}.`);
  }
}

const DiagnosticsParameters = Type.Object({
  paths: Type.Optional(Type.Array(Type.String(), {
    description: `Files or directories to check, relative to the workspace root (default: whole workspace). At most ${LSP_MAX_PATHS} entries.`,
  })),
  limit: Type.Optional(Type.Number({
    description: `Maximum files to check per selected server (default 50, at most ${LSP_MAX_FILES}).`,
  })),
  server: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], {
    description: "Optional configured LSP server name, or names. Defaults to all servers matching the file extension.",
  })),
});

const FixParameters = Type.Object({
  path: Type.String({ description: "File to fix, relative to the workspace root. The server is selected from configured file extensions." }),
  kind: Type.Optional(Type.String({ description: "Source action kind. Defaults to source.fixAll." })),
  server: Type.Optional(Type.String({ description: "Optional configured LSP server name. Required when several servers support the file." })),
  write: Type.Optional(Type.Boolean({
    description: "Write the computed edits through OMA's contained writer (default false: preview only). A read-only role cannot write.",
  })),
});

const StatusParameters = Type.Object({
  server: Type.Optional(Type.String({ description: "Only report the named LSP server." })),
});

type ToolResult = { content: { type: "text"; text: string }[]; details: unknown };

const textFromResult = (result: { content?: Array<{ type?: string; text?: string }> }): string =>
  result.content?.find(item => item.type === "text")?.text ?? "";

/** Everything this module needs from the verified vendored runtime. The
 * fields are the subset of each runtime module the adapter uses; loading
 * them here -- after `verifyVendorBundle` has passed, never at module
 * scope -- is what makes a tampered bundle refuse before any vendored
 * byte evaluates. */
interface VendoredRuntime {
  consumeLspConfigNotice(): string | undefined;
  loadRuntime(root: string, options: { projectTrusted: boolean }): { adapters: LspServerAdapter[]; timeoutMs: number };
  commandExists(command: string, cwd: string, pathValue?: string): boolean;
  commandPathValue(env: Record<string, string> | undefined): string;
  resolveCommandPath(command: string, cwd: string, platform: NodeJS.Platform, pathValue?: string): string | undefined;
  resolveSupportedFile(adapter: LspServerAdapter, root: string, filePath: string): string;
  runDiagnostics(adapter: LspServerAdapter, params: { root: string; files?: string[]; paths?: string[]; limit?: number },
    timeoutMs: number, signal: AbortSignal, ctx: { ui: { setStatus(key: string, text?: string): void } }, statusKey: string): Promise<unknown>;
  runFix(adapter: LspServerAdapter, params: { root: string; path: string; kind?: string; write?: boolean },
    timeoutMs: number, signal: AbortSignal, ctx: { ui: { setStatus(key: string, text?: string): void } }, statusKey: string): Promise<unknown>;
  selectDiagnosticRoutes(adapters: LspServerAdapter[], params: { root: string; paths?: string[]; server?: string | string[]; limit?: number },
    defaultLimit: number): { root: string; routes: { adapter: LspServerAdapter; reason: string; files: string[] }[]; skipped: { adapter: LspServerAdapter; reason: string }[] };
  selectFixRoute(adapters: LspServerAdapter[], params: { root: string; path: string; server?: string }):
    { root: string; route: { adapter: LspServerAdapter; reason: string } };
  LspSessionScope: new () => {
    assertOpen(): void;
    context<T extends object>(ctx: T): T;
    run<T>(caller: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
    close(): Promise<unknown>;
  };
}

async function loadVendoredRuntime(): Promise<VendoredRuntime> {
  const [adapters, command, files, runner, routes, sessionLifecycle] = await Promise.all([
    import("./vendor/pi-lsp/runtime/adapters.js"),
    import("./vendor/pi-lsp/runtime/command.js"),
    import("./vendor/pi-lsp/runtime/files.js"),
    import("./vendor/pi-lsp/runtime/runner.js"),
    import("./vendor/pi-lsp/runtime/routes.js"),
    import("./vendor/pi-lsp/runtime/session-lifecycle.js"),
  ]);
  return {
    consumeLspConfigNotice: adapters.consumeLspConfigNotice,
    loadRuntime: adapters.loadRuntime,
    commandExists: command.commandExists,
    commandPathValue: command.commandPathValue,
    resolveCommandPath: command.resolveCommandPath,
    resolveSupportedFile: files.resolveSupportedFile,
    runDiagnostics: runner.runDiagnostics,
    runFix: runner.runFix,
    selectDiagnosticRoutes: routes.selectDiagnosticRoutes,
    selectFixRoute: routes.selectFixRoute,
    LspSessionScope: sessionLifecycle.LspSessionScope,
  } as VendoredRuntime;
}

export async function registerLspTools(pi: ExtensionAPI, options: LspToolOptions): Promise<void> {
  // The vendored payload is verified before any of it becomes a tool --
  // and before any vendored module evaluates: every runtime import happens
  // below this check. A failed check refuses the whole session -- the
  // same fail-closed posture the provenance list and the surface plan
  // already take.
  let verification: VendorVerification;
  try {
    verification = verifyVendorBundle(options.bundleDir ?? vendoredBundleDir("pi-lsp"));
  } catch (error) {
    pi.on("session_start", () => {
      try {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`bundled pi-lsp payload failed integrity verification; refusing session: ${message}\n`);
      } catch { /* best effort */ }
      process.exit(1);
    });
    return;
  }
  const vendored = await loadVendoredRuntime();
  const { consumeLspConfigNotice, loadRuntime, commandExists, commandPathValue, resolveCommandPath,
    resolveSupportedFile, runDiagnostics, runFix, selectDiagnosticRoutes, selectFixRoute, LspSessionScope } = vendored;

  /** Load and bound the configured server catalog, exactly like upstream
   * (config is re-read per call so a pi-lsp.json change takes effect on the
   * next call; it is read from the agent dir only -- project trust is
   * OMA's, so pi-lsp never consults project-level trust for config). */
  const configuredRuntime = (workspace: string): LspRuntime => {
    const { adapters, timeoutMs } = loadRuntime(workspace, { projectTrusted: false });
    return {
      adapters: adapters.slice(0, LSP_MAX_SERVERS),
      timeoutMs: clampTimeout(timeoutMs),
      configNotice: consumeLspConfigNotice(),
    };
  };

  // Upstream's session seam, kept: one operation scope per session, reset
  // on session start (extension reload starts a new session), drained on
  // shutdown so a dying session takes its LSP children with it.
  const sessions = new WeakMap<object, { scope: InstanceType<typeof LspSessionScope>; generation: number }>();
  const sessionFor = (key: object) => {
    let session = sessions.get(key);
    if (!session) { session = { scope: new LspSessionScope(), generation: 0 }; sessions.set(key, session); }
    return session;
  };

  pi.on("session_start", async (_event, ctx) => {
    const session = sessionFor(ctx.sessionManager);
    const generation = ++session.generation;
    await session.scope.close();
    if (generation !== session.generation) return;
    session.scope = new LspSessionScope();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const session = sessionFor(ctx.sessionManager);
    session.generation++;
    await session.scope.close();
  });

  const statusCtx = (ctx: ExtensionContext) => ({ ui: ctx.ui });
  const missingReason = (adapter: LspServerAdapter): string | undefined =>
    commandExists(adapter.defaultCommand.command, options.workspace, commandPathValue(adapter.env))
      ? undefined
      : `${adapter.name} command missing`;

  /** A read-only role never spawns a language server: the child carries
   * ambient filesystem authority and env redirection cannot cover a server
   * that writes beside the files it indexes, so "the Principal cannot
   * write" would be a claim OMA could not keep. Status needs no child. */
  const requireSpawnRole = (tool: string): void => {
    if (options.readOnly)
      throw new WorkspaceRefusal(
        `${tool} spawns a language server with ambient filesystem authority -- a read-only role cannot run it. lsp_status still works; run diagnostics from a writable agent.`);
  };

  /** One call, one scratch: server-internal home/cache/temp writes land in
   * a directory OMA removes when the call ends. */
  const withScratch = <T>(fn: (scratch: string) => Promise<T>): Promise<T> => {
    const scratch = mkdtempSync(join(tmpdir(), "oma-lsp-"));
    return fn(scratch).finally(() => rmSync(scratch, { recursive: true, force: true }));
  };

  /** The aggregate deadline for one call across however many routes it fans
   * out to: each route still gets its own request timeout, but a hung or
   * slow route cannot multiply that timeout by the route count. The signal
   * merges the caller's abort with the deadline; an error surfaced while
   * the deadline -- not the caller -- fired is reported as the deadline. */
  const callDeadline = (tool: string, ownedSignal: AbortSignal) => {
    const ms = options.callDeadlineMs ?? LSP_CALL_DEADLINE_MS;
    const controller = new AbortController();
    const message = `${tool} exceeded OMA's ${ms}ms aggregate call deadline`;
    const timer = setTimeout(() => controller.abort(new Error(message)), ms);
    return {
      signal: AbortSignal.any([ownedSignal, controller.signal]),
      stop: () => clearTimeout(timer),
      fired: () => controller.signal.aborted && !ownedSignal.aborted,
      message,
    };
  };
  /** Re-report an in-flight failure as the deadline when the deadline is
   * what ended it -- the vendored abort text would only say "aborted". */
  const deadlineAware = (deadline: ReturnType<typeof callDeadline>, error: unknown): never => {
    if (deadline.fired()) throw new Error(deadline.message);
    throw error;
  };

  pi.registerTool({
    name: "lsp_diagnostics",
    label: "LSP Diagnostics",
    description:
      "Run diagnostics for workspace files using configured, language-agnostic LSP server routes. " +
      "Servers whose command is not installed are reported unavailable; a file checked by a running " +
      "server with no diagnostics is clean -- the two are never conflated.",
    promptSnippet: "Get diagnostics from configured LSP servers selected by file extension (missing servers are reported unavailable).",
    promptGuidelines: [
      "Use lsp_diagnostics when files need diagnostics from a configured LSP server.",
      "Use the server parameter only when the user asks for a specific configured LSP server or multiple servers match the same extension.",
      "If a configured server command is missing, report it as unavailable -- install it or update the server's command in pi-lsp.json.",
      "Use lsp_status to see which language servers are available before interpreting an empty result.",
    ],
    parameters: DiagnosticsParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      requireSpawnRole("lsp_diagnostics");
      if (params.paths !== undefined && params.paths.length > LSP_MAX_PATHS)
        throw new WorkspaceRefusal(`lsp_diagnostics accepts at most ${LSP_MAX_PATHS} paths`);
      const limit = Math.min(Math.max(1, Math.floor(params.limit ?? 50)), LSP_MAX_FILES);
      const scope = sessionFor(ctx.sessionManager).scope;
      return await scope.run(signal, async (ownedSignal) => await withScratch(async (scratch) => {
        const runtime = configuredRuntime(options.workspace);
        const { root, routes, skipped } = selectDiagnosticRoutes(runtime.adapters, {
          root: options.workspace,
          ...(params.paths === undefined ? {} : { paths: params.paths }),
          ...(params.server === undefined ? {} : { server: params.server }),
          limit,
        }, limit);
        // Re-filter each route's collected files through OMA's byte bound;
        // a route whose files are all oversized is dropped, not run.
        const bounded = routes
          .map(route => ({ ...route, bounded: boundedFiles(root, route.files) }))
          .filter(route => route.bounded.files.length > 0);
        const oversized = bounded.flatMap(route => route.bounded.oversized);
        if (bounded.length === 0) {
          if (skipped.length > 0)
            throw new Error(`LSP diagnostics unavailable: ${skipped.map(entry => `${entry.adapter.name} (${entry.reason})`).join("; ")}. ` +
              "Every applicable server's command is missing from PATH -- unavailable is not clean.");
          throw new Error("No supported files within OMA bounds to check.");
        }
        // The aggregate deadline bounds the whole call across routes.
        const deadline = callDeadline("lsp_diagnostics", ownedSignal);
        const results: { route: (typeof bounded)[number]; result: ToolResult }[] = [];
        try {
          for (const route of bounded) {
            deadline.signal.throwIfAborted();
            const result = await runDiagnostics(
              hardenedAdapter(route.adapter, scratch),
              { root, files: route.bounded.files },
              runtime.timeoutMs, deadline.signal, statusCtx(scope.context(ctx)), STATUS_KEY,
            ).catch(error => deadlineAware(deadline, error)) as ToolResult;
            // The pull path's diagnostics array is bounded here; the
            // pushed-diagnostics path is bounded inside the vendored client.
            for (const entry of (result.details as { files?: { path?: string; diagnostics?: unknown }[] } | undefined)?.files ?? [])
              boundDiagnostics(route.adapter.name, entry.path ?? "?", entry.diagnostics);
            results.push({ route, result });
          }
        } finally {
          deadline.stop();
        }
        const sections = results.map(({ route, result }) => `${route.reason}\n\n${textFromResult(result)}`);
        if (skipped.length > 0)
          sections.push(`Unavailable LSP server(s), not run: ${skipped.map(entry => `${entry.adapter.name} (${entry.reason})`).join("; ")}.`);
        if (oversized.length > 0)
          sections.push(`Skipped oversized file(s): ${oversized.join(", ")}.`);
        if (runtime.configNotice !== undefined)
          sections.push(`config: ${runtime.configNotice}`);
        return textResult(sections.join("\n\n---\n\n"), {
          root,
          routes: results.map(({ route, result }) => ({
            server: route.adapter.name,
            reason: route.reason,
            files: route.bounded.files.map(file => relative(root, file) || file),
            details: result.details,
          })),
          unavailable: skipped.map(entry => ({ server: entry.adapter.name, reason: entry.reason })),
          oversized,
          summary: {
            files: results.reduce((total, { result }) => total + (((result.details as { summary?: { files?: number } })?.summary?.files) ?? 0), 0),
            diagnostics: results.reduce((total, { result }) => total + (((result.details as { summary?: { diagnostics?: number } })?.summary?.diagnostics) ?? 0), 0),
            unavailableServers: skipped.length,
            oversizedFiles: oversized.length,
          },
        });
      }));
    },
  });

  pi.registerTool({
    name: "lsp_fix",
    label: "LSP Fix",
    description:
      "Compute language-server code-action fixes for one file. Preview by default: the " +
      "computed replacement text is returned without writing. With write: true the edits are " +
      "applied through OMA's contained writer; a read-only role is refused.",
    promptSnippet: "Compute LSP source fixes for a file (preview only; write: true applies them)",
    promptGuidelines: [
      "Use lsp_fix for files handled by a configured LSP code-action server.",
      "Use kind when the server needs a specific source action kind such as source.organizeImports.",
      "Preview first: call without write, then apply with write: true once the edits look right.",
    ],
    parameters: FixParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      requireSpawnRole("lsp_fix");
      if (params.write === true && options.readOnly)
        throw new WorkspaceRefusal("lsp_fix write requested but this role is read-only: preview the computed changes instead");
      const scope = sessionFor(ctx.sessionManager).scope;
      return await scope.run(signal, async (ownedSignal) => await withScratch(async (scratch) => {
        const runtime = configuredRuntime(options.workspace);
        const { root, route } = selectFixRoute(runtime.adapters, {
          root: options.workspace, path: params.path,
          ...(params.server === undefined ? {} : { server: params.server }),
        });
        const adapter = hardenedAdapter(route.adapter, scratch);
        // OMA bound: the file is read whole into the JSON-RPC request.
        const file = resolveSupportedFile(adapter, root, params.path);
        const stat = statSync(file);
        if (stat.size > LSP_FILE_BYTES)
          throw new WorkspaceRefusal(`${params.path} is ${stat.size} bytes; lsp_fix is bounded to ${LSP_FILE_BYTES}`);
        // The per-call deadline also bounds the sequential codeAction/resolve
        // loop (each unresolved action is a request): a pathological action
        // list cannot stretch the call past it.
        const deadline = callDeadline("lsp_fix", ownedSignal);
        // Always compute in preview mode -- upstream's write branch never
        // runs. Mutation is OMA's contained writer below, after the signal
        // is still live and the role gate has passed.
        let preview: ToolResult;
        try {
          preview = await runFix(adapter, {
            root, path: params.path, write: false,
            ...(params.kind === undefined ? {} : { kind: params.kind }),
          }, runtime.timeoutMs, deadline.signal, statusCtx(scope.context(ctx)), STATUS_KEY)
            .catch(error => deadlineAware(deadline, error)) as ToolResult;
        } finally {
          deadline.stop();
        }
        const details = (preview.details ?? {}) as Record<string, unknown>;
        if (params.write !== true || details.changed !== true)
          return preview;
        ownedSignal.throwIfAborted();
        const relativePath = typeof details.path === "string" ? details.path : params.path;
        const newText = typeof details.text === "string" ? details.text : "";
        await options.write(relativePath, newText);
        return textResult(`${adapter.name} LSP fix updated ${relativePath}.`, {
          ...details, write: true, text: undefined, containedWrite: true,
        });
      }));
    },
  });

  pi.registerTool({
    name: "lsp_status",
    label: "LSP Status",
    description:
      "Report which configured language servers are available (command found on PATH) " +
      "and which are unavailable (command missing). Never reports a missing server as clean.",
    promptSnippet: "Show configured language servers and whether each is available on PATH",
    parameters: StatusParameters,
    async execute(_toolCallId, params, _signal, _update, _ctx) {
      const runtime = configuredRuntime(options.workspace);
      let adapters = runtime.adapters;
      if (params.server !== undefined) {
        adapters = adapters.filter(adapter => adapter.name === params.server);
        if (adapters.length === 0)
          throw new Error(`Unknown LSP server: ${params.server}`);
      }
      const rows = adapters.map(adapter => {
        const missing = missingReason(adapter);
        const resolved = missing === undefined
          ? resolveCommandPath(adapter.defaultCommand.command, options.workspace, process.platform,
              commandPathValue(adapter.env))
          : undefined;
        return {
          name: adapter.name,
          status: missing === undefined ? "ready" : "unavailable",
          command: [adapter.defaultCommand.command, ...adapter.defaultCommand.args],
          ...(resolved === undefined ? {} : { resolved }),
          extensions: adapter.extensions,
          isDefault: adapter.isDefault,
          ...(missing === undefined ? {} : { reason: missing }),
        };
      });
      const ready = rows.filter(row => row.status === "ready").length;
      const lines = [
        `LSP status for ${options.workspace}: ${rows.length} configured server(s) -- ${ready} ready, ${rows.length - ready} unavailable.`,
        "",
        ...rows.map(row => row.status === "ready"
          ? `${row.name}: ready -- '${row.command.join(" ")}'${row.resolved === undefined ? "" : ` at ${row.resolved}`}`
          : `${row.name}: unavailable -- '${row.command.join(" ")}' not found on PATH`),
      ];
      if (runtime.configNotice !== undefined) lines.push("", `config: ${runtime.configNotice}`);
      return textResult(lines.join("\n"), {
        root: options.workspace,
        bundle: { package: verification.package, version: verification.version, commit: verification.commit, sha256: verification.bundleSha256 },
        servers: rows,
        summary: { configured: rows.length, ready, unavailable: rows.length - ready },
      });
    },
  });
}
