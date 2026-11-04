import { fstatSync, lstatSync } from "node:fs";
import { isAbsolute, normalize, join } from "node:path";
import { StoreError, unobserved } from "@oma/domain/errors";
import { load } from "koffi";

export interface DarwinDirectoryFilesystem {
  readonly type: number;
  readonly name: string;
  readonly local: boolean;
  readonly readOnly: boolean;
  readonly userSpace: boolean;
}
let filesystemCall: ((fd: number, output: Buffer) => number) | undefined;
/** Public 64-bit statfs ABI from sys/mount.h, independently checked against C
 * on the actual OS. Type numbers belong to Darwin, not Linux's magic table.
 * A held directory is observed; this grants no write or storage authority. */
export function darwinDirectoryFilesystem(fd: number): DarwinDirectoryFilesystem {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "Darwin filesystem observation requires the 64-bit backend");
  if (!Number.isSafeInteger(fd) || fd < 0 || !fstatSync(fd).isDirectory()) throw new TypeError("filesystem observation requires a directory descriptor");
  filesystemCall ??= load(null).func(process.arch === "arm64" ? "fstatfs" : "fstatfs$INODE64", "int", ["int", "void *"]);
  const output = Buffer.alloc(2168);
  if (filesystemCall(fd, output) !== 0)
    throw new StoreError("UNSUPPORTED_PROFILE", "Darwin directory filesystem could not be observed");
  const type = output.readUInt32LE(60), flags = output.readUInt32LE(64), field = output.subarray(72, 88), end = field.indexOf(0);
  const name = field.subarray(0, Math.max(0, end)).toString("ascii");
  if (type === 0 || end < 1 || !/^[A-Za-z0-9._-]+$/.test(name) || !Buffer.from(name, "ascii").equals(field.subarray(0, end)))
    throw new StoreError("UNSUPPORTED_PROFILE", "Darwin directory filesystem observation is malformed");
  return Object.freeze({ type, name,
    local: (flags & 0x1000 /* MNT_LOCAL */) !== 0, readOnly: (flags & 1 /* MNT_RDONLY */) !== 0,
    userSpace: (output.readUInt32LE(2136) & 2 /* MNT_EXT_FSKIT */) !== 0 });
}

/** Host compatibility policy, not an authorization token: runtime traversal still
 * uses openat2 below these paths. Missing suffixes may be created only by startup. */
export function assertHostDirectoryLayout(path: string, allowMissing = false): void {
  if (!isAbsolute(path) || path.includes("\0") || normalize(path) !== path)
    throw new StoreError("UNSUPPORTED_PROFILE", "host directory must be a normalized absolute path");
  let current = "/";
  for (const component of path.slice(1).split("/").filter(Boolean)) {
    current = join(current, component);
    let stat;
    try { stat = lstatSync(current, { throwIfNoEntry: false }); }
    catch (cause) { throw unobserved(cause, "the host directory layout") ?? new StoreError("UNSUPPORTED_PROFILE", "host directory layout is not a supported one", { cause }); }
    if (!stat && allowMissing) return;
    if (!stat?.isDirectory())
      throw new StoreError("UNSUPPORTED_PROFILE", "host directory ancestors must be real directories, not symlinks");
  }
}

