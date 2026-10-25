/** Real assembled registration and mail read from the isolated tarball install. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import extension from "@oma/extension";
import askExtension from "@oma/extension/ask-user-question";
import { messageIdForOperation } from "@oma/domain/derived";
import { omaToolNames } from "@oma/extension/mail-tools";
import { LSP_TOOL_NAMES } from "@oma/tool-lsp";
import { WEB_RESEARCH_TOOL_NAMES } from "@oma/tool-web";
const workspace = join(process.cwd(), "extension-workspace"), state = join(process.cwd(), "extension-state");
const archive = join(state, "archive");
for (const path of [workspace, state, archive]) mkdirSync(path);
process.chdir(workspace);
Object.assign(process.env, { PI_CODING_AGENT_DIR: state, OMA_AGENT_HOME: workspace,
  OMA_SOCKET: join(state, "control.sock"), OMA_MAIL_ARCHIVE: archive, OMA_ACTOR: "installedworker" });
for (const name of ["OMA_HOST_CHANNEL", "OMA_TOOL_SCOPE", "OMA_TOOL_SURFACE", "OMA_VERIFIED_EXTENSIONS", "OMA_PACKAGE_STORE",
  "OMA_INFERENCE_SOCKET", "OMA_EGRESS_PROXY_SOCKET"]) delete process.env[name];
const tools = new Map(), hooks = new Map(), commands = new Map();
const core = fileURLToPath(import.meta.resolve("@oma/extension"));
const pi = {
  registerTool: tool => tools.set(tool.name, tool),
  on(event, handler) { hooks.set(event, [...(hooks.get(event) ?? []), handler]); },
  events: { on() {}, off() {}, emit() { return false; } },
  registerCommand: (name, command) => commands.set(name, command), registerShortcut() {}, registerFlag() {},
  getFlag() {}, getActiveTools: () => [...tools.keys()], setActiveTools() {},
  getAllTools: () => [...tools.values()].map(tool => ({ name: tool.name, sourceInfo: { source: "extension", path: core } })),
  appendEntry() {}, sendMessage() {}, sendUserMessage() {},
  exec() { assert.fail("registration or mail reading cannot execute a command"); },
};
const context = { cwd: workspace, hasUI: false, sessionManager: { getBranch: () => [] }, ui: { setStatus() {}, notify() {} } };
try {
  await extension(pi);
  const expected = [...omaToolNames(false), "read", "write", "edit", "grep", "find", "ls", ...LSP_TOOL_NAMES,
    "replace", "replace_within", "insert", ...WEB_RESEARCH_TOOL_NAMES, "mcp"];
  assert.deepEqual([...tools.keys()].sort(), [...new Set(expected)].sort());
  assert.ok(commands.has("oma-deliver"));
  assert.ok(hooks.has("agent_settled") && hooks.has("before_agent_start") && hooks.has("tool_call"));
  const messageId = messageIdForOperation("op-00000000-0000-4000-8000-000000000001", 0);
  writeFileSync(join(archive, `${messageId}:2,`), "From: alice@agents.local\r\nTo: installedworker@agents.local\r\nSubject: installed read\r\nContent-Type: text/plain; charset=utf-8\r\n\r\ninstalled archive body\r\n");
  const read = await tools.get("oma_mail_read").execute("installed", { messageId });
  assert.match(read.content.map(part => part.text ?? "").join(""), /installed archive body/);
  assert.equal(tools.has("ask_user_question"), false);
  askExtension(pi);
  assert.equal(tools.has("ask_user_question"), true);
} finally {
  for (const handler of hooks.get("session_shutdown") ?? []) await handler({}, context);
}
