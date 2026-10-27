/** CTX-001/002: pure context-document policy. No filesystem, Git, defaults, or normalization. */
import { isValidWirePath } from "./identifiers.js";
import type { ContextEntry } from "@oma/contracts/values";
import { utf8Decoder } from "./utf8.js";

/** Traversal may descend into this one directory; file admission is separate. */
export function isContextDirectoryPath(value: unknown): value is "decisions" { return value === "decisions"; }

export function contextPathCheck(value: unknown): string | null {
  if (!isValidWirePath(value)) return "unsafe context path";
  if (value === "GOAL.md" || value === "RATIONALE.md") return null;
  if (/^decisions\/[^/]+\.md$/.test(value)) return null;
  return "unsupported context path";
}

export function contextPathsCheck(value: unknown): string | null {
  if (!Array.isArray(value)) return "expected context paths array";
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const path: unknown = value[index];
    const invalid = contextPathCheck(path);
    if (invalid) return `[${index}]: ${invalid}`;
    const name = path as string;
    if (seen.has(name)) return `duplicate context path ${name}`;
    seen.add(name);
  }
  return seen.has("GOAL.md") ? null : "GOAL.md is required";
}

export interface ContextEntryBounds {
  readonly maxFiles?: number;
  readonly maxBytes?: number;
  readonly contentBytes?: number;
  readonly requireSorted?: boolean;
}

/** Closed entry records; no mutation, sorting, deduplication, or hash recomputation. */
export function contextEntriesCheck(value: unknown, bounds: ContextEntryBounds = {}): string | null {
  for (const bound of [bounds.maxFiles, bounds.maxBytes, bounds.contentBytes]) {
    if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 0)) return "invalid context entry bound";
  }
  if (!Array.isArray(value)) return "expected context entries array";
  if (bounds.maxFiles !== undefined && value.length > bounds.maxFiles) return "too many context files";
  const paths: string[] = [];
  let total = 0;
  for (let index = 0; index < value.length; index++) {
    const raw: unknown = value[index];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return `[${index}]: expected context entry object`;
    const entry = raw as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (key !== "path" && key !== "bytes" && key !== "sha256") return `[${index}]: unknown field: ${key}`;
    }
    for (const key of ["path", "bytes", "sha256"]) {
      if (!Object.prototype.hasOwnProperty.call(entry, key)) return `[${index}]: missing field: ${key}`;
    }
    const pathError = contextPathCheck(entry.path);
    if (pathError) return `[${index}].path: ${pathError}`;
    if (typeof entry.bytes !== "number" || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0)
      return `[${index}].bytes: expected non-negative safe integer`;
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) return `[${index}].sha256: invalid SHA-256`;
    if (entry.bytes > Number.MAX_SAFE_INTEGER - total) return "context aggregate bytes exceed safe integer range";
    const name = entry.path as string;
    // Nonempty GOAL is a content policy: the streaming validator below owns it,
    // and this shape check only validates the declared manifest fields.
    const previous = paths.at(-1);
    if (bounds.requireSorted && previous !== undefined && previous >= name) return "context entries must be sorted and unique";
    total += entry.bytes; paths.push(name);
  }
  const pathsError = contextPathsCheck(paths);
  if (pathsError) return pathsError;
  if (bounds.contentBytes !== undefined && total !== bounds.contentBytes) return "context aggregate bytes mismatch";
  if (bounds.maxBytes !== undefined && total > bounds.maxBytes) return "context aggregate bytes exceed host limit";
  return null;
}

export function isContextEntries(value: unknown, bounds: ContextEntryBounds = {}): value is ContextEntry[] {
  return contextEntriesCheck(value, bounds) === null;
}

/** Incremental version of exactly the existing content policy. The decoder
 * retains only an incomplete UTF-8 code point; a U+FEFF is text (P0V-86).
 * No newline rewriting, whitespace trimming or new Markdown blacklist occurs.
 */
export class ContextTextValidator {
  private readonly decoder = utf8Decoder();
  private failure: string | null;
  private nonempty = false;
  private started = false;
  private finished = false;
  constructor(private readonly path: string) { this.failure = contextPathCheck(path); }
  private text(value: string): string | null {
    // P0V-86: the decoder keeps a U+FEFF, as it keeps every character. For
    // whether a document is empty, one that begins it is the signature an
    // editor writes into an empty UTF-8 file, not content.
    const content = this.started ? value : value.replace(/^\uFEFF/, "");
    if (value.length > 0) this.started = true;
    if (content.length > 0) this.nonempty = true;
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) this.failure = "binary context is forbidden";
    return this.failure;
  }
  append(bytes: Uint8Array): string | null {
    if (this.failure) return this.failure;
    if (this.finished) return "context text validator is already finished";
    try { return this.text(this.decoder.decode(bytes, { stream: true })); }
    catch { return this.failure = "context must be UTF-8 text"; }
  }
  finish(): string | null {
    if (this.failure || this.finished) return this.failure;
    this.finished = true;
    try { this.text(this.decoder.decode()); }
    catch { this.failure = "context must be UTF-8 text"; }
    if (!this.failure && this.path === "GOAL.md" && !this.nonempty) this.failure = "GOAL.md must not be empty";
    return this.failure;
  }
}

/** Whole-file convenience uses the same policy as streamed admission. */
export function contextFileCheck(path: string, bytes: Uint8Array): string | null {
  const validator = new ContextTextValidator(path);
  return validator.append(bytes) ?? validator.finish();
}
