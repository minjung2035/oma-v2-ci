/** Directory traversal uses held descriptors and kernel no-symlink resolution.
 * These capabilities protect namespace traversal, not same-inode writes or S-06 durability.
 */
import { constants, closeSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse } from "node:path";
import { StoreError, unobserved } from "../domain/errors.js";
import { entryAt, openBeneath, openDirectory } from "./contained-fs.js";

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

/** Only for caller-owned unaccepted/temporary artifacts. Never collect accepted evidence.
 * Readdir, chmod and removal stay under held directories; links are not traversed.
 */
export function removeOwnedTree(path: string): void {
  let parent: number;
  try { parent = openDirectory(dirname(path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  try {
    if (!lstatSync(entryAt(parent, basename(path)), { throwIfNoEntry: false })) return;
    const walk = (directory: number): void => {
      fchmodSync(directory, 0o700);
      for (const name of readdirSync(`/proc/self/fd/${directory}`)) {
        const entry = entryAt(directory, name); const stat = lstatSync(entry);
        if (stat.isDirectory()) {
          const child = openBeneath(directory, name, constants.O_RDONLY | constants.O_DIRECTORY);
          try { walk(child); } finally { closeSync(child); }
          rmdirSync(entry);
        } else if (stat.isFile()) unlinkSync(entry);
        else throw new StoreError("STORE_CORRUPT", "owned staging holds a non-regular entry");
      }
      fsyncSync(directory);
    };
    const root = openBeneath(parent, basename(path), constants.O_RDONLY | constants.O_DIRECTORY);
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
      fchmodSync(directory, 0o700);
      for (const name of readdirSync(`/proc/self/fd/${directory}`)) {
        const entry = entryAt(directory, name);
        if (lstatSync(entry).isDirectory()) {
          const child = openBeneath(directory, name, constants.O_RDONLY | constants.O_DIRECTORY);
          try { walk(child); } finally { closeSync(child); }
          rmdirSync(entry);
        } else unlinkSync(entry);
      }
    };
    const root = openBeneath(parent, basename(path), constants.O_RDONLY | constants.O_DIRECTORY);
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
