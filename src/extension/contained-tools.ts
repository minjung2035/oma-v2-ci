/** The model's file tools, with their effects made through the containment
 * primitives (R6-01, R6-18, PR-004).
 *
 * The engine's own read/write/edit/ls take pluggable operations for exactly
 * this (the engine documents them for tools that act somewhere other than the
 * local disk). OMA registers the same tools under the same names with its
 * operations, so the engine's schema, prompt text and editing behaviour are
 * unchanged and only where the bytes go is decided here. A tool of the same
 * name registered by an extension replaces the built-in one.
 *
 * Writes are serialized within this engine, and the workspace quota is
 * decided inside that serialization, at the moment of the write -- so two
 * calls cannot each fit and together exceed it. Inside the sandbox reads are
 * not narrowed (SB-001: the mount plan is the boundary), so only write and
 * edit are replaced there.
 */
import { dirname } from "node:path";
import {
  createEditToolDefinition, createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  detectSupportedImageMimeTypeFromFile, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  WorkspaceRefusal, accessWithin, existsWithin, isDirectoryWithin, mkdirWithin, readWithin, readdirWithin, writeGrowthWithin, withFileWithin, writeWithin, writeWithinUnchanged,
} from "./contained-files.js";
import { searchWorkspace } from "./contained-search.js";
import { admittedRoot, workspaceUsage } from "./workspace-guard.js";

/** The serialized, quota-decided workspace writer the contained `write`
 * and `edit` tools share -- exposed so a registered tool whose mutation
 * is computed elsewhere (lsp_fix applies language-server edits; the
 * bundled hashline tools commit anchored edits) reaches the filesystem
 * through the same serialization, quota decision, and containment, never
 * through a writer of its own.
 *
 * `expectedIdentity` is the read-modify-write contract the bundled
 * hashline runtime's writeAtomic carries: when the caller passes the
 * dev+ino it observed at read time, the write opens the named file (no
 * O_CREAT -- a name that is gone is a changed file, not a new one) and
 * refuses before any byte is written unless the opened inode is that same
 * one. The check is made inside the serialization, on the opened file
 * itself. */
export function createContainedWriter(workspace: string, workspaceBytes: number | null):
  (path: string, content: string, expectedIdentity?: { dev: number; ino: number }) => Promise<void> {
  let writes: Promise<unknown> = Promise.resolve();
  return (path: string, content: string, expectedIdentity?: { dev: number; ino: number }): Promise<void> => {
    const next = writes.catch(() => undefined).then(() => {
      if (!workspaceBytes) throw new WorkspaceRefusal("agent workspace quota is not configured");
      const growth = writeGrowthWithin(workspace, path, Buffer.byteLength(content, "utf8"));
      if (growth > 0 && (growth > workspaceBytes || workspaceUsage(workspace, workspaceBytes - growth) > workspaceBytes - growth))
        throw new WorkspaceRefusal("agent workspace quota would be exceeded");
      mkdirWithin(workspace, dirname(path));
      if (expectedIdentity === undefined) writeWithin(workspace, path, content);
      else writeWithinUnchanged(workspace, path, content, expectedIdentity);
    });
    writes = next;
    return next;
  };
}

export function containWorkspaceTools(pi: ExtensionAPI, workspace: string, workspaceBytes: number | null, sandboxed: boolean, readOnly = false,
  readableRoots: readonly string[] = [], write = createContainedWriter(workspace, workspaceBytes)): void {
  if (!readOnly) pi.registerTool(createWriteToolDefinition(workspace, { operations: {
    writeFile: (path, content) => write(path, content),
    // Parent creation is part of the same quota decision and serialized write.
    mkdir: async () => {},
  } }));
  if (!readOnly) pi.registerTool(createEditToolDefinition(workspace, { operations: {
    readFile: async path => readWithin(workspace, path),
    writeFile: (path, content) => write(path, content),
    access: async path => { accessWithin(workspace, path, true); },
  } }));
  if (sandboxed) return;
  // C18: a read the guard admitted under a readable root resolves under that
  // same root, through the same descriptor-relative no-follow containment the
  // workspace gets -- the path the guard passed is the path the effect
  // reaches. A name under no admitted root is refused with the guard's own
  // words; writes and edits stay rooted at the workspace only.
  const rootFor = (path: unknown): string => {
    const root = admittedRoot(workspace, readableRoots, path);
    if (root === null) throw new WorkspaceRefusal("tool path is outside the agent workspace");
    return root;
  };
  pi.registerTool(createReadToolDefinition(workspace, { operations: {
    readFile: async path => readWithin(rootFor(path), path),
    access: async path => { accessWithin(rootFor(path), path, false); },
    detectImageMimeType: async path => withFileWithin(rootFor(path), path, held => detectSupportedImageMimeTypeFromFile(held)),
  } }));
  // G10-02: the engine's walkers only see approved copies, including the
  // context=0 fast path which never invokes a custom readFile operation. The
  // snapshot's root is the one the search's own path was admitted under.
  const grep = createGrepToolDefinition(workspace);
  pi.registerTool({ ...grep, execute: async (id, params, signal, update, ctx) =>
    searchWorkspace("grep", rootFor(params.path ?? "."), params, workspaceBytes, signal) });
  const find = createFindToolDefinition(workspace);
  pi.registerTool({ ...find, execute: async (id, params, signal, update, ctx) =>
    searchWorkspace("find", rootFor(params.path ?? "."), params, workspaceBytes, signal) });
  pi.registerTool(createLsToolDefinition(workspace, { operations: {
    exists: path => existsWithin(rootFor(path), path),
    stat: path => { const directory = isDirectoryWithin(rootFor(path), path); return { isDirectory: () => directory }; },
    readdir: path => readdirWithin(rootFor(path), path),
  } }));
}
