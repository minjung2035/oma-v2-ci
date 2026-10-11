/** P4: logical views of the one Store, not independent repositories.
 * The tables rename existing methods only. They create neither SQL nor effects.
 */
import type { StoreQueries, StoreWrites } from "./store-access.js";
export type { StoreWrites } from "./store-access.js";

type StoreAccess = StoreQueries & StoreWrites;
type Table = Readonly<Record<string, Readonly<Record<string, keyof StoreAccess>>>>;

function freezeTable<T extends Table>(table: T): T {
  for (const group of Object.values(table)) Object.freeze(group);
  return Object.freeze(table);
}
export const READ_FACETS = freezeTable({
  operations: {
    get: "getOperation", getById: "getOperationById", classifyKey: "claimKey", retried: "retriedOperation",
    recoverableIds: "recoverableOperations", physicalCreate: "findPhysicalCreate",
    succeededContext: "findSucceededContext", latestAction: "latestAgentAction", latestSociety: "latestSocietyAction", submissions: "submittedOperations",
  },
  attestations: { all: "attestationFacts" },
  agents: { get: "getAgent", all: "listAgents" },
  subscriptions: { subscribers: "subscribers", all: "allSubscriptions" },
  deliveries: { get: "getDelivery", pending: "pendingDeliveries", forOperation: "deliveriesForOperation" },
  batches: { get: "getBatch", prepared: "preparedBatches", pending: "pendingBatchesFor" },
} as const satisfies Table);

export const WRITE_FACETS = freezeTable({
  operations: {
    insert: "insertOperation", claim: "claimOperation", accept: "acceptOperation",
    prepare: "updateOperationPlanJson", succeed: "setOperationSucceeded",
    fail: "setOperationFailed", unknown: "setOperationUnknown",
  },
  agents: { insert: "insertAgent", update: "updateAgent" },
  subscriptions: { follow: "follow", unfollow: "unfollow" },
  deliveries: { insert: "insertDeliveries", materialize: "markMaterialized", acknowledge: "markAcknowledged" },
  batches: {
    prepare: "insertPreparedBatch",
    link: "linkDeliveriesToBatch", complete: "completeBatch",
  },
} as const satisfies Table);

type Values<T> = T[keyof T];
export type WriteMethod = Values<{ [K in keyof typeof WRITE_FACETS]: Values<typeof WRITE_FACETS[K]> }>;
export const WRITE_METHODS: readonly WriteMethod[] = Object.freeze(
  [...new Set(Object.values(WRITE_FACETS).flatMap(facet => Object.values(facet)))],
);
type Bound<T extends Table> = {
  readonly [Group in keyof T]: { readonly [Name in keyof T[Group]]: StoreAccess[T[Group][Name]] }
};
export type ReadFacets = Bound<typeof READ_FACETS>;
export type WriteFacets = Bound<typeof WRITE_FACETS>;

/** Explicit calls keep the projection visible to the compiler and static
 * call graph. The descriptors above name capabilities, never dispatch them. */
export function readFacets(store: StoreQueries): ReadFacets {
  return Object.freeze({
    operations: Object.freeze({
      get: (actor, key) => store.getOperation(actor, key),
      getById: id => store.getOperationById(id),
      classifyKey: (actor, key, hash) => store.claimKey(actor, key, hash),
      retried: (actor, key) => store.retriedOperation(actor, key),
      recoverableIds: () => store.recoverableOperations(),
      physicalCreate: (name, hash) => store.findPhysicalCreate(name, hash),
      succeededContext: candidate => store.findSucceededContext(candidate),
      latestAction: (agent, actor) => store.latestAgentAction(agent, actor),
      latestSociety: () => store.latestSocietyAction(),
      submissions: () => store.submittedOperations(),
    }),
    attestations: Object.freeze({ all: () => store.attestationFacts() }),
    agents: Object.freeze({ get: name => store.getAgent(name), all: () => store.listAgents() }),
    subscriptions: Object.freeze({ subscribers: topic => store.subscribers(topic), all: () => store.allSubscriptions() }),
    deliveries: Object.freeze({ get: (message, recipient) => store.getDelivery(message, recipient),
      pending: agent => store.pendingDeliveries(agent), forOperation: id => store.deliveriesForOperation(id) }),
    batches: Object.freeze({ get: id => store.getBatch(id), prepared: agent => store.preparedBatches(agent),
      pending: (agent, incarnation) => store.pendingBatchesFor(agent, incarnation) }),
  } satisfies ReadFacets);
}
/** Projection retains the exact current transaction's scoped closures. */
export function writeFacets(scoped: StoreWrites): WriteFacets {
  return Object.freeze({
    operations: Object.freeze({ insert: scoped.insertOperation, claim: scoped.claimOperation,
      accept: scoped.acceptOperation, prepare: scoped.updateOperationPlanJson,
      succeed: scoped.setOperationSucceeded, fail: scoped.setOperationFailed, unknown: scoped.setOperationUnknown }),
    agents: Object.freeze({ insert: scoped.insertAgent, update: scoped.updateAgent }),
    subscriptions: Object.freeze({ follow: scoped.follow, unfollow: scoped.unfollow }),
    deliveries: Object.freeze({ insert: scoped.insertDeliveries, materialize: scoped.markMaterialized, acknowledge: scoped.markAcknowledged }),
    batches: Object.freeze({ prepare: scoped.insertPreparedBatch, link: scoped.linkDeliveriesToBatch, complete: scoped.completeBatch }),
  } satisfies WriteFacets);
}
