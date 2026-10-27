/** Hash a regular file from one held descriptor with fixed memory. A growing
 * file cannot prolong the read: only its observed size and one tail byte are
 * read, and both descriptor observations must agree. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, writeSync, fchmodSync, fsyncSync, type Stats } from "node:fs";
import { openBeneath } from "@oma/native/files";
import { withCleanup } from "@oma/native/cleanup";

function readDescriptor(fd: number, consume?: (bytes: Buffer, position: number) => void): { readonly stat: Stats; readonly sha256: string } {
  const before = fstatSync(fd);
  if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 0) throw new Error("expected a safely addressable regular file");
  const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024);
  let position = 0;
  while (position < before.size) {
    const count = readSync(fd, buffer, 0, Math.min(buffer.length, before.size - position), position);
    if (count === 0) break;
    const bytes = buffer.subarray(0, count);
    hash.update(bytes); consume?.(bytes, position); position += count;
  }
  const tail = readSync(fd, buffer, 0, 1, position);
  const after = fstatSync(fd);
  if (position !== before.size || tail !== 0 || after.dev !== before.dev || after.ino !== before.ino ||
      after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
    throw new Error("file changed while being read");
  return { stat: after, sha256: hash.digest("hex") };
}
export function fileDigest(path: string): { readonly stat: Stats; readonly sha256: string } {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { return readDescriptor(fd); }
  finally { closeSync(fd); }
}
/** A disposable copy from a held readable capability. Positional reads keep
 * its cursor unchanged, including after unlink/rename. Exclusive creation
 * never replaces another entry. The caller's leased staging owns a partial
 * copy on failure; this helper never unlinks an accepted source or grants a
 * same-UID immutable-content/exact-reopen guarantee. */
export function copyDescriptorToEntry(source: number, parent: number, name: string): { readonly bytes: number; readonly sha256: string } {
  if (!name || name.includes("/") || name === "." || name === ".." || name.includes("\0")) throw new TypeError("copy requires one destination entry name");
  // Refuse a FIFO/device before creating even a disposable output.
  const original = fstatSync(source);
  if (!original.isFile() || !Number.isSafeInteger(original.size) || original.size < 0) throw new Error("copy source is not a safely addressable regular file");
  const fd = openBeneath(parent, name, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  return withCleanup(() => {
    const copied = readDescriptor(source, (bytes, position) => {
      for (let at = 0; at < bytes.length;) {
        const count = writeSync(fd, bytes, at, bytes.length - at, position + at);
        if (count === 0) throw new Error("copy destination stopped accepting bytes");
        at += count;
      }
    });
    const sealed = readDescriptor(fd);
    if (copied.stat.size !== original.size || copied.stat.dev !== original.dev || copied.stat.ino !== original.ino ||
        copied.stat.mtimeMs !== original.mtimeMs || copied.stat.ctimeMs !== original.ctimeMs || sealed.sha256 !== copied.sha256 ||
        sealed.stat.size !== copied.stat.size || sealed.stat.nlink !== 1) throw new Error("disposable copy differs from its held source");
    fchmodSync(fd, 0o444); fsyncSync(fd); fsyncSync(parent);
    return Object.freeze({ bytes: copied.stat.size, sha256: copied.sha256 });
  }, () => closeSync(fd));
}
