/** MODE-005/006: an opaque guest identity, never a host pathname or authority. */
import { isPlatformUuid, isValidSocietyName } from "../domain/identifiers.js";
import { StoreError } from "../domain/errors.js";

const PREFIX = "oma-guest-history:";
export interface GuestHistory {
  readonly projectId: string;
  readonly society: string;
  readonly file: string;
  readonly sessionId: string;
}
export function isGuestHistoryReference(value: string): boolean { return value.startsWith(PREFIX); }
export function checkedGuestHistory(value: unknown): GuestHistory {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StoreError("INVALID_REQUEST", "Invalid guest history identity");
  const p = value as Record<string, unknown>;
  if (Object.keys(p).sort().join(",") !== "file,projectId,sessionId,society" || !isPlatformUuid(p.projectId) ||
      !isValidSocietyName(p.society) || typeof p.file !== "string" || p.file.length > 255 ||
      !/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.jsonl$/.test(p.file) || typeof p.sessionId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(p.sessionId))
    throw new StoreError("INVALID_REQUEST", "Invalid guest history identity");
  return { projectId: p.projectId, society: p.society, file: p.file, sessionId: p.sessionId };
}
export function guestHistoryReference(value: GuestHistory): string {
  return PREFIX + Buffer.from(JSON.stringify(checkedGuestHistory(value))).toString("base64url");
}
export function parseGuestHistoryReference(value: string): GuestHistory {
  if (!isGuestHistoryReference(value) || value.length > 2048) throw new StoreError("INVALID_REQUEST", "Invalid guest history reference");
  try {
    const bytes = Buffer.from(value.slice(PREFIX.length), "base64url");
    const result = checkedGuestHistory(JSON.parse(bytes.toString("utf8")));
    if (guestHistoryReference(result) !== value) throw new Error("noncanonical reference");
    return result;
  } catch { throw new StoreError("INVALID_REQUEST", "Invalid guest history reference"); }
}
