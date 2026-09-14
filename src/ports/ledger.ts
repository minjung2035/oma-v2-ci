/** Internal ledger query/transaction contracts. No runtime implementation. */
import type { Actor, OperationId, RequestKey } from "../../implementation/contracts/identity.js";
import type { Receipt } from "../../implementation/contracts/durable.js";
import type { DecodedOperation as OperationRow } from "../storage/operation-codec.js";
import type { Transaction } from "../storage/transaction.js";

/** These queries preserve recovery payload/plan/hash/identity evidence. */
export interface OperationRowsPort {
  getOperation(actor: Actor, key: RequestKey): OperationRow | null;
  getOperationById(id: OperationId): OperationRow | null;
  recoverableOperations(): readonly OperationId[];
}
export interface StorePort extends OperationRowsPort {
  transaction<T>(fn: (tx: Transaction) => T): T;
  close(): void;
}

/** R08 supplies the projection; Store row queries must not masquerade as this port. */
export interface OperationReceiptPort {
  getReceipt(actor: Actor, key: RequestKey): Receipt | null;
}
export type ReceiptProjector = (operation: OperationRow) => Receipt;
