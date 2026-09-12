/** CTX-001..004 / DB-009: physical checks complement, never replace, the
 * operation decoder. A TypeScript brand is not proof about the filesystem.
 * Parent observations are not an openat2/kernel containment proof.
 */
import { constants, openSync, closeSync, fstatSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, parse } from "node:path";
import type { ContextEntry } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";
import { sha256Hex } from "../hash.js";
import { contextPathCheck } from "../validate.js";

export function assertContextDirectory(path: string): void {
  if (!isAbsolute(path)) throw new StoreError("STORE_CORRUPT", "context root must be absolute");
  const root = parse(path).root;
  let current = root;
  for (const component of path.slice(root.length).split("/").filter(Boolean)) {
    if (component === "." || component === "..") throw new StoreError("STORE_CORRUPT", "context root is not canonical");
    current = join(current, component);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new StoreError("STORE_CORRUPT", `context directory type mismatch: ${current}`);
  }
}

/** Check the descriptor again at the effect boundary; never follow a leaf link
 * and hash the bytes read from the same opened regular-file descriptor.
 */
export function readContextEntry(root: string, entry: ContextEntry): Buffer {
  const invalid = contextPathCheck(entry.path);
  if (invalid || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[0-9a-f]{64}$/.test(entry.sha256))
    throw new StoreError("STORE_CORRUPT", invalid ?? "invalid frozen context descriptor");
  assertContextDirectory(root);
  const components = entry.path.split("/");
  let parent = root;
  for (const component of components.slice(0, -1)) {
    parent = join(parent, component);
    assertContextDirectory(parent);
  }
  const path = join(root, entry.path);
  const observed = lstatSync(path, { throwIfNoEntry: false });
  if (!observed?.isFile() || observed.isSymbolicLink() || observed.size !== entry.bytes)
    throw new StoreError("STORE_CORRUPT", `context source type/size mismatch: ${entry.path}`);
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "ENOENT" || code === "ENOTDIR")
      throw new StoreError("STORE_CORRUPT", `context source changed before open: ${entry.path}`);
    throw error;
  }
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.dev !== observed.dev || before.ino !== observed.ino || before.size !== entry.bytes)
      throw new StoreError("STORE_CORRUPT", `context source identity changed: ${entry.path}`);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256)
      throw new StoreError("STORE_CORRUPT", `context source bytes changed: ${entry.path}`);
    return bytes;
  } finally { closeSync(fd); }
}
