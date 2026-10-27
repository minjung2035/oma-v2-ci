import { withCleanup } from "@oma/native/cleanup";
import { directoryNames, unlinkAt } from "@oma/file-descriptors";
import { statAt, renameAt, linkAt } from "@oma/native/posix-files";
// FS-001..003 / P7: syscall ordering, not artifact authority or S-06 evidence.
// Immutable publication and derived replacement are deliberately separate APIs.
// These helpers neither modify a ledger nor collect accepted recovery evidence.
import {
  constants, closeSync, fstatSync, fsyncSync, lstatSync, readdirSync, renameSync, unlinkSync, writeFileSync, linkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { assertDirectory, ensureDirectory, ensureOwnedDirectory } from "./directory.js";
import { linkDescriptor, openBeneath, openDirectory, openRegularBeneath, withinDirectory } from "@oma/native/files";
import { lockFileDescriptor } from "@oma/native/linux";

/** P7 durability fault seam. It is confined to these leaf primitives and their
 * one publication caller; no workflow constructor carries it and production
 * callers pass nothing, so the default path is the existing syscall ordering.
 *
 * A fault that is raised at a point is a *crash simulation*: the primitive stops
 * where it is and performs no cleanup, exactly like process loss. */
export type DurabilityPoint =
  | "file-create" | "file-write" | "file-fsync" | "derived-rename"
  | "publication-link" | "destination-validate" | "directory-fsync" | "temporary-cleanup"
  /** DR11: flushing another writer's file that a publication names as its evidence. */
  | "evidence-fsync";
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

/** Flush a directory this process already holds. A caller in the middle of a
 * sequence has the parent open; making it hand back the pathname so this could
 * open it again would reintroduce, for a flush, exactly the second resolution
 * the sequence was written to avoid. The pathname is carried only to name the
 * fault. */
export function fsyncHeldDir(fd: number, directory: string, faults?: DurabilityObserver): void {
  faultAt(faults, "directory-fsync", "ambiguous", directory);
  fsyncSync(fd);
  faultAt(faults, "directory-fsync", "after-visible", directory);
}

export function fsyncDir(directory: string, faults?: DurabilityObserver): void {
  const fd = openDirectory(directory);
  try { fsyncHeldDir(fd, directory, faults); }
  finally { closeSync(fd); }
}

/** Makes `directory` exist and every name on its path durable, from the
 * leaf up to the root. Existing modes are never rewritten. This is a
 * persistence barrier, not a race-proof capability to traverse an arbitrary
 * directory tree.
 *
 * P0V-71, P0-3: what this call created is not all that may be unflushed. A
 * call whose flush failed after its mkdirs left names that no later call
 * creates again -- the retry finds them all with EEXIST -- and another
 * creator may have won a mkdir without flushing yet. So every name on the
 * path is flushed on every call; a flush of a clean directory costs little
 * (about 0.04 ms for a six-deep path here). */
export function ensureDurableDirectory(directory: string, mode = 0o755, faults?: DurabilityObserver): void {
  ensureDirectory(directory, mode);
  flushDirectoryChain(directory, faults);
}

/** The persistence barrier half of `ensureDurableDirectory`, for a caller
 * that made or opened `directory` itself -- the owned ensure of a publish
 * path is not re-walked by path here because its names were addressed
 * through the directories it already held. */
export function flushDirectoryChain(directory: string, faults?: DurabilityObserver): void {
  for (let path = directory; ; path = dirname(path)) {
    fsyncDir(path, faults);
    if (dirname(path) === path) break;
  }
}

/** `ensureDurableDirectory` for a path whose tail oma owns: `ownedFrom`
 * names the first component oma itself made, and every component from it
 * down gets the owner-bits repair before the open that needs it -- a
 * mode-000 store root or data directory left by a stray cannot wedge the
 * walk. Ancestors above `ownedFrom` are the user's and keep the plain open. */
export function ensureOwnedDurableDirectory(directory: string, ownedFrom: string, mode = 0o700,
  faults?: DurabilityObserver): readonly string[] {
  const created = ensureOwnedDirectory(directory, ownedFrom, mode);
  flushDirectoryChain(directory, faults);
  return created;
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

/** Only the exact name successfully created by this invocation may reach here,
 * and only through the parent that invocation is holding: a temporary removed
 * by pathname is a second resolution, and the entry it finds need not be the
 * one this call created. ENOENT after an uncertain rename does not establish
 * that replacement failed; the original error still propagates and the parent
 * is flushed either way.
 */
function cleanupOwnedTemporary(parent: number, name: string, path: string, faults?: DurabilityObserver): void {
  try { unlinkAt(parent, name); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  faultAt(faults, "temporary-cleanup", "after-visible", path);
  fsyncHeldDir(parent, dirname(path), faults);
}

function cleanupAfterFailure(parent: number, name: string, path: string, failure: unknown, faults?: DurabilityObserver): never {
  if (isDurabilityFault(failure)) throw failure;
  try { cleanupOwnedTemporary(parent, name, path, faults); }
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
  try { writeExclusiveFsyncedEntry(parent, basename(path), path, bytes, mode, faults, use); }
  finally { closeSync(parent); }
}
/** The same sequence for an entry of a directory the caller already holds
 * (FS-005), so a caller that checked or created the directory writes into that
 * one; `path` only names the entry for faults and errors. */
export function writeExclusiveFsyncedEntry(parent: number, name: string, path: string, bytes: string | Uint8Array, mode = 0o600,
  faults?: DurabilityObserver, use?: (fd: number) => void): void {
  let fd: number | undefined;
  try {
    faultAt(faults, "file-create", "before", path);
    fd = openBeneath(parent, name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
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
      unlinkAt(parent, name);
      faultAt(faults, "temporary-cleanup", "after-visible", path);
      fsyncSync(parent);
    } catch (cleanup) { throw new AggregateError([error, cleanup], "filesystem effect and owned cleanup failed"); }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** A file under `target` only if no file has that name: the bytes are written
 * and flushed under a temporary name, linked to `target` -- which fails if the
 * name exists -- and the directory is flushed. The name appears whole or not at
 * all, so a crash never leaves a partial file under it, and two writers cannot
 * both publish it. Existing bytes are never overwritten. Every name is
 * addressed through the one descriptor the directory was resolved into. The
 * one no-replace publication for every owner (P0V-59; it was the request
 * cache's own).
 *
 * P0V-84 (R6-08, P0-4): the temporary carries a proof of its writer's death,
 * as a leased tree does (P0V-77). The writer holds an flock on it from the
 * moment it exists until it is gone; a writer killed in between leaves it
 * unlocked. The next publication of the same name removes every temporary of
 * that name whose lock is free, and leaves one still held. A temporary taken
 * from under its writer in the instant between its creation and its lock is
 * found missing at the link, and the publication starts again. */
export function publishNoReplace(target: string, data: string | Uint8Array, mode = 0o600, faults?: DurabilityObserver): "created" | "existing" {
  for (let attempt = 0; ; attempt++) {
    const result = withinDirectory(target, (parent, name) => {
      collectDeadTemporaries(parent);
      return publishOnce(parent, name, target, data, mode, faults);
    });
    if (result !== "restart") return result;
    if (attempt >= 2) throw new StoreError("INTERNAL_ERROR", "a no-replace publication's temporary kept being removed");
  }
}

/** P0V-111 (G01-01): a temporary that carries its writer's lock is named as
 * one -- `.held.tmp` -- so that a free lock on it is proof of a dead writer
 * whatever name it was for. Temporaries written without a lock (a
 * configuration's, a derived link's) keep the plain `.tmp` and are never
 * collected here; their owners collect them. */
const TEMPORARY = /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.held\.tmp$/;
/** The one-time name a locked publication temporary beside `name` has. */
export function temporaryNameFor(name: string): string {
  return `.${name}.${randomUUID()}.held.tmp`;
}
/** P0V-84, P0V-96: a publication's temporary, created under the held parent
 * and flocked from the moment it exists. Its writer holds the descriptor until
 * the temporary is gone -- linked away, renamed away or removed -- so a lock
 * found free is the proof its writer died in between. */
export function createLockedTemporary(parent: number, temporaryName: string, flags: number, mode: number): number {
  // A collector may acquire a fresh inode between O_EXCL and flock. Publish
  // the collectible name only after locking; the plain temporary has no
  // claim of writer death and is retained if this tiny preparation crashes.
  const preparing = temporaryName.replace(/\.held\.tmp$/, ".tmp");
  if (preparing === temporaryName) throw new StoreError("INTERNAL_ERROR", "locked temporary requires its held suffix");
  const fd = openBeneath(parent, preparing, flags | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    const lock = lockFileDescriptor(fd);
    if (lock.kind !== "held")
      throw new StoreError("BROKER_UNAVAILABLE", `a publication's temporary could not be locked (${lock.kind})`);
    // The provisional name is unique and cannot be collected or reused while
    // its descriptor is held. Never replace an existing held name.
    linkDescriptor(fd, parent, temporaryName);
    unlinkAt(parent, preparing);
    return fd;
  } catch (error) {
    try { unlinkAt(parent, preparing); } catch { /* retain the original failure */ }
    closeSync(fd);
    throw error;
  }
}
/** The locked temporaries in the held directory whose writers are dead,
 * removed under their lock. Every publication calls it first, so what a
 * killed writer left is gone by the next publication in the same directory,
 * of any name (P0V-111: a name never published again would otherwise keep
 * its leftover for ever); a live writer's is kept. */
export function collectDeadTemporaries(parent: number): void {
  let entries: string[];
  try { entries = directoryNames(parent); } catch { return; }
  for (const entry of entries) {
    if (!TEMPORARY.test(entry)) continue;
    let fd: number;
    try { fd = openBeneath(parent, entry, constants.O_RDONLY | constants.O_NOFOLLOW); } catch { continue; }
    try {
      if (lockFileDescriptor(fd).kind !== "held") continue;
      try { unlinkAt(parent, entry); } catch { /* raced with another collector */ }
    } finally { closeSync(fd); }
  }
}

function publishOnce(parent: number, name: string, target: string, data: string | Uint8Array, mode: number,
  faults: DurabilityObserver | undefined): "created" | "existing" | "restart" {
  const temp = temporaryNameFor(name);
  const temporary = join(dirname(target), temp);
  // P0V-83, R6-08: the same durability points as the other publications, so
  // a crash can be put between any two steps. An injected crash runs no
  // cleanup, as a real one would not.
  faultAt(faults, "file-create", "before", temporary);
  const fd = createLockedTemporary(parent, temp, constants.O_WRONLY, mode);
  let crashed = false;
  return withCleanup(() => {
    faultAt(faults, "file-create", "after-visible", temporary);
    try {
      faultAt(faults, "file-write", "before", temporary);
      writeFileSync(fd, data);
      faultAt(faults, "file-write", "ambiguous", temporary);
      faultAt(faults, "file-fsync", "ambiguous", temporary);
      fsyncSync(fd);
      faultAt(faults, "file-fsync", "after-visible", temporary);
    } catch (error) {
      if (isDurabilityFault(error)) { crashed = true; throw error; }
      try { unlinkAt(parent, temp); fsyncSync(parent); } catch { /* cleanup only; retain the write error */ }
      throw error;
    }
    let result: "created" | "existing" = "created";
    return withCleanup(() => {
      try {
      faultAt(faults, "publication-link", "before", target);
      try { linkAt(parent, temp, parent, name); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Taken by a collector before this writer's lock: start again.
        if (code === "ENOENT") return "restart";
        if (code !== "EEXIST") throw error;
        result = "existing";
      }
      faultAt(faults, "publication-link", "after-visible", target);
    } catch (error) {
      crashed = isDurabilityFault(error);
      throw error;
      }
      return result;
    }, () => {
      if (!crashed) {
        faultAt(faults, "temporary-cleanup", "before", temporary);
        try { unlinkAt(parent, temp); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        fsyncHeldDir(parent, dirname(target), faults);
      }
    });
  }, () => {
    // The lock ends with the descriptor -- here, or at this process's death.
    closeSync(fd);
  });
}

/** Derived-only replacement: exclusive temporary -> file fsync -> close ->
 * rename -> parent fsync. This function owns only its random temporary, never a
 * glob or an accepted source. A post-rename flush failure does not prove that
 * replacement did not happen; callers must not downgrade a durable operation.
 */
export function replaceDerivedFile(target: string, bytes: string | Uint8Array, mode = 0o600, faults?: DurabilityObserver): void {
  ensureDurableDirectory(dirname(target), 0o755, faults);
  // The directory is resolved once per attempt, and the temporary, the rename
  // and the flush all address it through that descriptor. Creating the
  // temporary by pathname after checking the directory -- which is what this
  // did -- let any process of this user swap a component of the path in
  // between, so the file the product believed it had replaced under its state
  // tree was created, written and renamed somewhere else entirely.
  // `ensureDurableDirectory` having just succeeded proved nothing about the
  // walk that followed it: it was a different walk.
  for (let attempt = 0; ; attempt++) {
    const result = withinDirectory(target, (parent, name) => {
      // P0V-96: what a killed writer of this name left is collected first, and
      // this writer's temporary is locked until it is renamed away.
      collectDeadTemporaries(parent);
      const temporaryName = temporaryNameFor(name);
      const temporary = join(dirname(target), temporaryName);
      faultAt(faults, "file-create", "before", temporary);
      const fd = createLockedTemporary(parent, temporaryName, constants.O_WRONLY, mode);
      let renamed = false;
      // P0V-49, P0-4: the descriptor is given back once, in the finally. The
      // number is free the moment it is closed, and anything opened afterwards
      // may be handed it, so nothing closes it a second time.
      try {
        faultAt(faults, "file-create", "after-visible", temporary);
        faultAt(faults, "file-write", "before", temporary);
        writeFileSync(fd, bytes);
        faultAt(faults, "file-write", "ambiguous", temporary);
        faultAt(faults, "file-fsync", "ambiguous", temporary);
        fsyncSync(fd);
        faultAt(faults, "file-fsync", "after-visible", temporary);
        faultAt(faults, "derived-rename", "before", target);
        try { renameAt(parent, temporaryName, parent, name); }
        catch (error) {
          // The window the no-replace publication already answers: a
          // temporary whose lock is free looks like a dead writer's to a
          // concurrent collection, and the instant between this file's
          // creation and its lock is free. A temporary taken in it is missing
          // here -- the same answer, so the replacement starts again.
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return "restart";
          throw error;
        }
        renamed = true;
        faultAt(faults, "derived-rename", "after-visible", target);
        fsyncHeldDir(parent, dirname(target), faults);
      } catch (error) {
        if (!renamed) cleanupAfterFailure(parent, temporaryName, temporary, error, faults);
        throw error;
      } finally {
        try { closeSync(fd); } catch { /* the kernel released it either way */ }
      }
      return "replaced";
    });
    if (result !== "restart") return;
    if (attempt >= 2) throw new StoreError("INTERNAL_ERROR", "a derived replacement's temporary kept being removed");
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
    for (const name of directoryNames(directory)) {
      const entry = statAt(directory, name);
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
