/** M-003 / IPC-006: structural receipt decoding, never ledger authority. */
import { decodeFailure, type Decoded } from "./failure-codec.js";
export { decodeFailure, type Decoded } from "./failure-codec.js";
import type { Json } from "@oma/contracts/identity";
import type { MutationMethod, OperationResult, Receipt } from "@oma/contracts/durable";
import { parseOperationId } from "@oma/domain/identifiers";
import { canonicalJson, snapshotJson } from "@oma/domain/canonical-json";
import { checkString, operationResultCheck } from "@oma/domain/validation";
import { isPublicMethod, PUBLIC_METHODS } from "./methods.js";
export { isErrorCode } from "@oma/domain/errors";

const invalid = (reason: string): Decoded<never> => ({ ok: false, reason });

export function isMutationMethod(value: unknown): value is MutationMethod {
  return isPublicMethod(value) && PUBLIC_METHODS[value].mode === "mutation";
}
function record(value: Json): value is { [key: string]: Json } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function snapshot(value: unknown): Decoded<Json> {
  try { return { ok: true, value: snapshotJson(value) }; }
  catch (error) { return invalid(error instanceof Error ? error.message : "invalid JSON value"); }
}


export function decodeOperationResultShape(value: unknown, expectedKind?: MutationMethod): Decoded<OperationResult> {
  const copied = snapshot(value);
  if (!copied.ok) return copied;
  const row = copied.value;
  if (!record(row) || !isMutationMethod(row.kind)) return invalid("invalid operation result kind");
  if (expectedKind !== undefined && row.kind !== expectedKind) return invalid("receipt result kind differs from request method");
  const error = operationResultCheck(row.kind)(row);
  if (error) return invalid(error);
  return { ok: true, value: row as OperationResult };
}

/** Whether an observation of a request may replace the one already recorded
 * for it.
 *
 * A recorded receipt is an observation of durable state, and durable state
 * does not become less settled: an operation that succeeded does not go back
 * to pending. Nothing enforced that, so two processes observing one request
 * key both read the same older value, both write, and the one whose write
 * lands last decides -- a recorded success regressing to `pending` offers the
 * Human a retry for work that already happened. Ordering the states is half of
 * the answer; the other half is that the caller must read and write under one
 * exclusive hold, because an order cannot be applied to a value that was
 * already stale when it was read.
 *
 * Two different terminal states for one operation are a contradiction, not an
 * update: one operation does not both succeed and fail.
 */
export type ReceiptOrder = "supersedes" | "stale" | "contradiction";

const TERMINAL: ReadonlySet<Receipt["state"]> = new Set(["succeeded", "failed"]);

export function receiptSupersession(previous: Receipt | null, observed: Receipt): ReceiptOrder {
  if (previous === null || !TERMINAL.has(previous.state)) return "supersedes";
  if (!TERMINAL.has(observed.state)) return "stale";
  return previous.state === observed.state ? "stale" : "contradiction";
}

/** Compare already validated observations of one original operation, not whether
 * a cache should replace its terminal entry. Reobserving the same terminal fact
 * is valid even though receiptSupersession deliberately calls it "stale".
 * Failure wording is diagnostic; its durable code and retry contract must agree.
 * A successful result is persisted data and cannot change.
 * This comparison itself proves neither acceptance nor authority. */
export function receiptFactConflict(previous: Receipt | null, observed: Receipt): boolean {
  if (previous === null) return false;
  if (previous.operation !== observed.operation) return true;
  if (!TERMINAL.has(previous.state)) return false;
  if (previous.state !== observed.state) return true;
  return previous.state === "succeeded"
    ? canonicalJson(previous.result) !== canonicalJson(observed.result)
    : previous.error?.code !== observed.error?.code || previous.error?.retry !== observed.error?.retry;
}

/** REQUEST_NOT_FOUND is a lookup result, not a durable operation or cached receipt. */
export function decodeReceipt(
  value: unknown,
  options: { expectedKind?: MutationMethod; allowNotFound?: boolean } = {},
): Decoded<Receipt> {
  const copied = snapshot(value);
  if (!copied.ok) return copied;
  const row = copied.value;
  if (!record(row) || Object.keys(row).some(key => !["operation", "state", "result", "error", "reason"].includes(key)))
    return invalid("receipt must be a closed object");
  if (row.state !== "pending" && row.state !== "succeeded" && row.state !== "failed" && row.state !== "unknown")
    return invalid("invalid receipt state");
  const operation = parseOperationId(row.operation);
  const notFound = options.allowNotFound === true && row.operation === "" && row.state === "failed";
  if (operation === null && !notFound) return invalid("invalid receipt operation id");
  const receipt: Receipt = { operation: operation ?? "", state: row.state };
  if (Object.hasOwn(row, "reason")) {
    if (typeof row.reason !== "string" || checkString()(row.reason)) return invalid("invalid receipt reason");
    receipt.reason = row.reason;
  }
  if (row.state === "succeeded") {
    if (Object.hasOwn(row, "error")) return invalid("succeeded receipt cannot carry an error");
    const result = decodeOperationResultShape(row.result, options.expectedKind);
    if (!result.ok) return result;
    receipt.result = result.value;
  } else {
    if (Object.hasOwn(row, "result")) return invalid("non-success receipt cannot carry a result");
    if (row.state === "failed") {
      const error = decodeFailure(row.error);
      if (!error.ok) return error;
      if (notFound && error.value.code !== "REQUEST_NOT_FOUND") return invalid("empty operation is reserved for REQUEST_NOT_FOUND");
      receipt.error = error.value;
    } else if (Object.hasOwn(row, "error")) return invalid("pending/unknown receipt cannot carry an error");
  }
  return { ok: true, value: receipt };
}
