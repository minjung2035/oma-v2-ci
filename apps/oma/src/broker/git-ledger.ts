/** Actual product ledger projection; no ambient mutation method escapes T. */
import type { Store } from "@oma/storage";
import type { GitLedger, GitTransaction, GitMessaging } from "@oma/git/ports";
import type { MailModule } from "@oma/mail";
export function gitLedger(store: Store): GitLedger {
  return Object.freeze({
    get inTransaction() { return store.inTransaction; },
    getAgent: actor => store.getAgent(actor),
    societyOpen: () => store.societyOpen(),
    claimKey: (actor, key, hash) => store.claimKey(actor, key, hash),
    retriedOperation: (actor, key) => store.retriedOperation(actor, key),
    getOperationById: id => store.getOperationById(id),
    recoverableOperations: () => store.recoverableOperations(),
    findSucceededContext: revision => store.findSucceededContext(revision),
    submissions: () => store.operations.submissions(),
    transaction: body => store.transaction(tx => {
      const captured: GitTransaction = Object.freeze({
        acceptOperation: tx.acceptOperation, insertDeliveries: tx.insertDeliveries,
        setOperationSucceeded: tx.setOperationSucceeded,
        setOperationFailed: tx.setOperationFailed, setOperationUnknown: tx.setOperationUnknown,
      });
      return body(captured);
    }),
  } satisfies GitLedger);
}
export function gitMessaging(mail: MailModule): GitMessaging {
  return Object.freeze({
    freezeNotification: (id, sender, input) => mail.freezeNotification(id, sender, input),
    recipients: to => mail.recipients(to),
    frozenDisposition: (id, message) => mail.frozenDisposition(id, message),
    publishGated: (id, proof) => mail.publishGated(id, proof),
  } satisfies GitMessaging);
}
