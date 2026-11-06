/** SDK-free private tool state. Every component and cleanup walk is no-follow.
 * Permission repair applies only to the opened owned leaf or to a directory
 * that same walk has opened for removal, never to its ancestors. */
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { chmodPathHandle, directoryNames, mkdirAt, openAt, openRoot, unlinkAt, renameExclusiveAt } from "./descriptor-files.js";
import { WorkspaceRefusal } from "./errors.js";

const DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NONBLOCK;
function code(error: unknown): string | undefined { return (error as NodeJS.ErrnoException | undefined)?.code; }
/** Roots the trusted launcher hands this process: its HOME and canonical
 * system temp root. A sandbox may refuse reading their ancestors, so a walk
 * starts at the deepest anchor; below it every component is still opened
 * without following links. */
function anchorFor(path: string): string {
  const anchors: string[] = [];
  try { anchors.push(realpathSync(tmpdir())); } catch { /* no usable temp root */ }
  const home = process.env.HOME;
  if (home !== undefined && isAbsolute(home) && resolve(home) === home) anchors.push(home);
  return anchors.filter(root => root !== "/" && (path === root || path.startsWith(`${root}/`)))
    .sort((left, right) => right.length - left.length)[0] ?? "/";
}
function withDirectory<T>(path: string, create: boolean, use: (fd: number) => T): T {
  if (!isAbsolute(path) || resolve(path) !== path) throw new WorkspaceRefusal("private state requires a normalized absolute path");
  const anchor = anchorFor(path);
  let fd = openRoot(anchor);
  try {
    for (const name of path.slice(anchor === "/" ? 0 : anchor.length).split("/").filter(Boolean)) {
      let created = false, next: number;
      // Open first: a sandbox refuses mkdir on an existing ancestor it may not
      // write (EPERM before EEXIST), so only a missing component is created.
      try { next = openAt(fd, name, DIRECTORY); }
      catch (error) {
        if (!create || code(error) !== "ENOENT") throw error;
        try { mkdirAt(fd, name, 0o700); created = true; } catch (made) { if (code(made) !== "EEXIST") throw made; }
        next = openAt(fd, name, DIRECTORY);
      }
      try { if (created) { fsyncSync(next); fsyncSync(fd); } }
      catch (error) { closeSync(next); throw error; }
      closeSync(fd); fd = next;
    }
    return use(fd);
  } finally { closeSync(fd); }
}
export function ensurePrivateStateDirectory(path: string): void {
  if (path === "/") throw new WorkspaceRefusal("invalid private state directory root");
  withDirectory(path, true, fd => {
    if (fstatSync(fd).uid !== process.getuid?.()) throw new WorkspaceRefusal("private state directory is not owned by this user");
    fchmodSync(fd, 0o700);
    fsyncSync(fd);
  });
}

/** A canonical per-installation 256-bit key; missing alone permits creation. */
export function privateStateKey(path: string, name: string): string {
  return withDirectory(path, false, parent => {
    const read = (): string => {
      const fd = openAt(parent, name, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.size > 64)
          throw new WorkspaceRefusal("private state key must be an exclusively named owned regular file");
        const key = readFileSync(fd, "utf8").trim();
        if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, "base64").toString("base64") !== key)
          throw new WorkspaceRefusal("private state key is not canonical 32-byte base64");
        fchmodSync(fd, 0o600); fsyncSync(fd); fsyncSync(parent);
        return key;
      } finally { closeSync(fd); }
    };
    try { return read(); } catch (error) { if (code(error) !== "ENOENT") throw error; }
    const key = randomBytes(32).toString("base64");
    const temporary = `.key-${randomBytes(16).toString("hex")}.tmp`;
    const fd = openAt(parent, temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    let published = false;
    try {
      try { writeFileSync(fd, `${key}\n`); fsyncSync(fd); } finally { closeSync(fd); }
      try { renameExclusiveAt(parent, temporary, parent, name); published = true; }
      catch (error) { if (code(error) !== "EEXIST") throw error; }
    } finally { if (!published) unlinkAt(parent, temporary); }
    fsyncSync(parent);
    return published ? key : read();
  });
}

/** The owner's access triple: a directory whose mode lacks any of it cannot
 * be listed, entered or emptied by its owner, whatever the entry is. */
const OWNER_ACCESS = 0o700;
/** Linux O_PATH: opens the inode itself without evaluating the entry's own
 * permission bits, so an owned directory left 0000 is still reachable. The
 * handle can serve as a directory descriptor for `*at` calls but cannot be
 * read through until the mode is repaired. */
const PATH_HANDLE = 0o10000000;

function unlinkEntry(parent: number, name: string, directory = false): void {
  try { unlinkAt(parent, name, directory); } catch (missing) { if (code(missing) !== "ENOENT") throw missing; }
}

/** Removes one name. A directory this user owns whose mode denies the walk is
 * repaired on the descriptor already opened for it -- removal is the last
 * thing this tree is for, and a mode damaged while it was in use would
 * otherwise strand it -- then emptied and unlinked. Nothing is repaired
 * through a name: a link, a foreign-owned entry and every ancestor keep
 * their modes, and a link is unlinked itself rather than followed. */
function removeAt(parent: number, name: string): void {
  let fd: number | undefined, handle = false;
  try { fd = openAt(parent, name, DIRECTORY); }
  catch (error) {
    const errno = code(error);
    if (errno === "ENOENT") return;
    if (errno === "ELOOP" || errno === "ENOTDIR") { unlinkEntry(parent, name); return; }
    if ((errno !== "EACCES" && errno !== "EPERM") || process.platform !== "linux") throw error;
    // Denied read+search: still a directory if a handle opens it. Repair goes
    // through that handle's own description, which no name swap can retarget.
    try { fd = openAt(parent, name, PATH_HANDLE | constants.O_DIRECTORY); handle = true; }
    catch (denied) {
      if (code(denied) === "ENOENT") return;
      if (code(denied) === "ELOOP" || code(denied) === "ENOTDIR") { unlinkEntry(parent, name); return; }
      throw error;
    }
  }
  try {
    const stat = fstatSync(fd);
    if (stat.uid === process.getuid?.() && (stat.mode & OWNER_ACCESS) !== OWNER_ACCESS) {
      const mode = (stat.mode & 0o7777) | OWNER_ACCESS;
      if (handle) chmodPathHandle(fd, mode); else fchmodSync(fd, mode);
    }
    for (const child of directoryNames(fd)) removeAt(fd, child);
  } finally { closeSync(fd); }
  unlinkEntry(parent, name, true);
}
/** Unlink a planted symlink itself; never recursively enter its target.
 * A directory this user owns and the removal walk has opened is repaired to
 * owner access when its mode denies it (a killed child's 0555/0000 scratch
 * subtree must not strand cleanup); everything else keeps the mode it had. */
export function removePrivateStateTree(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path || path === "/") throw new WorkspaceRefusal("invalid private state cleanup root");
  try { withDirectory(dirname(path), false, parent => removeAt(parent, basename(path))); }
  catch (error) { if (code(error) !== "ENOENT") throw error; }
}
