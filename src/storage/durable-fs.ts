// FS-001..003 / P7: syscall ordering, not artifact authority or S-06 evidence.
// Immutable publication and derived replacement are deliberately separate APIs.
// These helpers neither modify a ledger nor collect accepted recovery evidence.
import {
  constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync,
  readdirSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { assertDirectory, ensureDirectory } from "./directory.js";

/** P7 durability fault seam. It is confined to these leaf primitives and their
 * one publication caller; no workflow constructor carries it and production
 * callers pass nothing, so the default path is the existing syscall ordering.
 *
 * A fault that is raised at a point is a *crash simulation*: the primitive stops
 * where it is and performs no cleanup, exactly like process loss. */
export type DurabilityPoint =
  | "file-create" | "file-write" | "file-fsync" | "derived-rename"
  | "publication-link" | "destination-validate" | "directory-fsync" | "temporary-cleanup";
/** before: the effect has not happened. after-visible: another observer can see
 * it. ambiguous: this process cannot decide whether the effect happened. */
export type DurabilityPhase = "before" | "after-visible" | "ambiguous";
export interface DurabilityFault {
  readonly point: DurabilityPoint;
  readonly phase: DurabilityPhase;
  readonly path: string;
}
export type DurabilityObserver = (fault: DurabilityFault) => void;

export class DurabilityFaultError extends Error {
  readonly point: DurabilityPoint;
  readonly phase: DurabilityPhase;
  constructor(fault: DurabilityFault) {
    super(`durability fault ${fault.phase} ${fault.point}: ${fault.path}`);
    this.name = "DurabilityFaultError";
    this.point = fault.point; this.phase = fault.phase;
  }
}
/** The observer decides whether the simulated crash happens. Tests raise
 * `DurabilityFaultError` so the primitive can tell an injected crash from a real
 * syscall failure: a crash never runs a cleanup path. */
export function faultAt(observer: DurabilityObserver | undefined, point: DurabilityPoint, phase: DurabilityPhase, path: string): void {
  if (!observer) return;
  observer(Object.freeze({ point, phase, path }));
}
export const isDurabilityFault = (error: unknown): error is DurabilityFaultError => error instanceof DurabilityFaultError;

export function fsyncDir(directory: string, faults?: DurabilityObserver): void {
  assertDirectory(directory);
  const observed = lstatSync(directory);
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const current = fstatSync(fd);
    if (!current.isDirectory() || current.dev !== observed.dev || current.ino !== observed.ino)
      throw new StoreError("STORE_CORRUPT", `directory changed before fsync: ${directory}`);
    faultAt(faults, "directory-fsync", "ambiguous", directory);
    fsyncSync(fd);
    faultAt(faults, "directory-fsync", "after-visible", directory);
  } finally { closeSync(fd); }
}

/** Flush newly created directory names from the deepest parent upward. Existing
 * modes are never rewritten. This is a persistence barrier, not a race-proof
 * capability to traverse an arbitrary directory tree.
 */
export function ensureDurableDirectory(directory: string, mode = 0o755, faults?: DurabilityObserver): void {
  const created = ensureDirectory(directory, mode);
  for (const path of [...created].reverse()) {
    fsyncDir(path, faults);
    fsyncDir(dirname(path), faults);
  }
  // Fence an immediate parent even when another creator won mkdir's EEXIST.
  fsyncDir(directory, faults);
  fsyncDir(dirname(directory), faults);
}

export function fsyncFile(path: string, faults?: DurabilityObserver): void {
  assertDirectory(dirname(path));
  const observed = lstatSync(path);
  if (!observed.isFile() || observed.isSymbolicLink())
    throw new StoreError("STORE_CORRUPT", `non-regular file: ${path}`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const current = fstatSync(fd);
    if (!current.isFile() || current.dev !== observed.dev || current.ino !== observed.ino)
      throw new StoreError("STORE_CORRUPT", `file changed before fsync: ${path}`);
    faultAt(faults, "file-fsync", "ambiguous", path);
    fsyncSync(fd);
    faultAt(faults, "file-fsync", "after-visible", path);
  } finally { closeSync(fd); }
}

/** Only the exact name successfully created by this invocation may reach here.
 * ENOENT after an uncertain rename does not establish that replacement failed;
 * the original error still propagates and the parent is flushed either way.
 */
function cleanupOwnedTemporary(path: string, faults?: DurabilityObserver): void {
  try { unlinkSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  faultAt(faults, "temporary-cleanup", "after-visible", path);
  fsyncDir(dirname(path), faults);
}

function cleanupAfterFailure(path: string, failure: unknown, faults?: DurabilityObserver): never {
  if (isDurabilityFault(failure)) throw failure;
  try { cleanupOwnedTemporary(path, faults); }
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
export function writeExclusiveFsyncedFile(path: string, bytes: string | Uint8Array, mode = 0o600, faults?: DurabilityObserver): void {
  assertDirectory(dirname(path));
  faultAt(faults, "file-create", "before", path);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  faultAt(faults, "file-create", "after-visible", path);
  try {
    faultAt(faults, "file-write", "before", path);
    writeFileSync(fd, bytes);
    faultAt(faults, "file-write", "ambiguous", path);
    faultAt(faults, "file-fsync", "ambiguous", path);
    fsyncSync(fd);
    faultAt(faults, "file-fsync", "after-visible", path);
  } catch (error) { cleanupAfterFailure(path, error, faults); }
  finally { closeSync(fd); }
}

/** Derived-only replacement: exclusive temporary -> file fsync -> close ->
 * rename -> parent fsync. This function owns only its random temporary, never a
 * glob or an accepted source. A post-rename flush failure does not prove that
 * replacement did not happen; callers must not downgrade a durable operation.
 */
export function replaceDerivedFile(target: string, bytes: string | Uint8Array, mode = 0o600, faults?: DurabilityObserver): void {
  ensureDurableDirectory(dirname(target), 0o755, faults);
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  faultAt(faults, "file-create", "before", temporary);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  faultAt(faults, "file-create", "after-visible", temporary);
  let renamed = false;
  try {
    faultAt(faults, "file-write", "before", temporary);
    writeFileSync(fd, bytes);
    faultAt(faults, "file-write", "ambiguous", temporary);
    faultAt(faults, "file-fsync", "ambiguous", temporary);
    fsyncSync(fd);
    faultAt(faults, "file-fsync", "after-visible", temporary);
    closeSync(fd);
    faultAt(faults, "derived-rename", "before", target);
    renameSync(temporary, target);
    renamed = true;
    faultAt(faults, "derived-rename", "after-visible", target);
    fsyncDir(dirname(target), faults);
  } catch (error) {
    try { closeSync(fd); } catch { /* already closed */ }
    if (!renamed) cleanupAfterFailure(temporary, error, faults);
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
export function fsyncTree(root: string, policy: TreeFlushPolicy = "regular-files", faults?: DurabilityObserver): void {
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
