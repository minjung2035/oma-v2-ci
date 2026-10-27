/** Internal ledger query/transaction contracts. No runtime implementation. */
import type { Actor, OperationId, RequestKey } from "@oma/contracts/identity";
import type { Receipt } from "@oma/contracts/durable";

import type { OperationLookup, SynchronousResult } from "@oma/contracts/durable";

/** Recovery consumers retain the richer validated storage snapshot, not this projection. */
export interface OperationRowsPort {
  getOperation(actor: Actor, key: RequestKey): OperationLookup | null;
  getOperationById(id: OperationId): OperationLookup | null;
  recoverableOperations(): readonly OperationId[];
}
export interface StorePort extends OperationRowsPort {
  /** No typed write API here; runtime capability enforcement remains with Store. */
  transaction<T>(fn: () => SynchronousResult<T>): T;
  close(): void;
}

/** R08 supplies the projection; Store row queries must not masquerade as this port. */
export interface OperationReceiptPort {
  getReceipt(actor: Actor, key: RequestKey): Receipt | null;
}
export type ReceiptProjector = (operation: OperationLookup) => Receipt;
