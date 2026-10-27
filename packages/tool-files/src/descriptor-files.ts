/** Node-only directory capabilities for engine-hosted file tools (PI-001).
 * Linux resolves every component through a held directory. Darwin has no
 * qualified equivalent yet: refuse before opening or creating anything.
 * This leaf owns OS mechanics; containment and file policy live in index.ts.
 */
import { constants, mkdirSync, openSync, readdirSync, rmSync } from "node:fs";
import { WorkspaceRefusal } from "./errors.js";

function assertProfile(): void {
  if (process.platform !== "linux")
    throw new WorkspaceRefusal("G-FILES: descriptor file access is not qualified on this platform");
}

export function descriptorPath(fd: number): string {
  if (!Number.isInteger(fd) || fd < 0) throw new TypeError("invalid file descriptor");
  assertProfile();
  return `/proc/self/fd/${fd}`;
}

/** One entry, never a pathname walk supplied by a tool. */
export function entryAt(directory: number, name: string): string {
  if (typeof name !== "string" || name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\0") ||
      !Number.isInteger(directory) || directory < 0)
    throw new TypeError("invalid directory entry");
  return `${descriptorPath(directory)}/${name}`;
}

export function openRoot(root: string): number {
  assertProfile();
  return openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
}
export function openAt(parent: number, name: string, flags: number, mode?: number): number {
  return openSync(entryAt(parent, name), flags, mode);
}
export function mkdirAt(parent: number, name: string, mode: number): void {
  mkdirSync(entryAt(parent, name), mode);
}
export function directoryNames(fd: number): string[] { return readdirSync(descriptorPath(fd)); }
export function reopen(fd: number, flags: number): number { return openSync(descriptorPath(fd), flags); }
export function removeSnapshotAt(parent: number, name: string): void {
  rmSync(entryAt(parent, name), { recursive: true, force: true });
}
