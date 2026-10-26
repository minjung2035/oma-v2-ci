/** DR27: a project snapshot reads through held directories, never through a
 * path checked earlier. Symlinks are data; no target is read. The same openat
 * walk is used on Linux and macOS, without procfs on the Mac. */
import { closeSync, constants, fstatSync, openSync, readSync, type Stats } from "node:fs";
import { errno, load } from "koffi";
import { getSystemErrorName } from "node:util";
import { StoreError } from "@oma/domain/errors";
import { closeEvery, openBeneath } from "./files.js";

let native: { open: (directory: number, name: string, flags: number) => number;
  link: (directory: number, name: string, bytes: Buffer, size: number) => number } | undefined;
function calls() {
  if (process.platform !== "linux" && process.platform !== "darwin")
    throw new StoreError("UNSUPPORTED_PROFILE", "project snapshots require Linux or macOS openat");
  if (!native) {
    const libc = load(null);
    native = { open: libc.func("int openat(int directory, const char *name, int flags)"),
      link: libc.func("long readlinkat(int directory, const char *name, void *buffer, unsigned long size)") };
  }
  return native;
}
function opened(directory: number, name: string, flags: number): number {
  // Darwin O_SYMLINK opens the final link itself. Adding O_NOFOLLOW would
  // reject that very link with ELOOP instead of returning its descriptor.
  const noFollow = process.platform === "darwin" && (flags & 0x200000 /* O_SYMLINK */) !== 0
    ? 0 : constants.O_NOFOLLOW;
  const fd = calls().open(directory, name, flags | noFollow |
    (process.platform === "darwin" ? 0x1000000 : 0o2000000)); // O_CLOEXEC
  if (fd < 0) {
    const code = getSystemErrorName(-errno());
    throw Object.assign(new Error(`snapshot could not open ${name}: ${code}`), { code });
  }
  return fd;
}
export function sameSnapshotFile(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode &&
    before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
export type SnapshotEntry = { readonly stat: Stats; readonly link: Buffer | null; readonly descriptor: number };
export class SnapshotReader {
  private closed = false;
  readonly descriptor: number;
  readonly identity: Stats;
  constructor(path: string) {
    if (!path.startsWith("/") || path.includes("\0")) throw new TypeError("snapshot root must be absolute");
    let directory = openSync("/", constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      for (const part of path.split("/").filter(Boolean)) {
        if (part === "." || part === "..") throw new TypeError("snapshot root must be canonical");
        const next = opened(directory, part, constants.O_RDONLY | constants.O_DIRECTORY);
        const previous = directory; directory = next; closeSync(previous);
      }
      this.descriptor = directory; this.identity = fstatSync(directory);
    } catch (error) {
      try { closeSync(directory); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "snapshot reader and cleanup failed"); }
      throw error;
    }
  }
  close(): void { if (!this.closed) { this.closed = true; closeSync(this.descriptor); } }
  /** null means a positively observed missing component, not an unreadable
   * entry. Every returned descriptor belongs to the caller. */
  entry(path: string): SnapshotEntry | null {
    if (this.closed) throw new StoreError("INTERNAL_ERROR", "snapshot reader is closed");
    const parts = path.split("/");
    if (parts.some(part => !part || part === "." || part === ".." || part === ".git" || part.includes("\0")))
      throw new StoreError("INVALID_REQUEST", "snapshot path is not a project file");
    let parent = this.descriptor;
    let pin: number | undefined;
    const releaseParent = (): void => {
      const previous = parent; parent = this.descriptor;
      if (previous !== this.descriptor) closeSync(previous);
    };
    try {
      // Resolve the whole parent beneath the held root in one kernel walk.
      // A missing Darwin primitive refuses rather than falling back to a
      // component walk whose intermediate directory could leave this root.
      if (parts.length > 1)
        parent = openBeneath(this.descriptor, parts.slice(0, -1).join("/"), constants.O_RDONLY | constants.O_DIRECTORY);
      const name = parts.at(-1)!;
      pin = opened(parent, name, process.platform === "linux" ? 0o10000000 /* O_PATH */ : 0x200000 | 0x8000 /* O_SYMLINK | O_EVTONLY */);
      const stat = fstatSync(pin);
      if (stat.isSymbolicLink()) {
        // Linux can read the pinned link itself. macOS reads the held parent's
        // one entry, and the second pin must still be exactly the first link.
        const bytes = Buffer.alloc(Math.max(4096, stat.size + 1));
        const size = calls().link(process.platform === "linux" ? pin : parent, process.platform === "linux" ? "" : name, bytes, bytes.length);
        if (size < 0 || size >= bytes.length) throw new StoreError("REF_STATE_UNKNOWN", `snapshot link could not be read: ${path}`);
        if (process.platform === "darwin") {
          const again = opened(parent, name, 0x200000 | 0x8000);
          try { if (!sameSnapshotFile(stat, fstatSync(again))) throw new StoreError("REF_STATE_UNKNOWN", `snapshot link changed: ${path}`); }
          finally { closeSync(again); }
        }
        releaseParent();
        const descriptor = pin; pin = undefined;
        return { stat, link: bytes.subarray(0, size), descriptor };
      }
      if (!stat.isFile() && !stat.isDirectory()) throw new StoreError("UNSUPPORTED_PROFILE", `snapshot contains a special file: ${path}`);
      if (stat.isFile()) {
        const readable = process.platform === "linux"
          ? openSync(`/proc/self/fd/${pin}`, constants.O_RDONLY | constants.O_NONBLOCK)
          : opened(parent, name, constants.O_RDONLY | constants.O_NONBLOCK);
        const previous = pin; pin = readable; closeSync(previous);
        if (!sameSnapshotFile(stat, fstatSync(pin))) throw new StoreError("REF_STATE_UNKNOWN", `snapshot file changed: ${path}`);
      }
      releaseParent();
      const descriptor = pin; pin = undefined;
      return { stat, link: null, descriptor };
    } catch (error) {
      try { closeEvery(pin, parent !== this.descriptor ? parent : undefined); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "snapshot entry and cleanup failed"); }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
/** Read only the observed length, then require EOF and unchanged metadata.
 * A growing file cannot prolong the snapshot indefinitely. */
export function copySnapshotFile(entry: SnapshotEntry, path: string, write: (bytes: Buffer) => void,
  buffer = Buffer.alloc(64 * 1024)): void {
  if (buffer.length === 0) throw new TypeError("snapshot copy needs a nonempty buffer");
  let position = 0;
  while (position < entry.stat.size) {
    const count = readSync(entry.descriptor, buffer, 0, Math.min(buffer.length, entry.stat.size - position), position);
    if (count === 0) break;
    write(buffer.subarray(0, count)); position += count;
  }
  if (position !== entry.stat.size || readSync(entry.descriptor, buffer, 0, 1, position) !== 0 ||
      !sameSnapshotFile(entry.stat, fstatSync(entry.descriptor)))
    throw new StoreError("REF_STATE_UNKNOWN", `project file changed during the snapshot: ${path}`);
}
