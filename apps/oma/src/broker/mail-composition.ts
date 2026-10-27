import { mailEffects } from "./mail-effects.js";
/** Product composition for Mail; the feature never receives the concrete Store. */
import type { Store } from "@oma/storage";
import { MailModule, type MailSociety } from "@oma/mail";
import type { MailLedger, MailTransaction } from "@oma/mail/ports";
import type { BatchViewLimits } from "@oma/protocol/batch-view";
import type { Actor, MessageId } from "@oma/contracts";

export function mailLedger(store: Store, hintMaterialized?: (actor: Actor) => void): MailLedger {
  return Object.freeze({
    getAgent: actor => store.getAgent(actor),
    societyOpen: () => store.societyOpen(),
    listAgents: () => store.listAgents(),
    subscribers: topic => store.subscribers(topic),
    claimKey: (actor, key, hash) => store.claimKey(actor, key, hash),
    retriedOperation: (actor, key) => store.retriedOperation(actor, key),
    getOperation: (actor, key) => store.getOperation(actor, key),
    getOperationById: id => store.getOperationById(id),
    recoverableOperations: () => store.recoverableOperations(),
    deliveriesForOperation: id => store.deliveriesForOperation(id),
    getDelivery: (id, actor) => store.getDelivery(id, actor),
    pendingDeliveryRows: actor => store.pendingDeliveryRows(actor),
    getBatch: id => store.getBatch(id),
    preparedBatches: actor => store.preparedBatches(actor),
    transaction: body => {
      const materialized = new Set<Actor>();
      const result = store.transaction(tx => {
        // Copy captured closures, never ambient Store mutation methods. A saved
        // projection cannot act after this T or borrow a later T's authority.
        const scoped: MailTransaction = Object.freeze({
          acceptOperation: tx.acceptOperation,
          insertDeliveries: tx.insertDeliveries,
          setOperationSucceeded: tx.setOperationSucceeded,
          markMaterialized: (message: MessageId, actor: Actor) => {
            // Re-observing a confirmed publication during recovery is not a
            // new wake event; repeated repair must not feed its own hint loop.
            if (tx.markMaterialized(message, actor)) materialized.add(actor);
          },
          insertPreparedBatch: tx.insertPreparedBatch,
          linkDeliveriesToBatch: tx.linkDeliveriesToBatch,
          completeBatch: tx.completeBatch,
        });
        return body(scoped);
      });
      // Hints leave only after COMMIT. Rollback and commit uncertainty retain
      // original ledger semantics and rely on the ordinary recovery sweep.
      for (const actor of materialized) hintMaterialized?.(actor);
      return result;
    },
  } satisfies MailLedger);
}

export function createMailModule(paths: MailSociety, store: Store, maxReplyReferences: number,
  batchMaxMessages = 24, viewLimits?: BatchViewLimits, hintMaterialized?: (actor: Actor) => void): MailModule {
  store.bindRepositoryIdentity({ society: paths.society });
  return new MailModule(paths, mailLedger(store, hintMaterialized), maxReplyReferences, mailEffects(paths), batchMaxMessages, viewLimits);
}
