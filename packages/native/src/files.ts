/** Linux filesystem capabilities for staging/file handoff, not a full hostile-host
 * or SQLite/Git VFS boundary. An open fd pins identity, not immutable contents.
 * No lstat/open fallback when openat2 containment is unavailable.
 */
import { chmodSync, constants, closeSync, fstatSync, openSync } from "node:fs";
import { basename, dirname } from "node:path";
import { getSystemErrorName } from "node:util";
import { load, errno } from "koffi";
import { StoreError } from "@oma/domain/errors";
import { withCleanup } from "./cleanup.js";

/** P0V-65, P0-4: gives back every descriptor it is handed, whichever of them
 * fails to close -- Linux releases a number even when close reports an error
 * (P0V-49), so one failure is no reason to keep the others. The first failure
 * is reported once every close has been attempted. */
export function closeEvery(...descriptors: readonly (number | null | undefined)[]): void {
  let failure: { readonly error: unknown } | null = null;
  for (const fd of descriptors) {
    if (fd === null || fd === undefined) continue;
    try { closeSync(fd); } catch (error) { failure ??= { error }; }
  }
  if (failure !== null) throw failure.error;
}

let native:
  | {
      open: (nr: number, ...args: unknown[]) => number;
      link: (
        from: number,
        source: string,
        to: number,
        name: string,
        flags: number,
      ) => number;
    }
  | undefined;
function syscalls() {
  if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch))
    throw new StoreError(
      "UNSUPPORTED_PROFILE",
      "contained filesystem access requires Linux x64/arm64 openat2",
    );
  if (!native) {
    const libc = load(null);
    native = {
      open: libc.func("long syscall(long nr, ...)"),
      link: libc.func(
        "int linkat(int from, const char *source, int to, const char *name, int flags)",
      ),
    };
  }
  return native;
}
let darwinOpen: ((directory: number, path: string, flags: number, type: string, mode: number) => number) | undefined;
function checked(result: number): number {
  if (result >= 0) return result;
  const value = errno();
  if (value === 38 || value === 22)
    throw new StoreError(
      "UNSUPPORTED_PROFILE",
      "required contained filesystem syscall is unavailable",
    );
  const code = getSystemErrorName(-value);
  throw Object.assign(
    new Error(`contained filesystem operation failed: ${code}`),
    { code },
  );
}
function relativeName(path: string): void {
  if (
    !path ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new StoreError(
      "STORE_CORRUPT",
      "filesystem name must be relative and canonical",
    );
}
/** Caller owns the result; symlinks/magic links and escapes are rejected in-kernel. */
export function openBeneath(
  directory: number,
  path: string,
  flags: number,
  mode = 0,
): number {
  relativeName(path);
  if (!Number.isInteger(directory) || directory < 0)
    throw new TypeError("invalid directory descriptor");
  if (process.platform === "darwin") {
    // No component walk fallback: a moved intermediate directory could leave
    // the held root between opens. Require the kernel's beneath/no-link walk.
    // Darwin arm64 passes variadic arguments on the stack. Declaring mode as
    // a fixed fourth argument can create mode-000 files despite a 0600 input.
    darwinOpen ??= load(null).func("int openat(int directory, const char *path, int flags, ...)");
    if ((flags & 0o10000000 /* Linux O_PATH */) !== 0)
      throw new StoreError("UNSUPPORTED_PROFILE", "G-FILES: Darwin has no verified permission-independent entry pin and exact reopen");
    // O_NOFOLLOW_ANY also rejects the final symlink. XNU rejects combining
    // it with O_NOFOLLOW, which shared callers may already have requested.
    const containedFlags = (flags & ~constants.O_NOFOLLOW) | 0x01000000 /* O_CLOEXEC */ |
      0x20000000 /* O_NOFOLLOW_ANY */ | 0x1000 /* O_RESOLVE_BENEATH */;
    const result = darwinOpen(directory, path, containedFlags,
      "unsigned int", mode);
    if (result < 0 && [20, 62, 107].includes(errno()))
      throw new StoreError("STORE_CORRUPT", "filesystem containment rejected a link or path escape");
    return checked(result);
  }
  const how = Buffer.alloc(24);
  how.writeBigUInt64LE(BigInt(flags | 0o2000000 /* O_CLOEXEC */), 0);
  how.writeBigUInt64LE(BigInt(mode), 8);
  how.writeBigUInt64LE(0x0cn, 16); // RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS
  // glibc reads all six syscall argument slots, including unused ones. Supply
  // both trailing slots: Koffi's foreign stack may end immediately after our args.
  const result = syscalls().open(437, "int", directory, "const char *", path, "const void *", how, "size_t", how.byteLength, "long", 0, "long", 0);
  if (result < 0 && [18, 20, 40].includes(errno()))
    throw new StoreError(
      "STORE_CORRUPT",
      "filesystem containment rejected a link or path escape",
    );
  return checked(result);
}
/** Inspect with O_PATH before opening for I/O, so a raced FIFO/device is never consumed. */
export function openRegularBeneath(directory: number, path: string): number {
  const pin = openBeneath(
    directory,
    path,
    0o10000000 /* O_PATH */ | constants.O_NOFOLLOW,
  );
  let result: number | undefined;
  try {
    return withCleanup(() => {
      if (!fstatSync(pin).isFile())
        throw new StoreError(
          "STORE_CORRUPT",
          "contained entry is not a regular file",
        );
      result = openSync(
        `/proc/self/fd/${pin}`,
        constants.O_RDONLY | constants.O_NONBLOCK,
      );
      return result;
    }, () => closeSync(pin));
  } catch (error) {
    return withCleanup(() => { throw error; }, () => { if (result !== undefined) closeSync(result); });
  }
}
/** Minimal entry capability operations. Type, repair bits and lifetime remain
 * with storage. Darwin must supply an exact permission-independent pin/reopen
 * before these are available; an I/O open or pathname retry is no substitute. */
export function pinBeneath(directory: number, path: string, directoryOnly = false): number {
  return openBeneath(directory, path, 0o10000000 | constants.O_NOFOLLOW |
    (directoryOnly ? constants.O_DIRECTORY : 0));
}
export function reopenPinned(pin: number, flags: number): number {
  if (!Number.isSafeInteger(pin) || pin < 0) throw new TypeError("invalid entry pin");
  if (process.platform !== "linux")
    throw new StoreError("UNSUPPORTED_PROFILE", "G-FILES: exact entry reopen is unverified on this platform");
  return openSync(`/proc/self/fd/${pin}`, flags);
}
export function chmodPinned(pin: number, mode: number): void {
  if (!Number.isSafeInteger(pin) || pin < 0) throw new TypeError("invalid entry pin");
  if (process.platform !== "linux")
    throw new StoreError("UNSUPPORTED_PROFILE", "G-FILES: exact entry repair is unverified on this platform");
  chmodSync(`/proc/self/fd/${pin}`, mode);
}
/** Bootstrap a host-configured directory without following any pathname symlink.
 * Hold the result for the entire operation; children use openBeneath, not this path again.
 */
export function openDirectory(path: string): number {
  if (!path.startsWith("/") || path.includes("\0"))
    throw new StoreError("STORE_CORRUPT", "directory must be absolute");
  const root = openSync(
    "/",
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  if (path === "/") return root;
  let result: number | undefined;
  try {
    return withCleanup(() => {
      result = openBeneath(root, path.slice(1), constants.O_RDONLY | constants.O_DIRECTORY);
      return result;
    }, () => closeSync(root));
  } catch (error) {
    return withCleanup(() => { throw error; }, () => { if (result !== undefined) closeSync(result); });
  }
}
/** A single directory entry under an OWNED descriptor. The only followed magic
 * link is our fd in trusted procfs; callers must not concatenate descendants.
 */
export function entryAt(directory: number, name: string): string {
  relativeName(name);
  if (name.includes("/") || !Number.isInteger(directory) || directory < 0)
    throw new TypeError("invalid directory entry");
  return `/proc/self/fd/${directory}/${name}`;
}
/** linkat follows our proc-fd capability, never the previously verified source name. */
export function linkDescriptor(
  source: number,
  directory: number,
  name: string,
): void {
  entryAt(directory, name);
  if (!Number.isInteger(source) || source < 0)
    throw new TypeError("invalid source descriptor");
  checked(
    syscalls().link(-100, `/proc/self/fd/${source}`, directory, name, 0x400),
  ); // AT_SYMLINK_FOLLOW
}

/** Do something to a name, inside the directory that holds it, having resolved
 * that directory exactly once.
 *
 * Every filesystem defect this product has had at the same UID is the same two
 * lines: resolve a path, decide what it is, then perform the effect on the path
 * again. The second resolution is a fresh walk through a namespace any process
 * of this user can rearrange in between, so the thing that was checked and the
 * thing that was written are the same object only when nobody tried. It is not
 * a window that can be narrowed by checking again afterwards, because the check
 * and the use are still two walks.
 *
 * `openDirectory` resolves the parent in the kernel with no symlink followed at
 * any component, and the returned descriptor names that directory's inode for
 * as long as it is open -- renaming, unlinking or replacing the path afterwards
 * does not move it. `entryAt` then addresses one entry through that descriptor.
 * So the rule this primitive exists to make cheap is: resolve the parent once,
 * and never say the pathname again.
 *
 * The body is given the parent and the leaf name and nothing else, so a caller
 * that wanted to re-resolve the path would have to go and fetch it; that is the
 * whole point of the shape. The descriptor is closed on the way out, so the
 * body must not keep it.
 */
export function withinDirectory<T>(path: string, body: (parent: number, name: string) => T): T {
  const leaf = basename(path);
  if (leaf === "" || leaf === "." || leaf === "..")
    throw new StoreError("STORE_CORRUPT", `path has no entry to act on: ${path}`);
  const parent = openDirectory(dirname(path));
  return withCleanup(() => body(parent, leaf), () => closeSync(parent));
}
