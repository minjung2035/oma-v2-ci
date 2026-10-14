import { observeImmutableFile, readImmutableBytes } from "../storage/immutable-file.js";
import type { Store } from "../store.js";
import { ownedMessages, type PlanFor } from "../durable.js";
import { StoreError, errorCodeOf } from "../domain/errors.js";
export interface MailRecoveryPort {
  objectPath(id: string): string;
  /** The archive a message belongs to by audience. */
  archivePath(id: string, audience?: "workers"): string;
  materialize(id: string): Promise<void>;
}
export interface RecoveryCounts { examined: number; repaired: number; remaining: number }

type ReviewPlan = Extract<PlanFor<"attest.record">, { messages: unknown }>;
/** The request name a review operation's result reports: the frozen name of
 * the open fact — its own for an open, the named request otherwise. */
function reviewRequestName(store: Store, plan: ReviewPlan): string {
  if (plan.fact.kind === "merge.open" || plan.fact.kind === "challenge.open") return plan.fact.name;
  const open = store.operations.getById(plan.fact.request);
  if (open === null || open.kind !== "attest.record" || !("messages" in open.plan) ||
      (open.plan.fact.kind !== "merge.open" && open.plan.fact.kind !== "challenge.open"))
    throw new StoreError("STORE_CORRUPT", "review fact names no review request");
  return open.plan.fact.name;
}
export async function reconcileMailOperation(store: Store, mail: MailRecoveryPort, id: string): Promise<void> {
  const operation = store.operations.getById(id);
  if (!operation || (operation.kind !== "attest.record" && operation.kind !== "mail.send" && operation.kind !== "agent.continue") ||
    (operation.state !== "pending" && operation.state !== "unknown")) return;
  const messages = ownedMessages(operation.plan);
  for (const message of messages) readImmutableBytes(mail.objectPath(message.id), message.sha256, message.bytes);
  await mail.materialize(id);
  const current = store.operations.getById(id);
  if (!current) throw new StoreError("STORE_CORRUPT", "accepted mail disappeared during recovery");
  if (current.state === "succeeded" || current.state === "failed") return;
  const deliveries = store.deliveries.forOperation(id);
  for (const message of messages) {
    const expected = [...message.recipients].sort();
    const actual = deliveries.filter(delivery => delivery.messageId === message.id)
      .map(delivery => delivery.recipient).sort();
    if (expected.length !== actual.length || expected.some((recipient, index) => recipient !== actual[index]))
      throw new StoreError("STORE_CORRUPT", "accepted mail recipient snapshot changed");
    const archive = observeImmutableFile(mail.archivePath(message.id, message.audience), message.sha256, message.bytes);
    // The archive is derived state: proven absence needs materialization, not repair.
    if (archive.kind === "absent") return;
    if (archive.kind === "corrupt") throw archive.error;
    if (archive.kind === "unavailable")
      throw new StoreError("BROKER_UNAVAILABLE", "mail archive observation is unavailable", { cause: archive.error });
  }
  if (!deliveries.every(delivery => delivery.materialized === 1)) return;
  const plan = operation.plan;
  const result = plan.kind === "attest.record" && "messages" in plan
    ? { kind: "attest.record", request: reviewRequestName(store, plan),
        messages: plan.messages.map(message => message.id), recipientCount: deliveries.length }
    : { kind: operation.kind, message: messages[0]!.id,
        recipientCount: deliveries.length, archivePath: mail.archivePath(messages[0]!.id) };
  store.transaction(tx => tx.operations.succeed(id, JSON.stringify(result)));
}
export async function reconcileOrdinaryMail(store: Store, mail: MailRecoveryPort): Promise<RecoveryCounts> {
  const snapshot = [...new Set(store.operations.recoverableIds())];
  const counts: RecoveryCounts = { examined: 0, repaired: 0, remaining: 0 };
  for (const id of snapshot) {
    const before = store.operations.getById(id);
    if (!before || (before.kind !== "attest.record" && before.kind !== "mail.send" && before.kind !== "agent.continue") ||
      (before.state !== "pending" && before.state !== "unknown")) continue;
    counts.examined++;
    try { await reconcileMailOperation(store, mail, id); }
    catch (error) {
      if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error;
      console.error(JSON.stringify({ event: "reconcile.mail", operation: id, code: errorCodeOf(error) }));
    }
    const after = store.operations.getById(id);
    if (!after) throw new StoreError("STORE_CORRUPT", "accepted operation disappeared during recovery");
    if (after.state === "succeeded" || after.state === "failed") counts.repaired++;
    else counts.remaining++;
  }
  return counts;
}
