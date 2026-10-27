import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { registerMcpTools } from "@oma/tool-mcp";
const state = join(process.cwd(), "mcp-state"); mkdirSync(state);
process.env.PI_CODING_AGENT_DIR = state;
const tools = new Map(), hooks = new Map();
const pi = { registerTool: tool => tools.set(tool.name, tool), on(event, handler) { hooks.set(event, [...(hooks.get(event) ?? []), handler]); },
  events: { on() {}, emit() { return false; }, off() {} }, appendEntry() {}, sendMessage() {}, sendUserMessage() {},
  getFlag() {}, getActiveTools() { return []; }, setActiveTools() {}, getAllTools() { return [...tools.values()].map(tool => ({ name: tool.name })); },
  registerCommand() { assert.fail("MCP commands are not registered"); }, registerShortcut() { assert.fail("MCP shortcuts are not registered"); }, registerFlag() { assert.fail("MCP flags are not registered"); }, exec() { assert.fail("registration cannot execute a command"); } };
const context = { sessionManager: { getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, hasUI: false };
try {
  await registerMcpTools(pi, { config: { mcpServers: {} }, agentDir: state, interactive: false });
  assert.deepEqual([...tools.keys()], ["mcp"]);
  assert.ok(hooks.has("session_start") && hooks.has("session_shutdown"));
} finally {
  for (const handler of hooks.get("session_shutdown") ?? []) await handler({}, context);
}
