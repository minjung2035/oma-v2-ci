// FS/IPC: transport .wire copies and workflow upload.bundle names have different
// owners. No accepted name is unlinked by connection cleanup or a failed retry.
import {
  constants, closeSync, writeFileSync, readSync, fstatSync, lstatSync,
  fchmodSync, fsyncSync, unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import type { BlobDescriptor } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";
import { entryAt, openBeneath, openDirectory, openRegularBeneath } from "./contained-fs.js";
import { removeOwnedFile } from "./directory.js";
import type { PreacceptOwner } from "./preaccept-artifact.js";
import { ensureDurableDirectory, fsyncDir } from "./durable-fs.js";
import { submitStagingPathAt, submitBundlePathAt } from "./paths.js";

export interface FrozenBundle { readonly path: string; readonly bytes: number; readonly sha256: string }
export type BundleObservation =
  | { readonly kind: "present" }
  | { readonly kind: "absent" }
  | { readonly kind: "corrupt"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string };
function code(error: unknown): string | null {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}
export class PreparedSubmitSpool implements PreacceptOwner {
  private owner: "preaccept" | "accepted" | "released" = "preaccept";
  constructor(readonly bundle: FrozenBundle | null) {}
  /** Called on durable acceptance or uncertainty about whether T committed. */
  retainForOperation(): void {
    if (this.owner === "released") throw new StoreError("INTERNAL_ERROR", "released bundle cannot become accepted evidence");
    this.owner = "accepted";
  }
  /** The caller must first establish that this operation was NOT accepted. */
  discardUnaccepted(): void {
    if (this.owner !== "preaccept") return;
    this.owner = "released";
    if (this.bundle) removeOwnedFile(this.bundle.path);
  }
}

export async function prepareSubmitSpool(
  stateRoot: string, operationId: string, descriptor: BlobDescriptor | undefined,
  chunks: AsyncIterable<Uint8Array>,
): Promise<PreparedSubmitSpool> {
  if (descriptor !== undefined && (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0 ||
      !/^[0-9a-f]{64}$/.test(descriptor.sha256) || descriptor.mediaType !== "application/x-git-bundle"))
    throw new StoreError("STREAM_INVALID", "invalid bundle descriptor");
  const frozenDescriptor = descriptor === undefined ? null : Object.freeze({ bytes: descriptor.bytes, sha256: descriptor.sha256 });
  const staging = submitStagingPathAt(stateRoot, operationId);
  ensureDurableDirectory(staging, 0o700);
  if (frozenDescriptor === null) {
    for await (const chunk of chunks) {
      if (!(chunk instanceof Uint8Array) || chunk.byteLength !== 0)
        throw new StoreError("STREAM_INVALID", "raw bundle bytes require a descriptor");
    }
    return new PreparedSubmitSpool(null);
  }
  const path = submitBundlePathAt(stateRoot, operationId);
  // No name is owned if exclusive creation fails; never delete an existing file.
  const parent = openDirectory(staging);
  let fd: number;
  try { fd = openBeneath(parent, basename(path), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { closeSync(parent); throw error; }
  try {
    try {
      const hash = createHash("sha256"); let total = 0;
      for await (const chunk of chunks) {
        if (!(chunk instanceof Uint8Array) || chunk.byteLength > frozenDescriptor.bytes - total)
          throw new StoreError("STREAM_INVALID", "bundle exceeds its declared byte count");
        writeFileSync(fd, chunk); hash.update(chunk); total += chunk.byteLength;
      }
      if (total !== frozenDescriptor.bytes || hash.digest("hex") !== frozenDescriptor.sha256)
        throw new StoreError("STREAM_INVALID", "bundle bytes or digest do not match the descriptor");
      fchmodSync(fd, 0o444);
      fsyncSync(fd);
      const current = lstatSync(entryAt(parent, basename(path))); const pinned = fstatSync(fd);
      if (!current.isFile() || current.dev !== pinned.dev || current.ino !== pinned.ino)
        throw new StoreError("STORE_CORRUPT", "prepared bundle name changed identity");
    } finally { closeSync(fd); }
    fsyncSync(parent); fsyncDir(dirname(staging));
  } catch (error) {
    try { unlinkSync(entryAt(parent, basename(path))); fsyncSync(parent); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "bundle preparation and owned cleanup failed"); }
    throw error;
  } finally { closeSync(parent); }
  return new PreparedSubmitSpool(Object.freeze({ path, ...frozenDescriptor }));
}

/** Read-time trust boundary: hash one contained single-link descriptor and keep
 * it through the handoff. A same-UID in-place writer is not stopped by fd pinning.
 * An I/O failure is not absence, and none of this closes S-06.
 */
function openVerifiedBundle(bundle: FrozenBundle): number {
  const parent = openDirectory(dirname(bundle.path));
  let fd: number | undefined;
  try {
    const named = lstatSync(entryAt(parent, basename(bundle.path)));
    if (!named.isFile() || named.nlink !== 1 || named.size !== bundle.bytes)
      throw new StoreError("STORE_CORRUPT", "bundle type, link count or length changed");
    fd = openRegularBeneath(parent, basename(bundle.path));
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.dev !== named.dev || before.ino !== named.ino || before.size !== bundle.bytes)
      throw new StoreError("STORE_CORRUPT", "bundle identity changed before open");
    const hash = createHash("sha256"); const buffer = Buffer.alloc(64 * 1024);
    let total = 0;
    while (true) {
      const read = readSync(fd, buffer, 0, Math.min(buffer.length, bundle.bytes - total + 1), total);
      if (read === 0) break;
      total += read;
      if (total > bundle.bytes) throw new StoreError("STORE_CORRUPT", "bundle grew while being read");
      hash.update(buffer.subarray(0, read));
    }
    const after = fstatSync(fd); const currentName = lstatSync(entryAt(parent, basename(bundle.path)));
    if (total !== bundle.bytes || hash.digest("hex") !== bundle.sha256 ||
      after.nlink !== 1 || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
      currentName.dev !== before.dev || currentName.ino !== before.ino || !currentName.isFile())
      throw new StoreError("STORE_CORRUPT", "accepted bundle bytes or identity changed");
    return fd;
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    throw error;
  } finally { closeSync(parent); }
}
export function observeFrozenBundle(bundle: FrozenBundle): BundleObservation {
  try { closeSync(openVerifiedBundle(bundle)); return { kind: "present" }; }
  catch (error) {
    if (code(error) === "ENOENT") return { kind: "absent" };
    if (error instanceof StoreError && error.code === "STORE_CORRUPT" || code(error) === "ELOOP")
      return { kind: "corrupt", reason: "unsafe bundle path, bytes or identity" };
    return { kind: "unavailable", reason: `bundle observation failed${code(error) ? ` (${code(error)})` : ""}` };
  }
}
/** The descriptor stays owned until the asynchronous consumer has received it.
 * A spawned consumer must inherit this fd; it must not use bundle.path instead.
 */
export async function withFrozenBundle(bundle: FrozenBundle, consume: (fd: number) => void | Promise<void>): Promise<void> {
  let fd: number;
  try { fd = openVerifiedBundle(bundle); }
  catch (error) {
    if (error instanceof StoreError) throw error;
    if (code(error) === "ENOENT") throw new StoreError("STORE_CORRUPT", "accepted bundle is missing");
    throw new StoreError("REF_STATE_UNKNOWN", "accepted bundle could not be opened for handoff");
  }
  try { await consume(fd); } finally { closeSync(fd); }
}
export function requireFrozenBundle(bundle: FrozenBundle): void {
  const observation = observeFrozenBundle(bundle);
  if (observation.kind === "present") return;
  if (observation.kind === "unavailable") throw new StoreError("REF_STATE_UNKNOWN", observation.reason);
  throw new StoreError("STORE_CORRUPT", observation.kind === "absent" ? "accepted bundle is missing" : observation.reason);
}
