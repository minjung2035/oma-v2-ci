/** DB-005/009, IPC-008: ledger-to-wire projection, with no durable writes. */
import type { Receipt } from "@oma/contracts/durable";
import { StoreError, terminalFailure } from "@oma/domain/errors";
import type { OperationLookup } from "@oma/contracts/durable";
import { decodeReceipt } from "./receipt-codec.js";

/** A receipt is a projection of the Store's relationally decoded snapshot.
 * Original JSON strings remain on that snapshot for audit; they are not parsed
 * a second time, normalized, repaired, or used as an alternate source of facts.
 */

export function receiptOfOperation(operation: OperationLookup): Receipt {
  const raw: Record<string, unknown> = {
    operation: operation.id,
    state: operation.state,
  };
  switch (operation.state) {
    case "succeeded":
      raw.result = operation.result;
      break;
    case "failed":
      raw.error = terminalFailure(operation.errorCode);
      break;
    case "pending":
    case "unknown":
      break;
  }
  const decoded = decodeReceipt(raw, { expectedKind: operation.kind });
  if (!decoded.ok)
    throw new StoreError(
      "STORE_CORRUPT",
      `invalid durable receipt: ${decoded.reason}`,
    );
  return decoded.value;
}
