// Test-only stand-in for a model provider: an OpenAI-compatible chat
// completions endpoint whose answers a test scripts. The bundled engine is
// pointed at it through its own models.json, so everything between the model
// and the society -- the engine, the trusted extension, the CLI it starts, the
// broker, the ledger and the mailboxes -- is the product's. Only the model's
// choices are scripted, and they can depend on what the engine sent: the
// delivery notice it was given, the result of the tool it called.
//
// This is not provider evidence (P0-5): what a real provider streams, how it
// fails and how the engine retries it are the engine's (INF-001).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Socket } from "node:net";

export interface ChatMessage {
  readonly role: string;
  readonly content?: string | null | readonly { readonly type: string; readonly text?: string }[];
  readonly tool_calls?: readonly { readonly id: string; readonly function: { readonly name: string; readonly arguments: string } }[];
  readonly tool_call_id?: string;
}
export interface ChatRequest {
  readonly model?: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly { readonly function?: { readonly name: string } }[];
}
export interface ToolCall { readonly name: string; readonly args: unknown; readonly id?: string }

/** What the scripted model answers one request with. */
export type Reply =
  /** A plain answer that ends the turn. */
  | { readonly kind: "text"; readonly text: string }
  /** Tool calls (arguments as JSON, or `raw` as sent), optionally after some text. */
  | { readonly kind: "tools"; readonly calls: readonly (ToolCall & { readonly raw?: string })[]; readonly text?: string }
  /** The provider refuses the request. */
  | { readonly kind: "http-error"; readonly status: number; readonly body?: string }
  /** Headers and the start of an answer, then the connection is cut. */
  | { readonly kind: "cut" }
  /** Headers, then nothing: the provider stops answering. */
  | { readonly kind: "hang" }
  /** A body that is not the protocol. */
  | { readonly kind: "garbage" }
  /** Another reply, answered only after `ms`. */
  | { readonly kind: "delayed"; readonly ms: number; readonly then: Reply };

export const text = (value: string): Reply => ({ kind: "text", text: value });
export const tools = (...calls: (ToolCall & { readonly raw?: string })[]): Reply => ({ kind: "tools", calls });
export const call = (name: string, args: unknown, id?: string): ToolCall => (id === undefined ? { name, args } : { name, args, id });
export const delayed = (ms: number, then: Reply): Reply => ({ kind: "delayed", ms, then });
export const failing = (status = 500): Reply => ({ kind: "http-error", status });

export interface Seen {
  readonly path: string;
  readonly body: ChatRequest;
  readonly reply: Reply;
}
export type Script = (request: ChatRequest, index: number) => Reply;

export interface ScriptedProvider {
  readonly baseUrl: string;
  readonly seen: readonly Seen[];
  /** Replaces the script for the requests still to come. */
  script(next: Script | readonly Reply[]): void;
  /** Writes the engine's models.json (and fast retry settings) into its agent directory. */
  configure(agentDir: string): void;
  close(): Promise<void>;
}

/** The last message's text of a role, the way the engine sent it. */
export function textOf(message: ChatMessage | undefined): string {
  if (message === undefined || message.content === null || message.content === undefined) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.map(part => part.text ?? "").join("");
}
/** The tool results the engine sent back in this request, newest last. */
export function toolResults(request: ChatRequest): { readonly id: string; readonly text: string }[] {
  return request.messages.filter(message => message.role === "tool").map(message => ({ id: message.tool_call_id ?? "", text: textOf(message) }));
}
/** The text of the newest message a user (the Human, or a delivery notice) sent. */
export function lastUserText(request: ChatRequest): string {
  return textOf([...request.messages].reverse().find(message => message.role === "user"));
}
/** Whether the engine's newest message is a tool result, i.e. this request continues a turn. */
export function continuesTurn(request: ChatRequest): boolean {
  return request.messages.at(-1)?.role === "tool";
}

const scriptOf = (source: Script | readonly Reply[]): Script => {
  if (typeof source === "function") return source;
  const replies = [...source];
  return (_request, index) => replies[index] ?? { kind: "text", text: "(script exhausted)" };
};

export async function scriptedProvider(initial: Script | readonly Reply[] = []): Promise<ScriptedProvider> {
  const seen: Seen[] = [];
  let script = scriptOf(initial);
  let offset = 0;
  const sockets = new Set<Socket>();
  const answer = (request: IncomingMessage, response: ServerResponse, body: ChatRequest): void => {
    const index = seen.length - offset;
    let reply: Reply;
    try { reply = script(body, index); } catch (error) { reply = { kind: "http-error", status: 599, body: String(error) }; }
    seen.push({ path: request.url ?? "", body, reply });
    respond(response, reply);
  };
  const respond = (response: ServerResponse, reply: Reply): void => {
    if (reply.kind === "delayed") {
      const timer = setTimeout(() => { if (!response.destroyed) respond(response, reply.then); }, reply.ms);
      response.once("close", () => { clearTimeout(timer); });
      return;
    }
    if (reply.kind === "http-error") {
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: reply.body ?? `scripted ${reply.status}`, type: "scripted" } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const base = { id: `chatcmpl-${seen.length}`, object: "chat.completion.chunk", created: 0, model: "scripted" };
    const send = (value: unknown): void => { response.write(`data: ${JSON.stringify(value)}\n\n`); };
    if (reply.kind === "hang") return;
    if (reply.kind === "garbage") { response.end("data: {not json\n\n"); return; }
    if (reply.kind === "cut") {
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "partial " } }] });
      setTimeout(() => { response.socket?.destroy(); }, 20);
      return;
    }
    if (reply.kind === "text") {
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: reply.text } }] });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      response.end("data: [DONE]\n\n");
      return;
    }
    if (reply.text !== undefined) send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: reply.text } }] });
    reply.calls.forEach((toolCall, position) => {
      const id = toolCall.id ?? `call_${seen.length}_${position}`;
      const args = toolCall.raw ?? JSON.stringify(toolCall.args);
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: position, id, type: "function", function: { name: toolCall.name, arguments: "" } }] } }] });
      send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: position, function: { arguments: args } }] } }] });
    });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    response.end("data: [DONE]\n\n");
  };
  const server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { raw += chunk; });
    request.on("end", () => {
      let body: ChatRequest;
      try { body = JSON.parse(raw) as ChatRequest; } catch { response.writeHead(400); response.end(); return; }
      answer(request, response, body);
    });
  });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  return {
    baseUrl,
    get seen() { return seen; },
    script(next) { script = scriptOf(next); offset = seen.length; },
    configure(agentDir) {
      mkdirSync(agentDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { fake: {
        baseUrl, api: "openai-completions", apiKey: "scripted-key",
        models: [{ id: "scripted", contextWindow: 200000, maxTokens: 8192 }],
      } } }));
      // The engine's own retry policy stays on (INF-001); only its waits are
      // shortened so a scenario that makes it retry does not take minutes.
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
        retry: { enabled: true, maxRetries: 2, baseDelayMs: 50, maxAgentDelayMs: 200 },
        httpIdleTimeoutMs: 3000,
      }));
    },
    close: () => new Promise<void>(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}
