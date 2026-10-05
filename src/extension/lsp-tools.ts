/** code_intel: the bundled pi-lsp extension (vendored byte-pinned under
 * `src/extension/vendor/pi-lsp/`) exposed as exactly three OMA tools --
 * `lsp_diagnostics`, `lsp_fix`, `lsp_status` -- inside OMA's authority
 * model rather than upstream's "any agent cwd" model.
 *
 * What OMA owns, and where it lives:
 *
 * - Integrity: `verifyVendorBundle` runs at registration; a tampered or
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
 * - Environment: a language server is not an OMA client. The child
 *   inherits the engine's environment minus `OMA_*` wiring and
 *   `NODE_OPTIONS` (the client-preload import would otherwise install the
 *   broker client inside a node-based language server), plus the
 *   adapter's declared overrides. PATH is the engine's PATH as resolved
 *   by upstream's command lookup.
 * - Mutation: `lsp_fix` is preview-only by default (`write` absent or
 *   false returns the computed text, like upstream). `write: true`
 *   reaches the filesystem only through OMA's contained writer -- the
 *   same byte-budgeted, workspace-contained serialized path the `write`
 *   tool uses -- never through upstream's own writeFileSync branch, which
 *   stays armed at `write: false`.
 * - Authority: the workspace guard lists `lsp_fix` in its conditional
 *   write gate, so a read-only role (the Principal) is refused before
 *   execute runs; the check here is defense in depth, the guard is the
 *   gate.
 * - Availability: a configured server whose command is not on PATH is
 *   `unavailable`. The diagnostics aggregate is refused loud when every
 *   applicable server is unavailable -- "no diagnostics" is a state a
 *   server reports, not a state OMA invents for a server it never ran.
 * - Bounds: file count, file bytes, path list, timeout, and configured
 *   server count are clamped to OMA limits regardless of what
 *   `pi-lsp.json` asks for.
 */
import { statSync } from "node:fs";
import { relative } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { consumeLspConfigNotice, loadRuntime } from "./vendor/pi-lsp/runtime/adapters.js";
import { commandExists, commandPathValue, mergeEnvironment, resolveCommandPath } from "./vendor/pi-lsp/runtime/command.js";
import { resolveSupportedFile } from "./vendor/pi-lsp/runtime/files.js";
import { runDiagnostics, runFix } from "./vendor/pi-lsp/runtime/runner.js";
import { selectDiagnosticRoutes, selectFixRoute } from "./vendor/pi-lsp/runtime/routes.js";
import { LspSessionScope } from "./vendor/pi-lsp/runtime/session-lifecycle.js";
import type { LspServerAdapter } from "./vendor/pi-lsp/runtime/types.js";
import { WorkspaceRefusal } from "./contained-files.js";
import { textResult } from "./shared.js";
import { vendoredBundleDir, verifyVendorBundle, type VendorVerification } from "./vendor-bundle.js";

export const LSP_TOOL_NAMES = Object.freeze(["lsp_diagnostics", "lsp_fix", "lsp_status"] as const);

/** OMA bounds over the upstream defaults: the model may narrow them,
 * never widen them. */
const LSP_MAX_FILES = 100;
const LSP_MAX_PATHS = 64;
const LSP_FILE_BYTES = 1_048_576;
const LSP_TIMEOUT_MS = 120_000;
const LSP_MAX_SERVERS = 64;

const STATUS_KEY = "lsp";

export interface LspToolOptions {
  /** realpath'd workspace root the engine was started on. */
  readonly workspace: string;
  /** true for the Principal's engine -- write authority is refused. */
  readonly readOnly: boolean;
  /** OMA's contained serialized writer (the same seam `write` uses). */
  readonly write: (path: string, content: string) => Promise<void>;
  /** The bundle root to verify -- defaults to the deployed vendored copy
   * beside this module. Tests point it at a copy they may corrupt. */
  readonly bundleDir?: string | undefined;
}

interface LspRuntime {
  readonly adapters: LspServerAdapter[];
  readonly timeoutMs: number;
  readonly configNotice: string | undefined;
}

/** The child environment is OMA's to give: the adapter's declared
 * overrides plus two scrubs the vendored client's `mergeEnvironment`
 * applies on top of process.env. `OMA_*` names the broker socket, the
 * inference wiring, the workspace lease -- none of it is a language
 * server's business. `NODE_OPTIONS` would inject OMA's client preload
 * into any node-based server. Both are emptied out (empty-valued, never
 * absent -- `mergeEnvironment` only overrides, it does not delete). */
function hardenedAdapter(adapter: LspServerAdapter): LspServerAdapter {
  const env: Record<string, string> = { ...(adapter.env ?? {}), NODE_OPTIONS: "" };
  for (const key of Object.keys(process.env)) if (key.startsWith("OMA_")) env[key] = "";
  return { ...adapter, env };
}

/** The exact environment the language-server child would get for this
 * adapter -- the vendored client's own `mergeEnvironment` applied to the
 * scrubbed overrides. Exported so tests can pin the boundary: no OMA_*
 * value and no NODE_OPTIONS survives, PATH and ordinary variables do. */
export function lspChildEnvironment(adapter: LspServerAdapter): NodeJS.ProcessEnv {
  return mergeEnvironment(hardenedAdapter(adapter).env);
}

function clampTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return LSP_TIMEOUT_MS;
  return Math.min(Math.max(1000, Math.floor(timeoutMs)), LSP_TIMEOUT_MS);
}

/** Load and bound the configured server catalog, exactly like upstream
 * (config is re-read per call so a pi-lsp.json change takes effect on the
 * next call; it is read from the agent dir only -- project trust is
 * OMA's, so pi-lsp never consults project-level trust for config). */
function configuredRuntime(workspace: string): LspRuntime {
  const { adapters, timeoutMs } = loadRuntime(workspace, { projectTrusted: false });
  return {
    adapters: adapters.slice(0, LSP_MAX_SERVERS),
    timeoutMs: clampTimeout(timeoutMs),
    configNotice: consumeLspConfigNotice(),
  };
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

export function registerLspTools(pi: ExtensionAPI, options: LspToolOptions): void {
  // The vendored payload is verified before any of it becomes a tool. A
  // failed check refuses the whole session -- the same fail-closed posture
  // the provenance list and the surface plan already take.
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

  // Upstream's session seam, kept: one operation scope per session, reset
  // on session start (extension reload starts a new session), drained on
  // shutdown so a dying session takes its LSP children with it.
  const sessions = new WeakMap<object, { scope: LspSessionScope; generation: number }>();
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
      if (params.paths !== undefined && params.paths.length > LSP_MAX_PATHS)
        throw new WorkspaceRefusal(`lsp_diagnostics accepts at most ${LSP_MAX_PATHS} paths`);
      const limit = Math.min(Math.max(1, Math.floor(params.limit ?? 50)), LSP_MAX_FILES);
      const scope = sessionFor(ctx.sessionManager).scope;
      return await scope.run(signal, async (ownedSignal) => {
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
        const results: { route: (typeof bounded)[number]; result: ToolResult }[] = [];
        for (const route of bounded) {
          ownedSignal.throwIfAborted();
          const result = await runDiagnostics(
            hardenedAdapter(route.adapter),
            { root, files: route.bounded.files },
            runtime.timeoutMs, ownedSignal, statusCtx(scope.context(ctx)), STATUS_KEY,
          ) as ToolResult;
          results.push({ route, result });
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
      });
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
      if (params.write === true && options.readOnly)
        throw new WorkspaceRefusal("lsp_fix write requested but this role is read-only: preview the computed changes instead");
      const scope = sessionFor(ctx.sessionManager).scope;
      return await scope.run(signal, async (ownedSignal) => {
        const runtime = configuredRuntime(options.workspace);
        const { root, route } = selectFixRoute(runtime.adapters, {
          root: options.workspace, path: params.path,
          ...(params.server === undefined ? {} : { server: params.server }),
        });
        const adapter = hardenedAdapter(route.adapter);
        // OMA bound: the file is read whole into the JSON-RPC request.
        const file = resolveSupportedFile(adapter, root, params.path);
        const stat = statSync(file);
        if (stat.size > LSP_FILE_BYTES)
          throw new WorkspaceRefusal(`${params.path} is ${stat.size} bytes; lsp_fix is bounded to ${LSP_FILE_BYTES}`);
        // Always compute in preview mode -- upstream's write branch never
        // runs. Mutation is OMA's contained writer below, after the signal
        // is still live and the role gate has passed.
        const preview = await runFix(adapter, {
          root, path: params.path, write: false,
          ...(params.kind === undefined ? {} : { kind: params.kind }),
        }, runtime.timeoutMs, ownedSignal, statusCtx(scope.context(ctx)), STATUS_KEY) as ToolResult;
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
      });
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
