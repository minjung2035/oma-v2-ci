// MUST [IPC-005]: canonical request hash.
// Method + normalized params (+ stream descriptor) as key-sorted canonical UTF-8
// JSON, SHA-256. `to`/`prerequisite`/path sets are deduped and lexically sorted;
// other array order is preserved when meaningful. Body bytes and subject are NOT
// trimmed. Request key, transport id, timestamp, and actor-supplied claims are
// never hash inputs.
import { createHash } from "node:crypto";
import type { Json } from "../implementation/contracts.js";

function sortKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Dedupe + lexical sort (string sets). */
export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(sortKey);
}

function canonicalize(v: Json, out: string[]): void {
  if (v === null) {
    out.push("null");
    return;
  }
  if (typeof v === "boolean") {
    out.push(v ? "true" : "false");
    return;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v))
      throw new Error("cannot canonicalize non-finite number");
    out.push(String(v));
    return;
  }
  if (typeof v === "string") {
    out.push(JSON.stringify(v));
    return;
  }
  if (Array.isArray(v)) {
    out.push("[");
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out.push(",");
      canonicalize(v[i] as Json, out);
    }
    out.push("]");
    return;
  }
  const record = v as Record<string, Json>;
  const keys = Object.keys(record).sort(sortKey);
  out.push("{");
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) out.push(",");
    out.push(JSON.stringify(keys[i]!), ":");
    const value = record[keys[i]!];
    if (value === undefined)
      throw new Error("never: key came from Object.keys");
    canonicalize(value, out);
  }
  out.push("}");
}

/** Canonical JSON string for an arbitrary JSON value. */
export function canonicalJson(v: Json): string {
  const out: string[] = [];
  canonicalize(v, out);
  return out.join("");
}

export function sha256Hex(utf8: string): string {
  return createHash("sha256").update(utf8, "utf8").digest("hex");
}

/**
 * MUST [IPC-005]: request hash = SHA-256 over canonical JSON of
 * { method, params(canonicalized), ...(stream descriptor when present) }.
 * The caller must already have normalised sets via sortedUnique(); the stream
 * descriptor is folded in as a separate canonical field when bytes are sent.
 */
export function requestHash(
  method: string,
  params: Json,
  stream?: { bytes: number; sha256: string },
): string {
  const value: Json = stream ? { method, params, stream } : { method, params };
  return sha256Hex(canonicalJson(value));
}
