/** MAIL-004..006 / FS-002: immutable bytes, never a derived overwrite API.
 * Multiple hardlink names are legitimate mail artifacts. Context's single-link
 * requirement is a separate policy, not a global filesystem rule.
 */
import {
  constants, closeSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync,
  mkdirSync, openSync, readSync, unlinkSync, writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { sha256Hex } from "../domain/canonical-json.js";
import { StoreError } from "../domain/errors.js";
import { fsyncDir } from "./durable-fs.js";

/** Return the exact descriptor whose bytes were checked. Holding this descriptor
 * prevents a pathname replacement between validation and chmod/fsync from being
 * mistaken for validation of the replacement. Parent races remain a host gate.
 */
function verifiedFile(path: string, expectedHash?: string): { fd: number; bytes: Buffer; hash: string } {
  const observed = lstatSync(path);
  if (!observed.isFile() || observed.isSymbolicLink()) throw new StoreError("STORE_CORRUPT", `non-regular immutable file: ${path}`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.dev !== observed.dev || before.ino !== observed.ino || !Number.isSafeInteger(before.size) || before.size < 0)
      throw new StoreError("STORE_CORRUPT", `immutable file identity changed: ${path}`);
    const parts: Buffer[] = [];
    let remaining = before.size;
    while (remaining > 0) {
      const part = Buffer.allocUnsafe(Math.min(remaining, 64 * 1024));
      const count = readSync(fd, part, 0, part.length, null);
      if (count === 0) throw new StoreError("STORE_CORRUPT", `immutable file truncated: ${path}`);
      parts.push(part.subarray(0, count)); remaining -= count;
    }
    if (readSync(fd, Buffer.allocUnsafe(1), 0, 1, null) !== 0) throw new StoreError("STORE_CORRUPT", `immutable file grew: ${path}`);
    const after = fstatSync(fd);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new StoreError("STORE_CORRUPT", `immutable file bytes changed: ${path}`);
    const bytes = Buffer.concat(parts, before.size);
    const hash = sha256Hex(bytes);
    if (expectedHash !== undefined && hash !== expectedHash) throw new StoreError("STORE_CORRUPT", `immutable file hash mismatch: ${path}`);
    return { fd, bytes, hash };
  } catch (error) { closeSync(fd); throw error; }
}

/** Same name and bytes = idempotent success; different bytes/type = corruption.
 * Source ownership is NOT transferred. The mail caller removes its writable
 * staging alias after publication; accepted source evidence is never GC'd here.
 * EXDEV ordering: destination temporary write/fsync/close -> verify -> exclusive
 * link -> verify public descriptor/chmod/fsync/close -> parent fsync -> unlink
 * owned temporary -> parent fsync. A failed post-publication flush is ambiguous,
 * never proof that nothing became visible and never permission to overwrite.
 */
export function publishImmutableFile(source: string, destination: string, expectedHash?: string): void {
  const original = verifiedFile(source, expectedHash);
  closeSync(original.fd);
  mkdirSync(dirname(destination), { recursive: true });
  let temporary: string | null = null;
  let ownsTemporary = false;
  try {
    try { linkSync(source, destination); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
        const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        ownsTemporary = true;
        try { writeFileSync(fd, original.bytes); fsyncSync(fd); } finally { closeSync(fd); }
        const staged = verifiedFile(temporary, original.hash);
        closeSync(staged.fd);
        try { linkSync(temporary, destination); }
        catch (publicationError) {
          if ((publicationError as NodeJS.ErrnoException).code !== "EEXIST") throw publicationError;
        }
      } else if (code !== "EEXIST") throw error;
    }
    const published = verifiedFile(destination, original.hash);
    try { fchmodSync(published.fd, 0o444); fsyncSync(published.fd); } finally { closeSync(published.fd); }
    fsyncDir(dirname(destination));
  } finally {
    if (ownsTemporary && temporary !== null) {
      unlinkSync(temporary);
      fsyncDir(dirname(temporary));
    }
  }
}
