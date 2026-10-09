/** Keep optional installation out of input readiness. Pi's existing providers
 * observe the installed path on their next request, including Personal/reload. */
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { getToolPath, ensureTool as installTool, type ToolStatus } from "@earendil-works/pi-coding-agent/dist/utils/tools-manager.js";

const pending = new Map<string, Promise<void>>();
let installedFd: string | undefined;
function install(tool: "fd" | "rg", status?: (status: ToolStatus) => void): void {
  if (pending.has(tool)) return;
  const existing = getToolPath(tool);
  if (existing) { if (tool === "fd") installedFd = existing; return; }
  const task = Promise.resolve().then(() => installTool(tool, status)).then(path => {
    if (tool === "fd") installedFd = path;
  }, error => {
    try { status?.({ type: "warning", message: `Could not install ${tool}: ${error instanceof Error ? error.message : String(error)}` }); } catch { /* closed UI */ }
  }).finally(() => { pending.delete(tool); });
  pending.set(tool, task);
}

export async function ensureTool(tool: "fd" | "rg", status?: (status: ToolStatus) => void): Promise<string | undefined> {
  const path = getToolPath(tool) ?? undefined;
  if (tool === "fd") installedFd = path;
  if (path === undefined && tool === "fd") setImmediate(() => install(tool, status));
  return path;
}

// The one pinned private field needed for late installation. All matching,
// cancellation, commands and application of completions remain upstream's.
const suggest = CombinedAutocompleteProvider.prototype.getSuggestions;
CombinedAutocompleteProvider.prototype.getSuggestions = function (...args) {
  const path = installedFd;
  if (path) Reflect.set(this, "fdPath", path);
  else setImmediate(() => install("fd"));
  return suggest.apply(this, args);
};
