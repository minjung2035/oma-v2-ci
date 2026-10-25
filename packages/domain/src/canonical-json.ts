/** IPC-005: canonical JSON primitives. No request policy, defaults, or I/O. */
import { createHash } from "node:crypto";
import type { Json } from "@oma/contracts/identity";
import { StoreError } from "./errors.js";

/** P0V-119 (G08-01, G09-01, G09-02), P0-6: how deeply JSON data may nest,
 * one named bound for every JSON value OMA reads or hashes -- a frame, a
 * configuration, a receipt, a cached request, a payload. No OMA document
 * comes near it; a value past it is refused as the request it is
 * (INVALID_REQUEST), before a recursive walk could run out of stack and fail
 * as something else. */
export const JSON_NESTING_LIMIT = 64;
function tooDeep(): never {
  throw new StoreError("INVALID_REQUEST", `JSON nesting exceeds ${JSON_NESTING_LIMIT}`);
}

function sortKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(sortKey);
}

/** Copy only actual JSON data. A cast, accessor, or custom toJSON is not validation.
 * Throws TypeError for what is not JSON data, and StoreError INVALID_REQUEST
 * for JSON nested past JSON_NESTING_LIMIT. */
export function snapshotJson(value: unknown): Json {
  const ancestors = new Set<object>();
  const visit = (input: unknown): Json => {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new TypeError("cannot canonicalize non-finite number");
      return input;
    }
    if (typeof input !== "object") throw new TypeError("expected a JSON value");
    if (ancestors.has(input)) throw new TypeError("cyclic JSON value");
    if (Object.getOwnPropertySymbols(input).length) throw new TypeError("symbol keys are not JSON data");
    if (ancestors.size >= JSON_NESTING_LIMIT) tooDeep();
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        const result: Json[] = [];
        for (let index = 0; index < input.length; index++) {
          const field = Object.getOwnPropertyDescriptor(input, String(index));
          if (!field || !("value" in field)) throw new TypeError("sparse/accessor arrays are not JSON data");
          result.push(visit(field.value));
        }
        return result;
      }
      const prototype: unknown = Object.getPrototypeOf(input);
      if (prototype !== null && prototype !== Object.prototype)
        throw new TypeError("expected a plain JSON object");
      const result: { [key: string]: Json } = {};
      for (const key of Object.keys(input)) {
        const field = Object.getOwnPropertyDescriptor(input, key);
        if (!field || !("value" in field)) throw new TypeError("accessors are not JSON data");
        // defineProperty preserves a literal __proto__ key without setting a prototype.
        Object.defineProperty(result, key, {
          value: visit(field.value), enumerable: true, writable: true, configurable: true,
        });
      }
      return result;
    } finally {
      ancestors.delete(input);
    }
  };
  return visit(value);
}

function appendCanonical(value: Json, output: string[]): void {
  if (value === null) { output.push("null"); return; }
  if (typeof value === "boolean") { output.push(value ? "true" : "false"); return; }
  // G08-03: a number is spelled by ECMA-262 Number::toString -- a specified
  // algorithm (the shortest round-trip spelling), the one JSON.stringify uses,
  // -0 as "0" -- not by an engine's choice. Golden vectors in p0-review7 hold
  // the spelling, so an engine that departed from it would be noticed.
  if (typeof value === "number") { output.push(String(value)); return; }
  if (typeof value === "string") { output.push(JSON.stringify(value)); return; }
  if (Array.isArray(value)) {
    output.push("[");
    for (let index = 0; index < value.length; index++) {
      if (index > 0) output.push(",");
      appendCanonical(value[index]!, output);
    }
    output.push("]");
    return;
  }
  const keys = Object.keys(value).sort(sortKey);
  output.push("{");
  for (let index = 0; index < keys.length; index++) {
    if (index > 0) output.push(",");
    const key = keys[index]!;
    output.push(JSON.stringify(key), ":");
    appendCanonical(value[key]!, output);
  }
  output.push("}");
}

/** Preserves the established key order, number spelling, and string escaping. */
export function canonicalJson(value: unknown): string {
  const output: string[] = [];
  appendCanonical(snapshotJson(value), output);
  return output.join("");
}

export function sha256Hex(bytes: string | Uint8Array): string {
  const hash = createHash("sha256");
  if (typeof bytes === "string") hash.update(bytes, "utf8");
  else hash.update(bytes);
  return hash.digest("hex");
}
