/** code_intel: the bundled pi-lsp extension (vendored byte-pinned under
 * `vendor/pi-lsp/`) exposed as exactly three OMA tools --
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
 * - Bounds: numeric caps that could refuse legitimate work are converted,
 *   never silently. A caller's own timeout is floored at one second but
 *   never capped; the aggregate per-call deadline is gone -- replaced by
 *   a progress-reset stall window any inbound LSP frame restarts, so a
 *   server still streaming survives a call of any length and only a
 *   silent one is reclaimed. File lists, path lists and configured
 *   server counts are complete: a caller's `limit` is honored as its own
 *   choice and an absent one means the whole workspace, with the file
 *   count always visible in the result. Diagnostics over a per-file or
 *   message bound are truncated with a visible marker and count, never
 *   thrown. An oversized inbound frame refuses only the request its
 *   sniffed id names -- an unidentifiable frame (a notification, say) is
 *   dropped and counted, never blamed on the sole pending request. The
 *   didOpen loop honors stdin backpressure so a large corpus never
 *   materializes in this process's memory while a server reads slowly,
 *   and a per-file or per-route failure degrades to a named marker
 *   instead of discarding the results that did complete. What remains a
 *   refusal is a memory bound whose failure mode (engine OOM) is worse
 *   than the refusal -- the workspace-edit materialization -- and stderr
 *   accumulation, which is truncation with a marker already.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { statSync } from "node:fs";
import { relative } from "node:path";
import { Type } from "typebox";
import { buildChildEnv } from "@oma/tool-runtime/child-env";
import { WorkspaceRefusal } from "@oma/tool-files";
import { observeLspCall, withLspScratch } from "./lsp-call-scope.js";
import { textResult } from "@oma/tool-runtime/shared";
import { vendoredBundleDir, verifyVendorBundle, type VendorVerification } from "@oma/tool-runtime/vendor-bundle";
// Type-only: erased at compile, so this never evaluates the vendored
// module before verification (PI-001 keeps runtime imports out too).
import type { LspServerAdapter } from "./vendor/pi-lsp/runtime/types.js";

export const LSP_TOOL_NAMES = Object.freeze(["lsp_diagnostics", "lsp_fix", "lsp_status"] as const);

/** The timeout used when pi-lsp.json's `timeout` is absent or invalid.
 * A caller's positive value is floored at one second and never capped --
 * the configured budget is the caller's own choice. */
const LSP_TIMEOUT_MS = 120_000;
/** The silence window for one call across however many routes it fans
 * out to. Not a deadline: every inbound LSP frame restarts it, so a
 * server still streaming survives a call of any length and only a dead,
 * stopped or wedged server is reclaimed. It is never tighter than the
 * call's own per-request timeout, so a caller who asked for a longer
 * request budget is not undercut. */
const LSP_CALL_STALL_MS = 300_000;

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
  /** Silence window for the whole call across every route it fans out
   * to; defaults to LSP_CALL_STALL_MS and is never tighter than the
   * call's per-request timeout. Any inbound LSP frame restarts it --
   * tests shrink it to prove the progress reset. */
  readonly callStallMs?: number | undefined;
}

interface LspRuntime {
  readonly adapters: LspServerAdapter[];
  readonly timeoutMs: number;
  readonly configNotice: string | undefined;
}

/** The environment the language-server child gets, complete: the
 * vendored client's `mergeEnvironment` no longer seeds the result from
 * process.env (its OMA divergence in command.js), so the map this
 * builds IS the child's environment -- deny-by-default, with no
 * empty-string tombstones. Built in three tiers by the shared
 * `buildChildEnv`: the engine's allowlisted inherited names first, the
 * adapter's declared env second (an adapter-declared PATH is the
 * documented command-lookup override), the per-call scratch's
 * HOME/XDG/TMP redirects last. A same-spelling collision goes to the
 * later tier; a case-variant collision is the vendored merge's own win32
 * dedup below, so a declared `Path` stays inert litter on POSIX rather
 * than shadowing PATH -- exactly upstream's platform semantics. */
function hardenedAdapter(adapter: LspServerAdapter, scratch?: string): LspServerAdapter {
  return { ...adapter, env: buildChildEnv(process.env, adapter.env, scratch) };
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
  verifyVendorBundle(vendoredBundleDir("pi-lsp", new URL("./", import.meta.url)));
  const { mergeEnvironment } = await import("./vendor/pi-lsp/runtime/command.js");
  return mergeEnvironment(hardenedAdapter(adapter, scratch).env);
}

function clampTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return LSP_TIMEOUT_MS;
  return Math.max(1000, Math.floor(timeoutMs));
}

/** Files upstream collected for a route, minus the ones that are not
 * regular files or vanished between collect and open. Size is not a
 * refusal: the LSP didOpen carries the whole text either way, so the
 * cost is the file itself -- there is no amplification a byte bound
 * would guard. */
function liveFiles(files: string[]): string[] {
  const kept: string[] = [];
  for (const file of files) {
    try { if (statSync(file).isFile()) kept.push(file); }
    catch { /* a file that vanished between collect and open is skipped */ }
  }
  return kept;
}

const DiagnosticsParameters = Type.Object({
  paths: Type.Optional(Type.Array(Type.String(), {
    description: "Files or directories to check, relative to the workspace root (default: whole workspace).",
  })),
  limit: Type.Optional(Type.Number({
    description: "Maximum files to check per selected server (default: all collected files).",
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
  /** Registers a sink the vendored client calls with its adapter on every
   * inbound LSP frame chunk -- the per-call progress signal the stall
   * window resets on. Returns the unsubscribe. Exported by an OMA
   * divergence in lsp-client.js. */
  omaOnInboundFrame(sink: (adapter: LspServerAdapter) => void): () => void;
}

async function loadVendoredRuntime(): Promise<VendoredRuntime> {
  const [adapters, command, files, runner, routes, sessionLifecycle, lspClient] = await Promise.all([
    import("./vendor/pi-lsp/runtime/adapters.js"),
    import("./vendor/pi-lsp/runtime/command.js"),
    import("./vendor/pi-lsp/runtime/files.js"),
    import("./vendor/pi-lsp/runtime/runner.js"),
    import("./vendor/pi-lsp/runtime/routes.js"),
    import("./vendor/pi-lsp/runtime/session-lifecycle.js"),
    // The splice export lives in the verified .js; the upstream-emitted
    // .d.ts does not declare it, so the import is cast -- the bundle
    // check above already proved the export exists.
    import("./vendor/pi-lsp/runtime/lsp-client.js").then(
      module => module as unknown as Pick<VendoredRuntime, "omaOnInboundFrame">),
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
    omaOnInboundFrame: lspClient.omaOnInboundFrame,
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
    verification = verifyVendorBundle(vendoredBundleDir("pi-lsp", new URL("./", import.meta.url)));
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
    resolveSupportedFile, runDiagnostics, runFix, selectDiagnosticRoutes, selectFixRoute, LspSessionScope,
    omaOnInboundFrame } = vendored;

  /** Load and bound the configured server catalog, exactly like upstream
   * (config is re-read per call so a pi-lsp.json change takes effect on the
   * next call; it is read from the agent dir only -- project trust is
   * OMA's, so pi-lsp never consults project-level trust for config). */
  const configuredRuntime = (workspace: string): LspRuntime => {
    const { adapters, timeoutMs } = loadRuntime(workspace, { projectTrusted: false });
    return {
      // Every configured server routes and reports -- the catalog is the
      // user's own config, so none of it is dropped.
      adapters,
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

  const callStall = (tool: string, signal: AbortSignal, timeoutMs: number, adapters: ReadonlySet<LspServerAdapter>) =>
    observeLspCall(tool, signal, timeoutMs, options.callStallMs ?? LSP_CALL_STALL_MS, adapters, omaOnInboundFrame);

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
      // A limit the model passes is its own choice and is honored exactly;
      // an absent one means the whole collected workspace -- the complete
      // file set and count are what the result reports.
      const limit = params.limit === undefined || !Number.isFinite(params.limit)
        ? Number.MAX_SAFE_INTEGER
        : Math.max(1, Math.floor(params.limit));
      const scope = sessionFor(ctx.sessionManager).scope;
      return await scope.run(signal, async (ownedSignal) => await withLspScratch(async (scratch) => {
        const runtime = configuredRuntime(options.workspace);
        const { root, routes, skipped } = selectDiagnosticRoutes(runtime.adapters, {
          root: options.workspace,
          ...(params.paths === undefined ? {} : { paths: params.paths }),
          ...(params.server === undefined ? {} : { server: params.server }),
          limit,
        }, limit);
        // Drop only what is not a regular file (or vanished since collect);
        // size is never a refusal -- didOpen carries the text either way.
        const bounded = routes
          .map(route => ({ ...route, files: liveFiles(route.files) }))
          .filter(route => route.files.length > 0);
        if (bounded.length === 0) {
          if (skipped.length > 0)
            throw new Error(`LSP diagnostics unavailable: ${skipped.map(entry => `${entry.adapter.name} (${entry.reason})`).join("; ")}. ` +
              "Every applicable server's command is missing from PATH -- unavailable is not clean.");
          throw new Error("No supported files to check.");
        }
        // The stall window observes the whole call across routes; any
        // inbound frame on a route's own server restarts it.
        const callAdapters = new Set<LspServerAdapter>();
        const stall = callStall("lsp_diagnostics", ownedSignal, runtime.timeoutMs, callAdapters);
        const results: { route: (typeof bounded)[number]; result: ToolResult }[] = [];
        const failures: string[] = [];
        try {
          for (const route of bounded) {
            stall.signal.throwIfAborted();
            const hardened = hardenedAdapter(route.adapter, scratch);
            callAdapters.add(hardened);
            // A route's failure degrades that route's section to a named
            // error -- the routes that did complete keep their results.
            // The stall and the caller's abort still end the call, and a
            // call where every route failed stays a refusal below.
            try {
              const result = await runDiagnostics(
                hardened,
                { root, files: route.files },
                runtime.timeoutMs, stall.signal, statusCtx(scope.context(ctx)), STATUS_KEY,
              ) as ToolResult;
              results.push({ route, result });
            } catch (error) {
              if (stall.fired()) throw new Error(stall.message);
              stall.signal.throwIfAborted();
              const message = error instanceof Error ? error.message : String(error);
              failures.push(`${route.adapter.name}: ${message}`);
              results.push({ route, result: textResult(
                `${route.adapter.name} LSP diagnostics failed: ${message}`,
                { failed: true, error: message, summary: { files: 0, diagnostics: 0 } }) });
            }
          }
        } finally {
          stall.stop();
        }
        if (results.length > 0 && failures.length === results.length)
          throw new Error(`LSP diagnostics failed on every route: ${failures.join("; ")}`);
        const sections = results.map(({ route, result }) => `${route.reason}\n\n${textFromResult(result)}`);
        if (skipped.length > 0)
          sections.push(`Unavailable LSP server(s), not run: ${skipped.map(entry => `${entry.adapter.name} (${entry.reason})`).join("; ")}.`);
        if (runtime.configNotice !== undefined)
          sections.push(`config: ${runtime.configNotice}`);
        return textResult(sections.join("\n\n---\n\n"), {
          root,
          routes: results.map(({ route, result }) => ({
            server: route.adapter.name,
            reason: route.reason,
            files: route.files.map(file => relative(root, file) || file),
            details: result.details,
          })),
          unavailable: skipped.map(entry => ({ server: entry.adapter.name, reason: entry.reason })),
          summary: {
            files: results.reduce((total, { result }) => total + (((result.details as { summary?: { files?: number } })?.summary?.files) ?? 0), 0),
            diagnostics: results.reduce((total, { result }) => total + (((result.details as { summary?: { diagnostics?: number } })?.summary?.diagnostics) ?? 0), 0),
            unavailableServers: skipped.length,
            failedRoutes: failures.length,
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
      return await scope.run(signal, async (ownedSignal) => await withLspScratch(async (scratch) => {
        const runtime = configuredRuntime(options.workspace);
        const { root, route } = selectFixRoute(runtime.adapters, {
          root: options.workspace, path: params.path,
          ...(params.server === undefined ? {} : { server: params.server }),
        });
        const adapter = hardenedAdapter(route.adapter, scratch);
        // Resolves the path and refuses it when missing, non-regular or
        // outside root. No byte bound: didOpen carries the whole text
        // regardless, so the cost is the file itself -- refusing only
        // blocks a real fix.
        resolveSupportedFile(adapter, root, params.path);
        const callAdapters = new Set<LspServerAdapter>([adapter]);
        // The stall window also observes the sequential codeAction/resolve
        // loop (each unresolved action is a request): a pathological list
        // that stops answering is reclaimed, one still answering is not.
        const stall = callStall("lsp_fix", ownedSignal, runtime.timeoutMs, callAdapters);
        // Always compute in preview mode -- upstream's write branch never
        // runs. Mutation is OMA's contained writer below, after the signal
        // is still live and the role gate has passed.
        let preview: ToolResult;
        try {
          preview = await runFix(adapter, {
            root, path: params.path, write: false,
            ...(params.kind === undefined ? {} : { kind: params.kind }),
          }, runtime.timeoutMs, stall.signal, statusCtx(scope.context(ctx)), STATUS_KEY)
            .catch(error => stall.rethrow(error)) as ToolResult;
        } finally {
          stall.stop();
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
