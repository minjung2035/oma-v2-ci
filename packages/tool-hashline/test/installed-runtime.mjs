import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerHashlineTools } from "@oma/tool-hashline";
const workspace = join(process.cwd(), "hashline-workspace");
mkdirSync(workspace);
writeFileSync(join(workspace, "note.txt"), "installed hashline read\n");
const tools = new Map(), hooks = new Map();
const pi = { registerTool: tool => tools.set(tool.name, tool), on(event, handler) { hooks.set(event, [...(hooks.get(event) ?? []), handler]); } };
const context = { cwd: workspace, sessionManager: {}, ui: { setStatus() {} } };
try {
  await registerHashlineTools(pi, { workspace, readableRoots: [], sandboxed: false, readOnly: true,
    stateDir: join(workspace, "state"), write: async () => assert.fail("read-only adapter cannot write") });
  assert.deepEqual([...tools.keys()], ["read"]);
  const result = await tools.get("read").execute("probe", { path: "note.txt" }, undefined, undefined, context);
  assert.match(result.content.map(part => part.text ?? "").join(""), /installed hashline read/);
} finally {
  for (const handler of hooks.get("session_shutdown") ?? []) await handler({}, context);
}
