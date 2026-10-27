/** G01-r2: a durably published receipt whose engine session file was rotated
 * away (a file OMA does not own the lifetime of after the boundary flush) is
 * re-read as `conflicting` -> hold, not `verified`. If the crash landed between
 * publishDeliveryReceipt and the completeBatch transaction, the batch is left
 * `prepared` and every later rollover throws BATCH_CONFLICT: an operator-only
 * stall built on the disappearance of a non-receipt file.
 *
 * Uses only dist/ imports and a mkdtemp sandbox. No repo writes.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PI_ADAPTER_REVISION,
  publishDeliveryReceipt,
  observeDeliveryReceipt,
  deliveryDecision,
} from "../../../../dist/src/storage/delivery-receipt.js";
import { runnerSessionDirPathAt, runnerReceiptPathAt } from "../../../../dist/src/storage/paths.js";

const root = mkdtempSync(join(tmpdir(), "oma-adv-G01-storage-fs-r2-"));
const FRAME = 1 << 20;
const ENTRY = "0123abcd";

// A minimal PreparedBatch shape the receipt code reads (agent/id/incarnation/messageIds/notice).
const batch = {
  id: "b-0123abcd-4b5a-4968-8778-695a4b3c2d1e",
  agent: "alice",
  incarnation: 3,
  messageIds: ["m-0123abcd-4b5a-4968-8778-695a4b3c2d1e-0"],
  notice: "notice",
};

function writeSession(name) {
  const dir = runnerSessionDirPathAt(root, "alice");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, name);
  const at = "2026-09-23T00:00:00.000Z";
  const entries = [
    { type: "session", version: 3, id: "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e", timestamp: at, cwd: "/workspace" },
    { type: "custom", customType: "oma-delivery-boundary", id: ENTRY, parentId: null, timestamp: at,
      data: { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id, incarnation: batch.incarnation,
        messageIds: batch.messageIds, sessionPath: path } },
  ];
  writeFileSync(path, `${entries.map(e => JSON.stringify(e)).join("\n")}\n`, { mode: 0o600 });
  return path;
}

try {
  const session = writeSession("delivery.jsonl");
  const boundary = { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id, incarnation: batch.incarnation, sessionPath: session, entryId: ENTRY };
  publishDeliveryReceipt(root, batch, boundary, FRAME);

  // 1) Immediately after publication: verified.
  const before = deliveryDecision(observeDeliveryReceipt(root, batch, FRAME, { first: batch.incarnation, last: batch.incarnation }));
  console.log("before rotation:", before.action);

  // 2) Simulate: crash before completeBatch, then the engine rotates/removes
  //    the session file on the next run. The receipt file is untouched.
  unlinkSync(session);

  // 3) Rollover re-observation of the very same durable receipt.
  const after = deliveryDecision(observeDeliveryReceipt(root, batch, FRAME, { first: batch.incarnation, last: batch.incarnation + 1 }));
  console.log("after rotation:", after.action, after.action === "hold" ? after.error.code : "");
  console.log(
    before.action === "settle" && after.action === "hold" && after.error.code === "BATCH_CONFLICT"
      ? "CONFIRMED: a durable receipt flips verified->hold(BATCH_CONFLICT) when the session file is gone"
      : "NOT CONFIRMED",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
