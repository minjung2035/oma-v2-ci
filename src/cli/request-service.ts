// MUST [CLI-001..003]/[IPC-004..008]: freeze before transport and never rebuild
// same-key requests from current HEAD or mutable source files.
import type { Json, MutationMethod, Receipt } from "../../implementation/contracts.js";
import { uuidV4 } from "../ids.js";
import { snapshotJson } from "../domain/canonical-json.js";
import { requestParamsEqual } from "../domain/request-identity.js";
import { RequestCache, CacheError, readCacheFile, type CachedRequest, type FreezeInput } from "../request-cache.js";
import { decodeFailure, decodeReceipt } from "../protocol/receipt-codec.js";
import { isRequestNotFound } from "../protocol/receipts.js";
import { requestIntentConflict } from "./request-intent.js";
import { call, cliFrameBytes } from "./transport.js";
import { fail, finishFailure, finishReceipt, finishUnrecordedReceipt } from "./exit.js";

const HOME = process.env.HOME ?? "/tmp";
// P0V-112: made at first use, with the frame this CLI speaks -- a request's
// metadata retains a two-frame cache budget. Larger recovered receipts are
// printed without caching; the original request freeze is kept.
let made: RequestCache | null = null;
const cache = (): RequestCache => made ??= new RequestCache(HOME, readCacheFile, 2 * cliFrameBytes());

function requestPayload(value: unknown): { [key: string]: Json } {
  const copied = snapshotJson(value);
  if (copied === null || typeof copied !== "object" || Array.isArray(copied))
    throw new TypeError("request payload must be a JSON object");
  return copied;
}

function readFrozen(key: string): CachedRequest | null {
  const observed = cache().read(key);
  if (observed.kind === "present") return observed.value;
  if (observed.kind === "absent") return null;
  return fail(
    `CACHE_${observed.kind === "corrupt" ? "CORRUPT" : "UNAVAILABLE"}: ${key}: ${observed.reason}; Not resending until the original frozen request is restored`,
    3,
  );
}

function frozenBody(entry: CachedRequest): Uint8Array | undefined {
  if (entry.digest === undefined) return undefined;
  const observed = cache().readBody(entry.key, entry.digest);
  if (observed.kind === "present") return observed.value;
  return fail(
    `frozen request body ${observed.kind} for ${entry.key}${observed.kind === "absent" ? "" : `: ${observed.reason}`} (Recovery: preserve the original frozen request; do not create a new payload)`,
    3,
  );
}

/** WP26: the broker's receipt is the outcome; the request cache only
 * remembers it. A cache that cannot record it must not hide the receipt or
 * the key the Human needs to ask again -- without them a retry takes a new
 * key and repeats the effect. A receipt contradicting the cache's earlier
 * observation of the same request is reported as unknown. */
/** The broker's receipt is remembered in the request cache, then returned to
 * the caller -- merge open keeps its own sequencing after a git.submit. */
function recorded(receipt: Receipt, key: string): Receipt {
  try { cache().updateReceipt(key, receipt); }
  catch (error) {
    if (!(error instanceof CacheError)) throw error;
    finishUnrecordedReceipt(receipt, key, `${error.code}: Request cache could not record this receipt: ${error.message}`, error.code === "CACHE_CORRUPT");
  }
  return receipt;
}

function settle(receipt: Receipt, key: string): never {
  finishReceipt(recorded(receipt, key), key);
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
async function freezeThenSend(
  method: MutationMethod,
  params: Record<string, unknown>,
  key: string,
  digest?: { bytes: number; sha256: string },
  streamBytes?: Uint8Array,
): Promise<Receipt> {
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
      const publication = cache().freeze(input, streamBytes);
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
  return resolveFrozen(frozen, key, replay);
}

export async function replayOrSend(
  method: MutationMethod,
  params: Record<string, unknown>,
  key: string,
  digest?: { bytes: number; sha256: string },
  streamBytes?: Uint8Array,
): Promise<never> {
  return finishReceipt(await freezeThenSend(method, params, key, digest, streamBytes), key);
}

/** A lost answer permits observation, never a second effect. Even a lookup
 * reporting absence does not turn this call into an automatic send loop. */
async function recoverReceipt(frozen: CachedRequest, key: string): Promise<Receipt> {
  let reply;
  try { reply = (await call("operation.get", { key }))[0]; }
  catch { return acceptanceUnknown(key); }
  if (reply?.ok === true) {
    const decoded = decodeReceipt(reply.result, { expectedKind: frozen.method, allowNotFound: true });
    if (decoded.ok && !isRequestNotFound(decoded.value)) return recorded(decoded.value, key);
  }
  return acceptanceUnknown(key);
}

function acceptanceUnknown(key: string): never {
  fail(`Acceptance status unknown: ${key} (Recovery: use --request ${key} with the same command; do not rerun with a new key)`, 3);
}

/** The frozen request's outcome: looked up first when it may already have been
 * sent, and sent -- with its frozen body -- only when this is its first send or
 * the ledger has answered REQUEST_NOT_FOUND. P0V-38, P0-5: the lookup needs the
 * key alone, so a body that is missing or cannot be read now never keeps the
 * broker's receipt from the Human; it matters only for the resend, and there it
 * is still never rebuilt from anything but the freeze. */
async function resolveFrozen(frozen: CachedRequest, key: string, replay: boolean): Promise<Receipt> {
  if (replay) {
    let lookup;
    try {
      lookup = await call("operation.get", { key });
    } catch {
      return acceptanceUnknown(key);
    }
    const reply = lookup[0];
    if (reply?.ok === true) {
      const decoded = decodeReceipt(reply.result, { expectedKind: frozen.method, allowNotFound: true });
      if (!decoded.ok) fail(`invalid operation lookup: ${decoded.reason}; --request ${key}`, 3);
      if (!isRequestNotFound(decoded.value)) return recorded(decoded.value, key);
    } else {
      const decoded = decodeFailure(reply?.error);
      if (!decoded.ok || decoded.value.code !== "REQUEST_NOT_FOUND")
        fail(
          `operation lookup did not prove REQUEST_NOT_FOUND: ${decoded.ok ? decoded.value.code : "invalid reply"}; --request ${key}`,
          3,
        );
    }
  }
  const body = frozenBody(frozen);
  let replies;
  try {
    replies = await call(frozen.method, requestPayload(frozen.params), key, body);
  } catch {
    return recoverReceipt(frozen, key);
  }
  const reply = replies[0];
  if (reply?.ok === false && ["DEADLINE_EXCEEDED", "BROKER_UNAVAILABLE"].includes(reply.error.code))
    return recoverReceipt(frozen, key);
  if (reply?.ok === true) {
    const decoded = decodeReceipt(reply.result, { expectedKind: frozen.method });
    if (!decoded.ok) fail(`invalid mutation receipt: ${decoded.reason}; --request ${key}`, 3);
    return recorded(decoded.value, key);
  }
  return finishFailure(reply, "", key);
}

/** A corrupt/unavailable cache never reaches a source builder. */
export async function effect(
  expectedMethod: MutationMethod,
  key: string,
  build: () => FreshBuild | Promise<FreshBuild>,
  comparable: () => Record<string, unknown>,
): Promise<never> {
  return finishReceipt(await requestReceipt(expectedMethod, key, build, comparable), key);
}

/** `merge open` runs a candidate publication and then the open under its own
 * keys: the same frozen-request discipline as effect(), but the decoded
 * receipt returns to the caller instead of ending the process. */
export async function requestReceipt(
  expectedMethod: MutationMethod,
  key: string,
  build: () => FreshBuild | Promise<FreshBuild>,
  comparable: () => Record<string, unknown>,
): Promise<Receipt> {
  const cached = readFrozen(key);
  if (cached !== null) {
    const mismatch = requestIntentConflict(
      { expectedMethod, explicitParams: comparable },
      cached,
    );
    if (mismatch !== null)
      fail(`REQUEST_KEY_REUSED: key ${key} conflicts with explicit argument ${mismatch}`, 2);
    // The frozen request is replayed as frozen; its body is read only if the
    // ledger says it was never accepted (P0V-38).
    return resolveFrozen(cached, key, true);
  }
  const fresh = await build();
  if (fresh.method !== expectedMethod)
    throw new Error("fresh request builder returned a different method");
  return freezeThenSend(fresh.method, fresh.params, key, fresh.digest, fresh.stream);
}
