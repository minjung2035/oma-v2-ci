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
import { entryAt, openBeneath, openDirectory, openRegularBeneath } from "./contained-fs.js";

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
  const fd = openDirectory(directory);
  try {
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
  const parent = openDirectory(dirname(path));
  let fd: number;
  try { fd = openRegularBeneath(parent, basename(path)); }
  finally { closeSync(parent); }
  try {
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
export function writeExclusiveFsyncedFile(path: string, bytes: string | Uint8Array, mode = 0o600, faults?: DurabilityObserver, use?: (fd: number) => void): void {
  const parent = openDirectory(dirname(path));
  let fd: number | undefined;
  try {
    faultAt(faults, "file-create", "before", path);
    fd = openBeneath(parent, basename(path), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    faultAt(faults, "file-create", "after-visible", path);
    faultAt(faults, "file-write", "before", path);
    writeFileSync(fd, bytes);
    faultAt(faults, "file-write", "ambiguous", path);
    use?.(fd);
    faultAt(faults, "file-fsync", "ambiguous", path);
    fsyncSync(fd);
    faultAt(faults, "file-fsync", "after-visible", path);
  } catch (error) {
    if (fd === undefined || isDurabilityFault(error)) throw error;
    try {
      unlinkSync(entryAt(parent, basename(path)));
      faultAt(faults, "temporary-cleanup", "after-visible", path);
      fsyncSync(parent);
    } catch (cleanup) { throw new AggregateError([error, cleanup], "filesystem effect and owned cleanup failed"); }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
    closeSync(parent);
  }
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
export function fsyncTree(root: string | number, policy: TreeFlushPolicy = "regular-files", faults?: DurabilityObserver): void {
  const walk = (directory: number): void => {
    for (const name of readdirSync(`/proc/self/fd/${directory}`)) {
      const entry = lstatSync(entryAt(directory, name));
      if (entry.isSymbolicLink() && policy === "workspace-links") continue;
      const child = entry.isDirectory()
        ? openBeneath(directory, name, constants.O_RDONLY | constants.O_DIRECTORY)
        : openRegularBeneath(directory, name);
      try {
        const current = fstatSync(child);
        if (current.dev !== entry.dev || current.ino !== entry.ino ||
          (!entry.isDirectory() && (!current.isFile() || (policy === "context-single-link" && current.nlink !== 1))))
          throw new StoreError("STORE_CORRUPT", `fsync tree identity/link mismatch: ${name}`);
        if (entry.isDirectory()) walk(child); else fsyncSync(child);
      } finally { closeSync(child); }
    }
    fsyncSync(directory);
  };
  const directory = typeof root === "string" ? openDirectory(root) : root;
  try { walk(directory); }
  finally { if (typeof root === "string") closeSync(directory); }
}
