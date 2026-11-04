/** User immutable flags on an already held owned inode. This is a kernel
 * effect, not an immutable generation owner or an execution-death proof. */
import { fstatSync } from "node:fs";
import { errno, load } from "koffi";
import { getSystemErrorName } from "node:util";
import { StoreError } from "@oma/domain/errors";

const USER_IMMUTABLE = 2;
let calls: { stat(fd: number, bytes: Buffer): number; flags(fd: number, value: number): number } | undefined;
function unsupported(message: string): never { throw new StoreError("UNSUPPORTED_PROFILE", message); }
function native() {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch) || (process.getuid?.() ?? 0) <= 0)
    unsupported("immutable inode flags require an ordinary Darwin owner");
  if (calls === undefined) {
    const library = load(null);
    calls = { stat: library.func(process.arch === "x64" ? "fstat$INODE64" : "fstat", "int", ["int", "void *"]),
      flags: library.func("int fchflags(int fd, unsigned int flags)") };
  }
  return calls;
}
function checked(result: number): void {
  if (result === 0) return;
  const code = getSystemErrorName(-errno());
  throw Object.assign(new Error(`Darwin held inode flags: ${code}`), { code });
}
function snapshot(fd: number) {
  const api = native();
  if (!Number.isSafeInteger(fd) || fd < 0) throw new TypeError("invalid immutable inode descriptor");
  const before = fstatSync(fd, { bigint: true }), bytes = Buffer.alloc(144);
  if ((!before.isFile() && !before.isDirectory()) || before.uid !== BigInt(process.getuid!()) ||
      before.isFile() && before.nlink !== 1n) unsupported("immutable entry must be an owned regular inode without aliases or a directory");
  checked(api.stat(fd, bytes));
  // Public 64-bit inode stat ABI, independently compared with Node's native
  // reader on this exact descriptor. Actual C probes also read st_flags.
  const after = fstatSync(fd, { bigint: true });
  if (["dev", "ino", "mode", "uid", "gid", "nlink", "size"].some(key => before[key as "dev"] !== after[key as "dev"]) ||
      BigInt.asUintN(64, BigInt(bytes.readInt32LE(0))) !== after.dev || bytes.readBigUInt64LE(8) !== after.ino ||
      BigInt(bytes.readUInt16LE(4)) !== after.mode || BigInt(bytes.readUInt16LE(6)) !== after.nlink ||
      BigInt(bytes.readUInt32LE(16)) !== after.uid || BigInt(bytes.readUInt32LE(20)) !== after.gid ||
      bytes.readBigInt64LE(96) !== after.size) unsupported("Darwin held inode layout or identity changed");
  return { stat: after, flags: bytes.readUInt32LE(116) };
}
export function darwinOwnedEntryFlags(fd: number): number { return snapshot(fd).flags; }
/** Preserves every other flag. The caller must retain its scope/generation
 * ownership until complete execution death before clearing this bit. A
 * read-only descriptor does not itself prevent an unsandboxed owner unseal. */
export function setDarwinUserImmutable(fd: number, immutable: boolean): void {
  if (typeof immutable !== "boolean") throw new TypeError("invalid immutable flag value");
  const before = snapshot(fd), desired = (immutable ? before.flags | USER_IMMUTABLE : before.flags & ~USER_IMMUTABLE) >>> 0;
  checked(native().flags(fd, desired));
  const after = snapshot(fd);
  if (after.stat.dev !== before.stat.dev || after.stat.ino !== before.stat.ino || after.flags !== desired)
    unsupported("Darwin immutable flag effect was not observed on the held inode");
}
