// A stand-in for the Principal's engine, faithful everywhere except the model.
//
// It loads the real compiled trusted extension, is started with the real
// environment the product builds, holds the product's real private channel on
// descriptor 3, and runs OMA's tools exactly as the engine would: the tools
// start the real CLI as this process's child. Only the model is replaced -- a
// test drives the extension line by line on stdin, and the turn a delivery
// triggers is ended by the test, the way a model's reply would end it.
//
// Every line on stdout is one JSON event, shaped like the engine's RPC events
// where the product reads them.
import "#oma-test/app/runtime/client-preload";
import { appendFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const tools = new Map();
const commands = new Map();
const handlers = new Map();
// The shared extension event bus the real engine puts on every extension api.
const busHandlers = new Map();
const entries = [];
const sessionFile = process.env.OMA_TEST_SESSION_FILE;
const sessionId = randomBytes(8).toString("hex");
const ctx = {
  ui: { notify: (message, level) => emit({ type: "extension_ui_request", method: "notify", message, level }) },
  sessionManager: {
    getSessionId: () => sessionId,
    getSessionFile: () => sessionFile,
    getLeafEntry: () => entries.at(-1) ?? null,
    getBranch: () => [...entries],
  },
};
// The engine's session holds each tool call in the assistant message that made
// it, then the call's result, whether it returned or threw. These entries are
// kept here only: the file is the extension's own entries.
const message = message => { entries.push({ type: "message", id: randomBytes(4).toString("hex"), message }); };
const pi = {
  registerTool: tool => { tools.set(tool.name, tool); },
  registerCommand: (name, command) => { commands.set(name, command); },
  registerShortcut: () => {},
  exec: async () => ({ code: 0, stdout: "", stderr: "", killed: false }),
  registerProvider: () => {},
  on: (event, handler) => { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); },
  sendMessage: async (message, options) => { emit({ type: "custom_message", message, options }); },
  appendEntry: (customType, data) => {
    const entry = { type: "custom", customType, id: randomBytes(4).toString("hex"), data };
    entries.push(entry);
    appendFileSync(sessionFile, `${JSON.stringify(entry)}\n`);
  },
  getActiveTools: () => [...tools.keys()],
  getAllTools: () => [...tools.values()].map(tool => ({ name: tool.name, description: tool.description ?? "" })),
  setActiveTools: () => {},
  events: {
    on: (channel, handler) => {
      const list = busHandlers.get(channel) ?? [];
      list.push(handler); busHandlers.set(channel, list);
      return () => { const i = (busHandlers.get(channel) ?? []).indexOf(handler); if (i >= 0) busHandlers.get(channel).splice(i, 1); };
    },
    emit: (channel, data) => { for (const handler of busHandlers.get(channel) ?? []) handler(data); },
  },
};
const fire = async (event, payload) => {
  for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
};

const extension = (await import(process.env.OMA_TEST_EXTENSION)).default;
extension(pi);
emit({ type: "loaded", tools: [...tools.keys()] });

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  try {
    switch (request.op) {
      case "tool": {
        const tool = tools.get(request.name);
        if (!tool) throw new Error(`no tool ${request.name}`);
        const call = `call-${request.id}`;
        message({ role: "assistant", content: [{ type: "toolCall", id: call, name: request.name, arguments: request.params ?? {} }] });
        let result;
        try { result = await tool.execute(call, request.params ?? {}, undefined, undefined, ctx); }
        finally { message({ role: "toolResult", toolCallId: call, toolName: request.name, content: result?.content ?? [], isError: result === undefined }); }
        emit({ type: "tool", id: request.id, ok: true, text: result.content[0]?.text ?? "" });
        break;
      }
      case "prompt": {
        // What the product sends for delivery: an extension command.
        const [name, ...rest] = request.message.slice(1).split(" ");
        const command = commands.get(name);
        emit({ type: "response", id: request.id, command: "prompt", success: command !== undefined });
        if (command) await command.handler(rest.join(" "), ctx);
        break;
      }
      case "turn": {
        // The model's reply ending the turn a delivery started.
        emit({ type: "turn_start" });
        const message = { role: "assistant", stopReason: request.stopReason, content: [] };
        await fire("message_end", { message });
        emit({ type: "message_end", message });
        await fire("agent_settled", {});
        emit({ type: "agent_settled" });
        break;
      }
      case "environ":
        emit({ type: "environ", id: request.id, text: readFileSync("/proc/self/environ", "latin1") });
        break;
      default:
        throw new Error(`unknown op ${request.op}`);
    }
  } catch (error) {
    emit({ type: "tool", id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
