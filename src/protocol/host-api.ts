import { isValidSocietyName } from "../domain/identifiers.js";
import { checkedGuestHistory } from "./guest-history.js";
/** MAC-020/021/251: the Host API between the Mac's UIs (OMA.app, the `oma`
 * command) and `omahostd`. Framing and envelopes are the platform's own
 * (§4.2); this module is pure: the version, the hello and the method names.
 */
/** Raised whenever a Host API message's shape or meaning changes. A UI
 * speaks its own and the one before it; `omahostd` speaks its own (MAC-251). */
export const HOST_API_VERSION = 4;

export const HOST_API_METHODS = Object.freeze([
  "engine.status", "engine.start", "engine.stop",
  "society.list", "society.open", "society.close",
  "terminal.attach",
  "project.import", "project.export", "request.status", "archive.create",
  "project.bind", "project.extensions",
  "session.list", "session.inspect", "session.resume",
  // DR25: the packages `oma pi` installed on the Mac, carried to the engine.
  "packages.sync",
  // §8.4: the state disk's snapshot the Human asks for.
  "snapshot.create",
] as const);
export type HostApiMethod = (typeof HOST_API_METHODS)[number];

export interface HostApiHello {
  readonly api: { readonly min: number; readonly max: number };
  /** The login token `omahostd` wrote at its start (MAC-021). */
  readonly token: string;
  readonly client: "oma-app" | "oma-cli";
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function hostApiHelloProblem(value: unknown): string | null {
  if (!object(value)) return "hello params must be an object";
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "api,client,token") return "hello params are exactly api, token and client";
  const api = value.api;
  if (!object(api) || Object.keys(api).sort().join(",") !== "max,min" || !uint(api.min) || !uint(api.max) || api.min > api.max)
    return "api must be { min, max } with min <= max";
  if (typeof value.token !== "string" || !/^[0-9a-f]{64}$/.test(value.token)) return "invalid token";
  if (value.client !== "oma-app" && value.client !== "oma-cli") return "unknown client";
  return null;
}

/** Method contracts shared by UI transport and domain coordinators. The
 * framing peer stays domain-neutral; checked clients own untrusted decoding. */
export type ProjectImportRequest = { projectId: string; macRepo: string; branch: string; since: string | null };
export type ProjectExportRequest = { society: string; macRepo: string; since: string | null };
export type PackageSyncRequest = { projectId: string | null; activate?: string | undefined };
export type ProjectBindRequest = { macRepo: string; society: string };
export type ProjectBindResult = { projectId: string; displayName: string; society: string };
export type ProjectImportResult = { head: string; ref: string; objectFormat: "sha1" | "sha256"; notCarried: string[] };
export type ProjectExportResult = { head: string; bytes: number; sha256: string; ref: string };
export type ArchiveResult = { files: number; bytes: number; sha256: string };
export type PackageSyncResult = { added: string[]; said: string[]; ok: boolean };
export type SnapshotResult = { path: string; stopped: string[] };
export type ProjectExtensionsResult = { extensions: readonly string[] };
export type SessionListRequest = { projectId: string; after?: string };
export type SessionSummary = {
  identity: import("./guest-history.js").GuestHistory;
  created: string; modified: string; name?: string; messageCount: number; firstMessage: string;
};
export type SessionListResult = { sessions: SessionSummary[]; after: string | null };
export type SessionMethod = "session.list" | "session.inspect" | "session.resume";
export interface SessionRequests {
  "session.list": SessionListRequest;
  "session.inspect": import("./guest-history.js").GuestHistory;
  "session.resume": import("./guest-history.js").GuestHistory;
}
export interface SocietyMethods {
  "society.list": { params: Record<string, never>; result: { societies: { society: string; running: boolean }[] } };
  "society.open": { params: { society: string; projectId: string }; result: { state: "running" } };
  "society.close": { params: { society: string; mode: "keep-running" | "stop" }; result: { state: "running" | "stopped" | "unknown" } };
  "project.import": { params: { projectId: string; branch: string; bundle: { bytes: number; sha256: string } }; result: ProjectImportResult };
  "project.export": { params: { society: string; since?: string }; result: Omit<ProjectExportResult, "ref"> };
  "project.extensions": { params: { projectId: string }; result: ProjectExtensionsResult };
  "packages.replace": { params: { archive: { bytes: number; sha256: string }; activate?: string; projectId?: string }; result: PackageSyncResult };
  "archive.create": { params: { society: string }; result: ArchiveResult };
  "session.list": { params: SessionListRequest & { society: string }; result: SessionListResult };
  "session.inspect": { params: SessionRequests["session.inspect"]; result: { mode: "society"; sessionId: string } };
  "session.resume": { params: SessionRequests["session.resume"]; result: { state: "running" } };
}

export type SessionResults = { [M in SessionMethod]: SocietyMethods[M]["result"] };

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const oid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value);
const digest = (value: unknown): boolean => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const archive = (value: Record<string, unknown>): boolean => uint(value.bytes) && digest(value.sha256);
const running = (value: Record<string, unknown>): boolean => value.state === "running";

/** Full method shape checks; an unreadable answer stays an observation
 * failure. Refusals and durable replay keep the framing peer's semantics. */
export function societyResultProblem(method: keyof SocietyMethods, value: unknown, params?: Record<string, unknown>): string | null {
  if (!object(value)) return "expected an object";
  let valid: boolean;
  switch (method) {
    case "society.list": valid = Array.isArray(value.societies) && value.societies.every(item =>
      object(item) && isValidSocietyName(item.society) && typeof item.running === "boolean"); break;
    case "society.open": case "session.resume": valid = running(value); break;
    case "society.close": valid = value.state === "running" || value.state === "stopped" || value.state === "unknown"; break;
    case "project.import": valid = oid(value.head) && typeof value.ref === "string" &&
      (value.objectFormat === "sha1" && value.head.length === 40 || value.objectFormat === "sha256" && value.head.length === 64) && strings(value.notCarried); break;
    case "project.export": valid = oid(value.head) && archive(value); break;
    case "archive.create": valid = uint(value.files) && archive(value); break;
    case "packages.replace": valid = strings(value.added) && strings(value.said) && typeof value.ok === "boolean"; break;
    case "project.extensions": valid = strings(value.extensions); break;
    case "session.inspect": valid = value.mode === "society" && typeof value.sessionId === "string" && value.sessionId.length > 0; break;
    case "session.list": valid = (value.after === null || typeof value.after === "string") && Array.isArray(value.sessions) && value.sessions.every(item => {
      if (!object(item) || !object(item.identity) || typeof item.created !== "string" || typeof item.modified !== "string" ||
          item.name !== undefined && typeof item.name !== "string" || !uint(item.messageCount) || typeof item.firstMessage !== "string") return false;
      try { checkedGuestHistory(item.identity); return true; } catch { return false; }
    }); break;
  }
  if (!valid) return `invalid ${method} fields`;
  if (params !== undefined) {
    if (method === "session.inspect" && value.sessionId !== params.sessionId) return "history identity does not match the request";
    if (method === "session.list" && (value.sessions as SessionSummary[]).some(item => item.identity.projectId !== params.projectId ||
        params.society !== undefined && item.identity.society !== params.society)) return "history binding does not match the request";
  }
  return null;
}
