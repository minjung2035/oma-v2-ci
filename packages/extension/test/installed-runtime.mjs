/** Isolated tarball composition: current registration and contained record reads.
 * Fixture record bytes are not broker publication, authentication or kernel proof. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import extension from "@oma/extension";
import askExtension from "@oma/extension/ask-user-question";
import { collaborationSurface } from "@oma/domain/collaboration-surface";
import { messageIdForOperation } from "@oma/domain/derived";
const workspace = join(process.cwd(), "extension-workspace"), state = join(process.cwd(), "extension-state");
const archive = join(state, "archive"), records = join(state, "records");
for (const path of [workspace, state, archive, records]) mkdirSync(path);
const bodyDirectory = join(records, "mail", "bodies"); mkdirSync(bodyDirectory, { recursive: true });
process.chdir(workspace);
for (const name of ["OMA_HOST_CHANNEL", "OMA_TOOL_SCOPE", "OMA_VERIFIED_EXTENSIONS", "OMA_PACKAGE_STORE",
  "OMA_INFERENCE_SOCKET", "OMA_EGRESS_PROXY_SOCKET"]) delete process.env[name];
const plan = collaborationSurface("resident");
Object.assign(process.env, { PI_CODING_AGENT_DIR: state, OMA_AGENT_HOME: workspace,
  OMA_SOCKET: join(state, "control.sock"), OMA_MAIL_ARCHIVE: archive, OMA_ACTOR: "installedworker",
  OMA_RECORD_ROOT: records, OMA_MAIL_ADDRESSES: "7", OMA_FRAME_BYTES: "262144", OMA_BATCH_MAX_MESSAGES: "24",
  OMA_TOOL_SURFACE: JSON.stringify(plan) });
const tools = new Map(), hooks = new Map(), commands = new Map();
let active = new Set();
const core = fileURLToPath(import.meta.resolve("@oma/extension"));
const pi = {
  registerTool(tool) { tools.set(tool.name, tool); active.add(tool.name); },
  on(event, handler) { hooks.set(event, [...(hooks.get(event) ?? []), handler]); },
  events: { on() {}, off() {}, emit() { return false; } },
  registerCommand: (name, command) => commands.set(name, command), registerShortcut() {}, registerFlag() {},
  registerMessageRenderer() {}, registerToolRenderer() {},
  getFlag() {}, getActiveTools: () => [...active], setActiveTools(names) { active = new Set(names); },
  getAllTools: () => [...tools.values()].map(tool => ({ ...tool, sourceInfo: { source: "extension", path: core } })),
  appendEntry() {}, sendMessage() {}, sendUserMessage() {},
  exec() { assert.fail("registration, invalid action or record reading cannot execute a command"); },
};
const context = { cwd: workspace, hasUI: false,
  sessionManager: { getBranch: () => [], getSessionFile: () => join(state, "current.jsonl"), getSessionId: () => "installed-session" },
  ui: { setStatus() {}, notify() {} } };
try {
  await extension(pi);
  for (const handler of hooks.get("session_start") ?? []) await handler({ type: "session_start" }, context);
  assert.deepEqual([...active].sort(), [...plan.direct].sort());
  for (const retired of ["toolset", "oma_mail_read", "oma_mail_send", "oma_mail_ack"]) assert.equal(tools.has(retired), false);
  assert.equal(tools.get("oma_send").parameters.properties.to.maxItems, 7);
  const messageId = messageIdForOperation("op-00000000-0000-4000-8000-000000000001", 0);
  const original = "From: alice@agents.local\r\nTo: installedworker@agents.local\r\nSubject: installed read\r\nContent-Type: text/plain; charset=utf-8\r\n\r\ninstalled archive body\r\n";
  const raw = join(archive, `${messageId}:2,`), body = join(bodyDirectory, `${messageId}.txt`);
  writeFileSync(raw, original);
  writeFileSync(body, "installed archive body\r\n");
  const read = await tools.get("read").execute("installed", { path: body }, new AbortController().signal, undefined, context);
  assert.match(read.content.map(part => part.text ?? "").join(""), /installed archive body/);
  await assert.rejects(tools.get("read").execute("raw-archive", { path: raw }, new AbortController().signal, undefined, context));
  await assert.rejects(tools.get("oma_send").execute("invalid", {
    to: ["alice"], content: { kind: "text", value: null },
  }), /content/);
  assert.equal(readFileSync(raw, "utf8"), original, "ordinary reading does not rewrite or acknowledge original mail");
  assert.equal(tools.has("ask_user_question"), false);
  askExtension(pi);
  assert.equal(tools.has("ask_user_question"), true, "the separate Personal question extension remains usable");
} finally {
  for (const handler of hooks.get("session_shutdown") ?? []) await handler({}, context);
}
