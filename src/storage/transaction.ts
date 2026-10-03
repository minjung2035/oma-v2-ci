/** M-004/DB-005: a capability exists only for one synchronous root transaction.
 * AsyncLocalStorage prevents an escaped async continuation from borrowing a later
 * transaction's authority. It cannot undo an external effect already started.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { StoreError } from "../domain/errors.js";
import { assertNewAcceptance, observeStoreFailure } from "../domain/admission.js";
import type { Store } from "../store.js";
import type { SynchronousResult } from "../ports/ledger.js";
import { WRITE_METHODS, writeFacets, type StoreWrites, type WriteFacets } from "./facets.js";
export type { StoreWrites } from "./facets.js";

const BRAND: unique symbol = Symbol("StoreTransaction");
export type StoreReads = Pick<Store,
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
  constructor(private readonly store: Store) {}
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
    const methods = Object.fromEntries(WRITE_METHODS.map(name => [name, (...args: unknown[]) => {
      this.requireScope(scope);
      if (name === "insertPreparedBatch") assertNewAcceptance(this.store);
      return Reflect.apply(this.store[name], this.store, args);
    }]));
    // Both compatibility methods and facets retain the same captured scope.
    const tx = Object.freeze({ ...methods, ...writeFacets(methods as StoreWrites), [BRAND]: true }) as Transaction;
    try { return current.run(scope, () => body(tx)); }
    catch (error) { observeStoreFailure(this.store, error); throw error; }
    finally { scope.active = false; scope.inserted.clear(); this.scope = null; }
  }
}
