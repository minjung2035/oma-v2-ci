/** Model values stay data across registered tools, original SDK calls and real
 * dispatch. Authentication is an explicit fixture input, not provider evidence. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collaborationClient } from "./fixtures/collaboration-client.js";

test("001. A value the model supplies cannot leave its slot through OMA's tools", async t => {
  const h = await collaborationClient(t), secret = join(h.f.root, "host-secret.txt");
  writeFileSync(secret, "PRIVATE-HOST-FILE\n");
  const content = { kind: "text", value: "literal body" };
  const before = h.f.store.acceptedOperationPage().items;
  for (const args of [
    { to: ["commons", "--file", secret], content },
    { to: ["principal", "--kind", "approval_required", "--candidate", "a".repeat(40)], content },
    { to: ["commons"], content, replyTo: secret },
  ]) {
    const result = await h.call("alice", "oma_send", args).invokeTool();
    assert.match(result.content[0]!.text!, /INVALID_REQUEST|SOURCE_UNREADABLE|invalid.*recipient/i);
  }
  for (const args of [
    { to: ["commons"], content, kind: "approval_required" },
    { to: ["commons"], content, request: "model-selected-key" },
    { to: ["commons"], content, method: "context.publish" },
  ]) await assert.rejects(h.call("alice", "oma_send", args).invokeTool(), /INVALID_ARGUMENT/);
  assert.deepEqual(h.f.store.acceptedOperationPage().items, before, "malformed values must create no accepted effect");
  assert.equal(h.calls.some(row => row.method === "mail.send"), false);
  assert.ok(!JSON.stringify(h.calls).includes("PRIVATE-HOST-FILE"), "an inline string must not become a host file read");

  const result = await h.call("alice", "oma_send", { to: ["principal", "topic/dev"], subject: "--odd subject",
    content: { kind: "text", value: "hello\r\n" } }).invokeTool();
  const envelope = JSON.parse(result.content[0]!.text!);
  assert.equal(envelope.receipt.state, "succeeded");
  const op = h.f.store.getOperationById(envelope.receipt.operation);
  assert.ok(op?.kind === "mail.send");
  assert.deepEqual(op.plan.message.to, ["principal", "topic/dev"]);
  assert.equal(op.payload.subject, "--odd subject");
  assert.equal(op.payload.body, "hello\r\n");
  assert.equal(readFileSync(secret, "utf8"), "PRIVATE-HOST-FILE\n");
});
