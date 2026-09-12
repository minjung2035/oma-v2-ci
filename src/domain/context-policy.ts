/** CTX-001/002: pure context-document policy. No filesystem, Git, defaults, or normalization. */
import { isValidWirePath } from "./identifiers.js";
import type { ContextEntry } from "../../implementation/contracts.js";

/** Traversal may descend into this one directory; file admission is separate. */
export function isContextDirectoryPath(value: unknown): value is "decisions" {
  return value === "decisions";
}

export function contextPathCheck(value: unknown): string | null {
  if (!isValidWirePath(value)) return "unsafe context path";
  if (value === "GOAL.md" || value === "RATIONALE.md") return null;
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
  /** CTX-002 snapshots preserve the manifest order instead of silently sorting it. */
  readonly requireSorted?: boolean;
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
    const name = entry.path as string;
    const previous = paths.at(-1);
    if (bounds.requireSorted && previous !== undefined && previous >= name)
      return "context entries must be sorted and unique";
    total += entry.bytes;
    paths.push(name);
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

/** Preserve the supported wire content policy. Markdown is data, not executable
 * authority; refactoring does not add an HTML/shebang content blacklist.
 * Byte/hash verification and filesystem type checks stay at effect boundaries.
 */
export function contextFileCheck(path: string, bytes: Uint8Array): string | null {
  const pathError = contextPathCheck(path);
  if (pathError) return pathError;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return "context must be UTF-8 text"; }
  if (path === "GOAL.md" && text.length === 0) return "GOAL.md must not be empty";
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? "binary context is forbidden" : null;
}
