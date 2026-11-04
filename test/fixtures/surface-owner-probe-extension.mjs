// Test-only lifetime observer layered over the gate's real surface probe.
// Its optional failure is delivered through the installed SDK's event runner,
// after a real tool result, rather than through a mocked import or transport.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import probe from "../../dist/test/fixtures/surface-probe-extension.js";

export default function ownerProbe(pi) {
  probe(pi);
  const out = process.env.SURFACE_OWNER_LOG;
  if (!out) throw new Error("surface owner fixture requires a private lifetime log");
  const report = (phase, details = {}) => {
    const workdir = process.cwd();
    const sample = join(workdir, "sample.txt");
    appendFileSync(out, `${JSON.stringify({ phase, workdir, exists: existsSync(workdir),
      sample: existsSync(sample) ? readFileSync(sample, "utf8") : null, ...details })}\n`);
  };
  pi.on("session_start", event => { report("start", { reason: event.reason }); });
  pi.on("tool_result", event => {
    report("tool-result", { id: event.toolCallId, tool: event.toolName, isError: event.isError });
    if (process.env.SURFACE_OWNER_FAILURE === "tool-result" && event.toolCallId === "read-initial") {
      report("fault", { id: event.toolCallId });
      throw new Error("surface-owner-injected-tool-result-error");
    }
  });
  pi.on("session_shutdown", (_event, context) => {
    const file = context.sessionManager.getSessionFile();
    if (!file) throw new Error("surface owner fixture requires a persisted session");
    const entries = readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line));
    report("shutdown", { toolResults: entries
      .filter(entry => entry.type === "message" && entry.message.role === "toolResult")
      .map(entry => ({ id: entry.message.toolCallId, tool: entry.message.toolName,
        isError: entry.message.isError })) });
  });
}
