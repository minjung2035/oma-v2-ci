import { basename, isAbsolute, join } from "node:path";
import type { Receipt } from "../../implementation/contracts.js";
import { errorExit, failureText, type CliExitCode } from "../domain/errors.js";
import { decodeFailure } from "../protocol/receipt-codec.js";
import { receiptExit, receiptLines } from "../protocol/receipts.js";

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
    "  oma integrate <published-full-oid> --expect <full-oid> [--tier LOW|MEDIUM|HIGH] [--request K]",
    "  oma approve|object <candidate> --base B --target main --policy-revision R --file evidence [--request K]",
    "  Principal: approve <candidate> ... --decision ACCEPT|REQUEST_REVISION|REJECT",
    "  oma revoke <own-attestation-op> --file evidence [--request K]",
    "  oma challenge <integration-op> --candidate C --base B --target main --policy-revision R --file evidence [--request K]",
    "  Principal: challenge <challenge-op> --valid true|false [--floor MEDIUM|HIGH --scope text] --file evidence",
    "  Principal: challenge <finding-op> --applies true|false --candidate C --base B --target main --policy-revision R --file evidence",
    "  oma context publish <dir> --expect <oid-or-none> [--request K]",
    "  oma code show|diff|log|ls-tree|grep [--revision main|oid] [--base main|oid] [--path P] [--pattern text]",
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

/** DR1, SB-002-C: a path this CLI's caller is shown is in the caller's view.
 * The broker records and answers with the host's archive path; the archive
 * root this CLI's environment names -- /mail/archive/cur inside a sandbox, the
 * host's for the Principal -- is where the caller finds the message. */
export function inCallerView(receipt: Receipt, root = process.env.OMA_MAIL_ARCHIVE): Receipt {
  const result = receipt.result as { archivePath?: unknown } | undefined;
  if (receipt.state !== "succeeded" || root === undefined || !isAbsolute(root) || typeof result?.archivePath !== "string") return receipt;
  const shown = { ...receipt.result, archivePath: join(root, basename(result.archivePath)) } as NonNullable<Receipt["result"]>;
  return { ...receipt, result: shown };
}

export function finishReceipt(receipt: Receipt, key: string): never {
  for (const line of receiptLines(inCallerView(receipt), key)) console.log(line);
  process.exit(receiptExit(receipt));
}

/** WP26: a receipt the request cache could not record. The receipt and the
 * key to ask again come first; an observation contradicting the cache's
 * earlier one is unknown (3), otherwise the receipt's own exit stands. */
export function finishUnrecordedReceipt(receipt: Receipt, key: string, reason: string, contradicted: boolean): never {
  for (const line of receiptLines(inCallerView(receipt), key)) console.log(line);
  console.error(`oma: ${reason} (Query again: use --request ${key} with the same command; do not rerun with a new key)`);
  process.exit(contradicted ? 3 : receiptExit(receipt));
}

export function succeed(): never {
  process.exit(0);
}

export function fatal(error: unknown): never {
  console.error(`oma: ${(error as Error).message}`);
  process.exit(3);
}
