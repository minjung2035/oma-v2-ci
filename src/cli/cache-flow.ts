/** Client-side freeze/replay preparation. No transport, source-file rereads, or exit(). */
import type { Json, MutationMethod } from "../../implementation/contracts.js";
import { CacheError, type RequestCache, type CachedRequest, type FreezeInput, type StreamDigest } from "../request-cache.js";
import { snapshotJson } from "../domain/canonical-json.js";
import { requestParamsEqual } from "../domain/request-identity.js";

export function readFrozen(cache: RequestCache, key: string): CachedRequest | null {
  const observed = cache.read(key);
  switch (observed.kind) {
    case "absent": return null;
    case "present": return observed.value;
    case "corrupt": throw new CacheError("CACHE_CORRUPT", `key ${key}: ${observed.reason}; original freeze will not be reconstructed`);
    case "unavailable": throw new CacheError("CACHE_UNAVAILABLE", `key ${key}: ${observed.reason}; absence is not established`);
  }
}

export function requestPayload(value: unknown): { [key: string]: Json } {
  const copied = snapshotJson(value);
  if (copied === null || typeof copied !== "object" || Array.isArray(copied))
    throw new CacheError("INVALID_REQUEST", "request payload must be a JSON object");
  return copied;
}

export function verifiedFrozenBody(cache: RequestCache, frozen: CachedRequest): Uint8Array | undefined {
  if (!frozen.digest) return undefined;
  const body = cache.readBody(frozen.key, frozen.digest);
  if (body.kind === "present") return body.value;
  if (body.kind === "unavailable") throw new CacheError("CACHE_UNAVAILABLE", `frozen body ${frozen.key}: ${body.reason}`);
  throw new CacheError("CACHE_CORRUPT", `frozen body ${frozen.key}: ${body.kind === "absent" ? "missing" : body.reason}; no stream will be sent`);
}

export interface ReadyFrozenRequest {
  readonly request: CachedRequest;
  readonly replay: boolean;
  readonly body: Uint8Array | undefined;
}

export function prepareFrozenRequest(
  cache: RequestCache,
  method: MutationMethod,
  params: unknown,
  key: string,
  digest?: StreamDigest,
  body?: Uint8Array,
  expectedExisting?: CachedRequest,
): ReadyFrozenRequest {
  const cached = readFrozen(cache, key);
  if (expectedExisting !== undefined && cached === null)
    throw new CacheError("CACHE_CORRUPT", "frozen metadata disappeared during replay; no replacement will be created");
  const payload = requestPayload(params);
  if (cached) {
    const equalDigest = (cached.digest === undefined && digest === undefined) ||
      (cached.digest !== undefined && digest !== undefined && cached.digest.bytes === digest.bytes && cached.digest.sha256 === digest.sha256);
    if (cached.method !== method || !requestParamsEqual(method, cached.params, payload) || !equalDigest)
      throw new CacheError("REQUEST_KEY_REUSED", `key ${key} was already frozen for a different request`);
    if (expectedExisting && cached.createdAtMs !== expectedExisting.createdAtMs)
      throw new CacheError("CACHE_CORRUPT", "frozen creation timestamp changed during replay");
  }
  const draft: FreezeInput = {
    key, method, params: payload, createdAtMs: cached?.createdAtMs ?? Date.now(),
  };
  if (digest !== undefined) draft.digest = digest;
  if (cached) {
    // The replay-only API cannot recreate a file deleted after the observation.
    const frozen = cache.prepareReplay(draft);
    return { request: frozen, replay: true, body: verifiedFrozenBody(cache, frozen) };
  }
  const published = cache.freeze(draft, body);
  return { request: published.value, replay: published.kind === "existing", body: verifiedFrozenBody(cache, published.value) };
}
