/** POSIX descriptor mechanics only. No OMA policy, metadata helper or runtime. */
import { closeSync, constants } from "node:fs";
import { getSystemErrorName } from "node:util";
import { decode, errno, load } from "koffi";

let native: ReturnType<typeof initialize> | undefined;
function initialize() {
  if (process.platform !== "linux" && process.platform !== "darwin")
    throw new Error("descriptor operations require Linux or Darwin");
  const libc = load(null);
  return {
    open: libc.func("int openat(int fd, const char *name, int flags, ...)"),
    mkdir: libc.func("int mkdirat(int fd, const char *name, unsigned int mode)"),
    unlink: libc.func("int unlinkat(int fd, const char *name, int flags)"),
    fdopendir: libc.func("void *fdopendir(int fd)"),
    readdir: libc.func(process.platform === "darwin" && process.arch === "x64" ? "readdir$INODE64" : "readdir", "void *", ["void *"]),
    closedir: libc.func("int closedir(void *directory)"),
  };
}
function descriptor(fd: number): void {
  if (!Number.isSafeInteger(fd) || fd < 0) throw new TypeError("invalid directory descriptor");
}
function entry(fd: number, name: string): void {
  descriptor(fd);
  if (!name || name.includes("/") || name.includes("\0") || name === "." || name === "..")
    throw new TypeError("descriptor operation requires one entry name");
}
function checked(result: number): number {
  if (result >= 0) return result;
  const code = getSystemErrorName(-errno());
  throw Object.assign(new Error(`directory-relative operation failed: ${code}`), { code });
}
const closeOnExec = () => process.platform === "darwin" ? 0x01000000 : 0o2000000;

/** One leaf only. The caller owns the returned FD; no symlink is followed. */
export function openAt(fd: number, name: string, flags: number, mode = 0): number {
  entry(fd, name);
  return checked((native ??= initialize()).open(fd, name, flags | constants.O_NOFOLLOW | closeOnExec(),
    "unsigned int", (flags & constants.O_CREAT) !== 0 ? mode : 0));
}
export function mkdirAt(fd: number, name: string, mode = 0o755): void {
  entry(fd, name); checked((native ??= initialize()).mkdir(fd, name, mode));
}
export function unlinkAt(fd: number, name: string, directory = false): void {
  entry(fd, name);
  checked((native ??= initialize()).unlink(fd, name, directory ? (process.platform === "darwin" ? 0x80 : 0x200) : 0));
}
/** A fresh directory cursor on the held inode, not a descriptor alias. */
export function reopenDirectory(fd: number): number {
  descriptor(fd);
  return checked((native ??= initialize()).open(fd, ".", constants.O_RDONLY | constants.O_DIRECTORY | closeOnExec(), "unsigned int", 0));
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
/** fdopendir consumes only our fresh cursor; the caller's FD remains untouched. */
export function directoryNames(fd: number): string[] {
  const duplicate = reopenDirectory(fd), api = native!;
  const directory = api.fdopendir(duplicate);
  if (directory === null) {
    const code = getSystemErrorName(-errno());
    const failure = Object.assign(new Error(`fdopendir failed: ${code}`), { code });
    try { closeSync(duplicate); }
    catch (cleanup) { throw new AggregateError([failure, cleanup], "fdopendir and cleanup failed"); }
    throw failure;
  }
  let primary: unknown, failed = false;
  try {
    const names: string[] = [], offset = process.platform === "darwin" ? 21 : 19;
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
      const name = utf8.decode(record.subarray(offset, end));
      if (name === "." || name === "..") continue;
      entry(fd, name); names.push(name);
    }
    return names.sort();
  } catch (error) { failed = true; primary = error; throw error; }
  finally {
    try { checked(api.closedir(directory)); }
    catch (error) {
      if (failed) throw new AggregateError([primary, error], "directory read and cleanup failed");
      throw error;
    }
  }
}
