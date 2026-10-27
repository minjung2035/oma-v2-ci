/** The model's file effects, contained by the way they are made (R6-01,
 * PR-004, architecture §4: the check and the effect are one resolution).
 *
 * Workspace descendants are opened from held directories with no-follow
 * native operations. Policy, inode checks and snapshot ownership stay here;
 * only descriptor mechanics cross the private native adapter (NATIVE-025).
 */
import { closeSync, constants, fstatSync, ftruncateSync, readSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { setImmediate } from "node:timers/promises";

import { WorkspaceRefusal } from "./errors.js";
import { descriptorPath, directoryNames, mkdirAt, openAt, openRoot, reopenDirectory, unlinkAt } from "./descriptor-files.js";
export { WorkspaceRefusal } from "./errors.js";

/** The components of a path inside the workspace, or a refusal. */
export function componentsWithin(root: string, path: string): string[] {
  if (typeof path !== "string" || path.includes("\0")) throw new WorkspaceRefusal("tool path is invalid");
  const offset = relative(root, resolve(root, path));
  if (offset === "") return [];
  if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new WorkspaceRefusal("tool path is outside the agent workspace");
  return offset.split(sep);
}

/** The errno a thrown value carries, if any. A throw site is not obliged
 * to produce an object -- a null, string or number throw carries no
 * `.code` at all, and reading it blind would make the error handler
 * itself throw TypeError in place of the real error. */
function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function refusedLink(error: unknown): never {
  const code = errnoCode(error);
  if (code === "ELOOP" || code === "ENOTDIR") throw new WorkspaceRefusal("tool path passes through a link or a non-directory; links are not followed");
  throw error;
}

/** True when `error` is the descriptor-table overrun the snapshot's depth
 * is bounded by -- EMFILE or ENFILE -- checked without assuming the
 * thrown value's shape, so a non-object throw cannot turn the check
 * itself into a TypeError. Exported for the search child's own error
 * mapping, which classifies the same overrun raised inside the engine
 * walker the snapshot hands to it. */
export function isDescriptorOverrun(error: unknown): boolean {
  const code = errnoCode(error);
  return code === "EMFILE" || code === "ENFILE";
}

/** A descriptor-table overrun is the snapshot's only depth bound, and it
 * refuses in words rather than escaping as a bare errno: any EMFILE or
 * ENFILE the snapshot machinery raises -- the held-directory walk, a source
 * readdir or open, a destination open, the cleanup itself -- becomes this
 * refusal, which a caller can surface with its reason intact. */
function descriptorRefusal(error: unknown): never {
  if (isDescriptorOverrun(error)) throw new WorkspaceRefusal("search snapshot ran out of file descriptors");
  throw error;
}

/** A descriptor on the directory `components` names, walked from the root. */
function openDirectoryWithin(root: string, components: readonly string[], create: boolean): number {
  let fd: number;
  try { fd = openRoot(root); }
  catch (error) { refusedLink(error); }
  try {
    for (const part of components) {
      let next: number;
      try { next = openAt(fd, part, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
      catch (error) {
        if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") refusedLink(error);
        try { mkdirAt(fd, part, 0o755); }
        catch (made) { if ((made as NodeJS.ErrnoException).code !== "EEXIST") throw made; }
        try { next = openAt(fd, part, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
        catch (again) { refusedLink(again); }
      }
      closeSync(fd);
      fd = next;
    }
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}

/** Opens the named entry itself, never through a link. */
function openEntryWithin(root: string, path: string, flags: number, mode = 0o644): number {
  const components = componentsWithin(root, path);
  if (components.length === 0) {
    // The workspace itself: a directory, which no tool writes as a file.
    if ((flags & (constants.O_WRONLY | constants.O_RDWR)) !== 0) throw new WorkspaceRefusal("tool path is the workspace itself");
    return openDirectoryWithin(root, [], false);
  }
  const parent = openDirectoryWithin(root, components.slice(0, -1), false);
  try {
    try { return openAt(parent, components.at(-1)!, flags | constants.O_NOFOLLOW, mode); }
    catch (error) { refusedLink(error); }
  } finally { closeSync(parent); }
}

/** A regular file with no other name: a hard link would carry a write to
 * wherever else that file is named. */
function ownedFile(fd: number): void {
  const stat = fstatSync(fd);
  if (!stat.isFile()) throw new WorkspaceRefusal("tool path is not a regular file");
  if (stat.nlink > 1) throw new WorkspaceRefusal("tool path is a file with other names; it is not written through");
}

/** Borrows the newly opened file description for the callback. On Darwin its
 * descriptor alias shares the cursor; this is not an independent reopen. */
export async function withFileWithin<T>(root: string, path: string, use: (held: string) => Promise<T>): Promise<T> {
  const fd = openEntryWithin(root, path, constants.O_RDONLY);
  try { ownedFile(fd); return await use(descriptorPath(fd)); } finally { closeSync(fd); }
}

export function readWithin(root: string, path: string): Buffer {
  const fd = openEntryWithin(root, path, constants.O_RDONLY);
  try {
    ownedFile(fd);
    const size = fstatSync(fd).size;
    const buffer = Buffer.alloc(size);
    let filled = 0;
    while (filled < size) { const count = readSync(fd, buffer, filled, size - filled, filled); if (count === 0) break; filled += count; }
    return buffer.subarray(0, filled);
  } finally { closeSync(fd); }
}

export function accessWithin(root: string, path: string, write: boolean): void {
  const fd = openEntryWithin(root, path, write ? constants.O_RDWR : constants.O_RDONLY);
  try { ownedFile(fd); } finally { closeSync(fd); }
}

export function writeWithin(root: string, path: string, content: string | Buffer): void {
  // Opened without truncating, checked, then emptied: a file with another
  // name is refused before a byte of it changes.
  const fd = openEntryWithin(root, path, constants.O_WRONLY | constants.O_CREAT, 0o644);
  try {
    ownedFile(fd);
    ftruncateSync(fd, 0);
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    for (let at = 0; at < bytes.length; ) at += writeSync(fd, bytes, at, bytes.length - at, at);
  } finally { closeSync(fd); }
}

/** The refusal text `writeWithinUnchanged` raises when the opened inode is
 * not the one the caller read. Exported so a caller that must translate the
 * refusal into another failure contract (the bundled hashline runtime's
 * `[E_PATH_CHANGED]` wording) can recognize it exactly instead of matching
 * on a paraphrase. */
export const FILE_CHANGED_REFUSAL = "tool path resolves to a different file than the one read";

/** The read-modify-write commit: opens the named file (no O_CREAT — a name
 * that is gone is a changed file, not a new one) and refuses before any
 * byte is written unless the opened inode is the exact dev+ino the caller
 * observed when it read. This is the check the bundled hashline runtime's
 * writeAtomic performs, moved inside the containment walk so the decision
 * is made on the opened file itself. */
export function writeWithinUnchanged(root: string, path: string, content: string, expected: { dev: number; ino: number }): void {
  const fd = openEntryWithin(root, path, constants.O_WRONLY);
  try {
    ownedFile(fd);
    const stat = fstatSync(fd);
    if (stat.dev !== expected.dev || stat.ino !== expected.ino) throw new WorkspaceRefusal(FILE_CHANGED_REFUSAL);
    ftruncateSync(fd, 0);
    const bytes = Buffer.from(content, "utf8");
    for (let at = 0; at < bytes.length; ) at += writeSync(fd, bytes, at, bytes.length - at, at);
  } finally { closeSync(fd); }
}

export function mkdirWithin(root: string, path: string): void {
  closeSync(openDirectoryWithin(root, componentsWithin(root, path), true));
}

export function isDirectoryWithin(root: string, path: string): boolean {
  const fd = openEntryWithin(root, path, constants.O_RDONLY);
  try { return fstatSync(fd).isDirectory(); } finally { closeSync(fd); }
}

export function existsWithin(root: string, path: string): boolean {
  try { closeSync(openEntryWithin(root, path, constants.O_RDONLY)); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** G10-02: pathname walkers see only a private copy of approved inodes, never
 * the mutable workspace. The root and every descendant stay held while read.
 * Entry metadata costs one byte of the same finite workspace budget. No links
 * are copied. Depth is not refused: the source side holds one descriptor per
 * open level -- the workspace is the untrusted tree, so a component swapped
 * mid-copy cannot redirect a read -- and the destination side holds one per
 * open level too. The private `oma-search-*` tree is only mode-700: a same-uid
 * racer can still rename its directories or plant names inside it, so the
 * copy's own writes are made through directory-relative operations -- a
 * held parent cannot be swapped for a link, and a planted leaf name only
 * ever fails the copy closed (EEXIST/ELOOP), never carries a write through.
 * Both sides cost one descriptor per open level, so an OS descriptor bound
 * is the only depth limit and it refuses honestly, in words, rather than
 * quietly dropping back to path writes.
 *
 * `named` is a declaration, not a notification: it is called with each
 * candidate name BEFORE that directory is created, so a caller that names
 * the copy to a supervising parent can order the announcement ahead of the
 * fs effect -- a copy that exists was always declared first. A `named` that
 * cannot carry the declaration must throw: the snapshot then fails before
 * anything is made rather than exist undeclared. */
export async function withSearchSnapshot<T>(root: string, path: string,
  signal: AbortSignal | undefined, use: (snapshot: string, target: string) => Promise<T>,
  progress?: () => void, named?: (snapshotName: string) => void): Promise<T> {
  try {
    return await searchSnapshot(root, path, signal, use, progress, named);
  } catch (error) {
    // One boundary wording for the descriptor bound, wherever it fired.
    return descriptorRefusal(error);
  }
}

/** Snapshot cleanup never follows a planted link, including links to directories. */
function removeSnapshotAt(parent: number, name: string): void {
  let fd: number;
  try { fd = openAt(parent, name, constants.O_RDONLY | constants.O_DIRECTORY); }
  catch (error) {
    const code = errnoCode(error);
    if (code === "ENOENT") return;
    if (code !== "ENOTDIR" && code !== "ELOOP") throw error;
    try { unlinkAt(parent, name); }
    catch (missing) { if (errnoCode(missing) !== "ENOENT") throw missing; }
    return;
  }
  try { for (const entry of directoryNames(fd)) removeSnapshotAt(fd, entry); }
  finally { closeSync(fd); }
  try { unlinkAt(parent, name, true); }
  catch (error) { if (errnoCode(error) !== "ENOENT") throw error; }
}

async function searchSnapshot<T>(root: string, path: string,
  signal: AbortSignal | undefined, use: (snapshot: string, target: string) => Promise<T>,
  progress?: () => void, named?: (snapshotName: string) => void): Promise<T> {
  const parts = componentsWithin(root, path);
  const temp = openDirectoryWithin(tmpdir(), [], false);
  let baseName = "";
  try {
    // Declare-then-create, the ordering the parent sweep needs: the name is
    // announced before the directory exists, so a child killed or stopped in
    // the gap still had its copy's name delivered -- an undeclared snapshot
    // can never exist. A name already taken announces again fresh.
    for (;;) {
      baseName = `oma-search-${randomUUID()}`;
      named?.(baseName);
      try { mkdirAt(temp, baseName, 0o700); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
  } catch (error) { closeSync(temp); throw error; }
  const snapshot = join(tmpdir(), baseName, "workspace");
  let destination: number | undefined;
  const check = (): void => { if (signal?.aborted) throw new WorkspaceRefusal("search aborted"); };
  /** A fresh name inside a held destination directory. The private tree is
   * mode-700 -- permission bits do not stop a same-uid racer -- so every
   * entry is named through the held parent, and a descriptor-table overrun
   * refuses in words instead of degrading to path writes. The same refusal
   * reaches every other site at the `withSearchSnapshot` boundary. */
  const openDestination = (parent: number, name: string, flags: number, mode?: number): number => {
    try { return openAt(parent, name, flags, mode); }
    catch (error) { return descriptorRefusal(error); }
  };
  // `fd` is the descriptor held on the source entry and `parent` the one
  // held on its name's directory inside the private copy, so neither side
  // can be swapped out from under the entry this call resolves.
  const copy = async (fd: number, parent: number, name: string): Promise<void> => {
    check(); progress?.();
    const stat = fstatSync(fd);
    if (stat.isDirectory()) {
      mkdirAt(parent, name, 0o700);
      const into = openDestination(parent, name, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        for (const entry of directoryNames(fd)) {
          check(); progress?.();
          // Repository internals are not a search input. An empty .git at the
          // copy's root stops parent ignore discovery without importing config.
          // A listed name is one directory entry -- anything else is not one.
          if (entry === ".git" || entry === "." || entry === ".." || entry.includes("/") || entry.includes("\0")) continue;
          let child: number;
          try { child = openAt(fd, entry, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
          catch (error) {
            if (["ENOENT", "ELOOP"].includes(errnoCode(error) ?? "")) continue;
            throw error;
          }
          try {
            const current = fstatSync(child);
            if (current.isDirectory() || (current.isFile() && current.nlink === 1))
              await copy(child, into, entry);
          } finally { closeSync(child); }
        }
      } finally { closeSync(into); }
    } else {
      ownedFile(fd);
      const out = openDestination(parent, name,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        const buffer = Buffer.alloc(Math.min(stat.size + 1, 64 * 1024));
        let used = 0;
        for (;;) {
          check(); progress?.();
          const count = readSync(fd, buffer, 0, buffer.length, null);
          if (count === 0) break;
          used += count;
          if (used > stat.size) throw new WorkspaceRefusal("search input grew during snapshot");
          for (let at = 0; at < count;) at += writeSync(out, buffer, at, count - at);
          await setImmediate();
        }
        if (used !== stat.size) throw new WorkspaceRefusal("search input changed during snapshot");
        ownedFile(fd);
      } finally { closeSync(out); }
    }
    await setImmediate();
  };
  try {
    destination = openAt(temp, baseName, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const fd = openDirectoryWithin(root, [], false);
    try {
      // Validate the explicit target beneath the same held root we copy. Do not
      // resolve the workspace pathname a second time between check and use.
      let selected = reopenDirectory(fd);
      try {
        for (const [index, part] of parts.entries()) {
          let next: number;
          try { next = openAt(selected, part, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK |
            (index < parts.length - 1 ? constants.O_DIRECTORY : 0)); }
          catch (error) { refusedLink(error); }
          closeSync(selected); selected = next;
        }
        if (!fstatSync(selected).isDirectory()) ownedFile(selected);
      } finally { closeSync(selected); }
      await copy(fd, destination, "workspace");
    } finally { closeSync(fd); }
    const copied = openAt(destination, "workspace", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { mkdirAt(copied, ".git", 0o700); } finally { closeSync(copied); }
    check();
    return await use(snapshot, join(snapshot, ...parts));
  } finally {
    if (destination !== undefined) closeSync(destination);
    try { removeSnapshotAt(temp, baseName); } finally { closeSync(temp); }
  }
}

export function readdirWithin(root: string, path: string): string[] {
  const fd = openDirectoryWithin(root, componentsWithin(root, path), false);
  try { return directoryNames(fd); } finally { closeSync(fd); }
}
