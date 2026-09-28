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
import {
  createEditToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  detectSupportedImageMimeTypeFromFile, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  WorkspaceRefusal, accessWithin, existsWithin, isDirectoryWithin, mkdirWithin, readWithin, readdirWithin, sizeWithin, withFileWithin, writeWithin,
} from "./contained-files.js";
import { workspaceUsage } from "./workspace-guard.js";

export function containWorkspaceTools(pi: ExtensionAPI, workspace: string, workspaceBytes: number | null, sandboxed: boolean): void {
  let writes: Promise<unknown> = Promise.resolve();
  const write = (path: string, content: string): Promise<void> => {
    const next = writes.catch(() => undefined).then(() => {
      if (!workspaceBytes) throw new WorkspaceRefusal("agent workspace quota is not configured");
      const growth = Buffer.byteLength(content, "utf8") - sizeWithin(workspace, path);
      if (growth > 0 && (growth > workspaceBytes || workspaceUsage(workspace, workspaceBytes - growth) > workspaceBytes - growth))
        throw new WorkspaceRefusal("agent workspace quota would be exceeded");
      writeWithin(workspace, path, content);
    });
    writes = next;
    return next;
  };
  pi.registerTool(createWriteToolDefinition(workspace, { operations: {
    writeFile: (path, content) => write(path, content),
    mkdir: async dir => { mkdirWithin(workspace, dir); },
  } }));
  pi.registerTool(createEditToolDefinition(workspace, { operations: {
    readFile: async path => readWithin(workspace, path),
    writeFile: (path, content) => write(path, content),
    access: async path => { accessWithin(workspace, path, true); },
  } }));
  if (sandboxed) return;
  pi.registerTool(createReadToolDefinition(workspace, { operations: {
    readFile: async path => readWithin(workspace, path),
    access: async path => { accessWithin(workspace, path, false); },
    detectImageMimeType: path => withFileWithin(workspace, path, held => detectSupportedImageMimeTypeFromFile(held)),
  } }));
  // P0V-122 (G10-02): grep's own reads -- whether its start is a directory,
  // the lines around a match -- are made as read's are. Its search is the
  // engine's ripgrep, run without --follow.
  pi.registerTool(createGrepToolDefinition(workspace, { operations: {
    isDirectory: path => isDirectoryWithin(workspace, path),
    readFile: path => readWithin(workspace, path).toString("utf8"),
  } }));
  pi.registerTool(createLsToolDefinition(workspace, { operations: {
    exists: path => existsWithin(workspace, path),
    stat: path => { const directory = isDirectoryWithin(workspace, path); return { isDirectory: () => directory }; },
    readdir: path => readdirWithin(workspace, path),
  } }));
}
