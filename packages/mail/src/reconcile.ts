
import type { MailLedger, MailRecoveryEffects } from "./ports.js";
import { ownedMessages, type PlanFor } from "@oma/domain/durable";
import { StoreError, errorCodeOf } from "@oma/domain/errors";
import { mailEntryPresent } from "./observations.js";
export interface MailRecoveryPort {
  objectPath(id: string): string;
  /** The archive a message belongs to by audience. */
  archivePath(id: string, audience?: "workers"): string;
  materialize(id: string): Promise<void>;
}
import type { RecoveryCounts } from "@oma/contracts/runtime";

type ReviewPlan = Extract<PlanFor<"attest.record">, { messages: unknown }>;
/** The request name a review operation's result reports: the frozen name of
 * the open fact — its own for an open, the named request otherwise. */
function reviewRequestName(store: MailLedger, plan: ReviewPlan): string {
  if (plan.fact.kind === "merge.open" || plan.fact.kind === "challenge.open") return plan.fact.name;
  const open = store.getOperationById(plan.fact.request);
  if (open === null || open.kind !== "attest.record" || !("messages" in open.plan) ||
      (open.plan.fact.kind !== "merge.open" && open.plan.fact.kind !== "challenge.open"))
    throw new StoreError("STORE_CORRUPT", "review fact names no review request");
  return open.plan.fact.name;
}
export async function reconcileMailOperation(store: MailLedger, mail: MailRecoveryPort, id: string, effects: MailRecoveryEffects): Promise<void> {
  const operation = store.getOperationById(id);
  if (!operation || (operation.kind !== "attest.record" && operation.kind !== "mail.send" && operation.kind !== "agent.continue") ||
    (operation.state !== "pending" && operation.state !== "unknown")) return;
  const messages = ownedMessages(operation.plan);
  for (const message of messages) effects.readMessage(message);
  await mail.materialize(id);
  const current = store.getOperationById(id);
  if (!current) throw new StoreError("STORE_CORRUPT", "accepted mail disappeared during recovery");
  if (current.state === "succeeded" || current.state === "failed") return;
  const deliveries = store.deliveriesForOperation(id);
  for (const message of messages) {
    const expected = [...message.recipients].sort();
    const actual = deliveries.filter(delivery => delivery.messageId === message.id)
      .map(delivery => delivery.recipient).sort();
    if (expected.length !== actual.length || expected.some((recipient, index) => recipient !== actual[index]))
      throw new StoreError("STORE_CORRUPT", "accepted mail recipient snapshot changed");
    const archive = effects.observeArchive(message);
    // The archive is derived state: proven absence needs materialization, not repair.
    if (!mailEntryPresent(archive, "mail archive")) return;
  }
  if (!deliveries.every(delivery => delivery.materialized === 1)) return;
  const plan = operation.plan;
  const result = plan.kind === "attest.record" && "messages" in plan
    ? { kind: "attest.record", request: reviewRequestName(store, plan),
        messages: plan.messages.map(message => message.id), recipientCount: deliveries.length }
    : { kind: operation.kind, message: messages[0]!.id,
        recipientCount: deliveries.length, archivePath: mail.archivePath(messages[0]!.id) };
  store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify(result)));
}
export async function reconcileOrdinaryMail(store: MailLedger, mail: MailRecoveryPort, effects: MailRecoveryEffects): Promise<RecoveryCounts> {
  const snapshot = [...new Set(store.recoverableOperations())];
  const counts: RecoveryCounts = { examined: 0, repaired: 0, remaining: 0 };
  for (const id of snapshot) {
    const before = store.getOperationById(id);
    if (!before || (before.kind !== "attest.record" && before.kind !== "mail.send" && before.kind !== "agent.continue") ||
      (before.state !== "pending" && before.state !== "unknown")) continue;
    counts.examined++;
    try { await reconcileMailOperation(store, mail, id, effects); }
    catch (error) {
      if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error;
      console.error(JSON.stringify({ event: "reconcile.mail", operation: id, code: errorCodeOf(error) }));
    }
    const after = store.getOperationById(id);
    if (!after) throw new StoreError("STORE_CORRUPT", "accepted operation disappeared during recovery");
    if (after.state === "succeeded" || after.state === "failed") counts.repaired++;
    else counts.remaining++;
  }
  return counts;
}
