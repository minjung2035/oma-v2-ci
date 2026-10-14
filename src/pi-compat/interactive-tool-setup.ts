/** Pi 1.0.1's interactive init awaits optional search-tool downloads before
 * enabling input. Adapt only that import; real grep/find keep Pi's own lazy
 * installer. Installed tools remain available to autocomplete immediately. */
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pi = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
// This remaining private seam is deliberately version-bound. A dependency
// upgrade must validate and update the adapter before input can start.
for (const [name, root] of [["Pi", pi], ["Pi TUI", dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-tui")))]] as const) {
  const metadata = JSON.parse(readFileSync(join(root, "../package.json"), "utf8")) as { version?: unknown };
  if (metadata.version !== "1.0.1") throw new Error(`Unsupported ${name} search-tool adapter version: ${String(metadata.version)}`);
}
const interactive = pathToFileURL(join(pi, "modes/interactive/interactive-mode.js")).href;
const manager = pathToFileURL(join(pi, "utils/tools-manager.js")).href;
const adapter = new URL("./interactive-tools.js", import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  // The pinned Pi package does not export this private module. Resolve the
  // adapter's literal dependency into that same installation, for this one
  // importer only; every upstream tool keeps its original module identity.
  if (context.parentURL === adapter && specifier === "@earendil-works/pi-coding-agent/dist/utils/tools-manager.js")
    return { url: manager, shortCircuit: true };
  const result = next(specifier, context);
  return context.parentURL === interactive && result.url === manager
    ? { ...result, url: adapter } : result;
} });
