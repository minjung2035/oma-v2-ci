/** CTX-002/007: pure context-document policy. No filesystem, Git, defaults, or normalization. */
import { isValidWirePath } from "./identifiers.js";
import type { ContextEntry } from "../../implementation/contracts.js";

/** Traversal may descend into this one directory; file admission is separate. */
export function isContextDirectoryPath(value: unknown): value is "decisions" {
  return value === "decisions";
}

export function contextPathCheck(value: unknown): string | null {
  if (!isValidWirePath(value)) return "unsafe context path";
  if (value === "GOAL.md" || value === "CURRENT.md") return null;
  if (/^decisions\/[^/]+\.md$/.test(value)) return null;
  return "unsupported context path";
}

/** Required GOAL and duplicate detection apply equally to wire and accepted snapshots. */
export function contextPathsCheck(value: unknown): string | null {
  if (!Array.isArray(value)) return "expected context paths array";
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const path: unknown = value[index];
    const invalid = contextPathCheck(path);
    if (invalid) return `[${index}]: ${invalid}`;
    // contextPathCheck established a string; keep the original bytes and order.
    const name = path as string;
    if (seen.has(name)) return `duplicate context path ${name}`;
    seen.add(name);
  }
  return seen.has("GOAL.md") ? null : "GOAL.md is required";
}

export interface ContextEntryBounds {
  /** Host policy may bound fresh inputs. Accepted rows need not adopt newer limits. */
  readonly maxFiles?: number;
  readonly maxBytes?: number;
  /** Exact bytes in the advertised or received concatenated stream, when available. */
  readonly contentBytes?: number;
}

/** Closed entry records; no mutation, sorting, deduplication, or hash recomputation. */
export function contextEntriesCheck(value: unknown, bounds: ContextEntryBounds = {}): string | null {
  for (const bound of [bounds.maxFiles, bounds.maxBytes, bounds.contentBytes]) {
    if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 0))
      return "invalid context entry bound";
  }
  if (!Array.isArray(value)) return "expected context entries array";
  if (bounds.maxFiles !== undefined && value.length > bounds.maxFiles)
    return "too many context files";
  const paths: string[] = [];
  let total = 0;
  for (let index = 0; index < value.length; index++) {
    const raw: unknown = value[index];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      return `[${index}]: expected context entry object`;
    const entry = raw as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (key !== "path" && key !== "bytes" && key !== "sha256")
        return `[${index}]: unknown field: ${key}`;
    }
    for (const key of ["path", "bytes", "sha256"]) {
      if (!Object.prototype.hasOwnProperty.call(entry, key))
        return `[${index}]: missing field: ${key}`;
    }
    const pathError = contextPathCheck(entry.path);
    if (pathError) return `[${index}].path: ${pathError}`;
    if (typeof entry.bytes !== "number" || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0)
      return `[${index}].bytes: expected non-negative safe integer`;
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256))
      return `[${index}].sha256: invalid SHA-256`;
    if (entry.bytes > Number.MAX_SAFE_INTEGER - total)
      return "context aggregate bytes exceed safe integer range";
    total += entry.bytes;
    paths.push(entry.path as string);
  }
  const pathsError = contextPathsCheck(paths);
  if (pathsError) return pathsError;
  if (bounds.contentBytes !== undefined && total !== bounds.contentBytes)
    return "context aggregate bytes mismatch";
  if (bounds.maxBytes !== undefined && total > bounds.maxBytes)
    return "context aggregate bytes exceed host limit";
  return null;
}

export function isContextEntries(value: unknown, bounds: ContextEntryBounds = {}): value is ContextEntry[] {
  return contextEntriesCheck(value, bounds) === null;
}

/** Strict UTF-8 Markdown; byte/hash verification and filesystem type checks stay at effects. */
export function contextFileCheck(path: string, bytes: Uint8Array): string | null {
  const pathError = contextPathCheck(path);
  if (pathError) return pathError;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "context file is not valid UTF-8";
  }
  if (text.includes("\0")) return "context file contains NUL";
  if (/^\uFEFF?\s*#!/.test(text)) return "context file contains a shebang";
  if (/<\s*(?:html|head|body|script|iframe|object|embed|style)(?:\s|>)/i.test(text) || /<!doctype\s+html/i.test(text))
    return "context file contains HTML";
  if (path === "GOAL.md" && text.trim().length === 0) return "GOAL.md must be non-empty";
  return null;
}
