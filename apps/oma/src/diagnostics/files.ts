/** P6: bounded read-only observations. No chmod, fsync, publication or cleanup. */
import {
  constants, closeSync, fstatSync, lstatSync, openSync, readSync, readlinkSync, opendirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, parse } from "node:path";
import { ContextTextValidator, contextEntriesCheck } from "@oma/domain/context-policy";
import { mailHeadersMatch, type MailHeaderExpectation } from "./mail.js";
import { MAIL_HEADER_BYTES } from "@oma/domain/mail-values";
import type { ContextEntry } from "@oma/contracts/values";

export type FileObservation<T = true> =
  | { readonly kind: "present"; readonly value: T }
  | { readonly kind: "absent" }
  | { readonly kind: "corrupt" | "unknown"; readonly reason: string };
export interface FileExpectation { readonly bytes: number; readonly sha256: string; readonly singleLink?: boolean; readonly mode?: number; readonly contextPath?: string; readonly mail?: MailHeaderExpectation }
export interface DirectoryEntry { readonly name: string; readonly type: "file" | "directory" | "symlink" | "other" }
export interface IntegrityFiles {
  names(path: string): FileObservation<readonly DirectoryEntry[]>;
  file(path: string, expected: FileExpectation): FileObservation;
  symlink(path: string): FileObservation<string>;
  contextTree(path: string, entries: readonly ContextEntry[]): FileObservation;
}
export interface FileInspectionLimits { readonly maxFileBytes: number; readonly maxTotalBytes: number; readonly maxEntries: number }
export const FILE_INSPECTION_LIMITS: FileInspectionLimits = Object.freeze({ maxFileBytes: 16 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024, maxEntries: 10000 });
const absent = (): FileObservation<never> => ({ kind: "absent" });
const corrupt = (reason: string): FileObservation<never> => ({ kind: "corrupt", reason });
const unknown = (reason: string): FileObservation<never> => ({ kind: "unknown", reason });
const errorCode = (error: unknown): unknown => error !== null && typeof error === "object" && "code" in error ? error.code : null;
function sameIdentity(a: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }, b: typeof a): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function parents(path: string): FileObservation {
  if (!isAbsolute(path) || path.includes("\0") || path.split("/").some(part => part === "." || part === "..")) return corrupt("INVALID_PATH");
  const root = parse(path).root;
  let current = root;
  try {
    for (const component of dirname(path).slice(root.length).split("/").filter(Boolean)) {
      current = join(current, component);
      const stat = lstatSync(current, { throwIfNoEntry: false });
      if (!stat) return absent();
      if (!stat.isDirectory() || stat.isSymbolicLink()) return corrupt("UNSAFE_PARENT");
    }
    return { kind: "present", value: true };
  } catch { return unknown("PARENT_UNAVAILABLE"); }
}

/** Sequential observations share one byte/entry budget. A hostile concurrent
 * parent replacement still needs the separate kernel containment gate. This
 * observer reports detected instability, not an openat2 or power-loss proof.
 */
export class NodeIntegrityFiles implements IntegrityFiles {
  private bytesRead = 0;
  private entriesRead = 0;
  constructor(private readonly limits: FileInspectionLimits = FILE_INSPECTION_LIMITS) {
    for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("invalid file observation budget");
  }
  names(path: string): FileObservation<readonly DirectoryEntry[]> {
    const parent = parents(path); if (parent.kind !== "present") return parent;
    try {
      const before = lstatSync(path, { bigint: true, throwIfNoEntry: false });
      if (!before) return absent();
      if (!before.isDirectory() || before.isSymbolicLink()) return corrupt("NOT_DIRECTORY");
      const handle = opendirSync(path), entries: DirectoryEntry[] = [];
      try {
        for (let item = handle.readSync(); item !== null; item = handle.readSync()) {
          if (++this.entriesRead > this.limits.maxEntries) return unknown("DIRECTORY_ENTRY_BUDGET");
          entries.push(Object.freeze({ name: item.name,
            type: item.isFile() ? "file" : item.isDirectory() ? "directory" : item.isSymbolicLink() ? "symlink" : "other" }));
        }
      } finally { handle.closeSync(); }
      const after = lstatSync(path, { bigint: true });
      return sameIdentity(before, after) ? { kind: "present", value: Object.freeze(entries) } : unknown("DIRECTORY_CHANGED");
    } catch { return unknown("DIRECTORY_UNAVAILABLE"); }
  }
  file(path: string, expected: FileExpectation): FileObservation {
    const parent = parents(path); if (parent.kind !== "present") return parent;
    if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || !/^[0-9a-f]{64}$/.test(expected.sha256)) return corrupt("INVALID_FILE_EXPECTATION");
    if (expected.bytes > this.limits.maxFileBytes || expected.bytes > this.limits.maxTotalBytes - this.bytesRead) return unknown("FILE_BYTE_BUDGET");
    let fd: number | null = null;
    try {
      const named = lstatSync(path, { bigint: true, throwIfNoEntry: false });
      if (!named) return absent();
      if (!named.isFile() || named.isSymbolicLink()) return corrupt("NOT_REGULAR_FILE");
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = fstatSync(fd, { bigint: true });
      if (!sameIdentity(named, before)) return unknown("FILE_CHANGED_BEFORE_READ");
      if (!before.isFile() || before.size !== BigInt(expected.bytes) || (expected.singleLink && before.nlink !== 1n) ||
          (expected.mode !== undefined && Number(before.mode & 0o777n) !== expected.mode)) return corrupt("FILE_SIZE_MODE_OR_LINKS");
      const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(64 * 1024);
      const text = expected.contextPath === undefined ? null : new ContextTextValidator(expected.contextPath);
      const headerLimit = MAIL_HEADER_BYTES;
      const header = expected.mail ? Buffer.alloc(Math.min(expected.bytes, headerLimit + 4)) : null;
      let retained = 0;
      let remaining = expected.bytes;
      while (remaining > 0) {
        const count = readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null);
        if (count === 0) return unknown("FILE_CHANGED_DURING_READ");
        this.bytesRead += count; remaining -= count;
        const part = buffer.subarray(0, count); hash.update(part);
        if (header && retained < header.length) retained += part.copy(header, retained, 0, header.length - retained);
        if (text?.append(part)) return corrupt("INVALID_CONTEXT_TEXT");
      }
      if (readSync(fd, buffer, 0, 1, null) !== 0) return unknown("FILE_CHANGED_DURING_READ");
      const after = fstatSync(fd, { bigint: true });
      const namedAfter = lstatSync(path, { bigint: true, throwIfNoEntry: false });
      if (!namedAfter || !sameIdentity(before, after) || !sameIdentity(after, namedAfter)) return unknown("FILE_CHANGED_DURING_READ");
      if (text?.finish()) return corrupt("INVALID_CONTEXT_TEXT");
      if (hash.digest("hex") !== expected.sha256) return corrupt("FILE_HASH_MISMATCH");
      if (header && expected.mail) {
        const crlf = header.indexOf("\r\n\r\n"), lf = header.indexOf("\n\n");
        const ends = [crlf, lf].filter(value => value >= 0);
        if (ends.length === 0 && expected.bytes > headerLimit) return corrupt("MAIL_HEADER_INVALID");
        const block = ends.length ? header.subarray(0, Math.min(...ends)) : header;
        if (block.length > headerLimit) return corrupt("MAIL_HEADER_INVALID");
        try { if (!mailHeadersMatch(block, expected.mail)) return corrupt("MAIL_HEADER_RELATION"); }
        catch { return corrupt("MAIL_HEADER_INVALID"); }
      }
      return { kind: "present", value: true };
    } catch (error) { return errorCode(error) === "ELOOP" ? corrupt("SYMLINK_FILE") : unknown("FILE_UNAVAILABLE"); }
    finally { if (fd !== null) closeSync(fd); }
  }
  symlink(path: string): FileObservation<string> {
    const parent = parents(path); if (parent.kind !== "present") return parent;
    try {
      const before = lstatSync(path, { bigint: true, throwIfNoEntry: false });
      if (!before) return absent();
      if (!before.isSymbolicLink()) return corrupt("NOT_SYMLINK");
      const value = readlinkSync(path), after = lstatSync(path, { bigint: true });
      return sameIdentity(before, after) ? { kind: "present", value } : unknown("SYMLINK_CHANGED");
    } catch { return unknown("SYMLINK_UNAVAILABLE"); }
  }
  contextTree(root: string, entries: readonly ContextEntry[]): FileObservation {
    if (contextEntriesCheck(entries, { requireSorted: true })) return corrupt("INVALID_CONTEXT_EXPECTATION");
    const parent = parents(root); if (parent.kind !== "present") return parent;
    const expected = new Set(entries.map(entry => entry.path)), seen = new Set<string>();
    const walk = (directory: string, prefix: string): FileObservation => {
      const before = lstatSync(directory, { bigint: true, throwIfNoEntry: false });
      if (!before) return absent();
      if (!before.isDirectory() || before.isSymbolicLink() || (before.mode & 0o777n) !== 0o555n) return corrupt("CONTEXT_DIRECTORY_TYPE_MODE");
      const handle = opendirSync(directory);
      try {
        for (let item = handle.readSync(); item !== null; item = handle.readSync()) {
          if (++this.entriesRead > this.limits.maxEntries) return unknown("DIRECTORY_ENTRY_BUDGET");
          const relative = prefix + item.name, absolute = join(directory, item.name);
          if (item.isDirectory() && relative === "decisions" && entries.some(entry => entry.path.startsWith("decisions/"))) {
            const child = walk(absolute, "decisions/"); if (child.kind !== "present") return child;
          } else {
            if (!item.isFile() || !expected.has(relative) || seen.has(relative)) return corrupt("UNEXPECTED_CONTEXT_ENTRY");
            seen.add(relative);
          }
        }
      } finally { handle.closeSync(); }
      const after = lstatSync(directory, { bigint: true });
      return sameIdentity(before, after) ? { kind: "present", value: true } : unknown("CONTEXT_DIRECTORY_CHANGED");
    };
    try {
      const shape = walk(root, ""); if (shape.kind !== "present") return shape;
      if (seen.size !== expected.size) return corrupt("MISSING_CONTEXT_ENTRY");
      for (const entry of entries) {
        const observation = this.file(join(root, entry.path), { ...entry, mode: 0o644, singleLink: true, contextPath: entry.path });
        if (observation.kind !== "present") return observation.kind === "absent" ? unknown("CONTEXT_CHANGED_DURING_READ") : observation;
      }
      return { kind: "present", value: true };
    } catch { return unknown("CONTEXT_UNAVAILABLE"); }
  }
}
