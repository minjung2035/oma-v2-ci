/** The seventh review (adversarial, 2026-09-28): the core's findings, each
 * held by what the product now does. Platform findings are in
 * platform-stream-publication, platform-host-service and platform-snapshot. */
import test from "node:test";
import assert from "node:assert/strict";
import { requestKeyOf } from "../src/extension/shared.js";

/** A session branch as the engine keeps it: an assistant message with its
 * tool calls, and a tool result for each call that got one. */
function session(entries: readonly { call: string; tool: string; args: Record<string, unknown>; answered: boolean }[]) {
  const branch = entries.flatMap(entry => [
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: entry.call, name: entry.tool, arguments: entry.args }] } },
    ...(entry.answered ? [{ type: "message", message: { role: "toolResult", toolCallId: entry.call, toolName: entry.tool, content: [] } }] : []),
  ]);
  return { sessionManager: { getSessionId: () => "session-1", getBranch: () => branch } };
}

test("P0V-110 / F-07: a call repeated after its result was lost has the key of the first; after a result the model saw, a new one", () => {
  const args = { to: ["bob"], subject: "hi", body: "the same letter" };
  const send = (id: string, context: ReturnType<typeof session>) => requestKeyOf(undefined, { id, tool: "oma_mail_send", params: args, context });
  // The first call; the engine died before its result was recorded.
  const first = send("call-1", session([{ call: "call-1", tool: "oma_mail_send", args, answered: false }]));
  // The engine answered it with "No result provided" (not kept in the session); the model calls again.
  const again = send("call-2", session([
    { call: "call-1", tool: "oma_mail_send", args, answered: false },
    { call: "call-2", tool: "oma_mail_send", args, answered: false },
  ]));
  assert.equal(again, first, "the repeated call is the same request, which the broker answers once");
  // The model saw the first result and sends the same letter again: a new request.
  const later = send("call-3", session([
    { call: "call-1", tool: "oma_mail_send", args, answered: true },
    { call: "call-3", tool: "oma_mail_send", args, answered: false },
  ]));
  assert.notEqual(later, first);
  // Other arguments, another tool: other requests.
  assert.notEqual(requestKeyOf(undefined, { id: "call-4", tool: "oma_mail_send", params: { ...args, body: "another" }, context: session([]) }), first);
  assert.notEqual(requestKeyOf(undefined, { id: "call-5", tool: "oma_mail_ack", params: args, context: session([]) }), first);
  // The model's own key is the key; an invalid one is refused.
  assert.equal(requestKeyOf("mine-1", { id: "x", tool: "oma_mail_send", params: args, context: session([]) }), "mine-1");
  assert.throws(() => requestKeyOf("bad key", { id: "x", tool: "oma_mail_send", params: args }));
  // Without the engine's session, the call's own id stands in for it.
  assert.notEqual(requestKeyOf(undefined, { id: "a", tool: "oma_mail_send", params: args }), requestKeyOf(undefined, { id: "b", tool: "oma_mail_send", params: args }));
  assert.match(first, /^pi-[0-9a-f]{40}$/);
});
