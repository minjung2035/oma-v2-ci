import { ClientError } from "@oma/client/errors";
import { inCallerView } from "@oma/client/receipts";
export { inCallerView };
import type { Receipt } from "@oma/contracts";
import { errorExit, failureMessage, failureText, normalizeStorageFailure, publicFailure, StoreError, type CliExitCode } from "@oma/domain/errors";
import { decodeFailure, decodeReceipt } from "@oma/protocol/receipt-codec";
import { receiptExit, receiptLines } from "@oma/protocol/receipts";

/** P0V-62, P0-4: this module ends the process, so it also owns that nothing
 * written before the end is lost to it. A write to a pipe or socket completes
 * asynchronously in Node and `process.exit` does not wait for it: a status or
 * a log longer than the reader had taken so far was cut off, with exit 0.
 * Called once, before anything is written, it makes every later write to
 * stdout and stderr complete before it returns -- so each exit below leaves
 * nothing behind. A file or a terminal is already written synchronously. */
export function holdOutputUntilWritten(): void {
  for (const stream of [process.stdout, process.stderr]) {
    const handle = (stream as unknown as { readonly _handle?: { setBlocking?: (blocking: boolean) => unknown } })._handle;
    handle?.setBlocking?.(true);
  }
}

export function fail(message: string, code: CliExitCode): never {
  console.error(`oma: ${message}`);
  process.exit(code);
}

/** A read-only structured view ends through the same output owner as receipts. */
export function finishRead(value: unknown): never {
  process.stdout.write(JSON.stringify(value) + "\n");
  process.exit(0);
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
    "  oma agent wait [--observe true]",
    "  Principal: oma society open|close [--request K]",
    "  oma submit <revision> [--to <address> ...] [--subject S] [--file summary] [--path repo-path ...] [--request K]",
    "  oma merge open --tier LOW|MEDIUM|HIGH --title T --file reason.md [--candidate rev] [--base rev] [--request K]",
    "  oma merge review|cancel <merge-name> --file body [--request K]",
    "  oma merge vote <merge-name> --verdict approve|reject --file body [--approval <message id>] [--request K]",
    "  oma merge status [<merge-name>] | oma merge diff <merge-name> [--path P] [--cursor N]",
    "  oma challenge open --merge <merge-name> --tier LOW|HIGH --title T --file reason.md [--candidate rev --base rev] [--request K]",
    "  oma challenge review|vote|cancel|status as merge; oma challenge diff <name> [--view revert|original] [--path P] [--cursor N]",
    "  oma context publish <dir> --expect <oid-or-none> [--request K]",
    "  oma status [agent] [--after agent] (continue with the returned next cursor)",
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
    ? ` (Query again: use --request ${key} with the same command; do not rerun with a new key)` : "";
  // DR3 (AV28): the code, its words and the facts its code may carry.
  fail(`${prefix}${failureText(decoded.value)}${again}`, errorExit(decoded.value.code, decoded.value.retry));
}

function checkedReceipt(receipt: Receipt, key: string): Receipt {
  const decoded = decodeReceipt(receipt, { allowNotFound: true });
  if (!decoded.ok) fail(`invalid receipt: ${decoded.reason}; --request ${key} with the same command`, 3);
  return decoded.value;
}

export function finishReceipt(receipt: Receipt, key: string): never {
  const checked = checkedReceipt(receipt, key);
  for (const line of receiptLines(inCallerView(checked), key)) console.log(line);
  process.exit(receiptExit(checked));
}

/** WP26: a receipt the request cache could not record. The receipt and the
 * key to ask again come first; an observation contradicting the cache's
 * earlier one is unknown (3), otherwise the receipt's own exit stands. */
export function finishUnrecordedReceipt(receipt: Receipt, key: string, reason: string, contradicted: boolean): never {
  const checked = checkedReceipt(receipt, key);
  for (const line of receiptLines(inCallerView(checked), key)) console.log(line);
  console.error(`oma: ${reason} (Query again: use --request ${key} with the same command; do not rerun with a new key)`);
  process.exit(contradicted ? 3 : receiptExit(checked));
}

export function succeed(): never {
  process.exit(0);
}

export function fatal(error: unknown): never {
  if (error instanceof ClientError) {
    console.error(`oma: ${error.message}`);
    process.exit(error.exitCode);
  }
  const normalized = normalizeStorageFailure(error);
  if (normalized instanceof StoreError) {
    const failure = publicFailure(normalized);
    fail(failureText({ ...failure, message: failureMessage(normalized) ?? failure.message }), errorExit(failure.code, failure.retry));
  }
  fail(error instanceof Error ? error.message : String(error), 3);
}
