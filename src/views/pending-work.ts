/** VIEW-002/BATCH-002: counts have units. This projection is not read/understood/approval authority. */
import type { Actor } from "../../implementation/contracts.js";
import type { Store } from "../store.js";
import { StoreError } from "../domain/errors.js";
import { decodeBatchManifest } from "../storage/rows.js";

export interface PendingWorkSummary {
  readonly pendingDeliveryMessages: number;
  readonly preparedBatchCount: number;
  readonly preparedMessageCount: number;
  readonly pendingMessages: number;
  readonly hasPendingWork: boolean;
}
export type PendingWorkReads = Pick<Store, "pendingDeliveries" | "preparedBatches">;

/** Read synchronously from the validated Store facade, without an intervening
 * await. Store batch reads validate the exact linked delivery set before this
 * projection is allowed to count it. A Set detects corruption; it never repairs
 * duplicates by silently counting fewer messages.
 */
export function pendingWork(store: PendingWorkReads, agent: Actor): PendingWorkSummary {
  const deliveries = store.pendingDeliveries(agent);
  const batches = store.preparedBatches(agent);
  const messages = new Set<string>();
  const batchIds = new Set<string>();
  for (const delivery of deliveries) {
    if (delivery.recipient !== agent || delivery.materialized !== 1 || delivery.presented !== 0 || delivery.batchId !== null || messages.has(delivery.messageId))
      throw new StoreError("STORE_CORRUPT", "pending delivery projection violates its eligibility or identity");
    // Acknowledgement deliberately does not change the existing eligibility predicate.
    messages.add(delivery.messageId);
  }
  let preparedMessageCount = 0;
  for (const batch of batches) {
    if (batch.agent !== agent || batch.state !== "prepared" || batchIds.has(batch.id))
      throw new StoreError("STORE_CORRUPT", "prepared batch projection contains a wrong owner, state or duplicate");
    batchIds.add(batch.id);
    const manifest = decodeBatchManifest(batch.messageIdsJson);
    for (const message of manifest) {
      if (messages.has(message)) throw new StoreError("STORE_CORRUPT", "pending message occurs in more than one work item");
      messages.add(message);
    }
    preparedMessageCount += manifest.length;
  }
  const pendingMessages = deliveries.length + preparedMessageCount;
  if (!Number.isSafeInteger(pendingMessages)) throw new StoreError("STORE_CORRUPT", "pending message count is not a safe integer");
  return Object.freeze({ pendingDeliveryMessages: deliveries.length, preparedBatchCount: batches.length,
    preparedMessageCount, pendingMessages, hasPendingWork: pendingMessages > 0 });
}
