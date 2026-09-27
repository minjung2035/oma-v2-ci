/** Built-in file tools stay inside the agent's workspace and its quota.
 *
 * On the host -- the Principal, or a Resident of an unsealed deployment --
 * shell tools are refused outright and read/write/edit/grep/find/ls are
 * allowed only on paths whose real location is inside the workspace (PR-004).
 * Inside the sandbox the mount plan is the boundary (SB-001, TSP-009): the
 * shell the rootfs provides is the agent's, and reading is not narrowed below
 * what the sandbox shows. Everywhere, a write or edit stays inside the
 * workspace and is refused before it would take it over its byte quota.
 */
import { lstatSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function inside(root: string, path: string): boolean {
  const offset = relative(root, path);
  return (
    offset === "" ||
    (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
  );
}
/** R6-01: every component that exists is looked at itself (lstat), from the
 * root down, and a link anywhere -- one that points nowhere included -- is
 * refused; what does not exist yet is a name to be made. This is the early
 * refusal every path tool gets. The effect of read/write/edit/ls is also made
 * through the containment primitives (contained-tools.ts); grep and find walk
 * with their own programs from a start this check has seen. */
function allowedWorkspacePath(root: string, input: unknown): boolean {
  if (typeof input !== "string" || input.includes("\0")) return false;
  const target = resolve(root, input);
  if (!inside(root, target)) return false;
  let path = root;
  for (const part of relative(root, target).split(sep).filter(Boolean)) {
    path = join(path, part);
    let stat: ReturnType<typeof lstatSync> | undefined;
    try { stat = lstatSync(path, { throwIfNoEntry: false }); } catch { return false; }
    if (stat === undefined) return true;
    if (stat.isSymbolicLink()) return false;
  }
  return true;
}
export function workspaceUsage(root: string, stopAfter: number): number {
  const pending = [root];
  const files = new Set<string>();
  let total = 0;
  while (pending.length > 0) {
    const path = pending.pop()!;
    let stat: ReturnType<typeof lstatSync>;
    // P0-5, MAINTENANCE §10 (unknown != zero): only a name that is gone is
    // nothing; one that cannot be observed is refused like an unreadable
    // directory below.
    try { stat = lstatSync(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; return stopAfter + 1; }
    if (stat.isFile()) {
      const identity = `${stat.dev}:${stat.ino}`;
      if (files.has(identity)) continue;
      files.add(identity);
      total += stat.size;
    } else if (stat.isSymbolicLink()) total += stat.size;
    if (total > stopAfter) return total;
    if (!stat.isDirectory()) continue;
    try { for (const name of readdirSync(path)) pending.push(join(path, name)); } catch { return stopAfter + 1; }
  }
  return total;
}

function workspaceWriteFits(root: string, tool: string, input: Record<string, unknown>, maximum: number): boolean {
  if (tool !== "write" && tool !== "edit") return true;
  const path = typeof input.path === "string" ? resolve(root, input.path) : null;
  if (!path) return false;
  let growth = 0;
  if (tool === "write") {
    if (typeof input.content !== "string") return false;
    growth = Buffer.byteLength(input.content);
    try { const current = lstatSync(path); if (current.isFile()) growth = Math.max(0, growth - current.size); } catch { /* new file */ }
  } else {
    // AV25: the input a tool_call handler sees is the pinned engine's validated
    // one (BATCH-006), `edits: [{ oldText, newText }]`; the engine has already
    // folded its older single-edit form into it. What it may add is at most
    // the replacement text.
    const edits = input.edits;
    if (!Array.isArray(edits) || edits.length === 0) return false;
    for (const entry of edits) {
      const replacement = (entry as { newText?: unknown } | null)?.newText;
      if (typeof replacement !== "string") return false;
      growth += Buffer.byteLength(replacement);
    }
  }
  return growth <= maximum && workspaceUsage(root, maximum - growth) <= maximum - growth;
}

const PATH_TOOLS: readonly string[] = Object.freeze(["read", "write", "edit", "grep", "find", "ls"]);
const WRITE_TOOLS: readonly string[] = Object.freeze(["write", "edit"]);

/** Mirrors `TOOL_SCOPE_ENV`/`TOOL_SCOPE_SANDBOX` in src/runtime/pi-spawn-plan.ts:
 * the runner sets it in a confined engine's environment, and nowhere else. */
export const TOOL_SCOPE_ENV = "OMA_TOOL_SCOPE";
export const TOOL_SCOPE_SANDBOX = "sandbox";

export function guardWorkspaceTools(pi: ExtensionAPI, workspace: string, workspaceBytes: number | null,
  sandboxed = process.env[TOOL_SCOPE_ENV] === TOOL_SCOPE_SANDBOX): void {
  pi.on("tool_call", (event) => {
    if (event.toolName === "bash" || event.toolName === "powershell")
      return sandboxed ? undefined : {
        block: true,
        reason: "shell tools are disabled outside the OMA sandbox",
      };
    if (!PATH_TOOLS.includes(event.toolName)) return undefined;
    if (sandboxed && !WRITE_TOOLS.includes(event.toolName)) return undefined;
    const input = event.input as Record<string, unknown>;
    const path = input.path ?? ".";
    if (!allowedWorkspacePath(workspace, path))
      return { block: true, reason: "tool path is outside the agent workspace" };
    if ((event.toolName === "write" || event.toolName === "edit") &&
        (!workspaceBytes || !workspaceWriteFits(workspace, event.toolName, input, workspaceBytes)))
      return { block: true, reason: "agent workspace quota would be exceeded" };
    return undefined;
  });
}
