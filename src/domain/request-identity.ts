/** IPC-005/006/008: one identity definition for fresh hashes and replay comparisons.
 * Domain decoders still validate complete requests. Partial CLI projections are
 * deliberately not passed to those complete-request decoders.
 */
import type { Json } from "../../implementation/contracts/identity.js";
import { canonicalJson, sha256Hex, snapshotJson, sortedUnique } from "./canonical-json.js";

const SET_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "mail.send": ["to"],
  "git.submit": ["prerequisites", "to", "paths"],
});

export interface ExistingStreamIdentity {
  bytes: number;
  sha256: string;
}
export interface RequestIdentity {
  readonly canonicalParams: Json;
  readonly canonicalBytes: Uint8Array;
  readonly hash: string;
}

/** JSON validation is structural; no coercion, defaults, body edits, or Unicode normalization. */
export function canonicalRequestParams(method: string, params: unknown): Json {
  if (typeof method !== "string") throw new TypeError("request method must be a string");
  const copied = snapshotJson(params);
  const fields = Object.hasOwn(SET_FIELDS, method) ? SET_FIELDS[method] : undefined;
  if (!fields || copied === null || typeof copied !== "object" || Array.isArray(copied)) return copied;
  for (const field of fields) {
    if (!Object.hasOwn(copied, field)) continue;
    const value = copied[field];
    if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string"))
      throw new TypeError(`${method}.${field} must be a string set`);
    copied[field] = sortedUnique(value);
  }
  return copied;
}

/**
 * The existing production mutations have NO separate stream field: bundle and
 * content descriptors already live in params. The third argument preserves the
 * old explicit requestHash stream domain only; it is never inferred or added.
 * Actor/key/version/resolved authority are intentionally absent from the hash.
 */
export function buildRequestIdentity(
  method: string,
  validatedParams: unknown,
  existingStreamIdentity?: ExistingStreamIdentity,
): RequestIdentity {
  const canonicalParams = canonicalRequestParams(method, validatedParams);
  const value: Json = existingStreamIdentity === undefined
    ? { method, params: canonicalParams }
    : { method, params: canonicalParams, stream: snapshotJson(existingStreamIdentity) };
  const canonicalBytes = Buffer.from(canonicalJson(value), "utf8");
  return { canonicalParams, canonicalBytes, hash: sha256Hex(canonicalBytes) };
}

/** No hashing collision can make unequal request bytes compare equal. */
export function requestParamsEqual(method: string, left: unknown, right: unknown): boolean {
  return Buffer.from(buildRequestIdentity(method, left).canonicalBytes)
    .equals(Buffer.from(buildRequestIdentity(method, right).canonicalBytes));
}

function objectProjection(value: unknown): { [key: string]: Json } {
  const copied = snapshotJson(value);
  if (copied === null || typeof copied !== "object" || Array.isArray(copied))
    throw new TypeError("request projection must be a JSON object");
  return copied;
}

/**
 * Compare only explicit CLI fields, using the same field semantics as hashing.
 * Missing is not null. Ordered arrays stay ordered; frozen input is never edited.
 */
export function firstRequestProjectionMismatch(
  method: string, explicit: unknown, frozen: unknown,
): string | null {
  const wanted = objectProjection(explicit);
  const accepted = objectProjection(frozen);
  for (const key of Object.keys(wanted)) {
    if (!Object.hasOwn(accepted, key)) return key;
    if (!requestParamsEqual(method, { [key]: wanted[key]! }, { [key]: accepted[key]! })) return key;
  }
  return null;
}
