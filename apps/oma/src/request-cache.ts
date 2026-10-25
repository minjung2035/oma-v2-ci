// MUST [FS-003]/[IPC-006/008]: private model-mutable preaccept cache.
// This is neither a durable effect ledger nor broker/session authority.
import { readFileSync, openSync, closeSync, fstatSync, lstatSync, constants } from "node:fs";

import { join } from "node:path";
import type { Receipt, RequestKey } from "@oma/contracts";
import { isValidRequestKey } from "@oma/domain/identifiers";
import { requestParamsEqual } from "@oma/domain/request-identity";
import { sha256Hex } from "@oma/domain/canonical-json";
import { parseJsonObject } from "@oma/protocol/frame";
import { decodeReceipt, receiptSupersession } from "@oma/protocol/receipt-codec";
import { decodeCachedRequest, decodeStreamDigest, type CachedRequest, type StreamDigest } from "./cli/cache-codec.js";
import { ensureOwnedDurableDirectory, publishNoReplace, replaceDerivedFile as replaceReceiptFile } from "@oma/storage/durable-fs";
import { openBeneath, withinDirectory } from "@oma/native/files";
import { lockFileDescriptor } from "@oma/native/linux";

export type { CachedRequest, StreamDigest } from "./cli/cache-codec.js";
export type FreezeInput = Omit<CachedRequest, "lastReceipt">;
export type FileObservation<T> =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly value: T }
  | { readonly kind: "corrupt"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string };
export type CacheRead = FileObservation<CachedRequest>;
export type BodyRead = FileObservation<Uint8Array>;
export type FreezeResult = { readonly kind: "created" | "existing"; readonly value: CachedRequest };
export type CacheReader = (path: string, expectedBytes?: number, maximumBytes?: number) => FileObservation<Uint8Array>;

/** P0V-112 (G02-ledger-r2-02): a request's metadata holds the request and its
 * latest receipt, each no larger than one frame; a file larger than two
 * frames is not one this cache wrote, and is not read whole. The reference
 * frame is the CLI's when unset (256 KiB, CFG-003). */
export const REFERENCE_METADATA_BYTES = 2 * 256 * 1024;

/** How long a competing process may hold one request key's receipt lock
 * before this one reports the cache unavailable rather than waiting further. */
const RECEIPT_LOCK_ATTEMPTS = 200;
const RECEIPT_LOCK_PAUSE_MS = 5;

export class CacheError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "REQUEST_KEY_REUSED" | "CACHE_CORRUPT" | "CACHE_UNAVAILABLE", message: string) {
    super(message);
    this.name = "CacheError";
  }
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
function ioObservation(error: unknown): FileObservation<never> {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return { kind: "absent" };
  if (code === "ELOOP" || code === "EISDIR" || code === "ENOTDIR")
    return { kind: "corrupt", reason: messageOf(error) };
  return { kind: "unavailable", reason: messageOf(error) };
}
function requirePresent<T>(observation: FileObservation<T>, what: string): T {
  if (observation.kind === "present") return observation.value;
  if (observation.kind === "unavailable") throw new CacheError("CACHE_UNAVAILABLE", `${what}: ${observation.reason}`);
  throw new CacheError("CACHE_CORRUPT", `${what}: ${observation.kind === "absent" ? "missing" : observation.reason}`);
}

/** No existsSync precheck, symlink following, or FIFO read can erase an I/O failure. */
export const readCacheFile: CacheReader = (path, expectedBytes, maximumBytes) => {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0)
      return { kind: "corrupt", reason: "cache entry is not a regular file with a safe size" };
    if (expectedBytes !== undefined && stat.size !== expectedBytes)
      return { kind: "corrupt", reason: "body size differs from frozen digest" };
    if (maximumBytes !== undefined && stat.size > maximumBytes)
      return { kind: "corrupt", reason: "cache entry is larger than a request and its receipt can be" };
    const bytes = readFileSync(fd);
    if (bytes.length !== stat.size) return { kind: "corrupt", reason: "cache file changed during read" };
    return { kind: "present", value: bytes };
  } catch (error) {
    return ioObservation(error);
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); }
      catch (error) { return { kind: "unavailable", reason: `cache close failed: ${messageOf(error)}` }; }
    }
  }
};

/** Unique temporary name is transient, not a new cache format, queue, or lock.
 * Initial cache publication owns this descriptor and its unlink separately from
 * immutable mail and from the receipt-only derived replacement API.
 */
function sameIdentity(left: CachedRequest, right: CachedRequest): boolean {
  return left.key === right.key && left.method === right.method &&
    requestParamsEqual(left.method, left.params, right.params) &&
    ((left.digest === undefined && right.digest === undefined) ||
      (left.digest !== undefined && right.digest !== undefined && left.digest.bytes === right.digest.bytes && left.digest.sha256 === right.digest.sha256));
}
function freezeInput(input: FreezeInput): CachedRequest {
  if (Object.hasOwn(input, "lastReceipt")) throw new CacheError("INVALID_REQUEST", "initial freeze cannot set lastReceipt");
  const decoded = decodeCachedRequest({ ...input, lastReceipt: null }, input.key);
  if (!decoded.ok) throw new CacheError("INVALID_REQUEST", decoded.reason);
  return decoded.value;
}

export class RequestCache {
  /** The injected reader is for deterministic I/O-failure tests, never wire input. */
  constructor(readonly homeDir: string, private readonly reader: CacheReader = readCacheFile,
    private readonly metadataBytes: number = REFERENCE_METADATA_BYTES) {}

  private dir(): string { return join(this.homeDir, ".local", "state", "oma", "requests"); }
  /** P0-8: `.local/state/oma` is the first component oma itself made inside
   * the caller's home -- `.local` and `.local/state` are the user's shared
   * XDG names, never repaired -- and a mode-000 cache directory beneath the
   * boundary is repaired rather than wedged on. */
  private ensureDir(): void {
    ensureOwnedDurableDirectory(this.dir(), join(this.homeDir, ".local", "state", "oma"), 0o700);
  }
  private path(key: RequestKey): string {
    if (!isValidRequestKey(key)) throw new CacheError("INVALID_REQUEST", "invalid request key");
    return join(this.dir(), `${key}.json`);
  }
  bodyPath(key: RequestKey): string { return this.path(key).replace(/\.json$/, ".body"); }

  private readMetadata(key: RequestKey): CacheRead {
    if (!isValidRequestKey(key)) return { kind: "corrupt", reason: "invalid request key" };
    const bytes = this.reader(this.path(key), undefined, this.metadataBytes);
    if (bytes.kind !== "present") return bytes;
    try {
      const decoded = decodeCachedRequest(parseJsonObject(bytes.value).raw, key);
      return decoded.ok ? { kind: "present", value: decoded.value } : { kind: "corrupt", reason: decoded.reason };
    } catch (error) { return { kind: "corrupt", reason: messageOf(error) }; }
  }

  /** ENOENT metadata is absent only when no earlier body publication survives. */
  read(key: RequestKey): CacheRead {
    const metadata = this.readMetadata(key);
    if (metadata.kind !== "absent") return metadata;
    try {
      lstatSync(this.bodyPath(key));
      return { kind: "corrupt", reason: "orphan body without frozen metadata; original caller payload is unknown" };
    } catch (error) {
      const body = ioObservation(error);
      return body.kind === "absent" ? metadata : body;
    }
  }

  readBody(key: RequestKey, expected: StreamDigest): BodyRead {
    if (!isValidRequestKey(key)) return { kind: "corrupt", reason: "invalid request key" };
    const digest = decodeStreamDigest(expected);
    if (!digest.ok) return { kind: "corrupt", reason: digest.reason };
    const body = this.reader(this.bodyPath(key), expected.bytes);
    if (body.kind !== "present") return body;
    if (body.value.byteLength !== expected.bytes || sha256Hex(body.value) !== expected.sha256)
      return { kind: "corrupt", reason: "body bytes/hash differ from frozen digest" };
    return body;
  }

  private existing(request: CachedRequest, actual: CacheRead): FreezeResult {
    const frozen = requirePresent(actual, "frozen metadata");
    if (!sameIdentity(request, frozen)) throw new CacheError("REQUEST_KEY_REUSED", `key ${request.key} is already frozen for another request`);
    if (frozen.digest) requirePresent(this.readBody(frozen.key, frozen.digest), "frozen body");
    // Fence a competing link even when its original publisher has not fsynced
    // yet -- and, P0V-71, the path to it, which that publisher may not have.
    try { this.ensureDir(); }
    catch (error) { throw new CacheError("CACHE_UNAVAILABLE", `replay durability barrier failed: ${messageOf(error)}`); }
    return { kind: "existing", value: frozen };
  }

  /** Never creates metadata: disappearance during a replay is not a fresh key. */
  prepareReplay(input: FreezeInput): CachedRequest {
    return this.existing(freezeInput(input), this.read(input.key)).value;
  }

  /**
   * Initial freeze only. Body fsync/publication precedes metadata publication.
   * The two files are NOT one filesystem transaction. A body-only crash is
   * retained as an ambiguous orphan; no new payload is reconstructed for its key.
   */
  freeze(input: FreezeInput, body?: Uint8Array): FreezeResult {
    const request = freezeInput(input);
    const initial = this.read(request.key);
    if (initial.kind === "present") return this.existing(request, initial);
    if (initial.kind !== "absent") requirePresent(initial, "initial freeze");
    if (request.digest) {
      if (body === undefined || body.byteLength !== request.digest.bytes || sha256Hex(body) !== request.digest.sha256)
        throw new CacheError("INVALID_REQUEST", "fresh body does not match frozen digest");
    } else if (body !== undefined) throw new CacheError("INVALID_REQUEST", "request without a descriptor cannot freeze a body");
    try {
      // P0V-71, P0-3: the first freeze in a home creates `.local/state/oma/requests`;
      // a frozen request is durable only if every name on that path is.
      this.ensureDir();
      if (request.digest && body !== undefined) {
        const published = publishNoReplace(this.bodyPath(request.key), body);
        if (published === "existing") {
          const metadata = this.readMetadata(request.key);
          if (metadata.kind === "present") return this.existing(request, metadata);
          const observedBody = this.readBody(request.key, request.digest);
          if (observedBody.kind === "corrupt") throw new CacheError("REQUEST_KEY_REUSED", `key ${request.key} has a different frozen body`);
          if (metadata.kind !== "absent") requirePresent(metadata, "competing metadata publication");
          if (observedBody.kind !== "present") requirePresent(observedBody, "competing body publication");
          // Equal body bytes do not prove that another writer had equal params.
          throw new CacheError("CACHE_UNAVAILABLE", "another body publication exists without proven metadata; no reconstruction attempted");
        }
      }
      const published = publishNoReplace(this.path(request.key), JSON.stringify(request));
      if (published === "existing") return this.existing(request, this.readMetadata(request.key));
      return { kind: "created", value: request };
    } catch (error) {
      if (error instanceof CacheError) throw error;
      throw new CacheError("CACHE_UNAVAILABLE", `freeze publication failed: ${messageOf(error)}`);
    }
  }

  /** Serialises one request key's read-modify-write against other processes.
   *
   * The metadata file is replaced by rename, so a lock taken on it would be a
   * lock on an inode the next writer replaces; the lock is its own name, and
   * it is held for one read and one rename. A holder still there after the
   * bounded wait is not making progress, and a cache that hangs the Human's
   * terminal is worse than one that says it is unavailable. */
  private withReceiptLock<T>(key: RequestKey, body: () => T): T {
    const path = `${this.path(key).replace(/\.json$/, "")}.lock`;
    let fd: number;
    try {
      this.ensureDir();
      fd = withinDirectory(path, (parent, name) =>
        openBeneath(parent, name, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600));
    } catch (error) { throw new CacheError("CACHE_UNAVAILABLE", `receipt lock could not be opened: ${messageOf(error)}`); }
    const pause = new Int32Array(new SharedArrayBuffer(4));
    try {
      for (let attempt = 0; attempt < RECEIPT_LOCK_ATTEMPTS; attempt += 1) {
        const lock = lockFileDescriptor(fd);
        if (lock.kind === "held") return body();
        if (lock.kind === "failed")
          throw new CacheError("CACHE_UNAVAILABLE", `receipt lock could not be evaluated (errno ${lock.errno})`);
        Atomics.wait(pause, 0, 0, RECEIPT_LOCK_PAUSE_MS);
      }
      throw new CacheError("CACHE_UNAVAILABLE", "another process still holds this request's receipt lock");
    } finally { closeSync(fd); }
  }

  /** Only this API changes lastReceipt; callers cannot supply replacement identity fields.
   *
   * The read and the write are one critical section. Reading outside it would
   * make the ordering below an opinion about a value that may already have
   * been replaced, which is the lost update it exists to prevent. */
  updateReceipt(key: RequestKey, receipt: unknown): CachedRequest {
    return this.withReceiptLock(key, () => {
      const frozen = requirePresent(this.read(key), "receipt update metadata");
      const decoded = decodeReceipt(receipt, { expectedKind: frozen.method });
      if (!decoded.ok) throw new CacheError("CACHE_CORRUPT", `invalid receipt observation: ${decoded.reason}`);
      if (frozen.lastReceipt !== null && frozen.lastReceipt.operation !== decoded.value.operation)
        throw new CacheError("CACHE_CORRUPT", "receipt operation differs from the previous observation");
      const order = receiptSupersession(frozen.lastReceipt, decoded.value);
      if (order === "contradiction")
        throw new CacheError("CACHE_CORRUPT", "one operation cannot both succeed and fail");
      // A settled observation is kept: this one is older news, and rewriting
      // it would be the regression the ordering exists to refuse.
      if (order === "stale") return frozen;
      const updated: CachedRequest = { ...frozen, lastReceipt: decoded.value };
      const encoded = JSON.stringify(updated);
      // Recovery can receive a multi-frame receipt. Keep the original freeze
      // readable when that observation cannot fit the bounded local cache.
      if (Buffer.byteLength(encoded) > this.metadataBytes)
        throw new CacheError("CACHE_UNAVAILABLE", "receipt exceeds local cache budget; original request freeze preserved");
      try { replaceReceiptFile(this.path(key), encoded); }
      catch (error) { throw new CacheError("CACHE_UNAVAILABLE", `receipt update failed: ${messageOf(error)}`); }
      return updated;
    });
  }
}
