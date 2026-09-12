/** Filesystem shape checks only: no artifact authority, ledger access, or
 * openat2/S-06 proof. A hostile concurrent parent replacement still requires a
 * kernel containment primitive; observing parents is not a substitute for it.
 */
import { lstatSync, mkdirSync } from "node:fs";
import { isAbsolute, join, parse } from "node:path";
import { StoreError } from "../domain/errors.js";

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
  const { root, components } = componentsOf(path);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink())
      throw new StoreError("STORE_CORRUPT", `directory type mismatch: ${current}`);
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
  for (const component of components) {
    current = join(current, component);
    if (!lstatSync(current, { throwIfNoEntry: false })) {
      try { mkdirSync(current, { mode }); created.push(current); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink())
      throw new StoreError("STORE_CORRUPT", `directory type mismatch: ${current}`);
  }
  return created;
}
