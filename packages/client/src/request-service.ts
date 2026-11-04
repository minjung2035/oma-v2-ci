// MUST [CLI-001..003]/[IPC-004..008]: freeze before transport and never rebuild
// same-key requests from current HEAD or mutable source files.
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

export interface RequestOptions {
  /** Before reading mutable sources and before first freeze publication. This
   * may run twice; it must be idempotent and cannot authorize a transport send. */
  readonly beforePrepare?: () => void | Promise<void>;
  /** Protect freshly prepared in-memory bytes before publishing or reading the
   * model-mutable local cache. Never used to recreate an existing freeze. */
  readonly beforeFreeze?: (fresh: FreshBuild) => Promise<void>;
  /** Reported in recovery text instead of the frozen request's own key. */
  readonly displayKey?: string;
  /** Presentation only. Selected surfaces supply guidance for their available
   * observation path; omission retains the legacy tool wording and behavior. */
  readonly recoveryGuidance?: string;
  /** Runs after freeze resolution, immediately before the transport send --
   * on the first send and on every replay alike. A thrown error aborts the
   * send; the frozen request is left for the next attempt. */
  readonly beforeSend?: (frozen: CachedRequest, body?: Uint8Array) => Promise<void>;
  /** A completed canonical publication can make its original bundle unnecessary
   * for review-only transport; this must never permit publication reconstruction. */
  readonly needsFrozenBody?: (frozen: CachedRequest) => Promise<boolean>;
  /** A submission envelope stays frozen as one intent; only its validated review
   * DTO goes to the existing review owner after publication has succeeded. */
  readonly transportPayload?: (frozen: CachedRequest, body?: Uint8Array) => { params: Record<string, unknown>; body?: Uint8Array };
  /** Persist the verified original receipt before result presentation. */
  readonly onReceipt?: (receipt: Receipt) => void | Promise<void>;
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
  private readFrozen(key: string, display = key, options: RequestOptions = {}): CachedRequest | null {
    const observed = this.cache.read(key);
    if (observed.kind === "present") return observed.value;
    if (observed.kind === "absent") return null;
    return this.fail(`CACHE_${observed.kind === "corrupt" ? "CORRUPT" : "UNAVAILABLE"}: ${key}: ${observed.reason}; Not resending until the original frozen request is restored; ${options.recoveryGuidance ?? `observe oma_operation_status with key ${display}`}`, 3, display);
  }
  private frozenBody(entry: CachedRequest, display = entry.key, options: RequestOptions = {}): Uint8Array | undefined {
    if (entry.digest === undefined) return undefined;
    const observed = this.cache.readBody(entry.key, entry.digest);
    if (observed.kind === "present") return observed.value;
    return this.fail(`frozen request body ${observed.kind} for ${entry.key}${observed.kind === "absent" ? "" : `: ${observed.reason}`}; preserve the original frozen request; ${options.recoveryGuidance ?? `observe oma_operation_status with key ${display}`}; do not create a new payload`, 3, display);
  }

  /** WP26: the broker's receipt is the outcome; the request cache only
   * remembers it. A cache that cannot record it must not hide the receipt or
   * the key the Human needs to ask again -- without them a retry takes a new
   * key and repeats the effect. A receipt contradicting the cache's earlier
   * observation of the same request is reported as unknown. */
  /** The broker's receipt is remembered in the request cache, then returned to
   * the caller -- merge open keeps its own sequencing after a git.submit. */
  private async recorded(receipt: Receipt, key: string, options: RequestOptions): Promise<Receipt> {
    try { await options.onReceipt?.(receipt); }
    catch (error) {
      const failure = runtime().cacheFailure(error);
      throw new ClientError(`Original receipt could not be linked durably: ${error instanceof Error ? error.message : String(error)}; preserve request ${key}`,
        3, key, receipt, failure?.code === "CACHE_CORRUPT");
    }
    try { this.cache.updateReceipt(key, receipt); }
    catch (error) {
      const failure = runtime().cacheFailure(error);
      if (failure === null) throw new ClientError(`The canonical receipt was observed but local cache publication failed: ${error instanceof Error ? error.message : String(error)}`,
        3, key, receipt);
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
    const cached = this.readFrozen(key, display, options);
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
        await options.beforePrepare?.();
        await options.beforeFreeze?.({ method, params: payload,
          ...(digest === undefined ? {} : { digest }), ...(streamBytes === undefined ? {} : { stream: streamBytes }) });
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
  private async recoverReceipt(frozen: CachedRequest, key: string, display = key, options: RequestOptions = {}): Promise<Receipt> {
    let reply;
    try { reply = (await this.call("operation.get", { key }))[0]; }
    catch { return this.acceptanceUnknown(display, options); }
    if (reply?.ok === true) {
      const decoded = runtime().decodeReceipt(reply.result, { expectedKind: frozen.method, allowNotFound: true });
      if (decoded.ok && !runtime().notFound(decoded.value)) return this.recorded(decoded.value, key, options);
    }
    return this.acceptanceUnknown(display, options);
  }
  private acceptanceUnknown(key: string, options: RequestOptions = {}): never {
    return this.fail(`Acceptance status unknown: ${key}; ${options.recoveryGuidance ?? `observe oma_operation_status with key ${key}`}; do not resend under a new request key`, 3, key);
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
      catch { return this.acceptanceUnknown(display, options); }
      const reply = lookup[0];
      if (reply?.ok === true) {
        const decoded = runtime().decodeReceipt(reply.result, { expectedKind: frozen.method, allowNotFound: true });
        if (!decoded.ok) this.fail(`invalid operation lookup: ${decoded.reason}; request ${display}`, 3, display);
        if (!runtime().notFound(decoded.value)) return this.recorded(decoded.value, key, options);
      } else {
        const decoded = runtime().decodeFailure(reply?.error);
        if (!decoded.ok || decoded.value.code !== "REQUEST_NOT_FOUND")
          this.fail(`operation lookup did not prove REQUEST_NOT_FOUND: ${decoded.ok ? decoded.value.code : "invalid reply"}; request ${display}`, 3, display);
      }
    }
    const body = options.needsFrozenBody !== undefined && !await options.needsFrozenBody(frozen)
      ? undefined : this.frozenBody(frozen, display, options);
    if (options.beforeSend !== undefined) await options.beforeSend(frozen, body);
    let replies;
    const outgoing = options.transportPayload?.(frozen, body) ?? { params: this.payload(frozen.params), ...(body === undefined ? {} : { body }) };
    try { replies = await this.call(frozen.method, this.payload(outgoing.params), key, outgoing.body); }
    catch { return this.recoverReceipt(frozen, key, display, options); }
    const reply = replies[0];
    if (reply?.ok === false && ["DEADLINE_EXCEEDED", "BROKER_UNAVAILABLE"].includes(reply.error.code))
      return this.recoverReceipt(frozen, key, display, options);
    if (reply?.ok === true) {
      const decoded = runtime().decodeReceipt(reply.result, { expectedKind: frozen.method });
      if (!decoded.ok) this.fail(`invalid mutation receipt: ${decoded.reason}; request ${display}`, 3, display);
      return this.recorded(decoded.value, key, options);
    }
    const decoded = runtime().decodeFailure(reply?.error);
    if (!decoded.ok) return this.fail(`invalid broker failure: ${decoded.reason}; request ${display}`, 3, display);
    return this.fail(JSON.stringify({ ...decoded.value, request: display,
      ...(decoded.value.retry === "same-key" ? { recovery: options.recoveryGuidance ?? "Observe oma_operation_status with this key; reuse only the same request key and frozen input." } : {}) }),
      runtime().failureExit(decoded.value), display);
  }

  /** A corrupt/unavailable cache never reaches a source builder. */
  /** `merge open` runs a candidate publication and then the open under its own
   * keys: the same frozen-request discipline as effect(), but the decoded
   * receipt returns to the caller instead of ending the process. */
  async requestReceipt(expectedMethod: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>,
    comparable: () => Record<string, unknown>, options: RequestOptions = {}): Promise<Receipt> {
    const display = options.displayKey ?? key;
    const cached = this.readFrozen(key, display, options);
    if (cached !== null) {
      const mismatch = runtime().intentConflict(expectedMethod, comparable, cached);
      if (mismatch !== null) this.fail(`REQUEST_KEY_REUSED: key ${key} conflicts with explicit argument ${mismatch}`, 2, display);
      // The frozen request is replayed as frozen; its body is read only if the
      // ledger says it was never accepted (P0V-38).
      return this.resolveFrozen(cached, key, true, options);
    }
    await options.beforePrepare?.();
    const fresh = await build();
    if (fresh.method !== expectedMethod) throw new Error("fresh request builder returned a different method");
    return this.send(fresh.method, fresh.params, key, fresh.digest, fresh.stream, options);
  }
}
