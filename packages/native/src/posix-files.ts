/** Directory-relative effects. Publication/repair policy belongs to shared TS
 * storage owners. No pathname reconstructed from a directory FD is accepted. */
import { closeSync, constants, fstatSync, type BigIntStats, type Stats } from "node:fs";
import { decode, errno, load } from "koffi";
import { getSystemErrorName } from "node:util";
import { StoreError } from "@oma/domain/errors";
import { decodeUtf8 } from "@oma/domain/utf8";
import { openBeneath } from "./files.js";
import { withCleanup } from "./cleanup.js";
import type { EntryMetadataObservation } from "./metadata-observation.js";
import { darwinMetadata } from "./darwin-metadata.js";

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
export function readlinkBytesAt(fd: number, name: string): Buffer {
  entry(fd, name);
  const api = native ??= initialize();
  for (let capacity = 256; ; capacity *= 2) {
    const bytes = Buffer.alloc(capacity);
    const count = api.readlink(fd, name, bytes, bytes.length);
    if (count < 0) checked(-1);
    if (count < capacity) return bytes.subarray(0, count);
  }
}
export function readlinkAt(fd: number, name: string): string {
  return decodeUtf8(readlinkBytesAt(fd, name));
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
let darwinStat: ((fd: number, name: string, result: Buffer, flags: number) => number) | undefined;
let darwinStatLayoutChecked = false;
/** Decode the public 64-bit-inode stat ABI. This is one no-follow metadata
 * observation, not an entry pin, repair capability or proof about a later open.
 * SDK offsets are independently asserted by the real Darwin C probe. */
function darwinStatAt(fd: number, name: string, bigint: boolean): Stats | BigIntStats {
  if (!["arm64", "x64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "Darwin stat requires a supported 64-bit inode ABI");
  darwinStat ??= load(null).func(process.arch === "x64" ? "fstatat$INODE64" : "fstatat", "int",
    ["int", "const char *", "void *", "int"]);
  const bytes = Buffer.alloc(144);
  if (!darwinStatLayoutChecked) {
    // Compare the actual held directory with Node's independent native reader
    // before decoding a target. This checks layout only, never target liveness
    // or the stability of a later pathname operation.
    const own = fstatSync(fd, { bigint: true });
    checked(darwinStat(fd, ".", bytes, 0x20));
    if (BigInt.asUintN(64, BigInt(bytes.readInt32LE(0))) !== own.dev ||
        bytes.readBigUInt64LE(8) !== own.ino || BigInt(bytes.readUInt16LE(4)) !== own.mode ||
        BigInt(bytes.readUInt32LE(16)) !== own.uid || BigInt(bytes.readUInt32LE(20)) !== own.gid)
      throw new StoreError("UNSUPPORTED_PROFILE", "Darwin stat layout could not be independently observed");
    darwinStatLayoutChecked = true;
  }
  checked(darwinStat(fd, name, bytes, 0x20 /* AT_SYMLINK_NOFOLLOW */));
  // Obtain the public Node Stats shape/methods without private imports or the
  // deprecated Stats constructor. Replace every metadata field with the target
  // syscall's result; no parent metadata is returned as target evidence.
  const result = bigint ? fstatSync(fd, { bigint: true }) : fstatSync(fd);
  const value = (n: bigint): number | bigint => bigint ? n : Number(n);
  const unsigned = (n: bigint): number | bigint => value(BigInt.asUintN(64, n));
  const fields: Record<string, number | bigint> = {
    dev: unsigned(BigInt(bytes.readInt32LE(0))), mode: value(BigInt(bytes.readUInt16LE(4))),
    nlink: value(BigInt(bytes.readUInt16LE(6))), uid: value(BigInt(bytes.readUInt32LE(16))),
    gid: value(BigInt(bytes.readUInt32LE(20))), rdev: unsigned(BigInt(bytes.readInt32LE(24))),
    blksize: unsigned(BigInt(bytes.readInt32LE(112))), ino: value(bytes.readBigUInt64LE(8)),
    size: unsigned(bytes.readBigInt64LE(96)), blocks: unsigned(bytes.readBigInt64LE(104)),
  };
  for (const [name, offset] of [["atime", 32], ["mtime", 48], ["ctime", 64], ["birthtime", 80]] as const) {
    const seconds = bytes.readBigInt64LE(offset), nanoseconds = bytes.readBigInt64LE(offset + 8);
    if (nanoseconds < 0n || nanoseconds >= 1_000_000_000n)
      throw new StoreError("UNSUPPORTED_PROFILE", "Darwin stat returned an unrecognized timestamp layout");
    const total = seconds * 1_000_000_000n + nanoseconds;
    fields[`${name}Ms`] = bigint ? total / 1_000_000n : Number(seconds) * 1000 + Number(nanoseconds) / 1_000_000;
    if (bigint) fields[`${name}Ns`] = total;
  }
  return Object.assign(result, fields);
}

/** A no-I/O entry observation. Darwin uses one directory-relative fstatat;
 * Linux uses an O_PATH pin. Neither opens a FIFO/device for content I/O. */
export function statAt(fd: number, name: string): Stats;
export function statAt(fd: number, name: string, options: { readonly bigint: true; readonly throwIfNoEntry?: true }): BigIntStats;
export function statAt(fd: number, name: string, options: { readonly bigint: true; readonly throwIfNoEntry: false }): BigIntStats | undefined;
export function statAt(fd: number, name: string, options: { readonly throwIfNoEntry: false }): Stats | undefined;
export function statAt(fd: number, name: string, options?: { readonly bigint?: boolean; readonly throwIfNoEntry?: boolean }): Stats | BigIntStats | undefined {
  entry(fd, name);
  if (process.platform === "darwin") {
    try { return darwinStatAt(fd, name, options?.bigint === true); }
    catch (error) { if (options?.throwIfNoEntry === false && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  let pin: number;
  try { pin = openBeneath(fd, name, 0o10000000 | constants.O_NOFOLLOW); }
  catch (error) { if (options?.throwIfNoEntry === false && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  return withCleanup(() => options?.bigint ? fstatSync(pin, { bigint: true }) : fstatSync(pin), () => closeSync(pin));
}

/** A cache with unpreserved metadata needs a richer verification protocol. This is
 * one no-follow observation, not a pin or proof about a later entry. */
let listExtended: ((path: string, list: null, size: number) => number) | undefined;
function linuxMetadata(parent: number, name: string): EntryMetadataObservation {
  listExtended ??= load(null).func("long llistxattr(const char *path, void *list, unsigned long size)");
  const size = listExtended(`/proc/self/fd/${parent}/${name}`, null, 0);
  if (size < 0) {
    const code = errno();
    if (code === 95 /* EOPNOTSUPP: filesystem stores no attributes */) return { extendedAttributeBytes: 0n, darwin: null };
    throw new Error(`session extended attributes could not be observed (errno ${code})`);
  }
  return { extendedAttributeBytes: BigInt(size), darwin: null };
}
const metadataReaders = { linux: linuxMetadata, darwin: darwinMetadata };
export function assertNoUnpreservedMetadataAt(parent: number, name: string): void {
  entry(parent, name);
  const reader = metadataReaders[process.platform as keyof typeof metadataReaders];
  if (!reader) throw new StoreError("UNSUPPORTED_PROFILE", "metadata observation requires a supported POSIX kernel");
  const observed = reader(parent, name);
  if (observed.extendedAttributeBytes !== 0n || (observed.darwin !== null &&
      (observed.darwin.bsdFlags !== 0 || observed.darwin.aclPresent)))
    throw new Error("session workspace has unpreserved metadata; retained without reclamation");
}
