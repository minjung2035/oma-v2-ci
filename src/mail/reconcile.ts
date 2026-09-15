import { observeImmutableFile, readImmutableBytes } from "../storage/immutable-file.js";
import type { Store } from "../store.js";
import { StoreError, errorCodeOf } from "../domain/errors.js";
export interface MailRecoveryPort {
  objectPath(id: string): string;
  archivePath(id: string): string;
  materialize(id: string): Promise<void>;
}
export interface RecoveryCounts { examined: number; repaired: number; remaining: number }
export async function reconcileMailOperation(store: Store, mail: MailRecoveryPort, id: string): Promise<void> {
  const operation = store.operations.getById(id);
  if (!operation || (operation.kind !== "mail.send" && operation.kind !== "agent.continue") ||
    (operation.state !== "pending" && operation.state !== "unknown")) return;
  const message = operation.plan.message;
  readImmutableBytes(mail.objectPath(message.id), message.sha256, message.bytes);
  await mail.materialize(id);
  const current = store.operations.getById(id);
  if (!current) throw new StoreError("STORE_CORRUPT", "accepted mail disappeared during recovery");
  if (current.state === "succeeded" || current.state === "failed") return;
  const deliveries = store.deliveries.forOperation(id);
  const expected = [...message.recipients].sort();
  const actual = deliveries.map(delivery => delivery.recipient).sort();
  if (expected.length !== actual.length || expected.some((recipient, index) => recipient !== actual[index]))
    throw new StoreError("STORE_CORRUPT", "accepted mail recipient snapshot changed");
  const archive = observeImmutableFile(mail.archivePath(message.id), message.sha256, message.bytes);
  // The archive is derived state: proven absence needs materialization, not repair.
  if (archive.kind === "absent") return;
  if (archive.kind === "corrupt") throw archive.error;
  if (archive.kind === "unavailable")
    throw new StoreError("BROKER_UNAVAILABLE", "mail archive observation is unavailable", { cause: archive.error });
  if (deliveries.every(delivery => delivery.materialized === 1))
    store.transaction(tx => tx.operations.succeed(id, JSON.stringify({ kind: operation.kind, message: message.id,
      recipientCount: deliveries.length, archivePath: mail.archivePath(message.id) })));
}
export async function reconcileOrdinaryMail(store: Store, mail: MailRecoveryPort): Promise<RecoveryCounts> {
  const snapshot = [...new Set(store.operations.recoverableIds())];
  const counts: RecoveryCounts = { examined: 0, repaired: 0, remaining: 0 };
  for (const id of snapshot) {
    const before = store.operations.getById(id);
    if (!before || (before.kind !== "mail.send" && before.kind !== "agent.continue") ||
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
