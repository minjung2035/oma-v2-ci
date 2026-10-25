/** A host Personal birth and file identity; no guest-supplied path or cwd. */
import { UUID_V4_RE } from "@oma/domain/identifiers";
import { StoreError } from "@oma/domain/errors";

const PREFIX = "oma-host-history:";
export interface HostHistory { readonly birthId: string; readonly file: string; readonly sessionId: string }
export function hostHistoryReference(value: HostHistory): string {
  if (Object.keys(value).sort().join(",") !== "birthId,file,sessionId" || !UUID_V4_RE.test(value.birthId) ||
      typeof value.file !== "string" || value.file.length > 255 || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.jsonl$/.test(value.file) ||
      typeof value.sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value.sessionId))
    throw new StoreError("INVALID_REQUEST", "Invalid host history identity");
  return PREFIX + Buffer.from(JSON.stringify({ birthId: value.birthId, file: value.file, sessionId: value.sessionId })).toString("base64url");
}
export function isHostHistoryReference(value: string): boolean { return value.startsWith(PREFIX); }
export function parseHostHistoryReference(value: string): HostHistory {
  try {
    if (!isHostHistoryReference(value) || value.length > 2048) throw new Error();
    const identity = JSON.parse(Buffer.from(value.slice(PREFIX.length), "base64url").toString("utf8"));
    if (!identity || hostHistoryReference(identity) !== value) throw new Error();
    return identity;
  } catch { throw new StoreError("INVALID_REQUEST", "Invalid host history reference"); }
}

export interface HostHistoryQuery { readonly id: string; readonly method: "list" | "inspect"; readonly reference?: string; readonly after?: string }
export interface HostHistoryInfo {
  readonly reference: string; readonly created: string; readonly modified: string;
  readonly name?: string; readonly messageCount: number; readonly firstMessage: string;
}
export interface HostHistoryPage { readonly sessions: readonly HostHistoryInfo[]; readonly after: string | null }
export function parseHostHistoryQuery(value: unknown): HostHistoryQuery {
  const p = value as HostHistoryQuery;
  if (!p || typeof p !== "object" || Array.isArray(p) || typeof p.id !== "string" || !/^host-history-[1-9][0-9]{0,14}$/.test(p.id) ||
      (p.method === "list" ? Object.keys(p).sort().join(",") !== (p.after === undefined ? "id,method" : "after,id,method") :
       p.method !== "inspect" || Object.keys(p).sort().join(",") !== "id,method,reference"))
    throw new StoreError("INVALID_REQUEST", "Invalid host history query");
  if (p.method === "inspect") parseHostHistoryReference(p.reference!);
  if (p.after !== undefined) parseHostHistoryReference(p.after);
  return p;
}
export function checkedHostHistoryPage(value: unknown): HostHistoryPage {
  const p = value as HostHistoryPage;
  if (!p || typeof p !== "object" || Object.keys(p).sort().join(",") !== "after,sessions" || !Array.isArray(p.sessions) ||
      !(p.after === null || typeof p.after === "string")) throw new StoreError("BROKER_UNAVAILABLE", "Host history list could not be observed");
  let previous: string | undefined;
  for (const entry of p.sessions) {
    if (!entry || Object.keys(entry).sort().join(",") !== (entry.name === undefined ? "created,firstMessage,messageCount,modified,reference" : "created,firstMessage,messageCount,modified,name,reference") ||
        typeof entry.created !== "string" || !Number.isFinite(Date.parse(entry.created)) ||
        typeof entry.modified !== "string" || !Number.isFinite(Date.parse(entry.modified)) ||
        typeof entry.firstMessage !== "string" || entry.firstMessage.length > 160 ||
        !Number.isSafeInteger(entry.messageCount) || entry.messageCount < 0 ||
        entry.name !== undefined && (typeof entry.name !== "string" || entry.name.length > 160))
      throw new StoreError("BROKER_UNAVAILABLE", "Host history list could not be observed");
    parseHostHistoryReference(entry.reference);
    if (previous !== undefined && entry.reference.localeCompare(previous, "en") <= 0)
      throw new StoreError("BROKER_UNAVAILABLE", "Host history pagination did not advance");
    previous = entry.reference;
  }
  if (p.after !== null && p.after !== previous) throw new StoreError("BROKER_UNAVAILABLE", "Host history pagination did not advance");
  return p;
}
