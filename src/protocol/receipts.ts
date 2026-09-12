/** DB-005/009, IPC-008: one receipt projection, with no durable writes. */
import type { ErrorCode, MutationMethod, OperationId, Receipt } from "../../implementation/contracts.js";
import { StoreError, terminalFailure, isErrorCode, isPreacceptOnlyFailure, type CliExitCode } from "../domain/errors.js";
import { decodeReceipt } from "./receipt-codec.js";

/** Store validates plan/result relations before exposing this projection. This
 * builder rechecks the receipt shape and never repairs or rewrites legacy rows.
 */
export interface ReceiptOperation {
  readonly id: OperationId;
  readonly kind: MutationMethod;
  readonly state: Receipt["state"];
  readonly resultJson: string | null;
  readonly errorCode: ErrorCode | null;
}

export function receiptOfOperation(operation: ReceiptOperation): Receipt {
  const raw: Record<string, unknown> = { operation: operation.id, state: operation.state };
  if (operation.state === "succeeded") {
    if (operation.resultJson === null || operation.errorCode !== null)
      throw new StoreError("STORE_CORRUPT", "inconsistent succeeded operation");
    try { raw.result = JSON.parse(operation.resultJson); }
    catch { throw new StoreError("STORE_CORRUPT", "invalid operation result JSON"); }
  } else {
    if (operation.resultJson !== null)
      throw new StoreError("STORE_CORRUPT", "non-success operation has a result");
    if (operation.state === "failed") {
      if (!isErrorCode(operation.errorCode)) throw new StoreError("STORE_CORRUPT", "failed operation has no valid error code");
      if (isPreacceptOnlyFailure(operation.errorCode))
        throw new StoreError("STORE_CORRUPT", "accepted operation has a preaccept-only failure");
      raw.error = terminalFailure(operation.errorCode);
    } else if (operation.errorCode !== null) {
      throw new StoreError("STORE_CORRUPT", "non-failed operation has an error code");
    }
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
