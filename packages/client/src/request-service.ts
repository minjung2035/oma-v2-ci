// MUST [CLI-001..003]/[IPC-004..008]: freeze before transport and never rebuild
// same-key requests from current HEAD or mutable source files.
import { randomUUID } from "node:crypto";
import type { Json, MutationMethod, Receipt } from "@oma/contracts";
import { ClientError } from "./errors.js";
import { runtime, type CachePort, type CachedRequest, type Reply } from "./runtime.js";

export interface FreshBuild {
  method: MutationMethod;
  params: Record<string, unknown>;
  digest?: { bytes: number; sha256: string };
  stream?: Uint8Array;
}
export type RequestCall = (method: "operation.get" | MutationMethod, params: Record<string, unknown>,
  key?: string, body?: Uint8Array) => Promise<Reply[]>;
export function randKey(): string { return `cli-${randomUUID()}`; }

export interface RequestOptions {
  /** Reported in recovery text instead of the frozen request's own key. */
  readonly displayKey?: string;
  /** Runs after freeze resolution, immediately before the transport send --
   * on the first send and on every replay alike. A thrown error aborts the
   * send; the frozen request is left for the next attempt. */
  readonly beforeSend?: (frozen: CachedRequest) => Promise<void>;
}

export class RequestService {
  constructor(private readonly cache: CachePort, private readonly call: RequestCall) {}
  private fail(message: string, code: 2 | 3 | 4, key: string): never { throw new ClientError(message, code, key); }
  private payload(value: unknown): { [key: string]: Json } {
    const copied = runtime().snapshot(value);
    if (copied === null || typeof copied !== "object" || Array.isArray(copied))
      throw new TypeError("request payload must be a JSON object");
    return copied;
  }
  private readFrozen(key: string, display = key): CachedRequest | null {
    const observed = this.cache.read(key);
    if (observed.kind === "present") return observed.value;
    if (observed.kind === "absent") return null;
    return this.fail(`CACHE_${observed.kind === "corrupt" ? "CORRUPT" : "UNAVAILABLE"}: ${key}: ${observed.reason}; Not resending until the original frozen request is restored; --request ${display} with the same command`, 3, display);
  }
  private frozenBody(entry: CachedRequest, display = entry.key): Uint8Array | undefined {
    if (entry.digest === undefined) return undefined;
    const observed = this.cache.readBody(entry.key, entry.digest);
    if (observed.kind === "present") return observed.value;
    return this.fail(`frozen request body ${observed.kind} for ${entry.key}${observed.kind === "absent" ? "" : `: ${observed.reason}`} (Recovery: preserve the original frozen request; do not create a new payload; --request ${display} with the same command)`, 3, display);
  }

  /** WP26: the broker's receipt is the outcome; the request cache only
   * remembers it. A cache that cannot record it must not hide the receipt or
   * the key the Human needs to ask again -- without them a retry takes a new
   * key and repeats the effect. A receipt contradicting the cache's earlier
   * observation of the same request is reported as unknown. */
  /** The broker's receipt is remembered in the request cache, then returned to
   * the caller -- merge open keeps its own sequencing after a git.submit. */
  private recorded(receipt: Receipt, key: string): Receipt {
    try { this.cache.updateReceipt(key, receipt); }
    catch (error) {
      const failure = runtime().cacheFailure(error);
      if (failure === null) throw error;
      throw new ClientError(`${failure.code}: Request cache could not record this receipt: ${failure.message}`,
        failure.code === "CACHE_CORRUPT" ? 3 : runtime().receiptExit(receipt) || 3, key, receipt, failure.code === "CACHE_CORRUPT");
    }
    return receipt;
  }

  /** Only an explicit, decoded REQUEST_NOT_FOUND lookup permits frozen resend. */
  async send(method: MutationMethod, params: Record<string, unknown>, key: string,
    digest?: { bytes: number; sha256: string }, streamBytes?: Uint8Array, options: RequestOptions = {}): Promise<Receipt> {
    const display = options.displayKey ?? key;
    const payload = this.payload(params);
    const cached = this.readFrozen(key, display);
    let frozen: CachedRequest;
    let replay: boolean;
    if (cached !== null) {
      const sameMethod = cached.method === method && runtime().paramsEqual(method, cached.params, payload);
      const sameDigest = (cached.digest === undefined && digest === undefined) ||
        (cached.digest !== undefined && digest !== undefined && cached.digest.bytes === digest.bytes && cached.digest.sha256 === digest.sha256);
      if (!sameMethod || !sameDigest) this.fail(`REQUEST_KEY_REUSED: key ${key} was already frozen for a different request`, 2, display);
      frozen = cached; replay = true;
    } else {
      try {
        const publication = this.cache.freeze({ key, method, params: payload, createdAtMs: Date.now(),
          ...(digest === undefined ? {} : { digest }) }, streamBytes);
        frozen = publication.value; replay = publication.kind === "existing";
      } catch (error) {
        const failure = runtime().cacheFailure(error);
        if (failure !== null) this.fail(`${failure.code}: ${failure.message}`,
          failure.code === "INVALID_REQUEST" || failure.code === "REQUEST_KEY_REUSED" ? 2 : 3, display);
        throw error;
      }
    }
    return this.resolveFrozen(frozen, key, replay, options);
  }

  /** A lost answer permits observation, never a second effect. Even a lookup
   * reporting absence does not turn this call into an automatic send loop. */
  private async recoverReceipt(frozen: CachedRequest, key: string, display = key): Promise<Receipt> {
    let reply;
    try { reply = (await this.call("operation.get", { key }))[0]; }
    catch { return this.acceptanceUnknown(display); }
    if (reply?.ok === true) {
      const decoded = runtime().decodeReceipt(reply.result, { expectedKind: frozen.method, allowNotFound: true });
      if (decoded.ok && !runtime().notFound(decoded.value)) return this.recorded(decoded.value, key);
    }
    return this.acceptanceUnknown(display);
  }
  private acceptanceUnknown(key: string): never {
    return this.fail(`Acceptance status unknown: ${key} (Recovery: use --request ${key} with the same command; do not rerun with a new key)`, 3, key);
  }

  /** The frozen request's outcome: looked up first when it may already have been
   * sent, and sent -- with its frozen body -- only when this is its first send or
   * the ledger has answered REQUEST_NOT_FOUND. P0V-38, P0-5: the lookup needs the
   * key alone, so a body that is missing or cannot be read now never keeps the
   * broker's receipt from the Human; it matters only for the resend, and there it
   * is still never rebuilt from anything but the freeze. */
  private async resolveFrozen(frozen: CachedRequest, key: string, replay: boolean,
    options: RequestOptions = {}): Promise<Receipt> {
    const display = options.displayKey ?? key;
    if (replay) {
      let lookup;
      try { lookup = await this.call("operation.get", { key }); }
      catch { return this.acceptanceUnknown(display); }
      const reply = lookup[0];
      if (reply?.ok === true) {
        const decoded = runtime().decodeReceipt(reply.result, { expectedKind: frozen.method, allowNotFound: true });
        if (!decoded.ok) this.fail(`invalid operation lookup: ${decoded.reason}; --request ${display}`, 3, display);
        if (!runtime().notFound(decoded.value)) return this.recorded(decoded.value, key);
      } else {
        const decoded = runtime().decodeFailure(reply?.error);
        if (!decoded.ok || decoded.value.code !== "REQUEST_NOT_FOUND")
          this.fail(`operation lookup did not prove REQUEST_NOT_FOUND: ${decoded.ok ? decoded.value.code : "invalid reply"}; --request ${display}`, 3, display);
      }
    }
    const body = this.frozenBody(frozen, display);
    if (options.beforeSend !== undefined) {
      try { await options.beforeSend(frozen); }
      catch (error) {
        if (error instanceof ClientError) throw error;
        this.fail(`request preparation: ${error instanceof Error ? error.message : String(error)}`, 3, display);
      }
    }
    let replies;
    try { replies = await this.call(frozen.method, this.payload(frozen.params), key, body); }
    catch { return this.recoverReceipt(frozen, key, display); }
    const reply = replies[0];
    if (reply?.ok === false && ["DEADLINE_EXCEEDED", "BROKER_UNAVAILABLE"].includes(reply.error.code))
      return this.recoverReceipt(frozen, key, display);
    if (reply?.ok === true) {
      const decoded = runtime().decodeReceipt(reply.result, { expectedKind: frozen.method });
      if (!decoded.ok) this.fail(`invalid mutation receipt: ${decoded.reason}; --request ${display}`, 3, display);
      return this.recorded(decoded.value, key);
    }
    const decoded = runtime().decodeFailure(reply?.error);
    if (!decoded.ok) return this.fail(`invalid broker failure: ${decoded.reason}; --request ${display}`, 3, display);
    const again = decoded.value.retry === "same-key"
      ? ` (Query again: use --request ${display} with the same command; do not rerun with a new key)` : "";
    return this.fail(`${runtime().failureText(decoded.value)}${again}`, runtime().failureExit(decoded.value), display);
  }

  /** A corrupt/unavailable cache never reaches a source builder. */
  /** `merge open` runs a candidate publication and then the open under its own
   * keys: the same frozen-request discipline as effect(), but the decoded
   * receipt returns to the caller instead of ending the process. */
  async requestReceipt(expectedMethod: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>,
    comparable: () => Record<string, unknown>, options: RequestOptions = {}): Promise<Receipt> {
    const display = options.displayKey ?? key;
    const cached = this.readFrozen(key, display);
    if (cached !== null) {
      const mismatch = runtime().intentConflict(expectedMethod, comparable, cached);
      if (mismatch !== null) this.fail(`REQUEST_KEY_REUSED: key ${key} conflicts with explicit argument ${mismatch}`, 2, display);
      // The frozen request is replayed as frozen; its body is read only if the
      // ledger says it was never accepted (P0V-38).
      return this.resolveFrozen(cached, key, true, options);
    }
    const fresh = await build();
    if (fresh.method !== expectedMethod) throw new Error("fresh request builder returned a different method");
    return this.send(fresh.method, fresh.params, key, fresh.digest, fresh.stream, options);
  }
}
