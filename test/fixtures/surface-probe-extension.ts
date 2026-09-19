// Test-only observation extension. Never shipped and never in production's
// dependency closure: it exists so a harness can ask the running engine which
// tools are actually active after the trusted core extension has projected the
// surface. It registers no tool and changes no state.
import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function probe(pi: ExtensionAPI): void {
  const out = process.env.OMA_PROBE_OUT;
  if (out === undefined || out.length === 0) return;
  const report = (phase: string): void => {
    let active: string[] = [];
    let all: string[] = [];
    let error: string | null = null;
    try {
      active = [...pi.getActiveTools()];
      all = pi.getAllTools().map(tool => tool.name);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    // Written to a file rather than stdout: stdout is the RPC channel and a
    // non-JSONL line would poison the parser under test.
    writeFileSync(out, `${JSON.stringify({ phase, active, all, error })}\n`);
  };
  // Registered after the core extension, so this runs once the projection for
  // this session has been applied.
  pi.on("session_start", () => { report("session_start"); });
  // A tool result means the surface may have changed; report again so a harness
  // can compare before and after a group was opened.
  pi.on("tool_result", () => { report("expanded"); });
}
