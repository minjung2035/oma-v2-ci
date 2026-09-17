// MUST [CLI-001..003]/[IPC-004..008]: freeze before transport and never rebuild
// same-key requests from current HEAD or mutable source files.
import type { Json, MutationMethod } from "../../implementation/contracts.js";
import { uuidV4 } from "../ids.js";
import { snapshotJson } from "../domain/canonical-json.js";
import { requestParamsEqual } from "../domain/request-identity.js";
import { RequestCache, CacheError, type CachedRequest, type FreezeInput } from "../request-cache.js";
import { decodeFailure, decodeReceipt } from "../protocol/receipt-codec.js";
import { isRequestNotFound } from "../protocol/receipts.js";
import { requestIntentConflict } from "./request-intent.js";
import { call } from "./transport.js";
import { fail, finishFailure, finishReceipt } from "./exit.js";

const HOME = process.env.HOME ?? "/tmp";
const cache = new RequestCache(HOME);

function requestPayload(value: unknown): { [key: string]: Json } {
  const copied = snapshotJson(value);
  if (copied === null || typeof copied !== "object" || Array.isArray(copied))
    throw new TypeError("request payload must be a JSON object");
  return copied;
}

function readFrozen(key: string): CachedRequest | null {
  const observed = cache.read(key);
  if (observed.kind === "present") return observed.value;
  if (observed.kind === "absent") return null;
  return fail(
    `CACHE_${observed.kind === "corrupt" ? "CORRUPT" : "UNAVAILABLE"}: ${key}: ${observed.reason}; 원래 freeze를 복구하기 전에는 재전송하지 않음`,
    3,
  );
}

function frozenBody(entry: CachedRequest): Uint8Array | undefined {
  if (entry.digest === undefined) return undefined;
  const observed = cache.readBody(entry.key, entry.digest);
  if (observed.kind === "present") return observed.value;
  return fail(
    `frozen request body ${observed.kind} for ${entry.key}${observed.kind === "absent" ? "" : `: ${observed.reason}`} (복구: 원래 freeze 보존; 새 payload 생성 금지)`,
    3,
  );
}

export interface FreshBuild {
  method: MutationMethod;
  params: Record<string, unknown>;
  digest?: { bytes: number; sha256: string };
  stream?: Uint8Array;
}

export function randKey(): string {
  return `cli-${uuidV4()}`;
}

/** Only an explicit, decoded REQUEST_NOT_FOUND lookup permits frozen resend. */
export async function replayOrSend(
  method: MutationMethod,
  params: Record<string, unknown>,
  key: string,
  digest?: { bytes: number; sha256: string },
  streamBytes?: Uint8Array,
): Promise<never> {
  const payload = requestPayload(params);
  const cached = readFrozen(key);
  let frozen: CachedRequest;
  let replay: boolean;
  if (cached !== null) {
    const sameMethod = cached.method === method && requestParamsEqual(method, cached.params, payload);
    const sameDigest =
      (cached.digest === undefined && digest === undefined) ||
      (cached.digest !== undefined &&
        digest !== undefined &&
        cached.digest.bytes === digest.bytes &&
        cached.digest.sha256 === digest.sha256);
    if (!sameMethod || !sameDigest)
      fail(`REQUEST_KEY_REUSED: key ${key} was already frozen for a different request`, 2);
    frozen = cached;
    replay = true;
  } else {
    const input: FreezeInput = { key, method, params: payload, createdAtMs: Date.now() };
    if (digest !== undefined) input.digest = digest;
    try {
      const publication = cache.freeze(input, streamBytes);
      frozen = publication.value;
      replay = publication.kind === "existing";
    } catch (error) {
      if (error instanceof CacheError)
        fail(
          `${error.code}: ${error.message}`,
          error.code === "INVALID_REQUEST" || error.code === "REQUEST_KEY_REUSED" ? 2 : 3,
        );
      throw error;
    }
  }
  const body = frozenBody(frozen);
  if (replay) {
    let lookup;
    try {
      lookup = await call("operation.get", { key });
    } catch {
      fail(`미접수 여부 불명확: ${key} (복구: 원래 command에 --request ${key})`, 3);
    }
    const reply = lookup[0];
    if (reply?.ok === true) {
      const decoded = decodeReceipt(reply.result, { expectedKind: method, allowNotFound: true });
      if (!decoded.ok) fail(`invalid operation lookup: ${decoded.reason}; --request ${key}`, 3);
      if (!isRequestNotFound(decoded.value)) {
        cache.updateReceipt(key, decoded.value);
        finishReceipt(decoded.value, key);
      }
    } else {
      const decoded = decodeFailure(reply?.error);
      if (!decoded.ok || decoded.value.code !== "REQUEST_NOT_FOUND")
        fail(
          `operation lookup did not prove REQUEST_NOT_FOUND: ${decoded.ok ? decoded.value.code : "invalid reply"}; --request ${key}`,
          3,
        );
    }
  }
  let replies;
  try {
    replies = await call(frozen.method, requestPayload(frozen.params), key, body);
  } catch {
    fail(`미접수 여부 불명확: ${key} (복구: 원래 command에 --request ${key})`, 3);
  }
  const reply = replies[0];
  if (reply?.ok === true) {
    const decoded = decodeReceipt(reply.result, { expectedKind: method });
    if (!decoded.ok) fail(`invalid mutation receipt: ${decoded.reason}; --request ${key}`, 3);
    cache.updateReceipt(key, decoded.value);
    finishReceipt(decoded.value, key);
  }
  return finishFailure(reply);
}

/** A corrupt/unavailable cache never reaches a source builder. */
export async function effect(
  expectedMethod: MutationMethod,
  key: string,
  build: () => FreshBuild | Promise<FreshBuild>,
  comparable: () => Record<string, unknown>,
): Promise<never> {
  const cached = readFrozen(key);
  if (cached !== null) {
    const mismatch = requestIntentConflict(
      { expectedMethod, explicitParams: comparable },
      cached,
    );
    if (mismatch !== null)
      fail(`REQUEST_KEY_REUSED: key ${key} conflicts with explicit argument ${mismatch}`, 2);
    return replayOrSend(
      cached.method,
      requestPayload(cached.params),
      key,
      cached.digest,
      frozenBody(cached),
    );
  }
  const fresh = await build();
  if (fresh.method !== expectedMethod)
    throw new Error("fresh request builder returned a different method");
  return replayOrSend(fresh.method, fresh.params, key, fresh.digest, fresh.stream);
}
