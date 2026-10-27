/** file_edit: the bundled pi-hashline-edit-pro extension (vendored
 * byte-pinned under `vendor/pi-hashline-edit-pro/`) exposed
 * inside OMA's authority model rather than upstream's "registered tools own
 * the filesystem" model.
 *
 * What OMA owns, and where it lives:
 *
 * - Integrity: `verifyVendorBundle` runs at registration, and only after it
 *   passes is any vendored module evaluated — every runtime import here is
 *   a dynamic `await import()` behind that check (this module itself holds
 *   no vendored import; PI-001 keeps runtime imports out too). A tampered
 *   or incomplete payload refuses the session, it does not degrade.
 * - Surface: upstream's entry registers eight tools plus a config command
 *   and global-state features. OMA registers only `read` (anchored read,
 *   replacing the contained read's registration under the same name) and
 *   the three file_edit members `replace`, `replace_within`, `insert`.
 *   copy, move, anchor_grep, undo_last_change, auto-read-all and the
 *   /hashline-config, /clear-anchors commands are never compiled into the
 *   runtime and never registered. The builtin `edit` stays registered —
 *   v0.1 keeps both editors (convergence is a deferred decision), so the
 *   upstream session-start edit-suppression is not ported.
 * - Reads: upstream loads every file through one `fsOpen` call. The OMA
 *   divergence in file-kind.js makes that open injectable, and a host
 *   engine installs the contained opener: workspace/readable-root
 *   admission (the same `admittedRoot` the guard applies) plus the
 *   descriptor-relative no-follow walk, so a hashline read cannot reach a
 *   path the guard would refuse. Inside a Resident's sandbox no opener is
 *   installed — the mount plan is already the boundary (SB-001) — and
 *   upstream's plain fs open runs.
 * - Writes: upstream's commit and batch close write through `writeAtomic`
 *   and re-read through `readFile`. The OMA divergences in fs-write.js /
 *   commit.js / batch.js reroute both through the installed commit
 *   channel: OMA's shared contained writer (the same serialization and
 *   mutation boundary `write`/`edit` use), still carrying the read snapshot's
 *   inode identity — a deleted or replaced file refuses before a byte is
 *   written, reported with upstream's own `[E_PATH_CHANGED]` wording.
 *   The seam is fail-closed: with no channel installed it throws
 *   `[E_OMA_NO_COMMIT_CHANNEL]` rather than falling back to upstream's
 *   readFile/writeAtomic, and `writeAtomic` itself is confined to the
 *   bundle's own state directory (config.js's writes under
 *   PI_HASHLINE_DIR — a different ownership domain), so a direct
 *   mutation-target caller — replace-undo.js's undo write, were that tool
 *   ever registered — refuses `[E_OMA_STATE_DOMAIN]` instead of writing
 *   uncontained. `writeAtomic` remains in the bundle, alive for the state
 *   domain — faithful, not deleted.
 * - Authority: the workspace guard names replace/replace_within/insert in
 *   its write gate, so a read-only role (the Principal) is refused before
 *   execute runs; those tools are not even registered for it. The guard
 *   is the gate; the contained writer is the effect.
 * - State: upstream's persistence (hash store sqlite, anchor-registry
 *   sidecars, config.json) all lands under `configDir()`, which honors
 *   `PI_HASHLINE_DIR`. The adapter points it at the engine's own session
 *   directory — the same place Pi already keeps session state, OMA-owned
 *   and never the user's `$HOME` — giving the "minimal resume persistence"
 *   (anchor ownership and per-file hashes survive an engine restart inside
 *   the same session dir) without upstream's global config file.
 * - Serialization: the contained writer serializes every write of this
 *   engine, so a hashline commit cannot interleave with a `write`/`edit`
 *   mutation boundary; upstream's own per-path mutation queue still applies
 *   inside that boundary.
 */
import { existsSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolResultEventResult } from "@earendil-works/pi-coding-agent";
import { FILE_CHANGED_REFUSAL, WorkspaceRefusal, mkdirWithin, readWithin, withFileWithin } from "@oma/tool-files";
import { admittedRoot } from "@oma/tool-runtime/workspace-guard";
import { vendoredBundleDir, verifyVendorBundle } from "@oma/tool-runtime/vendor-bundle";

/** The file_edit group's members — the hashline mutation tools. Mirrors
 * `FILE_EDIT_TOOLS` in packages/domain/src/tool-surface.ts; PI-001 keeps this file
 * from importing the domain module, so the surface test binds the two
 * lists. */
export const HASHLINE_EDIT_TOOL_NAMES = Object.freeze(["replace", "replace_within", "insert"] as const);
/** The anchored read replaces the contained `read` registration under the
 * same name, so the surface's `read` entry is unchanged. */
export const HASHLINE_READ_TOOL_NAME = "read";

/** Upstream's `PI_HASHLINE_DIR` redirect: every upstream state file —
 * hash-store.sqlite, anchor-registry sidecars, config.json — lands under
 * the directory this names. */
const HASHLINE_STATE_ENV = "PI_HASHLINE_DIR";

export interface HashlineToolOptions {
  /** realpath'd workspace root the engine was started on. */
  readonly workspace: string;
  /** realpath'd roots the guard admits reads under (workspace plus the
   * package store) — the contained opener uses the same admission. */
  readonly readableRoots: readonly string[];
  /** true inside a Resident's sandbox, where the mount plan is the
   * boundary and no contained opener is installed (SB-001). */
  readonly sandboxed: boolean;
  /** true for the Principal's engine — the mutation tools are not
   * registered at all. */
  readonly readOnly: boolean;
  /** OMA's contained serialized writer (the same seam `write`/`edit` use),
   * carrying the optional inode-identity check the commit needs. */
  readonly write: (path: string, content: string, expectedIdentity?: { dev: number; ino: number }) => Promise<void>;
  /** Where upstream's state files land — defaults to
   * `<sessionDir>/hashline` under the engine's own session directory. */
  readonly stateDir?: string | undefined;
  /** Trusted model-view alias translation, applied only to sandboxed reads.
   * Mutation paths and the host contained opener never use this port. */
  readonly readPath?: ((path: string) => string) | undefined;
}

/** The subset of the verified vendored runtime this module calls, loaded
 * only after `verifyVendorBundle` has passed — a tampered bundle never
 * evaluates. */
interface HashlineRuntime {
  readonly regRead: (pi: ExtensionAPI) => void;
  readonly regReplace: (pi: ExtensionAPI) => void;
  readonly regReplaceWithin: (pi: ExtensionAPI) => void;
  readonly regInsert: (pi: ExtensionAPI) => void;
  readonly registerWriteHook: (pi: ExtensionAPI) => void;
  readonly initHasher: () => Promise<unknown>;
  readonly loadHashStore: () => Promise<unknown>;
  readonly pruneMissing: (store: unknown) => Promise<string[]>;
  readonly initRegistry: (sessionFile: string | undefined) => Promise<string>;
  readonly gcRegistrySidecars: () => Promise<void>;
  readonly freeAnchors: (path: string, anchors?: string[]) => void;
  readonly sessionKeyFor: (ctx: unknown) => string | undefined;
  readonly withAnchorSession: <T>(ctx: unknown, fn: () => Promise<T> | T) => Promise<T>;
  readonly releaseRegistrySession: (key: string) => void;
  readonly formatAnchorReclaimNotice: (paths: string[]) => string | undefined;
  readonly takeReclaimedPaths: () => string[];
  readonly planAssistantMessage: (message: unknown, cwd: string) => Promise<void>;
  readonly finalizeTurn: (toolCallIds: string[]) => Promise<void>;
  readonly resolveInCwd: (path: string, cwd: string) => Promise<{ absolute: string; resolved: string }>;
  readonly valAccess: (absolutePath: string, path: string, accessMode?: number) => Promise<void>;
  readonly loadFileKindAndText: (filePath: string, options?: { maxLines?: number; displayPath?: string }) => Promise<{ kind: string; mimeType?: string; text?: string; description?: string; identity?: { dev: number; ino: number }; hadUtf8DecodeErrors?: boolean }>;
  readonly readNormFile: (path: string, cwd: string, options?: { signal?: AbortSignal; preloadedFile?: unknown; preloadedNorm?: unknown; maxLines?: number; store?: unknown; noPersist?: boolean; allocation?: string; accessMode?: number }) => Promise<{ normalized: string; fileHashes: string[]; absolutePath: string }>;
  readonly fmtReadPreview: (normalized: string, options: { offset?: number; limit?: number }, fileHashes: string[], absolutePath: string, maxBytes?: number, maxLines?: number) => Promise<{ text: string; servedHashes: string[] }>;
  readonly serveRows: (path: string, fileHashes: string[], fileLines: string[], wantedHashes: string[]) => void;
  readonly splitLines: (text: string) => string[];
  readonly extractWarnings: (rendered: string) => string | undefined;
  readonly extractHints: (rendered: string) => string | undefined;
  readonly clearUndo: (path: string) => Promise<void>;
  readonly MAX_HASH_LINES: number;
  readonly omaInstallFileReader: (opener: ((path: string) => Promise<import("node:fs/promises").FileHandle>) | undefined) => void;
  readonly omaInstallCommitChannel: (channel: { read(path: string): Promise<string>; write(path: string, content: string, expectedIdentity?: { dev: number; ino: number }): Promise<void> } | undefined) => void;
}

async function loadHashlineRuntime(): Promise<HashlineRuntime> {
  // Static specifiers, exactly like the pi-lsp adapter: tsc resolves each
  // against the vendored .d.ts, and the "no vendored byte evaluates before
  // verification" audit sees every module this file can load.
  const [read, replace, replaceWithin, insert, writeHook, hashline, hashStore,
    anchorRegistry, batch, fsWrite, fileKind, fileReader, validation, utils,
    served, replaceRender, replaceUndo] = await Promise.all([
    import("./vendor/pi-hashline-edit-pro/runtime/read.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/replace.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/replace-within.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/insert.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/write-hook.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/hashline/index.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/hash-store.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/anchor-registry.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/batch.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/fs-write.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/file-kind.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/file-reader.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/validation.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/utils.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/served.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/replace-render.js"),
    import("./vendor/pi-hashline-edit-pro/runtime/replace-undo.js"),
  ]);
  return {
    regRead: read.regRead,
    regReplace: replace.regReplace,
    regReplaceWithin: replaceWithin.regReplaceWithin,
    regInsert: insert.regInsert,
    registerWriteHook: writeHook.registerWriteHook,
    initHasher: hashline.initHasher,
    loadHashStore: hashStore.loadHashStore,
    pruneMissing: hashStore.pruneMissing,
    initRegistry: anchorRegistry.initRegistry,
    gcRegistrySidecars: anchorRegistry.gcRegistrySidecars,
    freeAnchors: anchorRegistry.freeAnchors,
    sessionKeyFor: anchorRegistry.sessionKeyFor,
    withAnchorSession: anchorRegistry.withAnchorSession,
    releaseRegistrySession: anchorRegistry.releaseRegistrySession,
    formatAnchorReclaimNotice: anchorRegistry.formatAnchorReclaimNotice,
    takeReclaimedPaths: anchorRegistry.takeReclaimedPaths,
    planAssistantMessage: batch.planAssistantMessage,
    finalizeTurn: batch.finalizeTurn,
    resolveInCwd: fsWrite.resolveInCwd,
    valAccess: validation.valAccess,
    loadFileKindAndText: fileKind.loadFileKindAndText,
    readNormFile: fileReader.readNormFile,
    fmtReadPreview: read.fmtReadPreview,
    serveRows: served.serveRows,
    splitLines: utils.splitLines,
    extractWarnings: replaceRender.extractWarnings,
    extractHints: replaceRender.extractHints,
    clearUndo: replaceUndo.clearUndo,
    MAX_HASH_LINES: hashline.MAX_HASH_LINES,
    omaInstallFileReader: fileKind.omaInstallFileReader,
    omaInstallCommitChannel: fsWrite.omaInstallCommitChannel,
  } as HashlineRuntime;
}

/** Where upstream's state files live under OMA: the engine's own session
 * directory when it has one, else a per-engine temp dir — never the user's
 * $HOME (which `configDir()` would choose with no override). */
function stateDirFor(options: HashlineToolOptions, ctx: ExtensionContext): string {
  if (options.stateDir !== undefined) return options.stateDir;
  const sessionDir = (ctx.sessionManager as { getSessionDir?: () => string | undefined })?.getSessionDir?.();
  if (typeof sessionDir === "string" && sessionDir.length > 0) return join(sessionDir, "hashline");
  return join(tmpdir(), `oma-hashline-${process.pid}`);
}

/** Redirect upstream's state root into OMA-owned space. This must run
 * BEFORE any vendored state code resolves a path — `configDir()` is read
 * at registry-ensure time, and `withAnchorSession` ensures the registry
 * before its callback runs, so assigning the env inside the callback is
 * already too late: sidecars would land in $HOME. Registration installs a
 * contained default; session_start refines it to the engine's session
 * directory before entering the anchor session. */
function redirectHashlineState(options: HashlineToolOptions, ctx?: ExtensionContext): void {
  const dir = ctx === undefined
    ? (options.stateDir ?? join(tmpdir(), `oma-hashline-${process.pid}`))
    : stateDirFor(options, ctx);
  // mkdirWithin, not a bare mkdirSync: each level is created inside a held
  // parent descriptor — the state tree changes only through held parents.
  // The state dir's own ancestors may not exist yet (a session dir the
  // engine creates lazily, a caller-provided stateDir), so the walk starts
  // at the nearest existing ancestor.
  const missing: string[] = [];
  let base = dirname(dir);
  while (!existsSync(base)) { missing.unshift(basename(base)); base = dirname(base); }
  mkdirWithin(base, join(...missing, basename(dir)));
  process.env[HASHLINE_STATE_ENV] = dir;
}

export async function registerHashlineTools(pi: ExtensionAPI, options: HashlineToolOptions): Promise<void> {
  // The vendored payload is verified before any of it becomes a tool —
  // and before any vendored module evaluates: every runtime import happens
  // below this check. A failed check refuses the whole session, the same
  // fail-closed posture the provenance list and the surface plan take.
  try {
    verifyVendorBundle(vendoredBundleDir("pi-hashline-edit-pro", new URL("./", import.meta.url)));
  } catch (error) {
    pi.on("session_start", () => {
      try {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`bundled pi-hashline-edit-pro payload failed integrity verification; refusing session: ${message}\n`);
      } catch { /* best effort */ }
      process.exit(1);
    });
    return;
  }
  // Install the contained state root now — before any vendored module can
  // resolve configDir(): a session-less ctx or a pre-session_start tool
  // call must never reach upstream's $HOME default.
  redirectHashlineState(options);
  const vendored = await loadHashlineRuntime();

  // The read seam (host engines only): upstream's one file-open call now
  // resolves through the same admission the guard applies — workspace and
  // readable roots — and the descriptor-relative no-follow walk, so a
  // hashline read is contained exactly like the read tool it replaces.
  // Inside the sandbox no opener is installed: the mount plan is the
  // boundary (SB-001).
  if (!options.sandboxed) {
    vendored.omaInstallFileReader(async (path: string) => {
      const root = admittedRoot(options.workspace, options.readableRoots, path);
      if (root === null) throw new WorkspaceRefusal("tool path is outside the agent workspace");
      return withFileWithin(root, path, async held => await open(held, "r"));
    });
  }

  // The commit channel: upstream's writeAtomic/readFile pair rerouted to
  // OMA's shared contained writer. The inode identity check travels with
  // the write inside the serialization; a missing or replaced inode is
  // reported with upstream's own [E_PATH_CHANGED] wording so the vendored
  // machinery (and the model) see the same contract. A refusal that is not
  // "changed" — quota, containment — propagates as OMA's own refusal.
  // The install is unconditional (sandboxed or not): the vendored seam is
  // fail-closed, so a registration path that skipped this would throw on
  // first use rather than write uncontained.
  const commitRead = async (path: string): Promise<string> =>
    options.sandboxed ? await readFile(path, "utf-8") : readWithin(options.workspace, path).toString("utf-8");
  vendored.omaInstallCommitChannel({
    read: commitRead,
    write: async (path, content, expectedIdentity) => {
      try {
        await options.write(path, content, expectedIdentity);
      } catch (error) {
        const changed =
          (error instanceof WorkspaceRefusal && error.message === FILE_CHANGED_REFUSAL) ||
          (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
        if (changed)
          throw new Error(`[E_PATH_CHANGED] Refusing to write ${path}: the target changed after it was read.`);
        throw error;
      }
    },
  });

  // Upstream's tool registrations — OMA's subset only. `read` replaces the
  // contained read under the same name (last registration wins); the three
  // file_edit members exist only where the role may write.
  if (options.sandboxed && options.readPath !== undefined) {
    const readPath = options.readPath;
    const registration = Object.create(pi) as ExtensionAPI;
    registration.registerTool = tool => {
      if (tool.name !== HASHLINE_READ_TOOL_NAME) { pi.registerTool(tool); return; }
      const prepare = tool.prepareArguments;
      pi.registerTool({ ...tool, prepareArguments: args => {
        const params = prepare === undefined ? args : prepare(args);
        const named = params as { path?: unknown } | null | undefined;
        const translated = typeof named?.path === "string" ? { ...named, path: readPath(named.path) } : params;
        return translated as ReturnType<NonNullable<typeof tool.prepareArguments>>;
      } });
    };
    vendored.regRead(registration);
  } else vendored.regRead(pi);
  if (!options.readOnly) {
    vendored.regReplace(pi);
    vendored.regReplaceWithin(pi);
    vendored.regInsert(pi);
  }
  // Upstream's write hook: blocks a `write` call whose content echoes a
  // served anchor line, so the builtin write cannot smuggle a stale anchor
  // back into a file it was served from. Registered for every role —
  // inert where no write tool exists.
  vendored.registerWriteHook(pi);

  // autoRead is upstream's post-edit fresh-anchor diff (tool_result
  // handler below) and the write->anchored-preview echo. Upstream reads it
  // from its own config.json; OMA never writes that file, so the default —
  // on — holds.
  const autoRead = true;

  pi.on("session_start", async (_event, ctx) => {
    // Refine the state redirect to this engine's session directory BEFORE
    // withAnchorSession: it ensures the anchor registry — which resolves
    // configDir() — before the callback runs.
    redirectHashlineState(options, ctx);
    return vendored.withAnchorSession(ctx, async () => {
    // Upstream state files now resolve through configDir() ->
    // PI_HASHLINE_DIR, pointed at the OMA-owned directory: hash-store.sqlite,
    // the anchor-registry sidecars and (unused) config.json.
    // v0.1 coexistence: upstream's session_start removes the builtin `edit`
    // from the active set. OMA keeps it — both editors stay callable.
    await vendored.initHasher();
    vendored.loadHashStore()
      .then(async store => {
        const missing = await vendored.pruneMissing(store);
        for (const path of missing) vendored.freeAnchors(path);
      })
      .catch(error => {
        console.error("Failed to load hashline store:", error);
      });
    const sessionFile = (ctx.sessionManager as { getSessionFile?: () => string | undefined })?.getSessionFile?.();
    if (vendored.sessionKeyFor(ctx) === undefined) await vendored.initRegistry(sessionFile);
    await vendored.gcRegistrySidecars();
    });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    try {
      const key = vendored.sessionKeyFor(ctx);
      if (key !== undefined) vendored.releaseRegistrySession(key);
    } catch (error) {
      console.error("Failed to release anchor registry session:", error);
    }
  });

  // Upstream's batch machinery, kept verbatim: message_end plans a run of
  // anchored edits in one assistant message and turn_end finalizes it —
  // this is what makes sequential edits in one message verify against the
  // freshly written bytes instead of the stale pre-message snapshot.
  pi.on("message_end", async (event, ctx) => vendored.withAnchorSession(ctx, async () => {
    try {
      await vendored.planAssistantMessage((event as { message?: unknown }).message, ctx.cwd);
    } catch (error) {
      console.error("Failed to plan edit batch:", error);
    }
  }));
  pi.on("turn_end", async (event) => {
    try {
      const ids = ((event as { toolResults?: unknown[] }).toolResults ?? [])
        .map(result => (result as { toolCallId?: unknown }).toolCallId)
        .filter((id): id is string => typeof id === "string");
      await vendored.finalizeTurn(ids);
    } catch (error) {
      console.error("Failed to finalize edit batch:", error);
    }
  });

  // Upstream's tool_result handler, ported for the registered surface:
  // the `write` branch re-reads the written file and serves fresh anchors
  // (and invalidates the old ones); the edit branch replaces the tool
  // result with the post-edit fresh-anchor diff — upstream's "stale
  // refusal before writing, fresh anchors after" contract, verbatim.
  pi.on("tool_result", async (event, ctx): Promise<ToolResultEventResult | void> =>
    vendored.withAnchorSession(ctx, async (): Promise<ToolResultEventResult | void> => {
    if (event.isError) return;

    if (event.toolName === "write") {
      const writtenPath = event.input?.path;
      let resolvedPath: string | undefined;
      if (typeof writtenPath === "string") {
        try {
          resolvedPath = (await vendored.resolveInCwd(writtenPath, ctx.cwd)).resolved;
          vendored.freeAnchors(resolvedPath);
          await vendored.clearUndo(resolvedPath);
        } catch (error) {
          console.error("Failed to clear undo after write:", error);
        }
      }
      if (!autoRead) return;
      if (typeof writtenPath !== "string") return;
      try {
        resolvedPath ??= (await vendored.resolveInCwd(writtenPath, ctx.cwd)).resolved;
        await vendored.valAccess(resolvedPath, writtenPath);
        const file = await vendored.loadFileKindAndText(resolvedPath, { maxLines: vendored.MAX_HASH_LINES, displayPath: writtenPath });
        if (file.kind !== "text") return;
        const { normalized, fileHashes, absolutePath } = await vendored.readNormFile(
          writtenPath, ctx.cwd, { maxLines: vendored.MAX_HASH_LINES, preloadedFile: file },
        );
        const preview = await vendored.fmtReadPreview(
          normalized,
          {},
          fileHashes,
          absolutePath,
        );
        const fileLines = vendored.splitLines(normalized);
        vendored.serveRows(absolutePath, fileHashes, fileLines, preview.servedHashes);
        const reclaimNotice = vendored.formatAnchorReclaimNotice(vendored.takeReclaimedPaths());
        return {
          content: [
            ...(event.content ?? []),
            { type: "text", text: `\n\n--- Auto-read (hashline anchors) ---\n${preview.text}${reclaimNotice !== undefined ? `\n\n${reclaimNotice}` : ""}` },
          ],
        };
      } catch (error) {
        console.error("Auto-read after write failed:", error);
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            ...(event.content ?? []),
            { type: "text", text: `\n\n--- Auto-read failed: ${message} ---` },
          ],
        };
      }
    }

    if (
      event.toolName !== "replace" &&
      event.toolName !== "replace_within" &&
      event.toolName !== "insert"
    ) return;
    if (!autoRead) return;

    const metrics = (event.details as { metrics?: { classification?: string } } | undefined)?.metrics;
    if (metrics?.classification === "noop") return;

    const batched = (event.details as { batch?: { last?: boolean } } | undefined)?.batch;
    if (batched?.last === false) return;
    const toolDetails = event.details as { diff?: unknown; warnings?: unknown; hints?: unknown } | undefined;
    const diff = toolDetails?.diff;
    const detailWarnings = Array.isArray(toolDetails?.warnings) ? toolDetails.warnings.filter((w): w is string => typeof w === "string") : [];
    const detailHints = Array.isArray(toolDetails?.hints) ? toolDetails.hints.filter((h): h is string => typeof h === "string") : [];
    if (typeof diff !== "string") return;
    const hasDiff = diff.length > 0;

    const rendered = (event.content ?? [])
      .filter(
        (entry): entry is { type: "text"; text: string } =>
          entry.type === "text" && typeof (entry as { text?: unknown }).text === "string",
      )
      .map(entry => entry.text)
      .join("\n");
    const warnings = detailWarnings.length ? `Warnings:\n${detailWarnings.join("\n")}` : vendored.extractWarnings(rendered);
    const hints = detailHints.length ? `Hints:\n${detailHints.join("\n")}` : vendored.extractHints(rendered);
    const notices = [warnings, hints].filter((part): part is string => part !== undefined).join("\n\n");
    const emptyDiffNotice = "[post-edit] applied successfully; the diff is empty (no content change: whitespace or line endings only).";
    const noticeText = hasDiff ? (notices ? `${diff}\n\n${notices}` : diff) : notices ? `${emptyDiffNotice}\n\n${notices}` : emptyDiffNotice;
    return {
      content: [
        {
          type: "text",
          text: noticeText,
        },
      ],
    };
  }));
}
