/** FS-001..003: syscall ordering, not artifact authority or S-06 evidence.
 * Immutable publication and derived replacement are deliberately separate APIs.
 * These helpers neither modify a ledger nor collect accepted recovery evidence.
 */
import {
  constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync,
  readdirSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { assertDirectory, ensureDirectory } from "./directory.js";

export function fsyncDir(directory: string): void {
  assertDirectory(directory);
  const observed = lstatSync(directory);
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const current = fstatSync(fd);
    if (!current.isDirectory() || current.dev !== observed.dev || current.ino !== observed.ino)
      throw new StoreError("STORE_CORRUPT", `directory changed before fsync: ${directory}`);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

/** Flush newly created directory names from the deepest parent upward. Existing
 * modes are never rewritten. This is a persistence barrier, not a race-proof
 * capability to traverse an arbitrary directory tree.
 */
export function ensureDurableDirectory(directory: string, mode = 0o755): void {
  const created = ensureDirectory(directory, mode);
  for (const path of [...created].reverse()) {
    fsyncDir(path);
    fsyncDir(dirname(path));
  }
  // Fence an immediate parent even when another creator won mkdir's EEXIST.
  fsyncDir(directory);
  fsyncDir(dirname(directory));
}

export function fsyncFile(path: string): void {
  assertDirectory(dirname(path));
  const observed = lstatSync(path);
  if (!observed.isFile() || observed.isSymbolicLink())
    throw new StoreError("STORE_CORRUPT", `non-regular file: ${path}`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const current = fstatSync(fd);
    if (!current.isFile() || current.dev !== observed.dev || current.ino !== observed.ino)
      throw new StoreError("STORE_CORRUPT", `file changed before fsync: ${path}`);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

/** Only the exact name successfully created by this invocation may reach here.
 * ENOENT after an uncertain rename does not establish that replacement failed;
 * the original error still propagates and the parent is flushed either way.
 */
function cleanupOwnedTemporary(path: string): void {
  try { unlinkSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  fsyncDir(dirname(path));
}

function cleanupAfterFailure(path: string, failure: unknown): never {
  try { cleanupOwnedTemporary(path); }
  catch (cleanupFailure) {
    throw new AggregateError([failure, cleanupFailure], "filesystem effect and owned temporary cleanup both failed");
  }
  throw failure;
}

/** Exclusive open -> write -> file fsync -> close. A failed write owns and
 * removes only its partial name, then flushes its parent. After success the
 * caller owns the staging name and its later unlink/parent flush. No accepted
 * evidence is collected and no existing name is removed on an EEXIST failure.
 */
export function writeExclusiveFsyncedFile(path: string, bytes: string | Uint8Array, mode = 0o600): void {
  assertDirectory(dirname(path));
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  } catch (error) { cleanupAfterFailure(path, error); }
}

/** Derived-only replacement: exclusive temporary -> file fsync -> close ->
 * rename -> parent fsync. This function owns only its random temporary, never a
 * glob or an accepted source. A post-rename flush failure does not prove that
 * replacement did not happen; callers must not downgrade a durable operation.
 */
export function replaceDerivedFile(target: string, bytes: string | Uint8Array, mode = 0o600): void {
  ensureDurableDirectory(dirname(target));
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  let renamed = false;
  try {
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, target);
    renamed = true;
    fsyncDir(dirname(target));
  } catch (error) {
    if (!renamed) cleanupAfterFailure(temporary, error);
    throw error;
  }
}

export type TreeFlushPolicy = "regular-files" | "context-single-link" | "workspace-links";

/** The initial root is caller-owned and checked before opening. Descendants
 * are then addressed through held parent descriptors, not a recursive lookup
 * through pathnames already observed. This is still not an openat2/S-06 proof.
 * The default admits regular immutable hardlinks. Context adds nlink=1.
 * Workspace symlinks are never followed: their containing directory is flushed.
 * Current pointers use their separate parent-only publication primitive.
 */
export function fsyncTree(root: string, policy: TreeFlushPolicy = "regular-files"): void {
  assertDirectory(root);
  const walk = (path: string): void => {
    const observed = lstatSync(path);
    if (!observed.isDirectory()) throw new StoreError("STORE_CORRUPT", "invalid fsync tree directory");
    const directory = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(directory);
      if (!opened.isDirectory() || opened.dev !== observed.dev || opened.ino !== observed.ino)
        throw new StoreError("STORE_CORRUPT", "fsync tree directory changed before open");
      const pinned = `/proc/self/fd/${directory}`;
      for (const name of readdirSync(pinned)) {
        const child = join(pinned, name);
        const entry = lstatSync(child);
        if (entry.isDirectory()) { walk(child); continue; }
        if (entry.isSymbolicLink() && policy === "workspace-links") continue;
        if (!entry.isFile()) throw new StoreError("STORE_CORRUPT", `unsupported fsync tree entry: ${name}`);
        const file = openSync(child, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const current = fstatSync(file);
          if (!current.isFile() || current.dev !== entry.dev || current.ino !== entry.ino ||
            (policy === "context-single-link" && current.nlink !== 1))
            throw new StoreError("STORE_CORRUPT", `fsync tree identity/link mismatch: ${name}`);
          fsyncSync(file);
        } finally { closeSync(file); }
      }
      fsyncSync(directory);
    } finally { closeSync(directory); }
  };
  walk(root);
}
