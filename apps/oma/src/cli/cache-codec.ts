/** IPC-006/008: cache shape validation, not broker authority or host admission. */
import type { Json, MutationMethod, Receipt, RequestKey } from "@oma/contracts";
import { isValidRequestKey } from "@oma/domain/identifiers";
import { snapshotJson } from "@oma/domain/canonical-json";
import { PUBLIC_METHODS } from "@oma/protocol/methods";
import { decodeMutationPayload } from "@oma/protocol/request-codec";
import { decodeReceipt, isMutationMethod, type Decoded } from "@oma/protocol/receipt-codec";

export interface StreamDigest { bytes: number; sha256: string }
export interface CachedRequest {
  key: RequestKey;
  method: MutationMethod;
  /** Original frozen payload order/bytes; normalization is for comparison only. */
  params: Json;
  digest?: StreamDigest;
  createdAtMs: number;
  lastReceipt: Receipt | null;
}
const invalid = (reason: string): Decoded<never> => ({ ok: false, reason });
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function decodeStreamDigest(value: unknown): Decoded<StreamDigest> {
  if (!record(value) || Object.keys(value).some(key => key !== "bytes" && key !== "sha256") ||
    typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes < 0 ||
    typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)) return invalid("invalid stream digest");
  return { ok: true, value: { bytes: value.bytes, sha256: value.sha256 } };
}
export function decodeCachedRequest(value: unknown, expectedKey: RequestKey): Decoded<CachedRequest> {
  let row: Json;
  try { row = snapshotJson(value); }
  catch (error) { return invalid(error instanceof Error ? error.message : "invalid cache JSON"); }
  if (!record(row) || Object.keys(row).some(key => !["key", "method", "params", "digest", "createdAtMs", "lastReceipt"].includes(key)))
    return invalid("cache must be a closed object");
  if (!isValidRequestKey(row.key) || row.key !== expectedKey) return invalid("cache key differs from file key");
  if (!isMutationMethod(row.method)) return invalid("cache method is not a mutation");
  if (!record(row.params)) return invalid("cached params must be an object");
  try { decodeMutationPayload(row.method, row.params); }
  catch { return invalid(`invalid cached caller DTO for ${row.method}`); }
  if (typeof row.createdAtMs !== "number" || !Number.isSafeInteger(row.createdAtMs) || row.createdAtMs < 0)
    return invalid("invalid cache timestamp");
  let lastReceipt: Receipt | null = null;
  if (row.lastReceipt !== null) {
    const decoded = decodeReceipt(row.lastReceipt, { expectedKind: row.method });
    if (!decoded.ok) return invalid(`invalid cached receipt: ${decoded.reason}`);
    lastReceipt = decoded.value;
  }
  const streamPolicy = PUBLIC_METHODS[row.method].stream;
  const descriptor = streamPolicy === "optional-bundle" ? row.params.bundle :
    streamPolicy === "required-content" ? row.params.content : undefined;
  let digest: StreamDigest | undefined;
  if (descriptor === undefined) {
    if (Object.hasOwn(row, "digest")) return invalid("digest exists for a request without a stream descriptor");
  } else {
    const decoded = decodeStreamDigest(row.digest);
    if (!decoded.ok || !record(descriptor)) return invalid("stream descriptor requires a valid frozen digest");
    if (decoded.value.bytes !== descriptor.bytes || decoded.value.sha256 !== descriptor.sha256)
      return invalid("frozen digest differs from the caller descriptor");
    const mediaType = streamPolicy === "optional-bundle" ? "application/x-git-bundle" : "application/vnd.oma.context-v1";
    if (descriptor.mediaType !== mediaType) return invalid("stream media type differs from the method policy");
    digest = decoded.value;
  }
  const params = snapshotJson(row.params);
  const entry: CachedRequest = { key: row.key, method: row.method, params, createdAtMs: row.createdAtMs, lastReceipt };
  if (digest !== undefined) entry.digest = digest;
  // Preserve metadata key order and frozen nested payload order.
  return { ok: true, value: Object.assign(row, entry) };
}
