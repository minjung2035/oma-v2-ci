/** Built-in file tools stay inside the agent's workspace.
 *
 * On the host, for the Principal,
 * shell tools are refused outright and read/write/edit/grep/find/ls are
 * allowed only on paths whose real location is inside the workspace (PR-004).
 * Inside the sandbox the mount plan is the boundary (SB-001, TSP-009): the
 * shell the rootfs provides is the agent's, and reading is not narrowed below
 * what the sandbox shows. Everywhere, a write or edit stays inside the
 * workspace.
 *
 * DR37: admission checks containment, not workspace bytes or quota.
 */
import { lstatSync } from "node:fs";
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
 * refusal every path tool gets. File effects use descriptor-relative
 * containment too. grep/find walk a private copy made through those same
 * descriptors, never a workspace pathname this early check once saw. */
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
/** Every exposed tool whose params name filesystem paths the guard must
 * admit before the call runs; a tool that reads or writes paths and is
 * missing here would pass unchecked. The file_edit and code_intel
 * members are named explicitly so the surface rename cannot drop them. */
const PATH_TOOLS: readonly string[] = Object.freeze([
  "read", "write", "edit", "grep", "find", "ls",
  "replace", "replace_within", "insert",
  "lsp_diagnostics", "lsp_fix",
]);
/** Tools that write on every call. `lsp_fix` is not here: it writes only
 * when `write: true`, so its gate is conditional below and a read-only
 * caller still gets its preview. */
const WRITE_TOOLS: readonly string[] = Object.freeze([
  "write", "edit", "replace", "replace_within", "insert",
]);
/** Tools whose write is a parameter of the call, not the tool: only a
 * `write: true` (or `force: true`) call is a mutation. */
const CONDITIONAL_WRITE_TOOLS: readonly string[] = Object.freeze(["lsp_fix"]);
/** Reads these tools make still stay inside the workspace: the vendored
 * LSP runtime resolves every named path against the pinned workspace root
 * and refuses anything outside it, so admitting a package-store path here
 * would only delay the same refusal to deeper in the call. */
const WORKSPACE_ONLY_PATH_TOOLS: readonly string[] = Object.freeze(["lsp_diagnostics", "lsp_fix"]);
const NO_ROOTS: readonly string[] = Object.freeze([]);

/** Every path the call names: `path`, plus each entry of a `paths` list.
 * A tool whose request names several paths is gated on all of them, and
 * a malformed path value is itself refused -- `admittedRoot` admits only
 * strings that resolve inside a root. */
function inputPaths(input: Record<string, unknown>): unknown[] {
  const named: unknown[] = [];
  if (input.path !== undefined) named.push(input.path);
  if (Array.isArray(input.paths)) named.push(...input.paths);
  return named.length === 0 ? ["."] : named;
}

/** The first root under which the early check admits `path`, tried in the
 * order the guard itself tries them -- the workspace before every readable
 * root. The contained read resolves under exactly the root its admission
 * came through, so the path the guard passed is the path the effect reaches;
 * a name no root admits hears the same refusal the guard would have said. */
export function admittedRoot(workspace: string, readableRoots: readonly string[], path: unknown): string | null {
  if (allowedWorkspacePath(workspace, path)) return workspace;
  for (const root of readableRoots)
    if (allowedWorkspacePath(root, path)) return root;
  return null;
}

/** Mirrors `TOOL_SCOPE_ENV`/`TOOL_SCOPE_SANDBOX` in src/runtime/pi-spawn-plan.ts:
 * the runner sets it in a confined engine's environment, and nowhere else. */
export const TOOL_SCOPE_ENV = "OMA_TOOL_SCOPE";
export const TOOL_SCOPE_SANDBOX = "sandbox";

/** Mirrors `PACKAGE_STORE_ENV` in src/runtime/engine/principal-session.ts: the host engine's
 * environment names the installed-package store's real root, so the guard can
 * permit reads of the package skills, prompt templates and themes the
 * engine's argv advertised (C18) without opening arbitrary host paths. */
export const PACKAGE_STORE_ENV = "OMA_PACKAGE_STORE";

export function guardWorkspaceTools(pi: ExtensionAPI, workspace: string,
  sandboxed = process.env[TOOL_SCOPE_ENV] === TOOL_SCOPE_SANDBOX, readOnly = false,
  permitted?: (name: string) => boolean, readableRoots: readonly string[] = []): void {
  // The Principal is the engine with the read-only host channel; every other
  // is a Resident, and a refusal must not name another engine's role.
  const role = readOnly ? "the Principal's read, mail, review and safety role" : "this Resident's assigned role";
  pi.on("tool_call", (event) => {
    const input = (event.input ?? {}) as Record<string, unknown>;
    const writes = WRITE_TOOLS.includes(event.toolName) ||
      (CONDITIONAL_WRITE_TOOLS.includes(event.toolName) && (input.write === true || input.force === true));
    if (permitted && !permitted(event.toolName))
      return { block: true, reason: `this tool is outside ${role}` };
    if (readOnly && writes)
      return { block: true, reason: "the Principal reviews code but does not write or edit files; publish GOAL through explicit mail intent" };
    if (event.toolName === "bash" || event.toolName === "powershell")
      return sandboxed ? undefined : {
        block: true,
        reason: "shell tools are disabled outside the OMA sandbox",
      };
    if (!PATH_TOOLS.includes(event.toolName)) return undefined;
    if (sandboxed && !writes) return undefined;
    // C18: a read may also reach an installed-package resource root -- the
    // same store root the engine's argv names -- under the same
    // link-refusing containment the workspace gets. Writes and edits stay
    // inside the workspace; no other host path is opened. A call that
    // names several paths (lsp_diagnostics's paths list) is admitted only
    // when every named path is.
    const roots = (writes || WORKSPACE_ONLY_PATH_TOOLS.includes(event.toolName)) ? NO_ROOTS : readableRoots;
    if (inputPaths(input).every(path => admittedRoot(workspace, roots, path) !== null)) return undefined;
    return { block: true, reason: "tool path is outside the agent workspace" };
  });
}
