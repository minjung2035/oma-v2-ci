/** Human-owned settings and session metadata, never a Society sandbox boundary.
 * Both kernels use the shared held-directory
 * publication policy; unsupported primitives refuse before effects. Mutable callers hold their own writer lock (P0-3).
 * No caller may interpret a failed read as an absent file. */
import { closeSync, fstatSync, readSync } from "node:fs";
import { StoreError } from "@oma/domain/errors";
import { withCleanup } from "@oma/native/cleanup";
import { decodeUtf8 } from "@oma/domain/utf8";
import { openRegularBeneath, withinDirectory } from "@oma/native/files";
import { ensureDurableDirectory, ensureOwnedDurableDirectory, publishNoReplace, replaceDerivedFile, type DurabilityObserver } from "@oma/storage/durable-fs";

export function ensureUserDirectory(path: string): void {
  ensureDurableDirectory(path, 0o700);
}

/** `ensureUserDirectory` for a path whose tail oma owns -- the package store
 * and the run directory of `oma pi` are oma's own. `ownedFrom` names the
 * first component oma itself made (the data root `…/oma`, the app's support
 * directory): every component from it down gets the owner-bits repair the
 * owned sweeps make, so a mode-000 store root cannot wedge the open the way
 * the plain walk did. The ancestors above it are the user's and are never
 * rewritten. `faults` observes the same durability boundaries on both kernels. */
export function ensureOwnedUserDirectory(path: string, ownedFrom: string, faults?: DurabilityObserver): void {
  ensureOwnedDurableDirectory(path, ownedFrom, 0o700, faults);
}

/** Immutable publications may still have their temporary hardlink after a crash.
 * Mutable engine settings instead require one name, checked on the open inode. */
export function readUserFile(path: string, bound: number, options: { readonly singleName?: boolean; readonly firstLine?: boolean } = {}): string | null {
  if (!Number.isSafeInteger(bound) || bound < 1) throw new StoreError("INTERNAL_ERROR", "invalid user file bound");
  let observed = false;
  const read = (fd: number): string => {
    observed = true;
    return withCleanup(() => {
      const before = fstatSync(fd);
      if (options.singleName && before.nlink !== 1)
        throw new StoreError("UNSUPPORTED_PROFILE", "user settings must have a single name");
      if (!before.isFile() || (!options.firstLine && before.size > bound))
        throw new StoreError("STORE_CORRUPT", "user metadata is not a bounded regular file");
      const bytes = Buffer.alloc(Math.min(before.size, bound) + 1); let used = 0, end = -1;
      while (used < bytes.length) {
        const count = readSync(fd, bytes, used, Math.min(bytes.length - used, options.firstLine ? 4096 : bytes.length), used);
        if (count === 0) break;
        if (options.firstLine) {
          const at = bytes.subarray(used, used + count).indexOf(10);
          if (at >= 0) end = used + at;
        }
        used += count;
        if (end >= 0) break;
        end = -1;
      }
      const after = fstatSync(fd);
      if ((!options.firstLine && used !== before.size) || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
        throw new StoreError("STORE_CORRUPT", "user metadata changed while being read");
      const length = end < 0 ? used : end;
      if (length > bound) throw new StoreError("STORE_CORRUPT", "user metadata exceeds its read bound");
      try { return decodeUtf8(bytes.subarray(0, length)); }
      catch (cause) { throw new StoreError("STORE_CORRUPT", "user metadata is not UTF-8", { cause }); }
    }, () => closeSync(fd));
  };
  try {
    return withinDirectory(path, (parent, name) => read(openRegularBeneath(parent, name)));
  } catch (error) { if (!observed && (error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** Immutable birth facts: a retry never replaces the bytes already named. */
export function publishUserFile(path: string, bytes: string): "created" | "existing" {
  return publishNoReplace(path, bytes);
}

/** Derived settings only; not for a session's mode or another birth fact. */
export function replaceUserFile(path: string, bytes: string): void {
  replaceDerivedFile(path, bytes);
}

/** Mutable engine files serialize through locked-files.js, the one locked
 * read-modify-replace over these guarantees (A7). */
