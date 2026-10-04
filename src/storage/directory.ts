/** Directory traversal uses held descriptors and kernel no-symlink resolution.
 * These capabilities protect namespace traversal, not same-inode writes or S-06 durability.
 */
import { constants, chmodSync, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, rmdirSync, unlinkSync,
  type Dirent } from "node:fs";
import { basename, dirname, isAbsolute, join, parse } from "node:path";
import { StoreError, unobserved } from "../domain/errors.js";
import { withCleanup } from "../process/cleanup.js";
import { entryAt, openBeneath, openDirectory, withinDirectory } from "./contained-fs.js";

function componentsOf(path: string): { root: string; components: string[] } {
  if (!isAbsolute(path) || path.includes("\0"))
    throw new StoreError("STORE_CORRUPT", "filesystem directory must be absolute");
  const root = parse(path).root;
  const components = path.slice(root.length).split("/").filter(Boolean);
  // Check the complete lexical path before even the first mkdir is attempted.
  if (components.some(component => component === "." || component === ".."))
    throw new StoreError("STORE_CORRUPT", "filesystem directory is not canonical");
  return { root, components };
}

export function assertDirectory(path: string): void {
  componentsOf(path);
  try { closeSync(openDirectory(path)); }
  catch (error) {
    if (error instanceof StoreError) throw error;
    // DR13: a directory that could not be opened now is not one of another type.
    throw unobserved(error, `the directory ${path}`) ?? new StoreError("STORE_CORRUPT", `directory type mismatch: ${path}`);
  }
}

/** Create one component at a time, never recursively through a linked ancestor.
 * Return only directories this call created. The durability owner must flush
 * their parents; this shape-only helper does not claim a persistence barrier.
 */
export function ensureDirectory(path: string, mode = 0o755): readonly string[] {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777)
    throw new StoreError("STORE_CORRUPT", "invalid directory mode");
  const { root, components } = componentsOf(path);
  const created: string[] = [];
  let current = root;
  let parent = openDirectory(root);
  try {
    for (const component of components) {
      current = join(current, component);
      try { mkdirSync(entryAt(parent, component), { mode }); created.push(current); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      let child: number;
      try { child = openBeneath(parent, component, constants.O_RDONLY | constants.O_DIRECTORY); }
      catch (error) {
        if (error instanceof StoreError) throw error;
        throw unobserved(error, `the directory ${current}`) ?? new StoreError("STORE_CORRUPT", `directory type mismatch: ${current}`);
      }
      // P0V-49: the slot names the descriptor still held before the old one is
      // given back, so a close that fails is never followed by a second one.
      const previous = parent; parent = child; closeSync(previous);
    }
    return created;
  } finally { closeSync(parent); }
}

/** Gives a directory pinned beneath a held parent back its owner
 * read/write/search bits where a same-UID stray or an interrupted writer
 * dropped them. The repair runs through the O_PATH pin's own proc name --
 * the one inode the pin names, never a replaced path -- and bits are only
 * added, never stripped: the mode's other permission bits and its setuid,
 * setgid and sticky bits are kept. */
function repairOwnerBits(pin: number): void {
  const observed = fstatSync(pin);
  if ((observed.mode & 0o700) !== 0o700)
    chmodSync(`/proc/self/fd/${pin}`, (observed.mode & 0o7777) | 0o700);
}

/** Opens the `name` directory beneath a held parent for a removal or listing
 * walk even when its mode lost owner bits -- the `O_RDONLY | O_DIRECTORY`
 * open this replaces throws EACCES on a mode-000 directory before any repair
 * inside the walk could run. The O_PATH pin needs no permission bits of its
 * own and keeps the RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS guarantee -- a name
 * swapped for a link or an escape is refused in-kernel -- and the real
 * descriptor is opened through the pin's proc name after the repair, so every
 * step acts on the one pinned inode, never a re-resolved path. */
function openOwnedDirectory(parent: number, name: string): number {
  const pin = openBeneath(parent, name, 0o10000000 /* O_PATH */ | constants.O_DIRECTORY);
  let result: number | undefined;
  try {
    return withCleanup(() => {
      repairOwnerBits(pin);
      result = openSync(`/proc/self/fd/${pin}`, constants.O_RDONLY | constants.O_DIRECTORY);
      return result;
    }, () => closeSync(pin));
  } catch (error) {
    return withCleanup(() => { throw error; }, () => { if (result !== undefined) closeSync(result); });
  }
}

/** Only for caller-owned unaccepted/temporary artifacts. Never collect accepted evidence.
 * Readdir, chmod and removal stay under held directories; links are not traversed.
 * A leaf that is not a directory or a regular file -- a link, socket or fifo an
 * interrupted writer or a same-UID stray left in the owned tree -- is unlinked
 * as the entry it is, never followed (unlink removes the name, not its target):
 * the tree is being deleted either way, and refusing on an unexpected leaf
 * wedges the sweep that owns the tree without protecting anything outside it. */
export function removeOwnedTree(path: string): void {
  let parent: number;
  try { parent = openDirectory(dirname(path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  try {
    if (!lstatSync(entryAt(parent, basename(path)), { throwIfNoEntry: false })) return;
    const walk = (directory: number): void => {
      for (const name of readdirSync(`/proc/self/fd/${directory}`)) {
        const entry = entryAt(directory, name); const stat = lstatSync(entry);
        if (stat.isDirectory()) {
          const child = openOwnedDirectory(directory, name);
          try { walk(child); } finally { closeSync(child); }
          rmdirSync(entry);
        } else unlinkSync(entry);
      }
      fsyncSync(directory);
    };
    const root = openOwnedDirectory(parent, basename(path));
    try { walk(root); } finally { closeSync(root); }
    rmdirSync(entryAt(parent, basename(path))); fsyncSync(parent);
  } finally { closeSync(parent); }
}
/** DR24: a session's own tree, removed when the session ended having said
 * nothing: its rootfs holds links and its run root sockets, which are unlinked
 * as entries, never followed. Walks under held directories as removeOwnedTree does. */
export function removeUnusedTree(path: string): void {
  let parent: number;
  try { parent = openDirectory(dirname(path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  try {
    if (!lstatSync(entryAt(parent, basename(path)), { throwIfNoEntry: false })?.isDirectory()) return;
    const walk = (directory: number): void => {
      for (const name of readdirSync(`/proc/self/fd/${directory}`)) {
        const entry = entryAt(directory, name);
        if (lstatSync(entry).isDirectory()) {
          const child = openOwnedDirectory(directory, name);
          try { walk(child); } finally { closeSync(child); }
          rmdirSync(entry);
        } else unlinkSync(entry);
      }
    };
    const root = openOwnedDirectory(parent, basename(path));
    try { walk(root); } finally { closeSync(root); }
    rmdirSync(entryAt(parent, basename(path))); fsyncSync(parent);
  } finally { closeSync(parent); }
}
/** Remove a caller-owned leaf without traversing a replaced parent. */
export function removeOwnedFile(path: string): void {
  const parent = openDirectory(dirname(path));
  try {
    try { unlinkSync(entryAt(parent, basename(path))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    fsyncSync(parent);
  } finally { closeSync(parent); }
}
/** The entries of one caller-owned directory, or null when it cannot be
 * listed -- absent, another entry type, or unreadable even after the mode
 * repair. An O_PATH descriptor pins the entry beneath its held parent
 * without needing its mode bits or following a link, and /proc/self/fd
 * names that one inode for the stat, the repair and the listing -- never a
 * replaced name. The repair is the one the removal walks above make inside
 * owned trees: owner read/write/search bits are added back where a same-UID
 * stray or an interrupted writer dropped them, never stripped -- so a
 * directory a sweep keeps loses nothing it had, special bits included. */
export function listOwnedDirectory(path: string): Dirent[] | null {
  try {
    return withinDirectory(path, (parent, name) => {
      const pin = openBeneath(parent, name, 0o10000000 /* O_PATH */ | constants.O_DIRECTORY);
      try {
        repairOwnerBits(pin);
        return readdirSync(`/proc/self/fd/${pin}`, { withFileTypes: true });
      } finally { closeSync(pin); }
    });
  } catch { return null; }
}
