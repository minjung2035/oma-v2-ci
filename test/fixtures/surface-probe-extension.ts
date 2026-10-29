// Test-only observer: records the real engine's loadout around persisted turn
// boundaries. It registers no tools, forwards no calls, and mutates no session state.
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function probe(pi: ExtensionAPI): void {
  const out = process.env.OMA_PROBE_OUT;
  if (out === undefined || out.length === 0) return;
  const report = (phase: string, detail: Record<string, unknown> = {}): void => {
    appendFileSync(out, `${JSON.stringify({ phase, active: pi.getActiveTools(),
      all: pi.getAllTools().map(tool => tool.name), ...detail })}\n`);
  };
  // Loaded after the trusted extension, so startup and turn_end observations
  // see its applied selection. tool_result still sees the frozen batch loadout.
  pi.on("session_start", event => { report("session_start", { reason: event.reason }); });
  pi.on("tool_result", event => {
    report("tool_result", { tool: event.toolName, id: event.toolCallId, isError: event.isError });
  });
  pi.on("turn_end", event => {
    report("turn_end", { ids: event.toolResults.map(result => result.toolCallId),
      persisted: event.toolResultEntryIds });
  });
}
