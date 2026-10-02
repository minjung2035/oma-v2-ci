/** P4: logical views of the one Store, not independent repositories.
 * The tables rename existing methods only. They create neither SQL nor effects.
 */
import type { Store } from "../store.js";

type Table = Readonly<Record<string, Readonly<Record<string, keyof Store>>>>;

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
  usage: { get: "getUsage", all: "usageRows" },
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
  usage: { reserve: "reserveUsage", settle: "settleUsage" },
} as const satisfies Table);

type Values<T> = T[keyof T];
export type WriteMethod = Values<{ [K in keyof typeof WRITE_FACETS]: Values<typeof WRITE_FACETS[K]> }>;
export type StoreWrites = Pick<Store, WriteMethod>;
export const WRITE_METHODS: readonly WriteMethod[] = Object.freeze(
  [...new Set(Object.values(WRITE_FACETS).flatMap(facet => Object.values(facet)))],
);
type Bound<T extends Table> = {
  readonly [Group in keyof T]: { readonly [Name in keyof T[Group]]: Store[T[Group][Name]] }
};
export type ReadFacets = Bound<typeof READ_FACETS>;
export type WriteFacets = Bound<typeof WRITE_FACETS>;

/** The type assertion is a key-preserving adapter, not a data decoder. */
function bind<T extends Table>(table: T, owner: object): Bound<T> {
  const result: Record<string, object> = {};
  for (const [group, members] of Object.entries(table)) {
    const facet: Record<string, unknown> = {};
    for (const [name, method] of Object.entries(members)) {
      const fn: unknown = Reflect.get(owner, method);
      if (typeof fn !== "function") throw new TypeError(`missing Store facet method ${method}`);
      facet[name] = (...args: unknown[]) => Reflect.apply(fn, owner, args);
    }
    result[group] = Object.freeze(facet);
  }
  return Object.freeze(result) as Bound<T>;
}
export function readFacets(store: Store): ReadFacets { return bind(READ_FACETS, store); }
/** Pass ONLY the current transaction's already-scoped closures, never Store.
 * Escaped facet functions therefore retain exactly the original root scope.
 */
export function writeFacets(scoped: StoreWrites): WriteFacets { return bind(WRITE_FACETS, scoped); }
