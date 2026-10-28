import { directoryNames, mkdirAt, unlinkAt } from "@oma/file-descriptors";
import { statAt } from "@oma/native/posix-files";
/** Directory traversal uses held descriptors and kernel no-symlink resolution.
 * These capabilities protect namespace traversal, not same-inode writes or S-06 durability.
 */
import { constants, closeSync, fstatSync, fsyncSync, type Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, parse } from "node:path";
import { StoreError, unobserved } from "@oma/domain/errors";
import { withCleanup } from "@oma/native/cleanup";
import { chmodPinned, closeEvery, openBeneath, openDirectory, pinBeneath, reopenPinned, withinDirectory } from "@oma/native/files";

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
      try { mkdirAt(parent, component, mode); created.push(current); }
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

/** Restore required owner bits through the held directory descriptor, never
 * a replaced pathname. Other permission, setid and sticky bits are retained. */
function repairOwnerBits(pin: number, required = 0o700): void {
  const observed = fstatSync(pin);
  if ((observed.mode & required) !== required)
    chmodPinned(pin, (observed.mode & 0o7777) | required);
}

/** A readable directory already supplies the held capability this walk needs.
 * Only EACCES needs a permission-independent pin/repair/reopen, on kernels
 * that support it. A failed pin is not permission to retry by pathname. */
export function openOwnedDirectory(parent: number, name: string): number {
  let direct: number | undefined;
  try { direct = openBeneath(parent, name, constants.O_RDONLY | constants.O_DIRECTORY); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EACCES") throw error; }
  if (direct !== undefined) {
    const held = direct;
    try { repairOwnerBits(held); return held; }
    catch (error) { return withCleanup(() => { throw error; }, () => closeSync(held)); }
  }
  const pin = pinBeneath(parent, name, true);
  let result: number | undefined;
  try {
    return withCleanup(() => {
      repairOwnerBits(pin);
      result = reopenPinned(pin, constants.O_RDONLY | constants.O_DIRECTORY);
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

/** One owned append-only regular file under a directory the caller holds.
 * Inspect and repair its pinned inode before opening it for I/O; a FIFO or
 * device is never opened for I/O, and a replaced pathname cannot redirect it. */
export function openOwnedAppendFile(parent: number, name: string): number {
  let pin: number;
  try { pin = pinBeneath(parent, name); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      return openBeneath(parent, name, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT |
        constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    } catch (creationError) {
      if ((creationError as NodeJS.ErrnoException).code !== "EEXIST") throw creationError;
      // Another writer supplied the name. Inspect it, never truncate it.
      pin = pinBeneath(parent, name);
    }
  }
  let result: number | undefined;
  try {
    return withCleanup(() => {
      if (!fstatSync(pin).isFile()) throw new StoreError("STORE_CORRUPT", "owned append entry is not a regular file");
      repairOwnerBits(pin, 0o600);
      result = reopenPinned(pin, constants.O_RDWR | constants.O_APPEND | constants.O_NONBLOCK);
      return result;
    }, () => closeSync(pin));
  } catch (error) {
    return withCleanup(() => { throw error; }, () => { if (result !== undefined) closeSync(result); });
  }
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
    try { pin = pinBeneath(parent, name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    let directory: number | null = null;
    try { return withCleanup(() => {
      const stat = fstatSync(pin);
      if (!top && stat.isDirectory() && skip.has(name)) return null;
      if (stat.isDirectory()) {
        // Observation needs read/search, never write. Adding owner-write to
        // an immutable revision directory would invalidate its sealed mode.
        repairOwnerBits(pin, 0o500);
        directory = reopenPinned(pin, constants.O_RDONLY | constants.O_DIRECTORY);
        return { stat, directory };
      }
      return { stat, directory: null };
    }, () => closeSync(pin)); }
    catch (error) { return withCleanup(() => { throw error; }, () => closeEvery(directory)); }
  };
  const push = (entry: { stat: Stats; directory: number | null }): void => {
    if (entry.directory === null) return;
    try { stack.push({ fd: entry.directory, names: directoryNames(entry.directory), index: 0 }); }
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
        try { mkdirAt(parent, component, mode); created.push(current); }
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
        try { unlinkAt(parent, component); }
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
    if (!statAt(parent, basename(path), { throwIfNoEntry: false })) return;
    const walk = (directory: number): void => {
      for (const name of directoryNames(directory)) {
        const stat = statAt(directory, name);
        if (stat.isDirectory()) {
          const child = openOwnedDirectory(directory, name);
          try { walk(child); } finally { closeSync(child); }
          unlinkAt(directory, name, true);
        } else unlinkAt(directory, name);
      }
      fsyncSync(directory);
    };
    const root = openOwnedDirectory(parent, basename(path));
    try { walk(root); } finally { closeSync(root); }
    unlinkAt(parent, basename(path), true); fsyncSync(parent);
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
    if (!statAt(parent, basename(path), { throwIfNoEntry: false })?.isDirectory()) return;
    const walk = (directory: number): void => {
      for (const name of directoryNames(directory)) {
        if (statAt(directory, name).isDirectory()) {
          const child = openOwnedDirectory(directory, name);
          try { walk(child); } finally { closeSync(child); }
          unlinkAt(directory, name, true);
        } else unlinkAt(directory, name);
      }
    };
    const root = openOwnedDirectory(parent, basename(path));
    try { walk(root); } finally { closeSync(root); }
    unlinkAt(parent, basename(path), true); fsyncSync(parent);
  } finally { closeSync(parent); }
}
/** Remove a caller-owned leaf without traversing a replaced parent. */
export function removeOwnedFile(path: string): void {
  const parent = openDirectory(dirname(path));
  try {
    try { unlinkAt(parent, basename(path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    fsyncSync(parent);
  } finally { closeSync(parent); }
}
/** Caller-owned unaccepted/temporary entry, under an already held parent.
 * Publication callers retain their destination capability through replacement;
 * no renamed root or replacement ancestor can redirect the removal. */
export function removeOwnedEntryAt(parent: number, name: string): void {
  const observed = statAt(parent, name, { throwIfNoEntry: false });
  if (observed === undefined) return;
  if (!observed.isDirectory()) { unlinkAt(parent, name); fsyncSync(parent); return; }
  const root = openOwnedDirectory(parent, name);
  try {
    for (const child of directoryNames(root)) removeOwnedEntryAt(root, child);
    fsyncSync(root);
  } finally { closeSync(root); }
  unlinkAt(parent, name, true); fsyncSync(parent);
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
export interface OwnedDirectoryEntry { readonly name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }
export function listOwnedDirectory(path: string, options: { readonly required: true }): OwnedDirectoryEntry[];
export function listOwnedDirectory(path: string, options?: { readonly required?: false }): OwnedDirectoryEntry[] | null;
/** A required observation propagates the actual failure; optional diagnostics retain null as unknown. */
export function listOwnedDirectory(path: string, options: { readonly required?: boolean } = {}): OwnedDirectoryEntry[] | null {
  try {
    return withinDirectory(path, (parent, name) => {
      const pin = pinBeneath(parent, name, true);
      try {
        repairOwnerBits(pin);
        return directoryNames(pin).map(name => {
          const stat = statAt(pin, name);
          return { name, isDirectory: () => stat.isDirectory(), isFile: () => stat.isFile(),
            isSymbolicLink: () => stat.isSymbolicLink() };
        });
      } finally { closeSync(pin); }
    });
  } catch (error) { if (options.required) throw error; return null; }
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
      const pin = pinBeneath(parent, name);
      try {
        const observed = fstatSync(pin);
        const need = observed.isDirectory() ? 0o700 : observed.isFile() ? 0o600 : 0;
        if (need !== 0 && (observed.mode & need) !== need)
          chmodPinned(pin, (observed.mode & 0o7777) | need);
        return observed;
      } finally { closeSync(pin); }
    });
  } catch { return null; }
}
