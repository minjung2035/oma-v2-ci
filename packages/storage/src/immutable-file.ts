import { unlinkAt } from "@oma/native/posix-files";
import type { ImmutableObservation } from "@oma/contracts/files";
/** MAIL-004..006 / FS-002: immutable bytes, never a derived overwrite API.
 * Mail permits hardlinks. Keep checked descriptors through publication; names
 * are directory-relative and source linkat consumes the checked inode itself.
 */
import {
  constants,
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  readSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { sha256Hex } from "@oma/domain/canonical-json";
import { StoreError, normalizeStorageFailure } from "@oma/domain/errors";
import { cleanupAll, withCleanup } from "@oma/native/cleanup";
import {
  collectDeadTemporaries,
  createLockedTemporary,
  ensureOwnedDurableDirectory,
  faultAt,
  isDurabilityFault,
  temporaryNameFor,
  type DurabilityObserver,
} from "./durable-fs.js";
import { linkDescriptor, openDirectory, openRegularBeneath } from "@oma/native/files";
import type { PublishedIdentity } from "./preaccept-artifact.js";

function checkedBytes(
  fd: number,
  expectedHash?: string,
  expectedBytes?: number,
): { bytes: Buffer; hash: string } {
  const before = fstatSync(fd);
  if (
    !before.isFile() ||
    !Number.isSafeInteger(before.size) ||
    before.size < 0 ||
    (expectedBytes !== undefined && before.size !== expectedBytes)
  )
    throw new StoreError(
      "STORE_CORRUPT",
      "immutable file type or size mismatch",
    );
  const parts: Buffer[] = [];
  let remaining = before.size;
  while (remaining > 0) {
    const part = Buffer.allocUnsafe(Math.min(remaining, 64 * 1024));
    const count = readSync(fd, part, 0, part.length, before.size - remaining);
    if (count === 0)
      throw new StoreError("STORE_CORRUPT", "immutable file truncated");
    parts.push(part.subarray(0, count));
    remaining -= count;
  }
  if (readSync(fd, Buffer.allocUnsafe(1), 0, 1, before.size) !== 0)
    throw new StoreError("STORE_CORRUPT", "immutable file grew");
  const after = fstatSync(fd);
  if (
    !after.isFile() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  )
    throw new StoreError("STORE_CORRUPT", "immutable file bytes changed");
  const bytes = Buffer.concat(parts, before.size);
  const hash = sha256Hex(bytes);
  if (expectedHash !== undefined && hash !== expectedHash)
    throw new StoreError("STORE_CORRUPT", "immutable file hash mismatch");
  return { bytes, hash };
}
function openImmutable(directory: number, name: string): number {
  return openRegularBeneath(directory, name);
}
function readImmutableEntry(parent: number, name: string, expectedHash: string, expectedBytes: number): Buffer {
  const fd = openImmutable(parent, name);
  return withCleanup(() => checkedBytes(fd, expectedHash, expectedBytes).bytes, () => closeSync(fd));
}
/** Absence is evidence only on ENOENT, never on an inaccessible observer. */
export function observeImmutableFile(path: string, expectedHash: string, expectedBytes: number): ImmutableObservation {
  try {
    const parent = openDirectory(dirname(path));
    const bytes = withCleanup(() => readImmutableEntry(parent, basename(path), expectedHash, expectedBytes), () => closeSync(parent));
    return { kind: "present", bytes };
  } catch (error) {
    return failedObservation(error);
  }
}
/** The same observation of one entry of a directory the caller already holds,
 * so the caller can observe and then act under one resolution (FS-005, INV09). */
export function observeImmutableEntry(parent: number, name: string, expectedHash: string, expectedBytes: number): ImmutableObservation {
  try {
    return { kind: "present", bytes: readImmutableEntry(parent, name, expectedHash, expectedBytes) };
  } catch (error) { return failedObservation(error); }
}
function failedObservation(error: unknown): ImmutableObservation {
  error = normalizeStorageFailure(error);
  if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return { kind: "absent" };
  return { kind: error instanceof StoreError && error.code === "STORE_CORRUPT" ? "corrupt" : "unavailable", error };
}

/** Consumers parse these checked bytes, never reopen the checked pathname.
 * For accepted immutable evidence, proven absence is corruption. */
export function readImmutableBytes(path: string, expectedHash: string, expectedBytes: number): Buffer {
  const observed = observeImmutableFile(path, expectedHash, expectedBytes);
  switch (observed.kind) {
    case "present": return observed.bytes;
    case "absent": throw new StoreError("STORE_CORRUPT", "immutable file is missing");
    case "corrupt": throw observed.error;
    case "unavailable":
      if (observed.error instanceof StoreError) throw observed.error;
      throw new StoreError("BROKER_UNAVAILABLE", "immutable file observation is unavailable", { cause: observed.error });
  }
}

/** Same name/bytes = idempotent; different bytes/type = corruption. Source
 * ownership is not transferred, and accepted evidence is never collected here.
 * The caller still owns source cleanup. Same-inode writes remain outside this
 * namespace guarantee; a readonly mode alone is not a same-UID write boundary.
 * `linked` hears the inode this call itself put at the destination, before it
 * is validated or flushed; an existing destination is never reported.
 */
function publishImmutable(
  source: string,
  destination: string,
  expectedHash?: string,
  faults?: DurabilityObserver,
  linked?: (identity: PublishedIdentity) => void,
  held?: { readonly directory: number; readonly name: string },
): void {
  const sourceParent = openDirectory(dirname(source));
  let sourceFd: number | undefined;
  let parent: number | undefined;
  let temporaryFd: number | undefined;
  let temporary: string | undefined;
  let crashed = false;
  withCleanup(() => {
    try {
      sourceFd = openImmutable(sourceParent, basename(source));
      const original = checkedBytes(sourceFd, expectedHash);
      // P0-8: every caller's destination names an oma-owned mail directory. The
      // boundary the callers share is not this helper's to know, so the parent
      // itself is the boundary: its leaf is oma-made (mail/objects, an inbox's
      // new/cur/tmp, the archive) and is repaired; a mode-000 ancestor above it
      // refuses, and the provisioning ensure repairs those at start.
      if (held === undefined) ensureOwnedDurableDirectory(dirname(destination), dirname(destination), 0o755, faults);
      parent = held?.directory ?? openDirectory(dirname(destination));
      const destinationName = held?.name ?? basename(destination);
      // P0V-96: a copy killed before its temporary was removed left it with a
      // free lock; every publication of this name collects it first -- one
      // whose destination already exists never reaches the copying path.
      collectDeadTemporaries(parent);
      const report = (fd: number): void => {
        const stat = fstatSync(fd);
        linked?.({ dev: stat.dev, ino: stat.ino });
      };
      try {
        faultAt(faults, "publication-link", "before", destination);
        linkDescriptor(sourceFd, parent, destinationName);
        report(sourceFd);
      } catch (error) {
        if (isDurabilityFault(error)) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EXDEV") {
          const name = temporaryNameFor(basename(destination));
          const label = join(dirname(destination), name);
          faultAt(faults, "file-create", "before", label);
          temporaryFd = createLockedTemporary(parent, name, constants.O_RDWR, 0o600);
          temporary = name;
          faultAt(faults, "file-create", "after-visible", label);
          faultAt(faults, "file-write", "before", label);
          writeFileSync(temporaryFd, original.bytes);
          faultAt(faults, "file-write", "ambiguous", label);
          faultAt(faults, "file-fsync", "ambiguous", label);
          fsyncSync(temporaryFd);
          faultAt(faults, "file-fsync", "after-visible", label);
          checkedBytes(temporaryFd, original.hash);
          try {
            linkDescriptor(temporaryFd, parent, destinationName);
            report(temporaryFd);
          } catch (publicationError) {
            if ((publicationError as NodeJS.ErrnoException).code !== "EEXIST")
              throw publicationError;
          }
        } else if (code !== "EEXIST") throw error;
      }
      faultAt(faults, "publication-link", "after-visible", destination);
      faultAt(faults, "destination-validate", "before", destination);
      const published = openImmutable(parent, destinationName);
      withCleanup(() => {
        checkedBytes(published, original.hash);
        fchmodSync(published, 0o444);
        fsyncSync(published);
      }, () => closeSync(published));
      faultAt(faults, "destination-validate", "after-visible", destination);
      faultAt(faults, "directory-fsync", "ambiguous", dirname(destination));
      fsyncSync(parent);
      faultAt(faults, "directory-fsync", "after-visible", dirname(destination));
    } catch (error) {
      crashed = isDurabilityFault(error);
      throw error;
    }
  }, () => withCleanup(() => {
    if (temporary !== undefined && parent !== undefined && !crashed) {
      unlinkAt(parent, temporary);
      faultAt(
        faults,
        "temporary-cleanup",
        "after-visible",
        join(dirname(destination), temporary),
      );
      fsyncSync(parent);
    }
  }, () => cleanupAll([temporaryFd, held === undefined ? parent : undefined, sourceFd, sourceParent]
    .map(fd => () => { if (fd !== undefined) closeSync(fd); }))));
}

/** Publish under a pathname owned by this call; source validation still
 * precedes destination creation and every held descriptor closes here. */
export function publishImmutableFile(source: string, destination: string, expectedHash?: string,
    faults?: DurabilityObserver, linked?: (identity: PublishedIdentity) => void): void {
  try { publishImmutable(source, destination, expectedHash, faults, linked); }
  catch (error) { throw normalizeStorageFailure(error); }
}
/** The caller owns and retains this destination directory. Reuse the same
 * exact publication mechanism without resolving its pathname again. */
export function publishImmutableEntry(source: string, directory: number, name: string, destinationLabel: string,
    expectedHash?: string, faults?: DurabilityObserver, linked?: (identity: PublishedIdentity) => void): void {
  try { publishImmutable(source, destinationLabel, expectedHash, faults, linked, {directory, name}); }
  catch (error) { throw normalizeStorageFailure(error); }
}
