/** CTX-001..004 / DB-009: physical checks complement, never replace, the
 * operation decoder. A TypeScript brand is not proof about the filesystem.
 * Parent observations are not an openat2/kernel containment proof.
 */
import { constants, openSync, closeSync, fstatSync, lstatSync, mkdirSync, readSync } from "node:fs";
import { isAbsolute, join, parse } from "node:path";
import type { ContextEntry } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";
import { sha256Hex } from "../hash.js";
import { contextPathCheck, contextFileCheck } from "../domain/context-policy.js";

function directoryComponents(path: string): { root: string; components: string[] } {
  if (!isAbsolute(path) || path.includes("\0")) throw new StoreError("STORE_CORRUPT", "context root must be absolute");
  const root = parse(path).root;
  const components = path.slice(root.length).split("/").filter(Boolean);
  if (components.some(component => component === "." || component === ".."))
    throw new StoreError("STORE_CORRUPT", "context root is not canonical");
  return { root, components };
}

export function assertContextDirectory(path: string): void {
  const { root, components } = directoryComponents(path);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new StoreError("STORE_CORRUPT", `context directory type mismatch: ${current}`);
  }
}

/** Do not recursively mkdir through an already linked ancestor and discover it
 * only after writing outside the observed tree. Each existing parent is checked
 * before creating its child. As with reads, this is not a kernel race proof.
 */
export function ensureContextDirectory(path: string): void {
  const { root, components } = directoryComponents(path);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    if (!lstatSync(current, { throwIfNoEntry: false })) {
      try { mkdirSync(current); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new StoreError("STORE_CORRUPT", `context directory type mismatch: ${current}`);
  }
}

/** Consume at most the frozen length plus one byte. A growing file must not
 * turn a readFileSync-to-EOF operation into an unbounded allocation.
 */
function readFrozenLength(fd: number, length: number, path: string): Buffer {
  const chunks: Buffer[] = [];
  let remaining = length;
  while (remaining > 0) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const count = readSync(fd, chunk, 0, chunk.length, null);
    if (count === 0) throw new StoreError("STORE_CORRUPT", `context source was truncated: ${path}`);
    chunks.push(chunk.subarray(0, count));
    remaining -= count;
  }
  const probe = Buffer.allocUnsafe(1);
  if (readSync(fd, probe, 0, 1, null) !== 0)
    throw new StoreError("STORE_CORRUPT", `context source grew beyond its descriptor: ${path}`);
  return Buffer.concat(chunks, length);
}

/** Check the descriptor again at the effect boundary; never follow a leaf link
 * and hash the bytes read from the same opened single-link regular descriptor.
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
  if (!observed?.isFile() || observed.isSymbolicLink() || observed.nlink !== 1 || observed.size !== entry.bytes)
    throw new StoreError("STORE_CORRUPT", `context source type/link/size mismatch: ${entry.path}`);
  let fd: number;
  try {
    // O_NONBLOCK prevents a replacement FIFO from hanging before fstat can
    // reject its type. It does not change reads from regular files.
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "ENOENT" || code === "ENOTDIR")
      throw new StoreError("STORE_CORRUPT", `context source changed before open: ${entry.path}`);
    throw error;
  }
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.dev !== observed.dev || before.ino !== observed.ino || before.size !== entry.bytes)
      throw new StoreError("STORE_CORRUPT", `context source identity changed: ${entry.path}`);
    const bytes = readFrozenLength(fd, entry.bytes, entry.path);
    const after = fstatSync(fd);
    if (!after.isFile() || after.nlink !== 1 || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256)
      throw new StoreError("STORE_CORRUPT", `context source bytes changed: ${entry.path}`);
    const contentError = contextFileCheck(entry.path, bytes);
    if (contentError) throw new StoreError("STORE_CORRUPT", `${entry.path}: ${contentError}`);
    return bytes;
  } finally { closeSync(fd); }
}
