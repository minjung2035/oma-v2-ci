/** M-004/DB-005: a capability exists only for one synchronous root transaction.
 * AsyncLocalStorage prevents an escaped async continuation from borrowing a later
 * transaction's authority. It cannot undo an external effect already started.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { assertNewAcceptance, observeStoreFailure } from "@oma/domain/admission";
import { StoreError } from "@oma/domain/errors";
import type { SynchronousResult } from "@oma/contracts/durable";
import type { StoreQueries } from "./store-access.js";
import { writeFacets, type StoreWrites, type WriteFacets } from "./facets.js";
export type { StoreWrites } from "./facets.js";

const BRAND: unique symbol = Symbol("StoreTransaction");
export type StoreReads = Pick<StoreQueries,
  "societyOpen" | "getAgent" | "listAgents" | "subscribers" | "allSubscriptions" | "claimKey" |
  "getOperation" | "getOperationById" | "findPhysicalCreate" | "recoverableOperations" |
  "getDelivery" | "pendingDeliveries" | "deliveriesForOperation" | "getBatch" |
  "preparedBatches" | "pendingBatchesFor"
>;
export type Transaction = StoreWrites & WriteFacets & { readonly [BRAND]: true };
export type SyncCallback<T> = (tx: Transaction) => SynchronousResult<T>;
interface Scope { owner: TransactionScope; active: boolean; inserted: Set<string> }
const current = new AsyncLocalStorage<Scope>();

export function assertSynchronousResult(value: unknown): void {
  if (value !== null && (typeof value === "object" || typeof value === "function") &&
      "then" in value && typeof value.then === "function") {
    if (value instanceof Promise) void value.catch(() => undefined);
    throw new StoreError("INTERNAL_ERROR", "transaction callback returned a Promise/thenable; external effects are not cancelled by rollback");
  }
}

export class TransactionScope {
  private scope: Scope | null = null;
  constructor(private readonly store: StoreWrites) {}
  get active(): boolean { return this.scope?.active === true; }
  private requireScope(expected?: Scope): Scope {
    const scope = current.getStore();
    if (!scope || scope.owner !== this || scope !== this.scope || !scope.active || (expected !== undefined && scope !== expected))
      throw new StoreError("INTERNAL_ERROR", "mutation requires this Store's live root transaction capability");
    return scope;
  }
  requireLive(): void { this.requireScope(); }
  recordInserted(id: string): void {
    const scope = this.requireScope();
    // Called inside the same T as INSERT. A closed gate rolls the entire T back,
    // including old ambient Store callers; it never creates a half-accepted row.
    assertNewAcceptance(this.store);
    scope.inserted.add(id);
  }
  insertedIds(): readonly string[] { return [...this.requireScope().inserted]; }
  requireUnaccepted(id: string): void {
    if (!this.requireScope().inserted.has(id))
      throw new StoreError("STORE_CORRUPT", "accepted operation plan is immutable outside its original acceptance transaction");
  }
  run<T>(body: (tx: Transaction) => T): T {
    if (this.active) throw new StoreError("INTERNAL_ERROR", "nested store transaction");
    const scope: Scope = { owner: this, active: true, inserted: new Set() };
    this.scope = scope;
    const scoped = <A extends unknown[], R>(fn: (...args: A) => R): ((...args: A) => R) => (...args) => {
      this.requireScope(scope);
      return fn(...args);
    };
    const methods = {
      insertOperation: scoped(this.store.insertOperation.bind(this.store)),
      claimOperation: scoped(this.store.claimOperation.bind(this.store)),
      acceptOperation: scoped(this.store.acceptOperation.bind(this.store)),
      updateOperationPlanJson: scoped(this.store.updateOperationPlanJson.bind(this.store)),
      setOperationSucceeded: scoped(this.store.setOperationSucceeded.bind(this.store)),
      setOperationFailed: scoped(this.store.setOperationFailed.bind(this.store)),
      setOperationUnknown: scoped(this.store.setOperationUnknown.bind(this.store)),
      insertAgent: scoped(this.store.insertAgent.bind(this.store)),
      updateAgent: scoped(this.store.updateAgent.bind(this.store)),
      follow: scoped(this.store.follow.bind(this.store)),
      unfollow: scoped(this.store.unfollow.bind(this.store)),
      insertDeliveries: scoped(this.store.insertDeliveries.bind(this.store)),
      markMaterialized: scoped(this.store.markMaterialized.bind(this.store)),
      markAcknowledged: scoped(this.store.markAcknowledged.bind(this.store)),
      linkDeliveriesToBatch: scoped(this.store.linkDeliveriesToBatch.bind(this.store)),
      completeBatch: scoped(this.store.completeBatch.bind(this.store)),
      insertPreparedBatch: scoped((input: Parameters<StoreWrites["insertPreparedBatch"]>[0]) => {
        assertNewAcceptance(this.store);
        return this.store.insertPreparedBatch(input);
      }),
    } satisfies StoreWrites;
    // Both compatibility methods and facets retain the same captured scope.
    const tx = Object.freeze({ ...methods, ...writeFacets(methods), [BRAND]: true }) as Transaction;
    try { return current.run(scope, () => body(tx)); }
    catch (error) { observeStoreFailure(this.store, error); throw error; }
    finally { scope.active = false; scope.inserted.clear(); this.scope = null; }
  }
}
