/** Structural caller DTO decoding for frozen cache/ledger bytes. Host admission
 * and live actor authority remain separate, stricter checks in the broker.
 */
import type { MutationMethod } from "@oma/contracts/durable";
import type { PublicMethods } from "@oma/contracts/public-wire";
import { snapshotJson } from "@oma/domain/canonical-json";
import { decodePublicParams, UNBOUNDED_PUBLIC_LIMITS } from "./methods.js";

/** Throws TypeError for a value that is not this method's caller DTO, and
 * (through snapshotJson) StoreError INVALID_REQUEST for one nested past
 * JSON_NESTING_LIMIT -- never a stack overflow (P0V-119, G09-02). */
export function decodeMutationPayload<K extends MutationMethod>(method: K, value: unknown): PublicMethods[K]["params"] {
  const copied = snapshotJson(value);
  if (copied === null || typeof copied !== "object" || Array.isArray(copied))
    throw new TypeError("mutation payload must be a JSON object");
  const decoded = decodePublicParams(method, copied, { limits: UNBOUNDED_PUBLIC_LIMITS });
  if (decoded === null) throw new TypeError(`invalid caller DTO for ${method}`);
  return decoded;
}
