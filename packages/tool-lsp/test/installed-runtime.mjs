/** Executed from an external installation containing only declared packages. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerLspTools } from "@oma/tool-lsp";
const workspace = join(process.cwd(), "lsp-workspace");
mkdirSync(workspace);
process.env.PI_CODING_AGENT_DIR = workspace;
const fixture = fileURLToPath(new URL("./vendor/pi-lsp/upstream-tests/fixtures/diagnostics-server.mjs", import.meta.resolve("@oma/tool-lsp")));
writeFileSync(join(workspace, "note.tfix"), "hello\n");
writeFileSync(join(workspace, "pi-lsp.json"), JSON.stringify({ servers: { fixture: {
  command: [process.execPath, fixture, "pull-strict-optional-params", "1"], extensions: [".tfix"],
} } }));
const tools = new Map(), hooks = new Map();
const pi = { registerTool: tool => tools.set(tool.name, tool), on(event, handler) {
  hooks.set(event, [...(hooks.get(event) ?? []), handler]);
} };
const context = { cwd: workspace, sessionManager: {}, ui: { setStatus() {} } };
try {
  await registerLspTools(pi, { workspace, readOnly: false, write: async () => assert.fail("diagnostics cannot mutate") });
  const result = await tools.get("lsp_diagnostics").execute("probe", { paths: ["note.tfix"], server: "fixture" }, undefined, undefined, context);
  assert.match(result.content.map(part => part.text ?? "").join(""), /strict pull diagnostic/);
} finally {
  for (const handler of hooks.get("session_shutdown") ?? []) await handler({}, context);
}
