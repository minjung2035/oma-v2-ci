// MUST [FS-003]/[IPC-006/008]: ordinary caller homes hold model-mutable
// preaccept caches, not effect ledgers or authority. Host invocation APIs require
// a separately selected home outside every model-writable mount.
import { readFileSync, openSync, closeSync, fstatSync, lstatSync, constants } from "node:fs";

import { join } from "node:path";
import type { Receipt, RequestKey } from "@oma/contracts";
import { isValidRequestKey } from "@oma/domain/identifiers";
import { requestParamsEqual } from "@oma/domain/request-identity";
import { sha256Hex, snapshotJson } from "@oma/domain/canonical-json";
import { parseJsonObject } from "@oma/protocol/frame";
import { decodeReceipt, receiptSupersession, receiptFactConflict } from "@oma/protocol/receipt-codec";
import { decodeInvocationRejection } from "@oma/protocol/invocation-rejection";
import type { InvocationRejection } from "@oma/contracts/public-wire";
import { decodeFrozenInvocationResolution } from "@oma/protocol/invocation-resolution";
import { decodeFrozenSubmission } from "@oma/protocol/invocation-submission";
import { decodeCachedRequest, decodeStreamDigest, type CachedRequest, type StreamDigest } from "./runtime/request-cache-codec.js";
import { canonicalCollaborationJson } from "@oma/domain/collaboration-targets";
import { listOwnedDirectory } from "@oma/storage/directory";
import { decodeInvocationBinding, invocationFreezeSha256, invocationFreezeMatches, newInvocationBinding,
  type InvocationBinding, type InvocationIdentity } from "./runtime/invocation-codec.js";
import type { MutationMethod } from "@oma/contracts";
import type { FreshBuild, RequestOptions } from "@oma/client/request-service";
import { ensureOwnedDurableDirectoryBeneath, publishNoReplace, replaceDerivedFile as replaceReceiptFile } from "@oma/storage/durable-fs";
import { openBeneath, withinDirectory } from "@oma/native/files";
import { lockFileDescriptor } from "@oma/native/linux";

export type { CachedRequest, StreamDigest } from "./runtime/request-cache-codec.js";
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

  /** Called by mutation composition before its first cache observation. Read-only
   * diagnostics still use read() directly and never repair filesystem state. */
  prepare(): this {
    try { this.ensureDir(); }
    catch (error) { throw new CacheError("CACHE_UNAVAILABLE", `request cache preparation failed: ${messageOf(error)}`); }
    return this;
  }
  private dir(): string { return join(this.homeDir, ".local", "state", "oma", "requests"); }
  /** P0-8: `.local/state/oma` is the first component oma itself made inside
   * the caller's home -- `.local` and `.local/state` are the user's shared
   * XDG names, never repaired -- and a mode-000 cache directory beneath the
   * boundary is repaired rather than wedged on. The home itself is its launch
   * owner's, already durable; a confined engine cannot open what lies above. */
  private ensureDir(): void {
    ensureOwnedDurableDirectoryBeneath(this.dir(), join(this.homeDir, ".local", "state", "oma"), this.homeDir, 0o700);
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
    this.replayBarrier();
    return { kind: "existing", value: frozen };
  }

  /** Flush after observing an existing publication, not merely before reading:
   * a competing writer may have linked it since prepare(). No acceptance fact. */
  private replayBarrier(): void {
    try { this.ensureDir(); }
    catch (error) { throw new CacheError("CACHE_UNAVAILABLE", `replay durability barrier failed: ${messageOf(error)}`); }
  }

  /** Never creates metadata: disappearance during a replay is not a fresh key. */
  prepareReplay(input: FreezeInput): CachedRequest {
    const request = freezeInput(input);
    this.prepare();
    return this.existing(request, this.read(input.key)).value;
  }

  /**
   * Initial freeze only. Body fsync/publication precedes metadata publication.
   * The two files are NOT one filesystem transaction. A body-only crash is
   * retained as an ambiguous orphan; no new payload is reconstructed for its key.
   */
  freeze(input: FreezeInput, body?: Uint8Array): FreezeResult {
    const request = freezeInput(input);
    this.prepare();
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

  /** Transport-only handoff after the host has checked the exact canonical
   * publication child. Copies already protected metadata, never a new source
   * freeze or proof of acceptance. The obsolete bundle is neither rebuilt nor
   * published; ordinary freeze()/prepareReplay() keep requiring their body. */
  restorePublishedSubmissionMetadata(input: FreezeInput): FreezeResult {
    const request = freezeInput(input);
    if (request.method !== "attest.record" || !decodeFrozenSubmission(request.params, request.key).ok)
      throw new CacheError("INVALID_REQUEST", "metadata-only handoff requires an original compound submission");
    const encoded = JSON.stringify(request);
    if (Buffer.byteLength(encoded) > this.metadataBytes)
      throw new CacheError("CACHE_UNAVAILABLE", "original metadata exceeds the transport cache budget");
    const existing = (observed: CacheRead): FreezeResult => {
      const value = requirePresent(observed, "original transport metadata");
      if (value.createdAtMs !== request.createdAtMs || invocationFreezeSha256(value) !== invocationFreezeSha256(request))
        throw new CacheError("REQUEST_KEY_REUSED", "existing transport metadata differs from the protected original");
      this.replayBarrier();
      return { kind: "existing", value };
    };
    this.prepare();
    const current = this.read(request.key);
    if (current.kind === "present") return existing(current);
    if (current.kind !== "absent") requirePresent(current, "original transport cache handoff");
    try {
      const published = publishNoReplace(this.path(request.key), encoded);
      return published === "created" ? { kind: "created", value: request } : existing(this.read(request.key));
    } catch (error) {
      if (error instanceof CacheError) throw error;
      throw new CacheError("CACHE_UNAVAILABLE", `original transport metadata handoff failed: ${messageOf(error)}`);
    }
  }

  /** Protected first publication shares the original-key hold with preaccept
   * closure. Ordinary caller caches still use freeze(), without effect authority. */
  freezeInvocation(input: FreezeInput, body?: Uint8Array): FreezeResult {
    return this.withReceiptLock(input.key, () => {
      const binding = requirePresent(this.readInvocation(input.key), "original source publication binding");
      if (binding.phase !== "bound" || binding.frozen !== null || binding.receipt !== null ||
          binding.resolution !== undefined || binding.rejection !== undefined)
        throw new CacheError("CACHE_CORRUPT", "a prepared or completed original cannot acquire a fresh source freeze");
      if (input.method !== binding.method || input.createdAtMs !== binding.createdAtMs)
        throw new CacheError("REQUEST_KEY_REUSED", "protected source publication differs from its original binding");
      const result = this.freeze(input, body);
      if (!invocationFreezeMatches(binding, result.value))
        throw new CacheError("CACHE_CORRUPT", "original invocation freeze identity changed");
      return result;
    });
  }

  invocationOptions(key: RequestKey): RequestOptions {
    requirePresent(this.readInvocation(key), "original invocation options");
    return Object.freeze({
      beforePrepare: () => {
        const binding = requirePresent(this.readInvocation(key), "original preparation binding");
        if (binding.phase !== "bound" || binding.frozen !== null || binding.receipt !== null)
          throw new CacheError("CACHE_CORRUPT", "original frozen metadata disappeared; no source reconstruction permitted");
      },
      beforeFreeze: async (fresh: FreshBuild) => {
        const binding = requirePresent(this.readInvocation(key), "original source publication binding");
        this.freezeInvocation({ key, method: fresh.method, params: snapshotJson(fresh.params), createdAtMs: binding.createdAtMs,
          ...(fresh.digest === undefined ? {} : { digest: fresh.digest }) }, fresh.stream);
      },
      beforeSend: async (request: CachedRequest) => {
        if (request.key !== key) throw new CacheError("REQUEST_KEY_REUSED", "invocation hook belongs to a different request key");
        this.markInvocationSending(key);
      },
      onReceipt: (receipt: Receipt) => { this.recordInvocationReceipt(key, receipt); },
    });
  }

  /** Host-only linkage: the host must supply a protected home outside every
   * writable Worker mount. This cache grants no authority and runs no executor. */
  readInvocation(key: RequestKey): FileObservation<InvocationBinding> {
    if (!/^inv1-[a-f0-9]{64}$/.test(key)) return { kind: "corrupt", reason: "invalid invocation key" };
    const bytes = this.reader(this.invocationPath(key), undefined, this.metadataBytes);
    if (bytes.kind !== "present") return bytes;
    try {
      const decoded = decodeInvocationBinding(parseJsonObject(bytes.value).raw, key);
      if (!decoded.ok) return { kind: "corrupt", reason: decoded.reason };
      if (!Buffer.from(bytes.value).equals(Buffer.from(canonicalCollaborationJson(decoded.value))))
        return { kind: "corrupt", reason: "invocation bytes are not canonical" };
      return { kind: "present", value: decoded.value };
    } catch (error) { return { kind: "corrupt", reason: messageOf(error) }; }
  }
  bindInvocation(identity: InvocationIdentity, tool: string, method: MutationMethod, args: unknown): InvocationBinding {
    const created = newInvocationBinding(identity, tool, method, args);
    return this.withReceiptLock(created.key, () => {
      const previous = this.readInvocation(created.key);
      if (previous.kind === "present") {
        if (previous.value.argsSha256 !== created.argsSha256 || previous.value.tool !== tool || previous.value.method !== method)
          throw new CacheError("REQUEST_KEY_REUSED", "original tool-call binding already has different tool or arguments");
        return previous.value;
      }
      if (previous.kind !== "absent") return requirePresent(previous, "original invocation binding");
      const text = canonicalCollaborationJson(created);
      if (Buffer.byteLength(text) > this.metadataBytes) throw new CacheError("CACHE_UNAVAILABLE", "invocation linkage exceeds the request metadata budget");
      if (publishNoReplace(this.invocationPath(created.key), text) === "existing")
        return requirePresent(this.readInvocation(created.key), "competing invocation publication");
      return created;
    });
  }
  private invocationPath(key: RequestKey): string { return this.path(key).replace(/\.json$/, ".invocation.json"); }
  private writeInvocation(record: InvocationBinding): InvocationBinding {
    const decoded = decodeInvocationBinding(record, record.key);
    if (!decoded.ok) throw new CacheError("CACHE_CORRUPT", decoded.reason);
    const text = canonicalCollaborationJson(decoded.value);
    if (Buffer.byteLength(text) > this.metadataBytes) throw new CacheError("CACHE_UNAVAILABLE", "original invocation observation exceeds the metadata budget");
    replaceReceiptFile(this.invocationPath(record.key), text);
    return decoded.value;
  }
  /** Read-only enumeration of protected linkage, not a work queue. Each binding
   * is decoded transiently; callers need not retain raw source arguments. */
  *invocationRecords(): IterableIterator<InvocationBinding> {
    const entries = listOwnedDirectory(this.dir(), { required: true });
    const names = new Set(entries.map(entry => entry.name));
    for (const entry of entries) {
      const ownedFreeze = /^(inv1-[a-f0-9]{64})\.(?:json|body)$/.exec(entry.name);
      if (ownedFreeze !== null && !names.has(`${ownedFreeze[1]}.invocation.json`))
        throw new CacheError("CACHE_CORRUPT", "original invocation binding disappeared beside a frozen request; admission remains fenced");
    }
    for (const entry of entries) {
      if (!entry.name.endsWith(".invocation.json")) continue;
      const match = /^(inv1-[a-f0-9]{64})\.invocation\.json$/.exec(entry.name);
      if (match === null || !entry.isFile()) throw new CacheError("CACHE_CORRUPT", "unverifiable invocation entry; admission remains fenced");
      yield requirePresent(this.readInvocation(match[1]!), "protected invocation observation");
    }
  }
  /** Enumerates observations for admission fences, not a durable work queue. */
  pendingInvocations(): readonly InvocationBinding[] {
    const pending: InvocationBinding[] = [];
    for (const record of this.invocationRecords()) if (record.phase === "sending" && record.receipt === null) pending.push(record);
    return pending;
  }
  private checkedInvocationFreeze(binding: InvocationBinding): CachedRequest {
    const request = requirePresent(this.read(binding.key), "original invocation freeze");
    if (!invocationFreezeMatches(binding, request))
      throw new CacheError("CACHE_CORRUPT", "original invocation freeze identity changed");
    if (request.digest) requirePresent(this.readBody(binding.key, request.digest), "original invocation frozen body");
    return request;
  }
  /** Complete a no-effect invocation from its already protected exact evidence.
   * This never observes current sources or creates an accepted operation. */
  resolveInvocation(key: RequestKey): InvocationBinding {
    return this.withReceiptLock(key, () => {
      const binding = requirePresent(this.readInvocation(key), "original no-effect binding");
      if (binding.rejection !== undefined) throw new CacheError("CACHE_CORRUPT", "a closed-before-send invocation cannot acquire another no-effect completion");
      const request = this.checkedInvocationFreeze(binding), decoded = decodeFrozenInvocationResolution(request.params);
      if (request.method !== "attest.record" || !decoded.ok || binding.receipt !== null ||
          request.lastReceipt !== null || binding.phase === "sending")
        throw new CacheError("CACHE_CORRUPT", "original invocation cannot become a no-effect resolution");
      if (binding.resolution !== undefined) {
        if (canonicalCollaborationJson(binding.resolution) !== canonicalCollaborationJson(decoded.value))
          throw new CacheError("CACHE_CORRUPT", "original no-effect resolution changed");
        return binding;
      }
      return this.writeInvocation({ ...binding, phase: "resolved", frozen: { requestSha256: invocationFreezeSha256(request) }, resolution: decoded.value });
    });
  }
  /** Close only an unprepared original. The host's synchronous callback proves
   * canonical absence under this same protected-key hold; no queue/effect exists. */
  rejectInvocation(key: RequestKey, rejection: InvocationRejection, beforeReject: () => undefined): InvocationBinding {
    return this.withReceiptLock(key, () => {
      const binding = requirePresent(this.readInvocation(key), "original preaccept completion binding");
      if (binding.rejection !== undefined) return binding;
      const decoded = decodeInvocationRejection(rejection);
      if (!decoded.ok || binding.phase !== "bound" || binding.frozen !== null || binding.receipt !== null || binding.resolution !== undefined)
        throw new CacheError("CACHE_CORRUPT", "an original invocation that may have prepared or sent cannot become a preaccept rejection");
      const frozen = this.read(key);
      if (frozen.kind !== "absent") throw new CacheError(frozen.kind === "unavailable" ? "CACHE_UNAVAILABLE" : "CACHE_CORRUPT",
        "original protected freeze is not proven absent; no preaccept rejection is permitted");
      if (beforeReject() !== undefined) throw new CacheError("CACHE_CORRUPT", "original preaccept completion guard must be synchronous");
      return this.writeInvocation({ ...binding, phase: "rejected", rejection: decoded.value });
    });
  }
  pinInvocationCreation(key: RequestKey, creation: import("@oma/contracts/values").CreateResolution): InvocationBinding {
    return this.withReceiptLock(key, () => {
      const binding = requirePresent(this.readInvocation(key), "original creation binding");
      if (binding.method !== "agent.create") throw new CacheError("CACHE_CORRUPT", "creation resolution belongs to another action");
      if (binding.creation !== undefined) {
        if (canonicalCollaborationJson(binding.creation) !== canonicalCollaborationJson(creation))
          throw new CacheError("REQUEST_KEY_REUSED", "original creation resolution cannot change");
        return binding;
      }
      if (binding.phase !== "bound" || binding.frozen !== null || binding.receipt !== null)
        throw new CacheError("CACHE_CORRUPT", "completed original creation lost its frozen resolution");
      return this.writeInvocation({ ...binding, creation });
    });
  }
  sealInvocation(key: RequestKey): InvocationBinding {
    return this.withReceiptLock(key, () => {
      const binding = requirePresent(this.readInvocation(key), "original invocation binding");
      if (binding.rejection !== undefined) return binding;
      const request = this.checkedInvocationFreeze(binding);
      if (binding.frozen !== null || binding.phase === "observed") return binding;
      return this.writeInvocation({ ...binding, phase: "frozen", frozen: { requestSha256: invocationFreezeSha256(request) } });
    });
  }
  /** Called only from RequestService's beforeSend hook: its original-key lookup
   * owns resend admission. Persisting this marker is not proof of network send. */
  markInvocationSending(key: RequestKey): InvocationBinding {
    this.sealInvocation(key);
    return this.withReceiptLock("invocation-admission", () => {
      const current = requirePresent(this.readInvocation(key), "original invocation binding");
      if (current.phase === "resolved" || current.phase === "rejected") throw new CacheError("CACHE_CORRUPT", "a completed no-effect invocation cannot send");
      for (const other of this.pendingInvocations()) {
        if (other.key === key) continue;
        if (other.societyBirth !== current.societyBirth || other.actor !== current.actor)
          throw new CacheError("CACHE_CORRUPT", "host invocation cache mixes authenticated scopes");
        const local = this.read(other.key);
        if (local.kind === "present" && local.value.lastReceipt !== null) continue;
        if ((other.tool === current.tool && other.argsSha256 === current.argsSha256) ||
            (["oma_send", "oma_spawn"].includes(current.tool) && other.tool === current.tool))
          throw new CacheError("CACHE_UNAVAILABLE", `Original invocation ${other.key} is unresolved; no new execution`);
      }
      return this.withReceiptLock(key, () => {
        const binding = requirePresent(this.readInvocation(key), "original invocation send marker");
        if (binding.phase === "resolved" || binding.phase === "rejected")
          throw new CacheError("CACHE_CORRUPT", "a completed no-effect invocation cannot send");
        const request = this.checkedInvocationFreeze(binding);
        if (binding.receipt !== null || request.lastReceipt !== null)
          throw new CacheError("CACHE_CORRUPT", "broker absence contradicts an already observed original receipt");
        return binding.phase === "sending" ? binding : this.writeInvocation({ ...binding, phase: "sending" });
      });
    });
  }
  recordInvocationReceipt(key: RequestKey, receipt: Receipt): InvocationBinding {
    return this.withReceiptLock(key, () => {
      const binding = requirePresent(this.readInvocation(key), "original invocation receipt linkage");
      if (binding.phase === "resolved" || binding.phase === "rejected") throw new CacheError("CACHE_CORRUPT", "a no-effect invocation cannot acquire an accepted receipt");
      const decoded = decodeReceipt(receipt, { expectedKind: binding.method });
      if (!decoded.ok) throw new CacheError("CACHE_CORRUPT", decoded.reason);
      if (receiptFactConflict(binding.receipt, decoded.value))
        throw new CacheError("CACHE_CORRUPT", "original receipt contradicts the protected acceptance fact");
      const cached = this.read(key);
      if (cached.kind === "present" && cached.value.lastReceipt !== null) {
        if (receiptFactConflict(cached.value.lastReceipt, decoded.value))
          throw new CacheError("CACHE_CORRUPT", "original receipt contradicts the frozen cache observation");
      }
      const order = receiptSupersession(binding.receipt, decoded.value);
      if (order === "contradiction") throw new CacheError("CACHE_CORRUPT", "original operation has contradictory receipts");
      if (order === "stale") return binding;
      if (binding.receipt !== null && canonicalCollaborationJson(binding.receipt) === canonicalCollaborationJson(decoded.value)) return binding;
      return this.writeInvocation({ ...binding, phase: "observed", receipt: decoded.value });
    });
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
