/** Closed failure value codec. Independent of method metadata and receipts. */
import type { Failure } from "@oma/contracts/errors";
import type { Json } from "@oma/contracts/identity";
import { snapshotJson } from "@oma/domain/canonical-json";
import { isErrorCode } from "@oma/domain/errors";
import { checkString } from "@oma/domain/validation";
export type Decoded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };
const invalid = (reason: string): Decoded<never> => ({ ok: false, reason });
export function decodeFailure(value: unknown): Decoded<Failure> {
  let row: Json;
  try { row = snapshotJson(value); }
  catch (error) { return invalid(error instanceof Error ? error.message : "invalid JSON value"); }
  if (row === null || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(key => !["code", "message", "retry", "details"].includes(key)))
    return invalid("failure must be a closed object");
  if (!isErrorCode(row.code) || typeof row.message !== "string" || checkString()(row.message)) return invalid("invalid failure code/message");
  if (row.retry !== "never" && row.retry !== "same-key" && row.retry !== "after-repair") return invalid("invalid failure retry policy");
  const failure: Failure = { code: row.code, message: row.message, retry: row.retry };
  if (Object.hasOwn(row, "details")) failure.details = row.details!;
  return { ok: true, value: failure };
}
