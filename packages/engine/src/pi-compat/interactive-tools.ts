/** Keep optional installation out of input readiness. Pi's existing providers
 * observe the installed path on their next request, including Personal/reload. */
import type { ManagedToolStatus as ToolStatus } from "./search-tool-status.js";
import { CombinedAutocompleteProvider, type AutocompleteProvider } from "@earendil-works/pi-tui";
import { getToolPath, ensureTool as installTool } from "@earendil-works/pi-coding-agent/dist/utils/tools-manager.js";
if (typeof getToolPath !== "function" || typeof installTool !== "function")
  throw new Error("Unsupported Pi search-tool adapter exports");

const pending = new Map<string, Promise<void>>();
let installedFd: string | undefined;
const wrapped = new WeakMap<AutocompleteProvider, { cwd: string; upstream: AutocompleteProvider }>();
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

/** Installed through ExtensionUIContext.addAutocompleteProvider. Upstream and
 * other extensions keep first refusal; a public provider supplies late fd
 * results without changing the engine's prototype or private fields. */
export function withSearchTools(current: AutocompleteProvider, cwd: string): AutocompleteProvider {
  const existing = wrapped.get(current);
  if (existing?.cwd === cwd) return current;
  if (existing !== undefined) current = existing.upstream;
  let path: string | undefined;
  let files: CombinedAutocompleteProvider | undefined;
  const provider: AutocompleteProvider = {
    ...(current.triggerCharacters === undefined ? {} : { triggerCharacters: current.triggerCharacters }),
    async getSuggestions(...args) {
      const result = await current.getSuggestions(...args);
      if (result !== null || args[3].signal.aborted) return result;
      if (installedFd === undefined) { setImmediate(() => install("fd")); return null; }
      if (files === undefined || path !== installedFd) {
        path = installedFd;
        files = new CombinedAutocompleteProvider([], cwd, path);
      }
      return files.getSuggestions(...args);
    },
    applyCompletion: (...args) => current.applyCompletion(...args),
    ...(current.shouldTriggerFileCompletion === undefined ? {} : {
      shouldTriggerFileCompletion: (...args: [string[], number, number]) => current.shouldTriggerFileCompletion!(...args),
    }),
  };
  wrapped.set(provider, { cwd, upstream: current });
  return provider;
}
