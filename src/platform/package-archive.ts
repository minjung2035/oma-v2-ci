import { PACKAGE_ARCHIVE_BOUNDS } from "../domain/package-policy.js";
export { PACKAGE_ARCHIVE_BOUNDS } from "../domain/package-policy.js";
/** DR25 on macOS: the package store as it travels from the Mac to the engine.
 *
 * The guest has no network (MAC-203), so the packages `oma pi install`
 * installs on the Mac are carried to it whole. Both ends are this code, so the
 * form is this product's own, closed and bounded, not an archive format with
 * links, devices and owners to be refused one by one:
 *
 *   "oma-packages-v1\n", then entries, each
 *     kind (u8: 1 directory, 2 file, 0 end), path length (u16 BE), path (UTF-8),
 *     and for a file: executable (u8: 0 or 1), size (u32 BE high, u32 BE low), bytes
 *
 * What travels is the engine package manager's own list (`settings.json`) and
 * what it installed (`npm/`, `git/`, and the `local/` copies staged from local
 * paths (C20)): directories and regular files only. A link (npm's `.bin`), a
 * repository's `.git` and anything else stay behind; no engine loads them. A
 * directory comes before what is in it.
 */
import { closeSync, constants, mkdirSync, openSync, readSync, writeSync } from "node:fs";
import { entryAt, openBeneath, withinDirectory } from "../storage/contained-fs.js";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { decodeUtf8 } from "../domain/utf8.js";
import { StoreError } from "../domain/errors.js";
const MAGIC = Buffer.from("oma-packages-v1\n", "utf8");
/** What of the store travels: the package manager's list and what it installed. */
const ROOTS = Object.freeze({ files: ["settings.json"], directories: ["npm", "git", "local"] });
const SKIPPED_DIRECTORIES = new Set([".git"]);

function pathProblem(path: string): string | null {
  const bytes = Buffer.byteLength(path, "utf8");
  if (bytes === 0 || bytes > PACKAGE_ARCHIVE_BOUNDS.pathBytes || path.includes("\0") || path.includes("\\")) return "invalid path";
  const parts = path.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || Buffer.byteLength(part, "utf8") > PACKAGE_ARCHIVE_BOUNDS.componentBytes))
    return "path is not a normalized relative path";
  return null;
}

/** Writes the store's list and what it installed to `out`. */
export async function writePackageArchive(store: string, out: string): Promise<{ readonly entries: number; readonly bytes: number }> {
  const file = await open(out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let entries = 0, bytes = 0;
  const write = async (buffer: Buffer): Promise<void> => {
    for (let at = 0; at < buffer.length;) {
      const result = await file.write(buffer, at, buffer.length - at);
      if (result.bytesWritten === 0) throw new StoreError("INTERNAL_ERROR", "could not write the packages archive");
      at += result.bytesWritten;
    }
  };
  const header = (kind: number, path: string): Buffer => {
    const name = Buffer.from(path, "utf8");
    const head = Buffer.alloc(3); head.writeUInt8(kind, 0); head.writeUInt16BE(name.length, 1);
    return Buffer.concat([head, name]);
  };
  const count = (size = 0): void => {
    // Counted for the report, never refused: the write streams, so an
    // installed store's size is not a carry refusal.
    entries += 1; bytes += size;
  };
  const addFile = async (path: string, relative: string, mode: number, size: number): Promise<void> => {
    count(size);
    const input = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await input.stat();
      if (!before.isFile() || before.size !== size || before.mode !== mode)
        throw new StoreError("POLICY_CHANGED", `a package file changed while it was read: ${relative}`);
      const size64 = Buffer.alloc(9); size64.writeUInt8((mode & 0o111) !== 0 ? 1 : 0, 0);
      size64.writeUInt32BE(Math.floor(size / 2 ** 32), 1); size64.writeUInt32BE(size % 2 ** 32, 5);
      await write(Buffer.concat([header(2, relative), size64]));
      const buffer = Buffer.alloc(64 * 1024);
      let position = 0;
      while (position < size) {
        const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, size - position), position);
        if (bytesRead === 0) break;
        await write(buffer.subarray(0, bytesRead)); position += bytesRead;
      }
      const tail = await input.read(buffer, 0, 1, position);
      const after = await input.stat();
      if (position !== size || tail.bytesRead !== 0 || before.dev !== after.dev || before.ino !== after.ino ||
          before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
        throw new StoreError("POLICY_CHANGED", `a package file changed while it was read: ${relative}`);
    } finally { await input.close(); }
  };
  const walk = async (path: string, relative: string): Promise<void> => {
    count();
    await write(header(1, relative));
    for (const name of (await readdir(path)).sort()) {
      const child = join(path, name), inside = `${relative}/${name}`;
      if (pathProblem(inside) !== null) throw new StoreError("INVALID_REQUEST", `a package path cannot be carried: ${inside}`);
      const stat = await lstat(child);
      if (stat.isDirectory()) { if (!SKIPPED_DIRECTORIES.has(name)) await walk(child, inside); }
      else if (stat.isFile()) await addFile(child, inside, stat.mode, stat.size);
    }
  };
  try {
    await write(MAGIC);
    for (const name of ROOTS.files) {
      const stat = await lstat(join(store, name)).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (stat?.isFile()) await addFile(join(store, name), name, stat.mode, stat.size);
    }
    for (const name of ROOTS.directories) {
      const stat = await lstat(join(store, name)).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (stat?.isDirectory()) await walk(join(store, name), name);
    }
    await write(Buffer.from([0]));
    await file.sync();
  } finally { await file.close(); }
  return Object.freeze({ entries, bytes });
}

/** Reads an archive into `into`, a new empty directory, refusing anything the
 * writer would not have written. On a refusal what was written stays in
 * `into`, which is the caller's to remove. */
export function readPackageArchive(archive: string, into: string): { readonly entries: number; readonly bytes: number } {
  const fd = openSync(archive, constants.O_RDONLY | constants.O_NOFOLLOW);
  let position = 0;
  const take = (length: number): Buffer => {
    const out = Buffer.alloc(length);
    let used = 0;
    while (used < length) {
      const read = readSync(fd, out, used, length - used, position + used);
      if (read === 0) throw new StoreError("STREAM_INVALID", "the packages archive ends early");
      used += read;
    }
    position += length;
    return out;
  };
  let entries = 0, bytes = 0;
  const made = new Set<string>();
  try {
    if (!take(MAGIC.length).equals(MAGIC)) throw new StoreError("STREAM_INVALID", "not a packages archive");
    for (;;) {
      const kind = take(1).readUInt8(0);
      if (kind === 0) break;
      if (kind !== 1 && kind !== 2) throw new StoreError("STREAM_INVALID", "the packages archive has an unknown entry");
      if (++entries > PACKAGE_ARCHIVE_BOUNDS.entries) throw new StoreError("LIMIT_EXCEEDED", "the packages archive has too many entries");
      const length = take(2).readUInt16BE(0);
      if (length > PACKAGE_ARCHIVE_BOUNDS.pathBytes) throw new StoreError("STREAM_INVALID", "the packages archive names an invalid path");
      let path: string;
      try { path = decodeUtf8(take(length)); } catch { throw new StoreError("STREAM_INVALID", "the packages archive path is not UTF-8"); }
      const problem = pathProblem(path);
      if (problem !== null) throw new StoreError("STREAM_INVALID", `the packages archive names ${problem}`);
      const parts = path.split("/");
      const parent = parts.slice(0, -1).join("/");
      const rooted = parts.length === 1
        ? (kind === 1 ? ROOTS.directories.includes(path) : ROOTS.files.includes(path))
        : made.has(parent);
      if (!rooted || made.has(path)) throw new StoreError("STREAM_INVALID", `the packages archive names ${path} out of place`);
      // FS-005: every entry is made through its parent, resolved once, never by a path a link could redirect.
      if (kind === 1) { withinDirectory(join(into, path), (parent, name) => { mkdirSync(entryAt(parent, name), { mode: 0o755 }); }); made.add(path); continue; }
      const head = take(9);
      if (head.readUInt8(0) > 1) throw new StoreError("STREAM_INVALID", "the packages archive has an invalid executable flag");
      const size = head.readUInt32BE(1) * 2 ** 32 + head.readUInt32BE(5);
      if (!Number.isSafeInteger(size) || !Number.isSafeInteger(bytes + size))
        throw new StoreError("STREAM_INVALID", "the packages archive names a size that cannot be observed exactly");
      bytes += size;
      const out = withinDirectory(join(into, path), (parent, name) =>
        openBeneath(parent, name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, head.readUInt8(0) === 1 ? 0o755 : 0o644));
      try {
        for (let left = size; left > 0;) {
          const chunk = take(Math.min(left, 1024 * 1024));
          for (let at = 0; at < chunk.length;) at += writeSync(out, chunk, at, chunk.length - at);
          left -= chunk.length;
        }
      } finally { closeSync(out); }
      made.add(path);
    }
    const tail = Buffer.alloc(1);
    if (readSync(fd, tail, 0, 1, position) !== 0) throw new StoreError("STREAM_INVALID", "the packages archive goes on after its end");
  } finally { closeSync(fd); }
  return Object.freeze({ entries, bytes });
}
