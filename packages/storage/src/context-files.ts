/** CTX-001..004 / DB-009: physical checks complement the operation decoder.
 * Read and metadata handoff share one descriptor acquired beneath a pinned root.
 */
import { closeSync, fstatSync, readSync } from "node:fs";
import type { ContextEntry } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { sha256Hex } from "@oma/domain/canonical-json";
import { contextPathCheck, contextFileCheck } from "@oma/domain/context-policy";
import { openDirectory, openRegularBeneath } from "@oma/native/files";
export { assertDirectory as assertContextDirectory } from "./directory.js";
export { ensureDurableDirectory as ensureContextDirectory } from "./durable-fs.js";

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
export function readContextEntry(root: string | number, entry: ContextEntry, use?: (fd: number) => void): Buffer {
  const invalid = contextPathCheck(entry.path);
  if (invalid || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[0-9a-f]{64}$/.test(entry.sha256))
    throw new StoreError("STORE_CORRUPT", invalid ?? "invalid frozen context descriptor");
  const parent = typeof root === "string" ? openDirectory(root) : root;
  let fd: number;
  try { fd = openRegularBeneath(parent, entry.path); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "ENOENT" || code === "ENOTDIR")
      throw new StoreError("STORE_CORRUPT", `context source changed before open: ${entry.path}`);
    throw error;
  } finally { if (typeof root === "string") closeSync(parent); }
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size !== entry.bytes)
      throw new StoreError("STORE_CORRUPT", `context source identity changed: ${entry.path}`);
    const bytes = readFrozenLength(fd, entry.bytes, entry.path);
    const after = fstatSync(fd);
    if (!after.isFile() || after.nlink !== 1 || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256)
      throw new StoreError("STORE_CORRUPT", `context source bytes changed: ${entry.path}`);
    const contentError = contextFileCheck(entry.path, bytes);
    if (contentError) throw new StoreError("STORE_CORRUPT", `${entry.path}: ${contentError}`);
    use?.(fd);
    return bytes;
  } finally { closeSync(fd); }
}
