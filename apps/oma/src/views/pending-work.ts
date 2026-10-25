/** VIEW-002/BATCH-002: counts have units. This projection is not read/understood/approval authority. */
import type { Actor } from "@oma/contracts";
import type { Store } from "@oma/storage";
import type { PendingWorkRows } from "@oma/storage/ledger-reader";
import { StoreError } from "@oma/domain/errors";
import { decodeBatchManifest } from "@oma/storage/rows";

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

const NONE: PendingWorkSummary = Object.freeze({ pendingDeliveryMessages: 0, preparedBatchCount: 0,
  preparedMessageCount: 0, pendingMessages: 0, hasPendingWork: false });

/** WP23.03: the same counts as `pendingWork`, for every agent, from one read.
 * For display only (status.get and the status view); the recovery path keeps
 * `pendingWork`'s full-row reads. The relations the counts rest on are checked
 * here, over the whole read: a counted delivery or batch has an owner, a batch
 * is not from its owner's future, a prepared batch's manifest is exactly its
 * linked delivery set (same owner, not presented), and no message is counted
 * twice for one recipient. Anything else is STORE_CORRUPT, never a smaller count. */
export function pendingWorkByAgent(rows: PendingWorkRows): ReadonlyMap<Actor, PendingWorkSummary> {
  const corrupt = (why: string): never => { throw new StoreError("STORE_CORRUPT", `pending work projection: ${why}`); };
  const owners = new Map(rows.agents.map(agent => [agent.name, agent] as const));
  const counts = new Map<Actor, { deliveries: number; batches: number; batchMessages: number; messages: Set<string> }>();
  const of = (agent: Actor) => {
    if (!owners.has(agent)) corrupt("pending work names a missing agent");
    let entry = counts.get(agent);
    if (entry === undefined) counts.set(agent, entry = { deliveries: 0, batches: 0, batchMessages: 0, messages: new Set() });
    return entry;
  };
  const count = (entry: { messages: Set<string> }, message: string) => {
    if (entry.messages.has(message)) corrupt("a pending message occurs in more than one work item");
    entry.messages.add(message);
  };
  for (const delivery of rows.unbatched) {
    if (delivery.materialized !== 1 || delivery.presented !== 0 || delivery.batchId !== null)
      corrupt("an unbatched delivery violates its eligibility");
    const entry = of(delivery.recipient);
    count(entry, delivery.messageId); entry.deliveries += 1;
  }
  const linked = new Map<string, Set<string>>();
  for (const delivery of rows.linked) {
    const set = linked.get(delivery.batchId!) ?? new Set<string>();
    if (delivery.batchId === null || set.has(delivery.messageId) || delivery.presented !== 0) corrupt("a batch links a delivery twice or a presented one");
    set.add(delivery.messageId); linked.set(delivery.batchId!, set);
  }
  const recipients = new Map(rows.linked.map(delivery => [`${delivery.batchId}/${delivery.messageId}`, delivery.recipient] as const));
  const batches = new Set<string>();
  for (const batch of rows.prepared) {
    if (batch.state !== "prepared" || batches.has(batch.id)) corrupt("a prepared batch is repeated or not prepared");
    batches.add(batch.id);
    const entry = of(batch.agent);
    const owner = owners.get(batch.agent) ?? corrupt("a batch names a missing agent");
    if (batch.incarnation > owner.incarnation) corrupt("a batch belongs to a future incarnation");
    const manifest = decodeBatchManifest(batch.messageIdsJson);
    const set = linked.get(batch.id) ?? new Set<string>();
    if (manifest.length !== set.size || manifest.some(message => !set.has(message) || recipients.get(`${batch.id}/${message}`) !== batch.agent))
      corrupt("a batch manifest differs from its exact linked delivery set");
    for (const message of manifest) count(entry, message);
    entry.batches += 1; entry.batchMessages += manifest.length;
  }
  if (rows.linked.some(delivery => !batches.has(delivery.batchId!))) corrupt("a delivery links a batch that is not prepared");
  const summaries = new Map<Actor, PendingWorkSummary>();
  for (const agent of owners.keys()) {
    const entry = counts.get(agent);
    if (entry === undefined) { summaries.set(agent, NONE); continue; }
    const pendingMessages = entry.deliveries + entry.batchMessages;
    if (!Number.isSafeInteger(pendingMessages)) corrupt("a pending message count is not a safe integer");
    summaries.set(agent, Object.freeze({ pendingDeliveryMessages: entry.deliveries, preparedBatchCount: entry.batches,
      preparedMessageCount: entry.batchMessages, pendingMessages, hasPendingWork: pendingMessages > 0 }));
  }
  return summaries;
}
