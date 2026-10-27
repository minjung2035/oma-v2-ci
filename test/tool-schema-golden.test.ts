/** D26: the OMA tools' serialized surface is a contract.
 *
 * `parameters` is the JSON-schema object Pi hands to the model provider; a
 * silent drift in it is a protocol change, so every tool's serialized schema,
 * its label and prompt snippet are pinned here as literal goldens. The result
 * envelope every tool returns is pinned too, and the unknown-value behaviour
 * is asserted at the boundary a schema cannot hold: values smuggled past
 * validation into execute() must be refused, never forwarded to the CLI. */
import test from "node:test";
import assert from "node:assert/strict";
import { registerOmaTools } from "@oma/extension/mail-tools";

/** The env registerOmaTools needs before it registers anything. */
const ENV = { OMA_CLI_PATH: "/oma/cli.js", OMA_AGENT_HOME: "/home/agent", OMA_MAIL_ARCHIVE: "/mail/cur",
  OMA_SOCKET: "/run/oma.sock", OMA_SOCIETY: "demo", OMA_WORKSPACE_BYTES: "1048576" };

interface Registered { name: string; label?: string; description?: string; promptSnippet?: string; parameters: object;
  execute(id: string, params: Record<string, unknown>, signal?: AbortSignal, update?: unknown, engine?: unknown): Promise<unknown>; }

function registered(attached: boolean): Registered[] {
  const tools: Registered[] = [];
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(ENV)) { saved[key] = process.env[key]; process.env[key] = value; }
  try { registerOmaTools({ registerTool: (tool: Registered) => { tools.push(tool); } } as never, "/w",
    { attached } as never); }
  finally { for (const key of Object.keys(saved)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
  return tools;
}

const REQUEST_DESC = "Optional request key. Without one, calling again with the same arguments before you have seen a result is the same request, done once; give a new key to do the same thing again.";
const str = (extra: object = {}) => ({ type: "string", ...extra });
const named = (values: readonly string[]) => ({ anyOf: values.map(v => ({ type: "string", const: v })) });
const request = { request: str({ description: REQUEST_DESC }) };

const reviewCommon = { name: str({ description: "the request's generated name (merge-/challenge- + the request's full UUID)" }),
  verdict: named(["approve", "reject"]), body: str(), path: str(), cursor: { type: "integer", minimum: 0 }, ...request };
const reviewPrincipal = (extra: object = {}) => ({ type: "object", required: ["action"], properties: {
  action: named(["diff", "vote"]), approval: str({ description: "the approval message id the vote answers; required" }),
  ...extra, ...reviewCommon } });
const reviewWorker = (extra: object = {}) => ({ type: "object", required: ["action"], properties: {
  action: named(["open", "diff", "review", "vote", "status", "cancel"]),
  title: str(), reason: str(), candidate: str(), base: str(), ...extra, ...reviewCommon } });
const mailRead = { type: "object", required: ["messageId"], properties: {
  messageId: str({ description: "Message id or archive path from a notice, or /inbox.md" }) } };
const mailSend = (extra: object = {}) => ({ type: "object", required: ["to", "subject", "body"], properties: {
  to: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 64,
    description: "agent names, or shared addresses: commons / residents (all Workers), principal" },
  subject: str({ maxLength: 998 }), body: str(),
  kind: named(["message", "question", "result", "alert", "critical"]),
  ...extra, replyTo: str(), ...request } });

/** The exact serialized parameter schema each registered tool ships. A field,
 * union member or constraint that drifts fails this test -- that drift is a
 * protocol change, whether or not anything downstream noticed it. */
const GOLDEN = {
  worker: {
    oma_mail_read: mailRead,
    oma_mail_send: mailSend(),
    oma_mail_ack: { type: "object", required: ["messageId"], properties: { messageId: str(), ...request } },
    oma_status: { type: "object", properties: { agent: str() } },
    oma_merge: reviewWorker({ tier: named(["LOW", "MEDIUM", "HIGH"]) }),
    oma_challenge: reviewWorker({ merge: str({ description: "the applied merge-<UUID> request this challenge reverts" }),
      tier: named(["LOW", "HIGH"]), view: named(["revert", "original"]) }),
  },
  principal: {
    oma_mail_read: mailRead,
    // The Principal's send additionally carries the GOAL-publish intent pair.
    oma_mail_send: mailSend({
      intent: { type: "string", const: "goal",
        description: "Explicitly publish this body as GOAL.md and mail it to residents. Requires expectedRevision; preserves other shared context documents." },
      expectedRevision: str({ description: "Current context revision or none for the first GOAL" }) }),
    oma_society: { type: "object", required: ["action"], properties: { action: named(["open", "close"]), ...request } },
    oma_agent_lifecycle: { type: "object", required: ["name", "action"], properties: {
      name: str(), action: named(["start", "stop"]), ...request } },
    oma_merge: reviewPrincipal(),
    oma_challenge: reviewPrincipal({ view: named(["revert", "original"]) }),
  },
} as const;

test("D26: every OMA tool's serialized schema, label and snippet is the recorded golden", () => {
  const worker = registered(false), principal = registered(true);
  assert.deepEqual(worker.map(t => t.name), ["oma_mail_read", "oma_mail_send", "oma_mail_ack", "oma_status", "oma_merge", "oma_challenge"]);
  assert.deepEqual(principal.map(t => t.name), ["oma_mail_read", "oma_mail_send", "oma_society", "oma_agent_lifecycle", "oma_merge", "oma_challenge"]);

  for (const [side, tools] of [["worker", worker], ["principal", principal]] as const) {
    const goldens = GOLDEN[side] as Record<string, object>;
    assert.deepEqual(Object.keys(goldens).sort(), tools.map(t => t.name).sort(),
      `${side}: the registered set itself drifted`);
    for (const tool of tools) {
      const schema = JSON.parse(JSON.stringify(tool.parameters));
      assert.deepEqual(schema, goldens[tool.name], `${side} ${tool.name} schema drifted`);
      assert.equal(typeof tool.description, "string");
      assert.ok((tool.description as string).length > 0, `${side} ${tool.name} carries no description`);
      assert.equal(typeof tool.label, "string", `${side} ${tool.name} carries no label`);
    }
  }
  // The Principal's registration carries diff and vote alone; its prompt line
  // names only actions it can actually call, never the Worker verbs.
  assert.equal(principal.find(t => t.name === "oma_merge")!.promptSnippet, "diff and vote a HIGH merge's approval");
  assert.equal(principal.find(t => t.name === "oma_challenge")!.promptSnippet, "diff and vote a challenge's approval");
  assert.equal(worker.find(t => t.name === "oma_merge")!.promptSnippet, "open and review merge requests");
  assert.equal(worker.find(t => t.name === "oma_challenge")!.promptSnippet, "revert an applied merge");
});

test("D26: the tool result envelope is one text block plus details, never bare text", async () => {
  const worker = registered(false);
  const read = worker.find(t => t.name === "oma_mail_read")!;
  await assert.rejects(() => read.execute("call-1", { messageId: "/inbox.md" }),
    /no delivery index/, "a call without its backing view fails, not fabricates");
  // The envelope the shared helper produces -- the shape every tool returns.
  const { textResult } = await import("@oma/tool-runtime/shared");
  assert.deepEqual(textResult("hello", { request: "k" }),
    { content: [{ type: "text", text: "hello" }], details: { request: "k" } });
  assert.deepEqual(textResult("only text"), { content: [{ type: "text", text: "only text" }], details: {} });
});

test("D26: a value that bypasses schema validation is refused at execute, never forwarded", async () => {
  const principal = registered(true), worker = registered(false);
  const society = principal.find(t => t.name === "oma_society")!;
  await assert.rejects(() => society.execute("call-1", { action: "nuke" }), /not valid/);
  const lifecycle = principal.find(t => t.name === "oma_agent_lifecycle")!;
  await assert.rejects(() => lifecycle.execute("call-1", { name: "alice", action: "restart" }), /not valid/);
  // A field the action does not own is a model error, not a silently ignored one.
  const merge = worker.find(t => t.name === "oma_merge")!;
  await assert.rejects(() => merge.execute("call-1", { action: "status", name: "merge-1234abcd", sneaky: "x" }),
    /not valid/);
  // And an action outside the union, however it arrived, never reaches argv.
  await assert.rejects(() => merge.execute("call-1", { action: "force-push", name: "merge-1234abcd" }), /not valid/);
});
