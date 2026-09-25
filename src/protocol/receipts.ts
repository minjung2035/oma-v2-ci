/** IPC-008: wire receipt presentation; ledger projection belongs to storage. */
import type { Receipt } from "../../implementation/contracts/durable.js";
import { failureText, type CliExitCode } from "../domain/errors.js";

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
    case "failed": return [receipt.error === undefined ? "실패: ?" : `실패: ${failureText(receipt.error)}`];
  }
}
