/** Directory-relative effects. Publication/repair policy belongs to shared TS
 * storage owners. No pathname reconstructed from a directory FD is accepted. */
import { closeSync, constants, fstatSync, type Stats } from "node:fs";
import { decode, errno, load } from "koffi";
import { getSystemErrorName } from "node:util";
import { StoreError } from "@oma/domain/errors";
import { decodeUtf8 } from "@oma/domain/utf8";
import { openBeneath } from "./files.js";
import { withCleanup } from "./cleanup.js";

let native: ReturnType<typeof initialize> | undefined;
function initialize() {
  if (process.platform !== "linux" && process.platform !== "darwin")
    throw new StoreError("UNSUPPORTED_PROFILE", "owned files require a supported POSIX kernel");
  const libc = load(null);
  return {
    mkdir: libc.func("int mkdirat(int fd, const char *name, unsigned int mode)"),
    unlink: libc.func("int unlinkat(int fd, const char *name, int flags)"),
    rename: libc.func("int renameat(int from, const char *source, int to, const char *name)"),
    link: libc.func("int linkat(int from, const char *source, int to, const char *name, int flags)"),
    open: libc.func("int openat(int fd, const char *name, int flags, ...)"),
    fdopendir: libc.func("void *fdopendir(int fd)"),
    // arm64 Darwin has only the native 64-bit-inode ABI; the compatibility
    // suffix belongs to Intel. The SDK layout is asserted by the CI probe.
    readdir: libc.func(process.platform === "darwin" && process.arch === "x64" ? "readdir$INODE64" : "readdir", "void *", ["void *"]),
    closedir: libc.func("int closedir(void *directory)"),
    symlink: libc.func("int symlinkat(const char *target, int fd, const char *name)"),
    readlink: libc.func("intptr_t readlinkat(int fd, const char *name, void *buffer, size_t size)"),
  };
}
function entry(fd: number, name: string): void {
  if (!Number.isSafeInteger(fd) || fd < 0 || !name || name.includes("/") || name.includes("\0") || name === "." || name === "..")
    throw new TypeError("owned operation requires a directory descriptor and one entry name");
}
function checked(result: number): void {
  if (result === 0) return;
  const code = getSystemErrorName(-errno());
  throw Object.assign(new Error(`directory-relative operation failed: ${code}`), { code });
}
export function mkdirAt(fd: number, name: string, mode = 0o755): void {
  entry(fd, name); checked((native ??= initialize()).mkdir(fd, name, mode));
}
export function unlinkAt(fd: number, name: string, directory = false): void {
  entry(fd, name); checked((native ??= initialize()).unlink(fd, name, directory ? (process.platform === "darwin" ? 0x80 : 0x200) : 0));
}
export function renameAt(from: number, source: string, to: number, name: string): void {
  entry(from, source); entry(to, name); checked((native ??= initialize()).rename(from, source, to, name));
}
export function linkAt(from: number, source: string, to: number, name: string): void {
  entry(from, source); entry(to, name); checked((native ??= initialize()).link(from, source, to, name, 0));
}
export function symlinkAt(target: string, fd: number, name: string): void {
  entry(fd, name);
  if (target.includes("\0")) throw new TypeError("invalid symlink target");
  checked((native ??= initialize()).symlink(target, fd, name));
}
export function readlinkAt(fd: number, name: string): string {
  entry(fd, name);
  const api = native ??= initialize();
  for (let capacity = 256; ; capacity *= 2) {
    const bytes = Buffer.alloc(capacity);
    const count = api.readlink(fd, name, bytes, bytes.length);
    if (count < 0) checked(-1);
    if (count < capacity) return decodeUtf8(bytes.subarray(0, count));
  }
}
/** An independent directory cursor under the held inode. fdopendir owns only
 * the newly opened descriptor; neither cursor nor close changes the caller's
 * descriptor. EOF is accepted only with errno zero. libc layouts stay here. */
export function directoryNames(fd: number): string[] {
  if (!Number.isSafeInteger(fd) || fd < 0) throw new TypeError("invalid directory descriptor");
  const api = native ??= initialize();
  const duplicate = api.open(fd, ".", constants.O_RDONLY | constants.O_DIRECTORY |
    (process.platform === "darwin" ? 0x01000000 : 0o2000000), "unsigned int", 0);
  if (duplicate < 0) checked(-1);
  const directory = api.fdopendir(duplicate);
  if (directory === null) {
    const failure = errno();
    return withCleanup(() => { errno(failure); checked(-1); throw new Error("fdopendir failed"); }, () => closeSync(duplicate));
  }
  return withCleanup(() => {
    const names: string[] = [];
    const offset = process.platform === "darwin" ? 21 : 19;
    for (;;) {
      errno(0);
      const pointer = api.readdir(directory);
      if (pointer === null) { if (errno() !== 0) checked(-1); break; }
      const header = Buffer.from(decode(pointer, "uint8_t", offset));
      const recordSize = header.readUInt16LE(16);
      if (recordSize <= offset || recordSize > (process.platform === "darwin" ? 1048 : 280))
        throw new Error("invalid native directory record");
      const record = Buffer.from(decode(pointer, "uint8_t", recordSize));
      const end = record.indexOf(0, offset);
      if (end < offset || (process.platform === "darwin" && end - offset !== header.readUInt16LE(18)))
        throw new Error("invalid native directory name");
      const name = decodeUtf8(record.subarray(offset, end));
      if (name === "." || name === "..") continue;
      entry(fd, name); names.push(name);
    }
    return names.sort();
  }, () => checked(api.closedir(directory)));
}
/** A no-I/O entry observation. A platform without the necessary entry pin
 * refuses before opening a FIFO/device or repairing a re-resolved pathname. */
export function statAt(fd: number, name: string): Stats;
export function statAt(fd: number, name: string, options: { readonly throwIfNoEntry: false }): Stats | undefined;
export function statAt(fd: number, name: string, options?: { readonly throwIfNoEntry: false }): Stats | undefined {
  entry(fd, name);
  let pin: number;
  try { pin = openBeneath(fd, name, 0o10000000 | constants.O_NOFOLLOW); }
  catch (error) { if (options && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  return withCleanup(() => fstatSync(pin), () => closeSync(pin));
}
