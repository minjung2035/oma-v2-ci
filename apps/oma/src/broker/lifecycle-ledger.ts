/** Product projection of Lifecycle's queries and original captured transaction closures. */
import type { Store } from "@oma/storage";
import type { LifecycleLedger, LifecycleTransaction } from "@oma/lifecycle/ports";

export function lifecycleLedger(store: Store): LifecycleLedger {
  return Object.freeze({
    getAgent: actor => store.getAgent(actor), listAgents: () => store.listAgents(),
    societyOpen: () => store.societyOpen(),
    claimKey: (actor, key, hash) => store.claimKey(actor, key, hash),
    retriedOperation: (actor, key) => store.retriedOperation(actor, key),
    getOperation: (actor, key) => store.getOperation(actor, key),
    getOperationById: id => store.getOperationById(id),
    recoverableOperations: () => store.recoverableOperations(),
    findPhysicalCreate: (actor, hash) => store.findPhysicalCreate(actor, hash),
    latestAgentAction: (agent, actor) => store.latestAgentAction(agent, actor),
    latestSocietyAction: () => store.latestSocietyAction(),
    getDelivery: (id, actor) => store.getDelivery(id, actor),
    transaction: body => store.transaction(tx => {
      const captured: LifecycleTransaction = Object.freeze({
        acceptOperation: tx.acceptOperation,
        insertAgent: tx.insertAgent, updateAgent: tx.updateAgent,
        insertDeliveries: tx.insertDeliveries,
        setOperationSucceeded: tx.setOperationSucceeded,
        setOperationFailed: tx.setOperationFailed, setOperationUnknown: tx.setOperationUnknown,
        markAcknowledged: tx.markAcknowledged, follow: tx.follow, unfollow: tx.unfollow,
      });
      return body(captured);
    }),
  } satisfies LifecycleLedger);
}
