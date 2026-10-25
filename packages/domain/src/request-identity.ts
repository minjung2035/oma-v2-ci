/** IPC-005/006/008: one identity definition for fresh hashes and replay comparisons.
 * Domain decoders still validate complete requests. Partial CLI projections are
 * deliberately not passed to those complete-request decoders.
 */
import { StoreError } from "./errors.js";
import type { Actor, RequestKey } from "@oma/contracts/identity";
import type { Json } from "@oma/contracts/identity";
import type { MutationMethod } from "@oma/contracts/durable";
import type { PublicMethods } from "@oma/contracts/public-wire";
import { canonicalJson, sha256Hex, snapshotJson, sortedUnique } from "./canonical-json.js";

/** WP29: which params of a method are sets. The keys must be mutation methods
 * and the fields must be array params of that method, checked at compile time;
 * the values are the v1 request-hash recipe and do not change. */
type SetFields = { readonly [M in MutationMethod]?: readonly Extract<{
  [F in keyof PublicMethods[M]["params"]]: PublicMethods[M]["params"][F] extends readonly unknown[] | undefined ? F : never
}[keyof PublicMethods[M]["params"]], string>[] };
const SET_FIELD_RECIPE = {
  "mail.send": ["to"],
  "git.submit": ["prerequisites", "to", "paths"],
} as const satisfies SetFields;
const SET_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze(SET_FIELD_RECIPE);

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

/** Bundle/content descriptors are already in current mutation params.
 * Actor/key/version/resolved authority are intentionally absent from the hash. */
export function buildRequestIdentity(method: string, validatedParams: unknown): RequestIdentity {
  if (arguments.length > 2) throw new TypeError("separate stream request identity is unsupported; put the descriptor in params");
  const canonicalParams = canonicalRequestParams(method, validatedParams);
  const value: Json = { method, params: canonicalParams };
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

export function reused(actor: Actor, key: RequestKey): StoreError {
  return new StoreError("REQUEST_KEY_REUSED", `request key ${key} (actor ${actor}) already used with a different payload`);
}

/** IPC-005: the current mutation hash; accepted rows retain their stored hash. */
export function requestHash(method: string, params: unknown): string {
  if (arguments.length > 2) throw new TypeError("separate stream request identity is unsupported; put the descriptor in params");
  return buildRequestIdentity(method, params).hash;
}
