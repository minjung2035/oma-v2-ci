/** M-003 / IPC-006: structural receipt decoding, never ledger authority. */
import type { Failure, Json, MutationMethod, OperationResult, Receipt } from "../../implementation/contracts.js";
import { parseOperationId } from "../domain/identifiers.js";
import { snapshotJson } from "../domain/canonical-json.js";
import { isErrorCode } from "../domain/errors.js";
import { checkString, operationResultCheck } from "../validate.js";
import { isPublicMethod, PUBLIC_METHODS } from "./methods.js";
export { isErrorCode } from "../domain/errors.js";

export type Decoded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };
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

export function decodeFailure(value: unknown): Decoded<Failure> {
  const copied = snapshot(value);
  if (!copied.ok) return copied;
  const row = copied.value;
  if (!record(row) || Object.keys(row).some(key => !["code", "message", "retry", "details"].includes(key)))
    return invalid("failure must be a closed object");
  if (!isErrorCode(row.code) || typeof row.message !== "string" || checkString()(row.message))
    return invalid("invalid failure code/message");
  if (row.retry !== "never" && row.retry !== "same-key" && row.retry !== "after-repair")
    return invalid("invalid failure retry policy");
  const failure: Failure = { code: row.code, message: row.message, retry: row.retry };
  if (Object.hasOwn(row, "details")) failure.details = row.details!;
  return { ok: true, value: failure };
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
