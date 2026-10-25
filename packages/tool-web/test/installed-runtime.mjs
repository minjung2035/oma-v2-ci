import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { registerWebTools, WEB_RESEARCH_TOOL_NAMES } from "@oma/tool-web";
const state = join(process.cwd(), "web-state"); mkdirSync(state);
process.env.PI_CODING_AGENT_DIR = state;
const tools = [], hooks = new Map();
const pi = { registerTool: tool => tools.push(tool.name), on(event, handler) { hooks.set(event, [...(hooks.get(event) ?? []), handler]); },
  appendEntry() {}, sendMessage() {}, registerCommand() {}, registerShortcut() {}, exec() { assert.fail("registration cannot execute a command"); } };
try {
  await registerWebTools(pi);
  assert.deepEqual(tools, [...WEB_RESEARCH_TOOL_NAMES]);
} finally {
  for (const handler of hooks.get("session_shutdown") ?? []) await handler({}, { sessionManager: { getBranch: () => [] }, ui: { setStatus() {}, notify() {} } });
}
