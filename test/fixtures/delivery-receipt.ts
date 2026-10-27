import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** Delivery receipt fixtures: a real Store/MailModule with one prepared batch
 * and a complete Pi v3 session, not a header-only stand-in. */
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, BoundaryEvidence, PreparedBatch } from "@oma/contracts";
import { MailModule } from "@oma/mail";
import { Store } from "@oma/storage";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import { type DeliveryBoundary } from "@oma/contracts";
import { runnerReceiptPathAt, runnerSessionDirPathAt } from "@oma/domain/paths";
import { ALL_CAPS, storedSpec } from "./spec.js";
import { TEST_VIEW_LIMITS } from "./limits.js";

export const ENTRY = "0123abcd";

/** A Pi v3 session as the delivery leaves it: the header, the presented batch,
 * the settled assistant turn and the boundary entry the receipt names. */
export function completeSession(stateRoot: string, batch: PreparedBatch, name = "delivery.jsonl"): string {
  const sessions = runnerSessionDirPathAt(stateRoot, batch.agent);
  mkdirSync(sessions, { recursive: true, mode: 0o700 });
  const path = join(sessions, name);
  const at = "2026-09-23T00:00:00.000Z";
  const entries = [
    { type: "session", version: 3, id: "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e", timestamp: at, cwd: "/workspace" },
    { type: "custom_message", customType: "oma-mail", content: batch.notice, display: true,
      details: { batchId: batch.id, incarnation: batch.incarnation, messageIds: batch.messageIds },
      id: "1a2b3c4d", parentId: null, timestamp: at },
    { type: "message", id: "2b3c4d5e", parentId: "1a2b3c4d", timestamp: at,
      message: { role: "assistant", content: [{ type: "text", text: "read the mail" }], stopReason: "stop" } },
    { type: "custom", customType: "oma-delivery-boundary", id: ENTRY, parentId: "2b3c4d5e", timestamp: at,
      data: { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id, incarnation: batch.incarnation,
        messageIds: batch.messageIds, sessionPath: path } },
  ];
  writeFileSync(path, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`, { mode: 0o600 });
  return path;
}
/** DR11: a session file holding the boundary entries a receipt may name --
 * the session header, then one boundary entry per id, as Pi appends them. */
export function writeBoundarySession(path: string, batch: PreparedBatch, ...entryIds: readonly string[]): string {
  const entries = entryIds.map(id => JSON.stringify({ type: "custom", customType: "oma-delivery-boundary", id, parentId: null,
    timestamp: "2026-09-25T00:00:00.000Z", data: { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id,
      incarnation: batch.incarnation, messageIds: batch.messageIds, sessionPath: path } }));
  writeFileSync(path, `${['{"type":"session","version":3}', ...entries].join("\n")}\n`, { mode: 0o600 });
  return path;
}
export function boundaryOf(batch: PreparedBatch, sessionPath: string): DeliveryBoundary {
  return { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id, incarnation: batch.incarnation, sessionPath, entryId: ENTRY };
}
export function evidenceOf(stateRoot: string, batch: PreparedBatch, sessionPath: string): BoundaryEvidence {
  return { batchId: batch.id, incarnation: batch.incarnation, sessionPath, adapterRevision: PI_ADAPTER_REVISION,
    receiptPath: runnerReceiptPathAt(stateRoot, batch.agent, batch.id) };
}
/** Real Store and MailModule with one prepared batch for `alice`. */
export async function preparedFixture(incarnation = 1) {
  const root = mkdtempSync(join(tmpdir(), "oma-receipt-observation-"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction(() => store.insertAgent({ name: "alice", ...storedSpec(ALL_CAPS, "p", "alice"), role: "resident",
    desired: "enabled", incarnation, profile: "p", createdBy: null }));
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64, TEST_VIEW_LIMITS.batchMaxMessages, TEST_VIEW_LIMITS);
  const auth: AuthContext = { actor: "alice", incarnation, role: "resident", channel: "actor",
    capabilities: new Set(["mail.send"]), peer: { pid: 1, uid: 1, gid: 1 } };
  await mail.send(auth, "self", { to: ["alice"], subject: "hello", kind: "message", body: "body" });
  const batch = await mail.prepare(auth);
  assert.ok(batch);
  return {
    root, store, mail, auth, batch,
    receipt: runnerReceiptPathAt(root, "alice", batch.id),
    presented: () => store.getDelivery(batch.messageIds[0]!, "alice")?.presented,
    close() {
      for (const path of [runnerReceiptPathAt(root, "alice", batch.id), runnerSessionDirPathAt(root, "alice")])
        if (existsSync(path)) chmodSync(path, 0o700);
      store.close(); rmSync(root, { recursive: true, force: true });
    },
  };
}
export type ReceiptFixture = Awaited<ReturnType<typeof preparedFixture>>;
