/** P0-1/P0-2: a session's execution mode is a birth fact, not today's option.
 * The descriptor lives with its history; there is no second global registry. */
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { isValidSocietyName, UUID_V4_RE } from "@oma/domain/identifiers";
import { isSessionMode, type SessionMode } from "@oma/domain/session-mode";
import { sessionDirPathAt } from "@oma/domain/paths";
import { ensureOwnedUserDirectory, publishUserFile, readUserFile } from "./user-files.js";

export const SESSION_BIRTH = "session-mode.json";
export const PERSONAL_SESSIONS = ".personal";
const KIND = "oma-session-v1";
const MAX_BYTES = 16 * 1024;
export interface SessionBirth {
  readonly kind: typeof KIND;
  readonly mode: SessionMode;
  readonly id: string;
  readonly cwd: string;
  readonly history: string;
}
const absolute = (value: unknown): value is string => typeof value === "string" && isAbsolute(value) &&
  normalize(value) === value && !value.includes("\0") && Buffer.byteLength(value) <= 4096;
const corrupt = (): never => { throw new StoreError("STORE_CORRUPT", "session mode record is invalid; it cannot be reinterpreted as another mode"); };
const historyOf = (root: string, mode: SessionMode): string => mode === "society" ? sessionDirPathAt(root, "principal") : join(root, "history");
function checked(root: string, value: unknown): SessionBirth {
  if (!absolute(root) || root === "/" || value === null || typeof value !== "object" || Array.isArray(value)) return corrupt();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "cwd,history,id,kind,mode" || record.kind !== KIND || !isSessionMode(record.mode) ||
      record.id !== basename(root) || !absolute(record.cwd) || !absolute(record.history) || record.history !== historyOf(root, record.mode)) return corrupt();
  if (record.mode === "personal" ? !UUID_V4_RE.test(String(record.id)) || basename(dirname(root)) !== PERSONAL_SESSIONS : !isValidSocietyName(record.id)) return corrupt();
  return Object.freeze({ kind: KIND, mode: record.mode, id: record.id as string, cwd: record.cwd, history: record.history });
}
export function newSessionBirth(root: string, mode: SessionMode, cwd: string): SessionBirth {
  return checked(root, { kind: KIND, mode, id: basename(root), cwd, history: historyOf(root, mode) });
}
export function readSessionBirth(root: string): SessionBirth | null {
  if (!absolute(root) || root === "/") return corrupt();
  const text = readUserFile(join(root, SESSION_BIRTH), MAX_BYTES);
  if (text === null) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return corrupt(); }
  return checked(root, value);
}
export function publishSessionBirth(root: string, birth: SessionBirth): SessionBirth {
  const next = checked(root, birth), bytes = `${JSON.stringify(next)}\n`;
  if (Buffer.byteLength(bytes) > MAX_BYTES) return corrupt();
  // P0-8: a birth record's root is oma's own (a society or a Personal id
  // under the data root); its parent's tail is repaired inside that boundary.
  ensureOwnedUserDirectory(root, dirname(root));
  publishUserFile(join(root, SESSION_BIRTH), bytes);
  const saved = readSessionBirth(root);
  if (saved === null || JSON.stringify(saved) !== JSON.stringify(next))
    throw new StoreError("INVALID_REQUEST", "the session already has a different mode or identity; start a new session instead");
  return saved;
}
export function requireSessionMode(birth: SessionBirth, requested: SessionMode | undefined): void {
  if (requested !== undefined && requested !== birth.mode)
    throw new StoreError("INVALID_REQUEST", `this session is ${birth.mode}; its mode cannot be changed`);
}

/** Layout identifies where to look, never a mode or session identity on its own. */
export function sessionRootForHistory(dataRoot: string, file: string): string | null {
  if (!absolute(dataRoot) || !absolute(file) || !file.endsWith(".jsonl")) return null;
  const parts = relative(dataRoot, file).split(sep);
  const root = parts[0] === PERSONAL_SESSIONS && UUID_V4_RE.test(parts[1] ?? "")
    ? join(dataRoot, PERSONAL_SESSIONS, parts[1]!)
    : isValidSocietyName(parts[0]) ? join(dataRoot, parts[0]!) : null;
  if (root === null) return null;
  return dirname(file) === historyOf(root, parts[0] === PERSONAL_SESSIONS ? "personal" : "society") ? root : null;
}
