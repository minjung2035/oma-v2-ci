/** The model's file effects, contained by the way they are made (R6-01,
 * PR-004, architecture §4: the check and the effect are one resolution).
 *
 * Every name under the workspace is reached from a descriptor held on the
 * workspace root, one component at a time, each opened with O_NOFOLLOW
 * through that descriptor (`/proc/self/fd/<fd>/<name>`: the kernel resolves
 * the held directory, then the one name in it). A link anywhere on the way
 * is refused rather than followed -- a dangling one included, which a check
 * by existence missed -- and a component replaced after it was opened cannot
 * redirect what follows, because what follows is looked up in the directory
 * already held. The extension may use only Node built-ins (PI-001), so this
 * is openat2's RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS spelled with them.
 */
import { closeSync, constants, fstatSync, ftruncateSync, mkdirSync, openSync, readSync, readdirSync, writeSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export class WorkspaceRefusal extends Error {
  constructor(message: string) { super(message); this.name = "WorkspaceRefusal"; }
}
/** One directory entry under a held descriptor. PI-001 keeps the extension
 * from importing OMA's storage, so this mirrors `entryAt` in
 * src/storage/contained-fs.ts -- the same name, the same refusals; the two
 * are held equal by test/contained-tools.test.ts. */
export function entryAt(directory: number, name: string): string {
  if (typeof name !== "string" || name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\0") ||
      !Number.isInteger(directory) || directory < 0)
    throw new TypeError("invalid directory entry");
  return `/proc/self/fd/${directory}/${name}`;
}

/** The components of a path inside the workspace, or a refusal. */
export function componentsWithin(root: string, path: string): string[] {
  if (typeof path !== "string" || path.includes("\0")) throw new WorkspaceRefusal("tool path is invalid");
  const offset = relative(root, resolve(root, path));
  if (offset === "") return [];
  if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new WorkspaceRefusal("tool path is outside the agent workspace");
  return offset.split(sep);
}

function refusedLink(error: unknown): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ELOOP" || code === "ENOTDIR") throw new WorkspaceRefusal("tool path passes through a link or a non-directory; links are not followed");
  throw error;
}

/** A descriptor on the directory `components` names, walked from the root. */
function openDirectoryWithin(root: string, components: readonly string[], create: boolean): number {
  let fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    for (const part of components) {
      let next: number;
      try { next = openSync(entryAt(fd, part), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
      catch (error) {
        if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") refusedLink(error);
        try { mkdirSync(entryAt(fd, part), 0o755); }
        catch (made) { if ((made as NodeJS.ErrnoException).code !== "EEXIST") throw made; }
        try { next = openSync(entryAt(fd, part), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
        catch (again) { refusedLink(again); }
      }
      closeSync(fd);
      fd = next;
    }
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}

/** Opens the named entry itself, never through a link. */
function openEntryWithin(root: string, path: string, flags: number, mode = 0o644): number {
  const components = componentsWithin(root, path);
  if (components.length === 0) {
    // The workspace itself: a directory, which no tool writes as a file.
    if ((flags & (constants.O_WRONLY | constants.O_RDWR)) !== 0) throw new WorkspaceRefusal("tool path is the workspace itself");
    return openSync(root, constants.O_RDONLY | constants.O_DIRECTORY);
  }
  const parent = openDirectoryWithin(root, components.slice(0, -1), false);
  try {
    try { return openSync(entryAt(parent, components.at(-1)!), flags | constants.O_NOFOLLOW, mode); }
    catch (error) { refusedLink(error); }
  } finally { closeSync(parent); }
}

/** A regular file with no other name: a hard link would carry a write to
 * wherever else that file is named. */
function ownedFile(fd: number): void {
  const stat = fstatSync(fd);
  if (!stat.isFile()) throw new WorkspaceRefusal("tool path is not a regular file");
  if (stat.nlink > 1) throw new WorkspaceRefusal("tool path is a file with other names; it is not written through");
}

/** Runs `use` on the regular file itself, named by the descriptor held on it:
 * `/proc/self/fd/<fd>` reopens that inode, never the path again. */
export async function withFileWithin<T>(root: string, path: string, use: (held: string) => Promise<T>): Promise<T> {
  const fd = openEntryWithin(root, path, constants.O_RDONLY);
  try { ownedFile(fd); return await use(`/proc/self/fd/${fd}`); } finally { closeSync(fd); }
}

export function readWithin(root: string, path: string): Buffer {
  const fd = openEntryWithin(root, path, constants.O_RDONLY);
  try {
    ownedFile(fd);
    const size = fstatSync(fd).size;
    const buffer = Buffer.alloc(size);
    let filled = 0;
    while (filled < size) { const count = readSync(fd, buffer, filled, size - filled, filled); if (count === 0) break; filled += count; }
    return buffer.subarray(0, filled);
  } finally { closeSync(fd); }
}

export function accessWithin(root: string, path: string, write: boolean): void {
  const fd = openEntryWithin(root, path, write ? constants.O_RDWR : constants.O_RDONLY);
  try { ownedFile(fd); } finally { closeSync(fd); }
}

/** The size the entry has now, or 0 when it does not exist yet. */
export function sizeWithin(root: string, path: string): number {
  let fd: number;
  try { fd = openEntryWithin(root, path, constants.O_RDONLY); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
  try { ownedFile(fd); return fstatSync(fd).size; } finally { closeSync(fd); }
}

export function writeWithin(root: string, path: string, content: string | Buffer): void {
  // Opened without truncating, checked, then emptied: a file with another
  // name is refused before a byte of it changes.
  const fd = openEntryWithin(root, path, constants.O_WRONLY | constants.O_CREAT, 0o644);
  try {
    ownedFile(fd);
    ftruncateSync(fd, 0);
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    for (let at = 0; at < bytes.length; ) at += writeSync(fd, bytes, at, bytes.length - at, at);
  } finally { closeSync(fd); }
}

export function mkdirWithin(root: string, path: string): void {
  closeSync(openDirectoryWithin(root, componentsWithin(root, path), true));
}

export function isDirectoryWithin(root: string, path: string): boolean {
  const fd = openEntryWithin(root, path, constants.O_RDONLY);
  try { return fstatSync(fd).isDirectory(); } finally { closeSync(fd); }
}

export function existsWithin(root: string, path: string): boolean {
  try { closeSync(openEntryWithin(root, path, constants.O_RDONLY)); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export function readdirWithin(root: string, path: string): string[] {
  const fd = openDirectoryWithin(root, componentsWithin(root, path), false);
  try { return readdirSync(`/proc/self/fd/${fd}`); } finally { closeSync(fd); }
}
