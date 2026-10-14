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
import { createServer as createTlsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  /** The effort the engine asked for, when its model reasons. */
  readonly reasoning_effort?: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly { readonly function?: { readonly name: string } }[];
}
export interface ToolCall { readonly name: string; readonly args: unknown; readonly id?: string }

/** What the scripted model answers one request with. */
export type Reply =
  /** A plain answer that ends the turn. */
  | { readonly kind: "text"; readonly text: string; readonly thinking?: string }
  /** Tool calls (arguments as JSON, or `raw` as sent), optionally after some text. */
  | { readonly kind: "tools"; readonly calls: readonly (ToolCall & { readonly raw?: string })[]; readonly text?: string }
  /** The provider refuses the request. */
  | { readonly kind: "http-error"; readonly status: number; readonly body?: string }
  /** The connection is cut before any response headers. */
  | { readonly kind: "disconnect" }
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
  /** The credential the request carried (the Authorization header). */
  readonly authorization: string;
  readonly body: ChatRequest;
  readonly reply: Reply;
}
export type Script = (request: ChatRequest, index: number) => Reply;

export interface ScriptedProvider {
  readonly baseUrl: string;
  /** With TLS: the certificate a client must trust (NODE_EXTRA_CA_CERTS). */
  readonly caFile: string | null;
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

/** The engine's catalog model a confined Resident runs, served here. */
export const CONFINED_MODEL = Object.freeze({ provider: "groq", model: "llama-3.1-8b-instant" });
export const CONFINED_MODEL_2 = Object.freeze({ provider: "groq", model: "llama-3.3-70b-versatile" });
export const CONFINED_THINKING_MODEL = Object.freeze({ provider: "groq", model: "openai/gpt-oss-120b" });
/** A key the engine and the relay accept as a provider credential: long
 * enough to be given a placeholder of the same shape (engine-auth). */
export const SCRIPTED_KEY = `sk-scripted-${"k".repeat(40)}`;

/** A throwaway certificate for 127.0.0.1, so a TLS client can trust exactly it. */
function certificate(): { dir: string; key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "oma-scripted-tls-"));
  const keyPath = join(dir, "key.pem"); const certPath = join(dir, "cert.pem");
  writeFileSync(keyPath, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }));
  execFileSync("openssl", ["req", "-new", "-x509", "-key", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: "ignore" });
  return { dir, key: readFileSync(keyPath, "utf8"), cert: certPath };
}

export async function scriptedProvider(initial: Script | readonly Reply[] = [], options: { readonly tls?: boolean } = {}): Promise<ScriptedProvider> {
  const seen: Seen[] = [];
  let script = scriptOf(initial);
  let offset = 0;
  const sockets = new Set<Socket>();
  const answer = (request: IncomingMessage, response: ServerResponse, body: ChatRequest): void => {
    const index = seen.length - offset;
    let reply: Reply;
    try { reply = script(body, index); } catch (error) { reply = { kind: "http-error", status: 599, body: String(error) }; }
    seen.push({ path: request.url ?? "", authorization: String(request.headers.authorization ?? ""), body, reply });
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
    if (reply.kind === "disconnect") { response.destroy(); return; }
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
      if (reply.thinking) send({ ...base, choices: [{ index: 0, delta: { role: "assistant", reasoning_content: reply.thinking } }] });
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
  const tls = options.tls === true ? certificate() : null;
  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { raw += chunk; });
    request.on("end", () => {
      let body: ChatRequest;
      try { body = JSON.parse(raw) as ChatRequest; } catch { response.writeHead(400); response.end(); return; }
      answer(request, response, body);
    });
  };
  const server = tls === null ? createServer(handler) : createTlsServer({ key: tls.key, cert: readFileSync(tls.cert) }, handler);
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const baseUrl = `${tls === null ? "http" : "https"}://127.0.0.1:${port}/v1`;
  return {
    baseUrl,
    caFile: tls?.cert ?? null,
    get seen() { return seen; },
    script(next) { script = scriptOf(next); offset = seen.length; },
    configure(agentDir) {
      mkdirSync(agentDir, { recursive: true, mode: 0o700 });
      // `fake` is a provider of its own; `groq` is one the engine ships with an
      // OpenAI-compatible API, pointed here -- the provider a confined Resident
      // uses, because inside its sandbox the engine knows only its own catalog
      // and reaches it through the runner's relay.
      writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {
        fake: { baseUrl, api: "openai-completions", apiKey: SCRIPTED_KEY, models: [
          { id: "scripted", contextWindow: 200000, maxTokens: 8192 }, { id: "scripted-2", contextWindow: 200000, maxTokens: 8192 },
          // DR24: a model with effort levels, which only the scenarios that choose it use.
          { id: "scripted-thinking", reasoning: true, contextWindow: 200000, maxTokens: 8192 }] },
        groq: { baseUrl, apiKey: SCRIPTED_KEY },
      } }));
      // The engine's own retry policy stays on (INF-001); only its waits are
      // shortened so a scenario that makes it retry does not take minutes.
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
        retry: { enabled: true, maxRetries: 2, baseDelayMs: 50, maxAgentDelayMs: 200 },
        httpIdleTimeoutMs: 3000,
      }));
    },
    close: () => new Promise<void>(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(() => { if (tls !== null) rmSync(tls.dir, { recursive: true, force: true }); resolve(); });
    }),
  };
}
