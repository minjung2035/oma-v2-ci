import { mailEffects } from "./mail-effects.js";
/** Product composition for Mail; the feature never receives the concrete Store. */
import type { Store } from "@oma/storage";
import { MailModule, type MailSociety } from "@oma/mail";
import type { MailLedger, MailTransaction } from "@oma/mail/ports";
import type { BatchViewLimits } from "@oma/protocol/batch-view";

export function mailLedger(store: Store): MailLedger {
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
    transaction: body => store.transaction(tx => {
      // Copy captured closures, never ambient Store mutation methods. A saved
      // projection cannot act after this T or borrow a later T's authority.
      const scoped: MailTransaction = Object.freeze({
        acceptOperation: tx.acceptOperation,
        insertDeliveries: tx.insertDeliveries,
        setOperationSucceeded: tx.setOperationSucceeded,
        markMaterialized: tx.markMaterialized,
        insertPreparedBatch: tx.insertPreparedBatch,
        linkDeliveriesToBatch: tx.linkDeliveriesToBatch,
        completeBatch: tx.completeBatch,
      });
      return body(scoped);
    }),
  } satisfies MailLedger);
}

export function createMailModule(paths: MailSociety, store: Store, maxReplyReferences: number,
  batchMaxMessages = 24, viewLimits?: BatchViewLimits): MailModule {
  store.bindRepositoryIdentity({ society: paths.society });
  return new MailModule(paths, mailLedger(store), maxReplyReferences, mailEffects(paths), batchMaxMessages, viewLimits);
}
