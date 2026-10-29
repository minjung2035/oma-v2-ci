/** The model's file tools, with their effects made through the containment
 * primitives (R6-01, R6-18, PR-004).
 *
 * The engine's own read/write/edit/ls take pluggable operations for exactly
 * this (the engine documents them for tools that act somewhere other than the
 * local disk). OMA registers the same tools under the same names with its
 * operations. OMA owns the model-facing help while retaining the engine's
 * schemas and execution behavior. A tool of the same
 * name registered by an extension replaces the built-in one.
 *
 * Writes are serialized within this engine through contained descriptors.
 * File size is governed by the filesystem under DR37. Sandbox reads are
 * not narrowed (SB-001: the mount plan is the boundary); search/list retain
 * engine operations there. Anchored read/edit registration lives in tool-hashline.
 */
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  createBashToolDefinition, createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  detectSupportedImageMimeTypeFromFile, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  WorkspaceRefusal, accessWithin, existsWithin, isDirectoryWithin, mkdirWithin, readWithin, readdirWithin, withFileWithin, writeWithin, writeWithinUnchanged, type WriteExpectation,
} from "@oma/tool-files";
import { searchWorkspace } from "./contained-search.js";
import { admittedRoot } from "./workspace-guard.js";

/** Replace help only; preserve validation, rendering and execution metadata. */
function parameterHelp<T extends { properties: Record<string, object> }>(parameters: T, help: Record<string, string>): T {
  return { ...parameters, properties: Object.fromEntries(Object.entries(parameters.properties)
    .map(([name, schema]) => [name, { ...schema, ...(help[name] === undefined ? {} : { description: help[name] }) }])) };
}

/** Settings become readable after extension loading. Retain the engine's shell
 * factory and cache its configured handler, rather than reimplement execution. */
function registerDevelopmentShell(pi: ExtensionAPI, workspace: string): void {
  const definition = createBashToolDefinition(workspace);
  let configured: typeof definition | undefined;
  let shellPath: string | undefined;
  let commandPrefix: string | undefined;
  pi.registerTool({
    ...definition,
    description: "Run a development command in the current workspace and return combined stdout/stderr and its exit outcome. Foreground execution occupies this Worker's model turn; other Workers continue independently. Long output is truncated with a path to the full temporary log. This tool has no job-id or stdin-resume API.",
    promptSnippet: "Run development commands and collect their output and exit outcome.",
    promptGuidelines: [
      "Use file and search tools for repository inspection and anchored tools for edits; use bash for Git, builds, tests and other commands.",
      "To overlap a shell job with independent work, explicitly background it with stdin/stdout/stderr redirected and record its final exit code in a file. A successful launch does not prove the job passed. Collect its log and exit result before ending the activation; processes and temporary files do not survive it.",
    ],
    parameters: parameterHelp(definition.parameters, {
      command: "Shell program text to execute from the workspace. Quote literal data for the shell; JSON string encoding is not shell escaping.",
      timeout: "Optional timeout in seconds for this command; omitted means no tool-level timeout. A timeout does not establish successful completion.",
    }),
    async execute(...args) {
      const settings = pi.getSettings();
      if (configured === undefined || shellPath !== settings.shellPath || commandPrefix !== settings.shellCommandPrefix) {
        shellPath = settings.shellPath;
        commandPrefix = settings.shellCommandPrefix;
        configured = createBashToolDefinition(workspace, {
          ...(shellPath === undefined ? {} : { shellPath }),
          ...(commandPrefix === undefined ? {} : { commandPrefix }),
        });
      }
      return configured.execute(...args);
    },
  });
}

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
 * `expected` carries either the inode identity hashline observed or the
 * exact input text used to compute an LSP fix. Both checks run inside the
 * serialization on the opened descriptor before any byte is written. A
 * missing target is not created; a changed input must be read/recomputed. */
export function createContainedWriter(workspace: string):
  (path: string, content: string, expected?: WriteExpectation) => Promise<void> {
  let writes: Promise<unknown> = Promise.resolve();
  return (path: string, content: string, expected?: WriteExpectation): Promise<void> => {
    const next = writes.catch(() => undefined).then(() => {
      // DR37: writes keep their serialization and descriptor containment;
      // their size is governed by the filesystem, not an OMA quota.
      mkdirWithin(workspace, dirname(path));
      if (expected === undefined) writeWithin(workspace, path, content);
      else writeWithinUnchanged(workspace, path, content, expected);
    });
    writes = next;
    return next;
  };
}

export function containWorkspaceTools(pi: ExtensionAPI, workspace: string, sandboxed: boolean, readOnly = false,
  readableRoots: readonly string[] = [], write = createContainedWriter(workspace)): void {
  if (!readOnly) {
    registerDevelopmentShell(pi, workspace);
    const tool = createWriteToolDefinition(workspace, { operations: {
      writeFile: (path, content) => write(path, content),
      // Parent creation is part of the same serialized write.
      mkdir: async () => {},
    } });
    pi.registerTool({ ...tool,
      description: "Create a workspace file or replace its entire contents, creating parent directories as needed. Existing content is overwritten; use anchored edits for a targeted change. Returns after the contained write completes.",
      promptSnippet: "Create a file or replace its complete contents.",
      promptGuidelines: ["Pass plain file content, never served anchor prefixes. Preserve unrelated content when replacing an existing file."],
      parameters: parameterHelp(tool.parameters, {
        path: "Workspace file path to create or overwrite, relative or absolute within the writable root.",
        content: "Complete new file contents; existing contents are replaced.",
      }),
    });
  }
  const grep = createGrepToolDefinition(workspace);
  const find = createFindToolDefinition(workspace);
  const grepDefinition = { ...grep,
    description: sandboxed
      ? "Search file contents for a regex or literal pattern, respecting ignore rules. Returns matching paths and lines. Default limit is 100 matches; output and long lines may be truncated. Narrow the search or adjust limit when coverage is incomplete."
      : "Search admitted files for a regex or literal pattern, respecting ignore rules. Returns matching paths and lines from a contained snapshot. Only an explicit limit bounds matches; large complete output is returned inline for a read-only role or saved at the reported workspace path.",
    promptSnippet: "Search file contents and inspect matching paths and lines.",
    parameters: parameterHelp(grep.parameters, {
      pattern: "Regular expression to match, or literal text when literal is true.",
      path: "File or directory to search; defaults to the current workspace directory.",
      glob: "Optional file glob restricting the search, for example **/*.ts.",
      ignoreCase: "Match without case sensitivity when true; defaults to false.",
      literal: "Interpret pattern as literal text when true; defaults to regex matching.",
      context: "Context lines before and after each match; defaults to 0.",
      limit: sandboxed ? "Maximum matches; defaults to 100." : "Optional maximum matches; omitted requests all matches.",
    }),
  };
  const findDefinition = { ...find,
    description: sandboxed
      ? "Find file paths matching a glob under a directory, respecting ignore rules. Paths are relative to that directory. Default limit is 1000 results; inspect truncation notices before treating the list as complete."
      : "Find file paths matching a glob under an admitted directory, respecting ignore rules. Only an explicit limit bounds results; large complete output is returned inline for a read-only role or saved at the reported workspace path.",
    promptSnippet: "Find files by glob before reading their contents.",
    parameters: parameterHelp(find.parameters, {
      pattern: "File glob to match, for example src/**/*.ts.",
      path: "Directory to search; defaults to the current workspace directory.",
      limit: sandboxed ? "Maximum paths; defaults to 1000." : "Optional maximum paths; omitted requests all matching paths.",
    }),
  };
  if (sandboxed) {
    pi.registerTool(grepDefinition);
    pi.registerTool(findDefinition);
    const ls = createLsToolDefinition(workspace);
    pi.registerTool({ ...ls,
      description: "List one directory alphabetically, including dotfiles and a trailing / on directories. Defaults to 500 entries; inspect any truncation notice.",
      promptSnippet: "List one directory, including hidden entries.",
      parameters: parameterHelp(ls.parameters, { path: "Directory to list; defaults to the current workspace directory.", limit: "Maximum entries; defaults to 500." }),
    });
    return;
  }
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
  pi.registerTool({ ...grepDefinition, execute: async (id, params, signal, update, ctx) =>
    searchWorkspace("grep", rootFor(params.path ?? "."), params, signal, undefined, spool) });
  pi.registerTool({ ...findDefinition, execute: async (id, params, signal, update, ctx) =>
    searchWorkspace("find", rootFor(params.path ?? "."), params, signal, undefined, spool) });
  const ls = createLsToolDefinition(workspace, { operations: {
    exists: path => existsWithin(rootFor(path), path),
    stat: path => { const directory = isDirectoryWithin(rootFor(path), path); return { isDirectory: () => directory }; },
    readdir: path => readdirWithin(rootFor(path), path),
  } });
  pi.registerTool({ ...ls,
    description: "List one admitted directory alphabetically, including dotfiles and a trailing / on directories. Defaults to 500 entries; inspect any truncation notice.",
    promptSnippet: "List one directory, including hidden entries.",
    parameters: parameterHelp(ls.parameters, { path: "Admitted directory to list; defaults to the current workspace directory.", limit: "Maximum entries; defaults to 500." }),
  });
}
