/** Filesystem staging effects; package naming and archive interpretation stay
 * with their own owners. Linux keeps directory descriptors through publication;
 * macOS uses the host's owned file boundary. */
import { randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { createHostStagingDirectory, makeHostStagedDirectories, publishHostStaged, removeHostStaged, writeHostStagedFile } from "../platform/host/files.js";
import { entryAt, openBeneath } from "../storage/contained-fs.js";
import { openOwnedDirectory, openOwnedDirectoryPath, removeOwnedFile, removeOwnedTree } from "../storage/directory.js";
import { flushDirectoryChain, fsyncDir, fsyncFile, fsyncTree } from "../storage/durable-fs.js";
import { PACKAGE_LOCAL_DIR } from "./pi-packages.js";

/** An interrupted staging area the next change removes. */
export const STAGING_PREFIX = ".staging-local-";

/** What staging a local package needs of the filesystem beneath the store: a
 * scratch directory to fill, then one rename into `local/`. The two platforms
 * implement it their own way (the file's header says why); the readers of the
 * staged tree use `path`, which is never written through. */
export interface StageArea {
  /** The staging root's own path -- for reading it back, not writing it. */
  readonly path: string;
  /** `rel` is a directory beneath the staging root, its parents made too. */
  make(rel: string): void;
  /** `bytes` is the file `rel` beneath the staging root, its parents made. */
  write(rel: string, bytes: Buffer, executable: boolean): void;
  /** `size` bytes of `source` from `position` on are the file `rel` beneath the
   * staging root, its parents made -- the copy is chunked, so a staged file
   * is never a whole buffer in memory. */
  writeFrom(rel: string, source: number, position: number, size: number, executable: boolean): void;
  /** `made` -- a leaf name under the staging root, "" for the root itself --
   * becomes `local/<name>` whole, replacing a dead copy. */
  publish(made: string, name: string): void;
  /** The staging root is given back; a published name is unaffected. */
  close(): void;
}

const DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY;

/** `size` bytes of `source` from `position` on copied to the held `out`, a
 * chunk at a time -- the one copy loop both StageArea spellings share. A
 * source that ends early throws: what was staged is not the file the size
 * named. Positional reads keep the caller's own cursor untouched. */
function copyFdRange(source: number, position: number, size: number, out: number): void {
  const chunk = Buffer.alloc(Math.min(size, 1024 * 1024));
  let at = position, left = size;
  while (left > 0) {
    const want = Math.min(chunk.length, left);
    const got = readSync(source, chunk, 0, want, at);
    if (got === 0) throw new StoreError("INVALID_REQUEST", "a staged file ends inside the bytes its size named");
    for (let written = 0; written < got;) written += writeSync(out, chunk, written, got - written);
    at += got; left -= got;
  }
}

/** `rel`'s components beneath the held `dir`, each named through its held
 * parent; the deepest is answered held for the caller (which is `dir` itself
 * when `rel` names nothing). */
function descendBeneath(dir: number, rel: string, create: boolean): number {
  let current = dir;
  for (const part of rel.split("/")) {
    if (part === "") continue;
    if (create) {
      try { mkdirSync(entryAt(current, part)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    // Every descend is inside oma's own tree -- the staging area or `local/`
    // and its scope directories -- so an entry a stray left at mode-000 is
    // pinned, given its owner bits back and opened, never EACCES-wedged.
    const child = openOwnedDirectory(current, part);
    if (current !== dir) closeSync(current);
    current = child;
  }
  return current;
}

/** The first entry of `parts` beneath the held `parent` (whose path is
 * `parentPath`) that is present and not a directory is the stray an open or
 * a descend wedged on: unlinked as the entry it is, through the held
 * parent -- a link is never followed, the same answer the stage sweep
 * gives -- and the parent is flushed. Components verified as directories
 * are descended through the same owner-bits repair the opens make.
 * Answers false when there is no such stray -- the failure was something
 * else, or the collection itself could not complete -- so the caller's
 * original failure stands. */
export function collectStageStray(parent: number, parentPath: string, parts: readonly string[]): boolean {
  let held = parent;
  let path = parentPath;
  const release = (fd: number): void => { if (fd !== parent) closeSync(fd); };
  try {
    for (const part of parts) {
      path = join(path, part);
      const observed = (() => {
        try { return lstatSync(path, { throwIfNoEntry: false }); } catch { return undefined; }
      })();
      if (observed === undefined) return false;
      if (!observed.isDirectory()) {
        unlinkSync(entryAt(held, part));
        fsyncSync(held);
        return true;
      }
      const child = openOwnedDirectory(held, part);
      release(held);
      held = child;
    }
    return false;
  } catch { return false; }
  finally { release(held); }
}

/** The one refusal a stray non-directory leaves in a held open's way:
 * containment rejects the entry as a link or a non-directory. */
const isContainment = (error: unknown): boolean =>
  error instanceof StoreError && error.code === "STORE_CORRUPT";

/** Linux staging: the store root and the scratch directory are held open for
 * the whole operation and every write names an entry through them. */
export function linuxStaging(root: string): StageArea {
  // The store root is oma's own tree: a mode-000 `.packages` left by a stray
  // is given its owner bits back as it is pinned open, the same repair the
  // sweeps make -- an `oma pi install` does not wedge on the open.
  const store = openOwnedDirectoryPath(root);
  let dir: number | undefined;
  const tmp = `${STAGING_PREFIX}${randomUUID()}`;
  const path = join(root, tmp);
  try {
    mkdirSync(entryAt(store, tmp), { mode: 0o700 });
    dir = openBeneath(store, tmp, DIRECTORY);
  } catch (error) {
    if (dir !== undefined) closeSync(dir);
    closeSync(store);
    throw error;
  }
  const held = dir;
  const release = (fd: number): void => { if (fd !== held && fd !== store) closeSync(fd); };
  let closed = false;
  return {
    path,
    make(rel) {
      release(descendBeneath(held, rel, true));
    },
    write(rel, bytes, executable) {
      const parent = descendBeneath(held, dirname(rel) === "." ? "" : dirname(rel), true);
      try { writeFileSync(entryAt(parent, basename(rel)), bytes, { mode: executable ? 0o755 : 0o644 }); }
      finally { release(parent); }
    },
    writeFrom(rel, source, position, size, executable) {
      const parent = descendBeneath(held, dirname(rel) === "." ? "" : dirname(rel), true);
      try {
        const out = openBeneath(parent, basename(rel),
          constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, executable ? 0o755 : 0o644);
        try { copyFdRange(source, position, size, out); }
        finally { closeSync(out); }
      } finally { release(parent); }
    },
    publish(made, name) {
      const source = made === "" ? store : held;
      const leaf = made === "" ? tmp : made;
      const localPath = join(root, PACKAGE_LOCAL_DIR);
      // `local` is oma's own slot beneath the held store root: made under it
      // when the name is absent and opened through the same owner-bits
      // repair the sweeps make, so a mode-000 `local/` cannot wedge the
      // publish's open the way ensureUserDirectory's by-path walk did. A
      // stray non-directory where `local` or a strict-prefix slot must be a
      // directory still fails the open and the descend below -- and the
      // sweep that collects it only runs after a successful change, so the
      // install wedged on every retry until an unrelated `oma pi`
      // mutation. The blocking entry is collected here, once, the way the
      // sweep collects it, and the bounded step is retried once; anything
      // else stays the publish's own failure.
      const openLocal = (): number => {
        try { mkdirSync(entryAt(store, PACKAGE_LOCAL_DIR), { mode: 0o700 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        return openOwnedDirectory(store, PACKAGE_LOCAL_DIR);
      };
      let local: number;
      try { local = openLocal(); }
      catch (error) {
        if (!isContainment(error) || !collectStageStray(store, root, [PACKAGE_LOCAL_DIR])) throw error;
        local = openLocal();
      }
      // What ensureUserDirectory also gave the name: the durability barrier
      // -- every name on the path flushed, the new `local` included.
      flushDirectoryChain(localPath);
      try {
        const parts = name.split("/");
        const destName = parts.pop()!;
        // `dest` is `local` itself when the name holds no scope.
        const descend = (): number => descendBeneath(local, parts.join("/"), true);
        let dest: number;
        try { dest = descend(); }
        catch (error) {
          if (!isContainment(error) || !collectStageStray(local, localPath, parts)) throw error;
          dest = descend();
        }
        try {
          const destPath = join(localPath, name);
          const observed = lstatSync(destPath, { throwIfNoEntry: false });
          if (observed !== undefined) {
            if (observed.isDirectory()) removeOwnedTree(destPath); else removeOwnedFile(destPath);
          }
          renameSync(entryAt(source, leaf), entryAt(dest, destName));
          // The copy must outlive a crash the way the index naming it does.
          const arrived = lstatSync(destPath);
          if (arrived.isDirectory()) {
            const tree = openBeneath(dest, destName, DIRECTORY);
            try { fsyncTree(tree, "regular-files"); } finally { closeSync(tree); }
          } else fsyncFile(destPath);
          fsyncSync(dest);
          // Every directory the name descended through holds the next
          // component's dirent: `local` and `dest` are flushed on every
          // publish, but a three-or-more-component name makes intermediates
          // (`local/a` for `a/b/c`) nothing else flushes -- a crash after the
          // rename kept `a` without the `b` that walks to the staged copy.
          // The descend just repaired each one, so a flush by path cannot be
          // refused the way a first open could; the name is fsynced the way
          // `flushDirectoryChain` names every directory it persists.
          for (let depth = 1; depth < parts.length; depth++)
            fsyncDir(join(localPath, ...parts.slice(0, depth)));
        } finally { if (dest !== local) closeSync(dest); }
        fsyncSync(local);
      } finally { closeSync(local); }
      // The name the staging root left behind, so a crash proves nothing half-seen.
      fsyncSync(source === store ? store : held);
    },
    close() {
      if (closed) return;
      closed = true;
      try { removeOwnedTree(path); }
      finally { closeSync(held); closeSync(store); }
    },
  };
}

/** Mac staging: the same effects by path, through the host's file owner --
 * the store is in the app's support directory, outside any state tree. */
export function hostStaging(root: string): StageArea {
  // `dirname(root)` is the app's support directory -- the first component of
  // the store path oma itself made, so the owned tail (it, the store,
  // `local/` and its scopes) gets the owner-bits repair on the open path.
  const ownedFrom = dirname(root);
  const path = createHostStagingDirectory(root, STAGING_PREFIX, ownedFrom);
  let closed = false;
  return {
    path,
    make: rel => makeHostStagedDirectories(path, rel),
    write: (rel, bytes, executable) => writeHostStagedFile(path, rel, bytes, executable ? 0o755 : 0o644),
    writeFrom(rel, source, position, size, executable) {
      const dest = join(path, rel);
      mkdirSync(dirname(dest), { recursive: true });
      const out = openSync(dest, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, executable ? 0o755 : 0o644);
      try { copyFdRange(source, position, size, out); }
      finally { closeSync(out); }
    },
    publish: (made, name) => publishHostStaged(made === "" ? path : join(path, made), join(root, PACKAGE_LOCAL_DIR), name, ownedFrom),
    close() { if (closed) return; closed = true; removeHostStaged(path); },
  };
}
