/** IPC-008: wire receipt presentation; ledger projection belongs to storage. */
import type { Receipt } from "@oma/contracts/durable";
import type { CliExitCode } from "@oma/domain/errors";

/** An absent lookup is not a durable operation or a cacheable receipt. */
export const receiptNotFound: Receipt = Object.freeze({
  operation: "", state: "failed",
  error: Object.freeze({ code: "REQUEST_NOT_FOUND", message: "no such request", retry: "same-key" }),
});

export function isRequestNotFound(receipt: Receipt): boolean {
  return receipt.operation === "" && receipt.state === "failed" && receipt.error?.code === "REQUEST_NOT_FOUND";
}

function failedReceiptError(receipt: Receipt): NonNullable<Receipt["error"]> {
  if (receipt.error === undefined) throw new TypeError("failed receipt has no failure");
  return receipt.error;
}

export function receiptExit(receipt: Receipt): CliExitCode {
  if (receipt.state === "succeeded" || receipt.state === "pending") return 0;
  if (receipt.state === "unknown") return 3;
  const error = failedReceiptError(receipt);
  return error.code === "UNSUPPORTED_PROFILE" || error.code === "SPIKE_UNRESOLVED" ? 4 : 2;
}

