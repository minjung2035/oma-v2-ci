import type { Receipt } from "../../implementation/contracts.js";
import { errorExit, type CliExitCode } from "../domain/errors.js";
import { decodeFailure } from "../protocol/receipt-codec.js";
import { receiptExit, receiptLines } from "../protocol/receipts.js";

export function fail(message: string, code: CliExitCode): never {
  console.error(`oma: ${message}`);
  process.exit(code);
}

export function usage(): never {
  console.error([
    "usage:",
    "  oma send <address...> --subject S --file P [--kind K] [--reply P] [--request K]",
    "  approval_required: send principal --kind approval_required --candidate C --expect B --policy-revision R --subject S --file P",
    "  kinds: message/question/result/alert/context/approval_required/critical (mail is not approval authority)",
    "  oma ack <mail-path-or-id> [--request K]",
    "  oma follow <topic> [--request K] | oma unfollow <topic> [--request K]",
    "  oma agent create <name> --from <revision> --file <brief> [--request K]",
    "  oma agent start <name> [--request K] | oma agent stop <name> [--request K]",
    "  oma agent continue --note <text> [--request K]",
    "  oma agent wait",
    "  oma submit <revision> [--to <address> ...] [--subject S] [--file summary] [--path repo-path ...] [--request K]",
    "  oma integrate <published-full-oid> --expect <full-oid> [--request K]",
    "  oma context publish <dir> --expect <oid-or-none> [--request K]",
    "  oma status [agent]",
    "  oma logs <agent> --since <duration>",
    "  each option once (--to/--path may repeat); an option's value is the next argument as written;",
    "  arguments after -- are never options",
  ].join("\n"));
  process.exit(2);
}

/** `key` is the request the failure answers, when there is one. ERR-001: the
 * caller branches on retry, and "same-key" says this request may stand
 * accepted -- asked again under a new key it would be a second request. */
export function finishFailure(reply: { error?: unknown } | undefined, prefix = "", key?: string): never {
  const decoded = decodeFailure(reply?.error);
  if (!decoded.ok) fail(`${prefix}invalid broker failure: ${decoded.reason}${key === undefined ? "" : `; --request ${key}`}`, 3);
  const again = key !== undefined && decoded.value.retry === "same-key"
    ? ` (재조회: 동일 command에 --request ${key}; 새 key로 재실행하지 마세요)` : "";
  // AV28: a conflict names what it found, so the caller builds on the actual value.
  const details = decoded.value.details;
  const found = details !== null && typeof details === "object" && !Array.isArray(details) && "actual" in details
    ? ` (actual: ${details.actual === null ? "none" : String(details.actual)})` : "";
  fail(`${prefix}${decoded.value.code}: ${decoded.value.message}${found}${again}`, errorExit(decoded.value.code));
}

export function finishReceipt(receipt: Receipt, key: string): never {
  for (const line of receiptLines(receipt, key)) console.log(line);
  process.exit(receiptExit(receipt));
}

/** WP26: a receipt the request cache could not record. The receipt and the
 * key to ask again come first; an observation contradicting the cache's
 * earlier one is unknown (3), otherwise the receipt's own exit stands. */
export function finishUnrecordedReceipt(receipt: Receipt, key: string, reason: string, contradicted: boolean): never {
  for (const line of receiptLines(receipt, key)) console.log(line);
  console.error(`oma: ${reason} (재조회: 동일 command에 --request ${key}; 새 key로 재실행하지 마세요)`);
  process.exit(contradicted ? 3 : receiptExit(receipt));
}

export function succeed(): never {
  process.exit(0);
}

export function fatal(error: unknown): never {
  console.error(`oma: ${(error as Error).message}`);
  process.exit(3);
}
