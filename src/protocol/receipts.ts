/** DB-005/009, IPC-008: one receipt projection, with no durable writes. */
import type { Receipt } from "../../implementation/contracts/durable.js";
import { StoreError, terminalFailure, type CliExitCode } from "../domain/errors.js";
import type { DecodedOperation } from "../storage/operation-codec.js";
import { decodeReceipt } from "./receipt-codec.js";

/** A receipt is a projection of the Store's relationally decoded snapshot.
 * Original JSON strings remain on that snapshot for audit; they are not parsed
 * a second time, normalized, repaired, or used as an alternate source of facts.
 */
export type ReceiptOperation = DecodedOperation;

export function receiptOfOperation(operation: ReceiptOperation): Receipt {
  const raw: Record<string, unknown> = { operation: operation.id, state: operation.state };
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
  if (!decoded.ok) throw new StoreError("STORE_CORRUPT", `invalid durable receipt: ${decoded.reason}`);
  return decoded.value;
}

/** An absent lookup is not a durable operation or a cacheable receipt. */
export const receiptNotFound: Receipt = Object.freeze({
  operation: "", state: "failed",
  error: Object.freeze({ code: "REQUEST_NOT_FOUND", message: "no such request", retry: "same-key" }),
});

export function isRequestNotFound(receipt: Receipt): boolean {
  return receipt.operation === "" && receipt.state === "failed" && receipt.error?.code === "REQUEST_NOT_FOUND";
}

export function receiptExit(receipt: Receipt): CliExitCode {
  if (receipt.state === "succeeded" || receipt.state === "pending") return 0;
  if (receipt.state === "unknown") return 3;
  return receipt.error?.code === "UNSUPPORTED_PROFILE" || receipt.error?.code === "SPIKE_UNRESOLVED" ? 4 : 2;
}

export function receiptLines(receipt: Receipt, key: string): readonly string[] {
  switch (receipt.state) {
    case "succeeded": return [JSON.stringify(receipt)];
    case "pending": return ["접수됨 / 아직 완료되지 않음", `재조회: 동일 command에 --request ${key}`];
    case "unknown": return [
      `결과 불명확: ${receipt.reason ?? "authoritative evidence required"}`,
      `재조회: 동일 command에 --request ${key}; 새 key로 재실행하지 마세요`,
    ];
    case "failed": return [`실패: ${receipt.error?.code ?? "?"} ${receipt.error?.message ?? ""}`];
  }
}
