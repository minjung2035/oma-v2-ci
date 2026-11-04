/** Read-only structural decoding for original frozen cache/ledger bytes.
 * Never use this owner for fresh wire/action admission or to execute retired work. */
import type { MutationMethod } from "@oma/contracts/durable";
import type { PublicMethods } from "@oma/contracts/public-wire";
import type { StoredAttestationInput } from "@oma/contracts/attestation";
import { snapshotJson } from "@oma/domain/canonical-json";
import { storedAttestationInputProblem } from "@oma/domain/attestation";
import { decodePublicParams, UNBOUNDED_PUBLIC_LIMITS } from "./methods.js";

export type StoredMutationPayload<K extends MutationMethod> = K extends "attest.record"
  ? StoredAttestationInput : PublicMethods[K]["params"];

/** Throws TypeError for invalid original DTO bytes, and (through snapshotJson)
 * INVALID_REQUEST for excessive JSON nesting. No defaults or byte repair. */
export function decodeMutationPayload<K extends MutationMethod>(method: K, value: unknown): StoredMutationPayload<K> {
  const copied = snapshotJson(value);
  if (copied === null || typeof copied !== "object" || Array.isArray(copied))
    throw new TypeError("mutation payload must be a JSON object");
  if (method === "attest.record") {
    if (storedAttestationInputProblem(copied, UNBOUNDED_PUBLIC_LIMITS) !== null)
      throw new TypeError("invalid stored caller DTO for attest.record");
    // The read-only stored grammar includes retired adoption and derived facts.
    // It does not assert that any of these original inputs may execute now.
    return copied as StoredMutationPayload<K>;
  }
  const decoded = decodePublicParams(method, copied, { limits: UNBOUNDED_PUBLIC_LIMITS });
  if (decoded === null) throw new TypeError(`invalid caller DTO for ${method}`);
  return decoded as StoredMutationPayload<K>;
}
