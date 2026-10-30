/** Runtime-owned immutable results. References are scoped to one actor's root;
 * model source-write authority is never used to retain or read a result. */
import { closeSync, constants, fstatSync, fsyncSync, readSync, writeSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { openAt, openRoot } from "./descriptor-files.js";
import { join } from "node:path";
import { isUtf8 } from "node:buffer";
import { WorkspaceRefusal } from "./errors.js";
export const RESULT_PREVIEW_BYTES = 16 * 1024;
export const RESULT_PAGE_BYTES = 64 * 1024;
const referencePattern = /^oma-result:([a-f0-9-]{36}):([a-f0-9]{64})$/;
export const isResultReference = (value: unknown): value is string => typeof value === "string" && referencePattern.test(value);
export interface ResultReference { reference: string; bytes: number; sha256: string }
export function utf8Prefix(bytes: Buffer, limit: number): Buffer {
  let end = Math.min(limit, bytes.length);
  while (end > 0 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end);
}
/** Caller creates and owns the root as part of session storage. O_EXCL and
 * descriptor-relative creation prevent an existing name becoming a writer. */
export function createResult(root: string, id: string = randomUUID()) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new WorkspaceRefusal("invalid result id");
  const parent = openRoot(root);
  let fd: number;
  try { fd = openAt(parent, `${id}.result`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  finally { closeSync(parent); }
  const hash = createHash("sha256"); let bytes = 0, closed = false;
  return {
    path: join(root, `${id}.result`),
    append(chunk: Buffer): void {
      if (closed) throw new WorkspaceRefusal("result writer is closed");
      for (let at = 0; at < chunk.length;) {
        const n = writeSync(fd, chunk, at, chunk.length - at);
        if (n <= 0) throw new WorkspaceRefusal("result write made no progress");
        hash.update(chunk.subarray(at, at + n)); bytes += n; at += n;
      }
    },
    finish(): ResultReference {
      if (closed) throw new WorkspaceRefusal("result writer is closed");
      try { fsyncSync(fd); } finally { closeSync(fd); closed = true; }
      const sha256 = hash.digest("hex");
      const dir = openRoot(root); try { fsyncSync(dir); } finally { closeSync(dir); }
      return { reference: `oma-result:${id}:${sha256}`, bytes, sha256 };
    },
    close(): void { if (!closed) { closed = true; closeSync(fd); } },
  };
}
export interface ResultRange { byteOffset?: number; byteLimit?: number; line?: number; encoding?: "base64" }
/** Hash verification is bounded-memory and checks the opened file, not a path
 * observed before opening. UTF-8 pages can reconstruct the exact result. */
export function readResult(root: string, reference: string, range: ResultRange = {}) {
  const match = referencePattern.exec(reference);
  if (!match) throw new WorkspaceRefusal("invalid result reference");
  const limit = range.byteLimit ?? RESULT_PAGE_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 4 || limit > RESULT_PAGE_BYTES ||
      !Number.isSafeInteger(range.byteOffset ?? 0) || (range.byteOffset ?? 0) < 0 ||
      range.line !== undefined && (!Number.isSafeInteger(range.line) || range.line < 1 || range.byteOffset !== undefined))
    throw new WorkspaceRefusal("invalid result byte or line range");
  const parent = openRoot(root); let fd: number;
  try { fd = openAt(parent, `${match[1]}.result`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  finally { closeSync(parent); }
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1) throw new WorkspaceRefusal("result must be an unlinked regular file name");
    const hash = createHash("sha256"), block = Buffer.alloc(64 * 1024);
    let offset = range.byteOffset ?? 0, at = 0, line = 1, selected = range.line === undefined || range.line === 1;
    for (;;) {
      const n = readSync(fd, block, 0, block.length, at); if (!n) break;
      hash.update(block.subarray(0, n));
      if (!selected) for (let i = 0; i < n; i++) if (block[i] === 10 && ++line === range.line) { offset = at + i + 1; selected = true; break; }
      at += n;
    }
    const sha256 = hash.digest("hex"), after = fstatSync(fd);
    if (sha256 !== match[2] || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw new WorkspaceRefusal("result changed or its digest does not match");
    if (!selected || offset > at) throw new WorkspaceRefusal("result range is past the end");
    const page = Buffer.alloc(Math.min(limit + 4, at - offset));
    const n = readSync(fd, page, 0, page.length, offset), loaded = page.subarray(0, n);
    if (range.encoding !== "base64" && loaded.length && (loaded[0]! & 0xc0) === 0x80) throw new WorkspaceRefusal("byte offset is not a UTF-8 boundary; use next");
    const shown = range.encoding === "base64" ? loaded.subarray(0, limit) : utf8Prefix(loaded, limit), next = offset + shown.length;
    return { reference, sha256, bytes: at, byteOffset: offset, text: isUtf8(shown) ? shown.toString("utf8") : "[binary page; use dataBase64]", dataBase64: shown.toString("base64"), next: next < at ? next : null };
  } finally { closeSync(fd); }
}
