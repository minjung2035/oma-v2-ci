/** Directory-relative effects. Publication/repair policy belongs to shared TS
 * storage owners. No pathname reconstructed from a directory FD is accepted. */
import { closeSync, fstatSync, type Stats } from "node:fs";
import { errno, load } from "koffi";
import { getSystemErrorName } from "node:util";
import { StoreError } from "@oma/domain/errors";
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
/** A no-I/O entry observation. A platform without the necessary entry pin
 * refuses before opening a FIFO/device or repairing a re-resolved pathname. */
export function statAt(fd: number, name: string): Stats;
export function statAt(fd: number, name: string, options: { readonly throwIfNoEntry: false }): Stats | undefined;
export function statAt(fd: number, name: string, options?: { readonly throwIfNoEntry: false }): Stats | undefined {
  entry(fd, name);
  let pin: number;
  try { pin = openBeneath(fd, name, 0o10000000); }
  catch (error) { if (options && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  return withCleanup(() => fstatSync(pin), () => closeSync(pin));
}
