import { mailEffects } from "#oma-test/app/broker/mail-effects";
import { mailLedger } from "#oma-test/app/broker/mail-composition";
import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";
import type { MessagePlan } from "@oma/contracts";
import { sha256Hex } from "@oma/domain/canonical-json";
import { mailObjectPathAt, mailArchivePathAt, mailInboxPathAt } from "@oma/domain/paths";
import { operationMessage, MailMaterializer } from "@oma/mail/materializer";
import type { Store } from "@oma/storage";
import type { LedgerSnapshot, InvariantPhase } from "./store.js";

export function matchingFile(path: string, expected: { bytes: number; sha256: string }, required: boolean, label: string): boolean {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) { assert.equal(required, false, `${label}:MISSING:${path}`); return false; }
  assert.equal(stat.isFile(), true, `${label}:TYPE:${path}`);
  assert.equal(stat.size, expected.bytes, `${label}:SIZE:${path}`);
  assert.equal(sha256Hex(readFileSync(path)), expected.sha256, `${label}:HASH:${path}`);
  return true;
}
export function assertMail(snapshot: LedgerSnapshot, store: Store, root: string, society: string, phase: InvariantPhase): readonly string[] {
  const incomplete: string[] = [];
  const headers = new MailMaterializer(mailLedger(store), society, mailEffects({stateRoot: root, society}));
  for (const operation of snapshot.operations) {
    if (!["mail.send", "agent.continue", "git.submit", "context.publish", "agent.create"].includes(operation.kind)) continue;
    if (operation.kind === "agent.create" && operation.plan.existingCreation !== null) {
      assert.equal(snapshot.deliveries.some(delivery => delivery.operationId === operation.id), false, "LINKED_CREATE_OWNS_DELIVERY");
      continue;
    }
    const message: MessagePlan = operationMessage(operation);
    matchingFile(mailObjectPathAt(root, message.id), message, true, "ACCEPTED_MAIL_SOURCE");
    headers.headers(message);
    const deliveries = snapshot.deliveries.filter(delivery => delivery.operationId === operation.id);
    assert.deepEqual(deliveries.map(delivery => delivery.recipient).sort(), [...message.recipients].sort(), `MAIL_RECIPIENT_SET:${operation.id}`);
    const succeeded = operation.state === "succeeded";
    const archived = matchingFile(mailArchivePathAt(root, message.id), message, succeeded, "MAIL_ARCHIVE");
    for (const delivery of deliveries) {
      assert.equal(delivery.messageId, message.id, "MAIL_OPERATION_MESSAGE_LINK");
      const fresh = matchingFile(mailInboxPathAt(root, delivery.recipient, message.id, "new"), message, false, "MAIL_NEW");
      const current = matchingFile(mailInboxPathAt(root, delivery.recipient, message.id, "cur"), message, false, "MAIL_CUR");
      if (succeeded || delivery.materialized === 1) {
        assert.equal(archived, true, "MATERIALIZED_ARCHIVE_MISSING");
        assert.equal(fresh || current, true, "MATERIALIZED_INBOX_MISSING");
      }
      // Acknowledgement does not imply presentation; the flag decoders enforce
      // each fact's own first timestamp rather than substituting one for another.
      if (succeeded) assert.equal(delivery.materialized, 1, "SUCCEEDED_DELIVERY_NOT_MATERIALIZED");
    }
    if (operation.state === "pending" || operation.state === "unknown") {
      const allowed = phase !== "settled";
      assert.equal(allowed, true, `UNDECLARED_INCOMPLETE_MAIL:${operation.id}`);
      incomplete.push(`${operation.id}:${operation.state}:${archived ? "archive-present" : "archive-absent"}`);
    }
  }
  return incomplete;
}
