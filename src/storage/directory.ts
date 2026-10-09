/** Directory traversal uses held descriptors and kernel no-symlink resolution.
 * These capabilities protect namespace traversal, not same-inode writes or S-06 durability.
 */
import { constants, chmodSync, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, rmdirSync, unlinkSync,
  type Dirent, type Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, parse } from "node:path";
import { StoreError, unobserved } from "../domain/errors.js";
import { withCleanup } from "../process/cleanup.js";
import { closeEvery, entryAt, openBeneath, openDirectory, withinDirectory } from "./contained-fs.js";

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
 * required owner bits where a same-UID stray or an interrupted writer
 * dropped them. The repair runs through the O_PATH pin's own proc name --
 * the one inode the pin names, never a replaced path -- and bits are only
 * added, never stripped: the mode's other permission bits and its setuid,
 * setgid and sticky bits are kept. */
function repairOwnerBits(pin: number, required = 0o700): void {
  const observed = fstatSync(pin);
  if ((observed.mode & required) !== required)
    chmodSync(`/proc/self/fd/${pin}`, (observed.mode & 0o7777) | required);
}

/** Opens the `name` directory beneath a held parent for an open, removal or
 * listing walk even when its mode lost owner bits -- the `O_RDONLY |
 * O_DIRECTORY` open this replaces throws EACCES on a mode-000 directory
 * before any repair inside the walk could run. The O_PATH pin needs no
 * permission bits of its own and keeps the RESOLVE_BENEATH |
 * RESOLVE_NO_SYMLINKS guarantee -- a name swapped for a link or an escape is
 * refused in-kernel -- and the real descriptor is opened through the pin's
 * proc name after the repair, so every step acts on the one pinned inode,
 * never a re-resolved path. */
export function openOwnedDirectory(parent: number, name: string): number {
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

/** The same open for a directory `path` names: its parent is resolved once
 * the ordinary way -- the ancestors above the entry are not this product's to
 * repair -- and the one entry oma owns is pinned, given its owner bits back
 * and opened. `path` resolves exactly once and the descriptor names that
 * inode for as long as it is open. */
export function openOwnedDirectoryPath(path: string): number {
  return withinDirectory(path, (parent, name) => openOwnedDirectory(parent, name));
}

/** Stream an owned tree through pinned parents. A mode-000 child receives
 * only owner read/search bits on its own inode; sealed modes stay sealed.
 * Links are observed, never followed. All held directories
 * close even when the consumer stops early or throws. */
export function* walkOwnedTree(path: string, skip: ReadonlySet<string> = new Set()): Generator<Stats> {
  const stack: { fd: number; names: string[]; index: number }[] = [];
  let primary: { error: unknown } | null = null;
  const enter = (parent: number, name: string, top: boolean): { stat: Stats; directory: number | null } | null => {
    let pin: number;
    try { pin = openBeneath(parent, name, 0o10000000 /* O_PATH */ | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    let directory: number | null = null;
    try { return withCleanup(() => {
      const stat = fstatSync(pin);
      if (!top && stat.isDirectory() && skip.has(name)) return null;
      if (stat.isDirectory()) {
        // Observation needs read/search, never write. Adding owner-write to
        // an immutable revision directory would invalidate its sealed mode.
        repairOwnerBits(pin, 0o500);
        directory = openSync(`/proc/self/fd/${pin}`, constants.O_RDONLY | constants.O_DIRECTORY);
        return { stat, directory };
      }
      return { stat, directory: null };
    }, () => closeSync(pin)); }
    catch (error) { return withCleanup(() => { throw error; }, () => closeEvery(directory)); }
  };
  const push = (entry: { stat: Stats; directory: number | null }): void => {
    if (entry.directory === null) return;
    try { stack.push({ fd: entry.directory, names: readdirSync(`/proc/self/fd/${entry.directory}`), index: 0 }); }
    catch (error) { withCleanup(() => { throw error; }, () => closeSync(entry.directory!)); }
  };
  try {
    let first: ReturnType<typeof enter>;
    try { first = withinDirectory(path, (parent, name) => enter(parent, name, true)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    if (first === null) return;
    push(first); yield first.stat;
    while (stack.length > 0) {
      const current = stack.at(-1)!;
      if (current.index === current.names.length) { stack.pop(); closeSync(current.fd); continue; }
      const entry = enter(current.fd, current.names[current.index++]!, false);
      if (entry === null) continue;
      push(entry); yield entry.stat;
    }
  } catch (error) { primary = { error }; throw error; }
  finally {
    withCleanup(() => { if (primary !== null) throw primary.error; },
      () => closeEvery(...stack.reverse().map(item => item.fd)));
  }
}

/** `ensureDirectory` for a path whose tail oma owns. `ownedFrom` names the
 * first component of `path` oma itself made -- oma's data root, the package
 * store root's parent -- so every component from it down is oma's own tree
 * and gets the same owner-bits repair `openOwnedDirectory` makes before the
 * open that needs those bits: a mode-000 store root, data directory or
 * `local/` left by a same-UID stray or an interrupted writer can no longer
 * wedge the walk on EACCES. And a file or a link strictly below the
 * boundary where a directory must be is a stray -- the slot can hold
 * nothing oma made beneath it -- so it is unlinked through the held parent
 * and the step retried once; the boundary component itself is never
 * collected (its parent is not oma's). The ancestors above `ownedFrom` are
 * the user's: they are opened the plain way and their modes are never
 * rewritten. */
export function ensureOwnedDirectory(path: string, ownedFrom: string, mode = 0o755): readonly string[] {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777)
    throw new StoreError("STORE_CORRUPT", "invalid directory mode");
  const { root, components } = componentsOf(path);
  const boundary = componentsOf(ownedFrom);
  if (boundary.root !== root || boundary.components.length === 0 ||
      boundary.components.length > components.length ||
      boundary.components.some((part, index) => components[index] !== part))
    throw new StoreError("STORE_CORRUPT", "an owned directory's boundary must be its own ancestor");
  const created: string[] = [];
  let current = root;
  let parent = openDirectory(root);
  try {
    for (const [index, component] of components.entries()) {
      current = join(current, component);
      const owned = index >= boundary.components.length - 1;
      const make = (): number => {
        try { mkdirSync(entryAt(parent, component), { mode }); created.push(current); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        try {
          return owned ? openOwnedDirectory(parent, component)
            : openBeneath(parent, component, constants.O_RDONLY | constants.O_DIRECTORY);
        } catch (error) {
          if (error instanceof StoreError) throw error;
          throw unobserved(error, `the directory ${current}`) ?? new StoreError("STORE_CORRUPT", `directory type mismatch: ${current}`);
        }
      };
      let child: number;
      try { child = make(); }
      catch (error) {
        // A file or a link where an owned component must be a directory can
        // hold nothing oma made beneath it -- the same stray the stage
        // collection and the prune answer inside the store. It is unlinked
        // as the entry it is, through the held parent (a link is never
        // followed), and the step retried once -- but only strictly below
        // the boundary: the boundary component's own parent is the user's,
        // not oma's to write, so its refusal stands.
        if (index < boundary.components.length || !(error instanceof StoreError) || error.code !== "STORE_CORRUPT") throw error;
        try { unlinkSync(entryAt(parent, component)); }
        catch { throw error; }
        try { fsyncSync(parent); } catch { /* durable, or the retry reports it */ }
        child = make();
      }
      const previous = parent; parent = child; closeSync(previous);
    }
    return created;
  } finally { closeSync(parent); }
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
/** The same repair for one owned entry that is only being observed, not
 * opened or listed: a directory gets its owner read/write/search bits, a
 * regular file its owner read/write bits -- added only, never stripped,
 * the mode's other bits and the special bits kept -- on the one inode the
 * O_PATH pin names (`/proc/self/fd` addresses it, never a replaced path,
 * and a link is refused in-kernel rather than followed). Answers the
 * pinned entry's stat, or null when the entry cannot be observed or
 * repaired -- absent, or a mode the chmod could not set. */
export function repairOwnedEntryMode(path: string): Stats | null {
  try {
    return withinDirectory(path, (parent, name) => {
      const pin = openBeneath(parent, name, 0o10000000 /* O_PATH */);
      try {
        const observed = fstatSync(pin);
        const need = observed.isDirectory() ? 0o700 : observed.isFile() ? 0o600 : 0;
        if (need !== 0 && (observed.mode & need) !== need)
          chmodSync(`/proc/self/fd/${pin}`, (observed.mode & 0o7777) | need);
        return observed;
      } finally { closeSync(pin); }
    });
  } catch { return null; }
}
