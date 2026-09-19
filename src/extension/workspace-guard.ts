/** Built-in file tools stay inside the agent's workspace and its quota.
 *
 * Shell tools are refused outright; read/write/edit/grep/find/ls are allowed
 * only on paths whose real location is inside the workspace, and a write or
 * edit is refused before it would take the workspace over its byte quota.
 */
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function inside(root: string, path: string): boolean {
  const offset = relative(root, path);
  return (
    offset === "" ||
    (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
  );
}
function allowedWorkspacePath(root: string, input: unknown): boolean {
  if (typeof input !== "string" || input.includes("\0")) return false;
  const target = resolve(root, input);
  if (!inside(root, target)) return false;
  let existing = target;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return false;
    existing = parent;
  }
  try {
    return inside(root, realpathSync(existing));
  } catch {
    return false;
  }
}
function workspaceUsage(root: string, stopAfter: number): number {
  const pending = [root];
  const files = new Set<string>();
  let total = 0;
  while (pending.length > 0) {
    const path = pending.pop()!;
    let stat: ReturnType<typeof lstatSync>;
    try { stat = lstatSync(path); } catch { continue; }
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
    if (typeof input.newText !== "string") return false;
    growth = Buffer.byteLength(input.newText);
  }
  return growth <= maximum && workspaceUsage(root, maximum - growth) <= maximum - growth;
}

const PATH_TOOLS: readonly string[] = Object.freeze(["read", "write", "edit", "grep", "find", "ls"]);

export function guardWorkspaceTools(pi: ExtensionAPI, workspace: string, workspaceBytes: number | null): void {
  pi.on("tool_call", (event) => {
    if (event.toolName === "bash" || event.toolName === "powershell")
      return {
        block: true,
        reason: "shell tools are disabled for OMA residents",
      };
    if (!PATH_TOOLS.includes(event.toolName)) return undefined;
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
