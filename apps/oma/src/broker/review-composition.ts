/** Actual app adapters for the Review use case. */
import type { Store } from "@oma/storage";
import { PreacceptScope } from "@oma/storage/preaccept-artifact";
import { generateOperationId } from "@oma/native/identity";
import { observeStoreFailure } from "@oma/domain/admission";
import type { ReviewLedger, ReviewTransaction } from "@oma/review/ports";

export function reviewLedger(store: Store): ReviewLedger {
  return Object.freeze({
    getAgent: actor => store.getAgent(actor),
    societyOpen: () => store.societyOpen(),
    listAgents: () => store.listAgents(), subscribers: topic => store.subscribers(topic),
    attestationFacts: () => store.attestationFacts(),
    claimKey: (actor, key, hash) => store.claimKey(actor, key, hash),
    retriedOperation: (actor, key) => store.retriedOperation(actor, key),
    getOperation: (actor, key) => store.getOperation(actor, key),
    getOperationById: id => store.getOperationById(id),
    recoverableOperations: () => store.recoverableOperations(),
    observeFailure: error => observeStoreFailure(store, error),
    transaction: body => store.transaction(tx => {
      const captured: ReviewTransaction = Object.freeze({
        acceptOperation: tx.acceptOperation, insertDeliveries: tx.insertDeliveries,
        setOperationSucceeded: tx.setOperationSucceeded,
      });
      return body(captured);
    }),
  } satisfies ReviewLedger);
}
export function reviewRuntime() {
  return Object.freeze({ nextOperationId: generateOperationId, newPreacceptScope: () => new PreacceptScope() });
}
