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
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { sha256Hex } from "../domain/canonical-json.js";
import { StoreError } from "../domain/errors.js";
import {
  ensureDurableDirectory,
  faultAt,
  isDurabilityFault,
  type DurabilityObserver,
} from "./durable-fs.js";
import {
  entryAt,
  linkDescriptor,
  openBeneath,
  openDirectory,
  openRegularBeneath,
} from "./contained-fs.js";

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
export type ImmutableObservation =
  | { readonly kind: "present"; readonly bytes: Buffer }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable" | "corrupt"; readonly error: unknown };

/** Absence is evidence only on ENOENT, never on an inaccessible observer. */
export function observeImmutableFile(path: string, expectedHash: string, expectedBytes: number): ImmutableObservation {
  let parent: number | undefined;
  try {
    parent = openDirectory(dirname(path));
    const fd = openImmutable(parent, basename(path));
    try { return { kind: "present", bytes: checkedBytes(fd, expectedHash, expectedBytes).bytes }; }
    finally { closeSync(fd); }
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return { kind: "absent" };
    return { kind: error instanceof StoreError && error.code === "STORE_CORRUPT" ? "corrupt" : "unavailable", error };
  } finally { if (parent !== undefined) closeSync(parent); }
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
 */
export function publishImmutableFile(
  source: string,
  destination: string,
  expectedHash?: string,
  faults?: DurabilityObserver,
): void {
  const sourceParent = openDirectory(dirname(source));
  let sourceFd: number | undefined;
  let parent: number | undefined;
  let temporaryFd: number | undefined;
  let temporary: string | undefined;
  let crashed = false;
  try {
    sourceFd = openImmutable(sourceParent, basename(source));
    const original = checkedBytes(sourceFd, expectedHash);
    ensureDurableDirectory(dirname(destination), 0o755, faults);
    parent = openDirectory(dirname(destination));
    try {
      faultAt(faults, "publication-link", "before", destination);
      linkDescriptor(sourceFd, parent, basename(destination));
    } catch (error) {
      if (isDurabilityFault(error)) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        const name = `.${basename(destination)}.${randomUUID()}.tmp`;
        const label = join(dirname(destination), name);
        faultAt(faults, "file-create", "before", label);
        temporaryFd = openBeneath(
          parent,
          name,
          constants.O_RDWR |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
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
          linkDescriptor(temporaryFd, parent, basename(destination));
        } catch (publicationError) {
          if ((publicationError as NodeJS.ErrnoException).code !== "EEXIST")
            throw publicationError;
        }
      } else if (code !== "EEXIST") throw error;
    }
    faultAt(faults, "publication-link", "after-visible", destination);
    faultAt(faults, "destination-validate", "before", destination);
    const published = openImmutable(parent, basename(destination));
    try {
      checkedBytes(published, original.hash);
      fchmodSync(published, 0o444);
      fsyncSync(published);
    } finally {
      closeSync(published);
    }
    faultAt(faults, "destination-validate", "after-visible", destination);
    faultAt(faults, "directory-fsync", "ambiguous", dirname(destination));
    fsyncSync(parent);
    faultAt(faults, "directory-fsync", "after-visible", dirname(destination));
  } catch (error) {
    crashed = isDurabilityFault(error);
    throw error;
  } finally {
    try {
      if (temporary !== undefined && parent !== undefined && !crashed) {
        unlinkSync(entryAt(parent, temporary));
        faultAt(
          faults,
          "temporary-cleanup",
          "after-visible",
          join(dirname(destination), temporary),
        );
        fsyncSync(parent);
      }
    } finally {
      if (temporaryFd !== undefined) closeSync(temporaryFd);
      if (parent !== undefined) closeSync(parent);
      if (sourceFd !== undefined) closeSync(sourceFd);
      closeSync(sourceParent);
    }
  }
}
