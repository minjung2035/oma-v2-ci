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
 * Writes are serialized within this engine through contained descriptors.
 * File size is governed by the filesystem under DR37. Sandbox reads are
 * not narrowed (SB-001: the mount plan is the boundary), so only write and
 * edit are replaced there.
 */
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  createEditToolDefinition, createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  detectSupportedImageMimeTypeFromFile, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  WorkspaceRefusal, accessWithin, existsWithin, isDirectoryWithin, mkdirWithin, readWithin, readdirWithin, withFileWithin, writeWithin, writeWithinUnchanged,
} from "@oma/tool-files";
import { searchWorkspace } from "./contained-search.js";
import { admittedRoot } from "./workspace-guard.js";

/** /inbox.md is a logical product input. Native host layouts have no mount
 * there. Translate only that exact read alias; writes and host/Principal
 * admission keep their existing boundaries. Capture the trusted view now. */
export function logicalReadPathView(sandboxed: boolean, batchView?: string): (path: string) => string {
  if (!sandboxed || batchView === undefined) return path => path;
  if (!isAbsolute(batchView) || batchView === "/" || batchView.includes("\0") || resolve(batchView) !== batchView)
    throw new WorkspaceRefusal("batch read view must be a normalized non-root absolute path");
  const inbox = join(batchView, "inbox.md");
  return path => path === "/inbox.md" ? inbox : path;
}

/** The serialized, contained workspace writer the contained `write`
 * and `edit` tools share -- exposed so a registered tool whose mutation
 * is computed elsewhere (lsp_fix applies language-server edits; the
 * bundled hashline tools commit anchored edits) reaches the filesystem
 * through the same serialization and containment, never
 * through a writer of its own.
 *
 * `expectedIdentity` is the read-modify-write contract the bundled
 * hashline runtime's writeAtomic carries: when the caller passes the
 * dev+ino it observed at read time, the write opens the named file (no
 * O_CREAT -- a name that is gone is a changed file, not a new one) and
 * refuses before any byte is written unless the opened inode is that same
 * one. The check is made inside the serialization, on the opened file
 * itself. */
export function createContainedWriter(workspace: string):
  (path: string, content: string, expectedIdentity?: { dev: number; ino: number }) => Promise<void> {
  let writes: Promise<unknown> = Promise.resolve();
  return (path: string, content: string, expectedIdentity?: { dev: number; ino: number }): Promise<void> => {
    const next = writes.catch(() => undefined).then(() => {
      // DR37: writes keep their serialization and descriptor containment;
      // their size is governed by the filesystem, not an OMA quota.
      mkdirWithin(workspace, dirname(path));
      if (expectedIdentity === undefined) writeWithin(workspace, path, content);
      else writeWithinUnchanged(workspace, path, content, expectedIdentity);
    });
    writes = next;
    return next;
  };
}

export function containWorkspaceTools(pi: ExtensionAPI, workspace: string, sandboxed: boolean, readOnly = false,
  readableRoots: readonly string[] = [], write = createContainedWriter(workspace)): void {
  if (!readOnly) pi.registerTool(createWriteToolDefinition(workspace, { operations: {
    writeFile: (path, content) => write(path, content),
    // Parent creation is part of the same serialized write.
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
  // A complete answer too large for one result is spilled into the
  // workspace's own `.oma/search-results/` through the same contained
  // writer -- contained and serialized like any authored file, so the
  // named path is one the model's read/grep/find can open. A read-only
  // surface gets no spool (it must not write where its role cannot) and
  // the answer rides inline in full instead.
  const spool = readOnly ? undefined : { workspace, write };
  const grep = createGrepToolDefinition(workspace);
  pi.registerTool({ ...grep, execute: async (id, params, signal, update, ctx) =>
    searchWorkspace("grep", rootFor(params.path ?? "."), params, signal, undefined, spool) });
  const find = createFindToolDefinition(workspace);
  pi.registerTool({ ...find, execute: async (id, params, signal, update, ctx) =>
    searchWorkspace("find", rootFor(params.path ?? "."), params, signal, undefined, spool) });
  pi.registerTool(createLsToolDefinition(workspace, { operations: {
    exists: path => existsWithin(rootFor(path), path),
    stat: path => { const directory = isDirectoryWithin(rootFor(path), path); return { isDirectory: () => directory }; },
    readdir: path => readdirWithin(rootFor(path), path),
  } }));
}
