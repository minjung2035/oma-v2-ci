/** Structural caller DTO decoding for frozen cache/ledger bytes. Host admission
 * and live actor authority remain separate, stricter checks in the broker.
 */
import type { MutationMethod } from "../../implementation/contracts/durable.js";
import type { ProtocolLimits } from "../../implementation/contracts/host.js";
import type { PublicMethods } from "../../implementation/contracts/public-wire.js";
import { snapshotJson } from "../domain/canonical-json.js";
import { decodePublicParams } from "./methods.js";

const structuralLimits: ProtocolLimits = Object.freeze({
  frameBytes: Number.MAX_SAFE_INTEGER, mailBodyBytes: Number.MAX_SAFE_INTEGER,
  subjectBytes: Number.MAX_SAFE_INTEGER, addresses: Number.MAX_SAFE_INTEGER,
  replyReferences: Number.MAX_SAFE_INTEGER, contextFiles: Number.MAX_SAFE_INTEGER,
  contextBytes: Number.MAX_SAFE_INTEGER, bundleBytes: Number.MAX_SAFE_INTEGER,
  logBytes: Number.MAX_SAFE_INTEGER, batchMaxMessages: Number.MAX_SAFE_INTEGER,
  idleStreamSeconds: Number.MAX_SAFE_INTEGER, receiptWaitSeconds: Number.MAX_SAFE_INTEGER,
});

/** Throws TypeError for a value that is not this method's caller DTO, and
 * (through snapshotJson) StoreError INVALID_REQUEST for one nested past
 * JSON_NESTING_LIMIT -- never a stack overflow (P0V-119, G09-02). */
export function decodeMutationPayload<K extends MutationMethod>(method: K, value: unknown): PublicMethods[K]["params"] {
  const copied = snapshotJson(value);
  if (copied === null || typeof copied !== "object" || Array.isArray(copied))
    throw new TypeError("mutation payload must be a JSON object");
  const decoded = decodePublicParams(method, copied, { limits: structuralLimits });
  if (decoded === null) throw new TypeError(`invalid caller DTO for ${method}`);
  return decoded;
}
