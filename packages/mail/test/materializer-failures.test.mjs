import assert from "node:assert/strict";
import test from "node:test";
import { StoreError, errorCodeOf, primaryFailure } from "@oma/domain/errors";
import { messageIdForOperation } from "@oma/domain/derived";
import { MailMaterializer } from "@oma/mail/materializer";
import { BatchCoordinator } from "@oma/mail/batches";
import { reconcileOrdinaryMail } from "@oma/mail/reconcile";
import { buildFrozenMessage } from "@oma/mail/serialize";
import { messagePlanFrom } from "@oma/mail/facts";

async function fixture() {
  const id = "op-12345678-1234-4123-8123-123456789abc";
  const rendered = await buildFrozenMessage({ id: messageIdForOperation(id, 0), society: "demo", sender: "alice",
    to: ["commons"], kind: "message", contextRevision: null,
    replyHeaders: { replyTo: ["commons"], inReplyTo: null, references: [] } }, { subject: "test", body: "body" });
  const message = messagePlanFrom(rendered, ["alice", "bob"]);
  const operation = { id, kind: "mail.send", state: "pending", plan: { kind: "mail.send", message } };
  const deliveries = message.recipients.map(recipient => ({ messageId: message.id, recipient, operationId: id, materialized: 0 }));
  const corruption = new StoreError("STORE_CORRUPT", "inbox bytes differ"), cleanup = new Error("close failed");
  const opened = [], marked = [];
  const store = { getOperationById: () => operation, recoverableOperations: () => [id],
    listAgents: () => [{ name: "alice" }, { name: "bob" }], deliveriesForOperation: () => deliveries,
    getDelivery: (_id, actor) => deliveries.find(row => row.recipient === actor),
    transaction: use => use({ markMaterialized: (_id, actor) => marked.push(actor) }) };
  const effects = { readMessage: () => Buffer.from(rendered.text), publishMailArchive: () => {},
    openInbox: actor => { opened.push(actor); return { observeInboxMessage: () => ({ kind: "corrupt", error: corruption }),
      close: () => { throw cleanup; } }; } };
  return { id, message, store, effects, corruption, cleanup, opened, marked };
}

test("001. Mail publication preserves corruption through close failure and stops fanout", async () => {
  const f = await fixture();
  assert.throws(() => new MailMaterializer(f.store, "demo", f.effects).ordinary(f.id), error => {
    assert.equal(errorCodeOf(error), "STORE_CORRUPT");
    assert.equal(primaryFailure(error), f.corruption);
    assert.deepEqual(error.errors, [f.corruption, f.cleanup]);
    return true;
  });
  assert.deepEqual(f.opened, ["alice"]);
  assert.deepEqual(f.marked, []);
});

test("002. Mailbox move preserves the primary observation when closing fails", async () => {
  const f = await fixture();
  const batches = new BatchCoordinator(f.store, "/unused", {}, f.effects, 24);
  assert.throws(() => batches.moveToCur("alice", [f.message.id]), error => {
    assert.equal(primaryFailure(error), f.corruption);
    assert.deepEqual(error.errors, [f.corruption, f.cleanup]);
    return true;
  });
});

test("003. Mail recovery propagates aggregate corruption for the admission fence", async () => {
  const f = await fixture();
  const failure = new AggregateError([f.corruption, f.cleanup], "publication and cleanup failed");
  await assert.rejects(reconcileOrdinaryMail(f.store, { materialize: async () => { throw failure; } }, f.effects),
    error => error === failure);
});
