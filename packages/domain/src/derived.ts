/** ID/FS/GIT: deterministic identity-derived names. No filesystem effects or root discovery. */
import { createHash } from "node:crypto";
import {
  parseActor, parseResidentName, parseSocietyName, parseRequestKey, parseOperationId,
  parseMessageFileId, parseMessageId, parseBatchId, parseFullOid,
  type MessageId,
} from "./identifiers.js";

function required<T>(value: unknown, parse: (value: unknown) => T | null, what: string): T {
  const parsed = parse(value);
  if (parsed === null) throw new TypeError(`invalid ${what} ${String(value)}`);
  return parsed;
}

export function messageIdForOperation(operationId: string, ordinal: number): MessageId {
  const operation = required(operationId, parseOperationId, "operation id");
  if (!Number.isSafeInteger(ordinal) || ordinal < 0)
    throw new TypeError(`invalid message ordinal ${ordinal}`);
  return required(`m-${operation.slice(3)}-${ordinal}`, parseMessageFileId, "message id");
}

export function publishedRefFor(actor: string, operationId: string): string {
  const owner = required(actor, parseActor, "actor");
  const operation = required(operationId, parseOperationId, "operation id");
  return `refs/oma/published/${owner}/${operation}`;
}

/** D03: fresh CLI requests only. Never reconstruct an already frozen exportRef. */
export function exportRefForRequestKey(key: string): string {
  const request = required(key, parseRequestKey, "request key");
  const suffix = createHash("sha256").update(request, "utf8").digest("hex");
  return `refs/oma/export/cli-${suffix}`;
}

/** Grammar only: historical export suffixes use the existing request-key alphabet.
 * A valid spelling does not prove that a ref exists or belongs to an operation.
 */
export function isExportRef(value: unknown): value is string {
  const prefix = "refs/oma/export/";
  return typeof value === "string" && value.startsWith(prefix) && parseRequestKey(value.slice(prefix.length)) !== null;
}
export function isPublishedRef(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return parts.length === 5 && parts[0] === "refs" && parts[1] === "oma" && parts[2] === "published" &&
    parseActor(parts[3]) !== null && parseOperationId(parts[4]) !== null;
}
export function isMailObjectRelativePath(value: unknown): value is string {
  const prefix = "mail/objects/";
  return typeof value === "string" && value.startsWith(prefix) && value.endsWith(".eml") &&
    parseMessageFileId(value.slice(prefix.length, -4)) !== null;
}

export function submitStagingFor(operationId: string): string {
  return `staging/submit-${required(operationId, parseOperationId, "operation id")}`;
}
export function submitBundleFor(operationId: string): string {
  return `${submitStagingFor(operationId)}/upload.bundle`;
}
/** CTX-003/P0: immutable authorization witness for a content-identical publication. */
export function contextNoopRefFor(operationId: string): string {
  return `refs/oma/context/${required(operationId, parseOperationId, "operation id")}`;
}
export function contextStagingFor(operationId: string): string {
  return `staging/context-${required(operationId, parseOperationId, "operation id")}`;
}
export function agentRootFor(actor: string): string {
  return `agents/${required(actor, parseActor, "actor")}`;
}
export function workspaceFor(actor: string): string {
  return `${agentRootFor(actor)}/workspace`;
}
export function runnerViewFor(actor: string): string {
  return `${agentRootFor(actor)}/runner/view`;
}
export function batchViewFileName(batchId: string): string {
  return `batch-${required(batchId, parseBatchId, "batch id")}.json`;
}
export function batchViewFor(actor: string, batchId: string): string {
  return `${runnerViewFor(actor)}/${batchViewFileName(batchId)}`;
}
export function runnerReceiptFor(actor: string, batchId: string): string {
  return `${agentRootFor(actor)}/runner/receipts/${batchViewFileName(batchId)}`;
}
export function runnerSessionDirFor(actor: string): string {
  return `${agentRootFor(actor)}/runner/sessions`;
}
/** Where an agent's engine keeps its session.
 *
 * PR-003 keeps the Principal's Human history and private memory under
 * `principal/private`, so its session does not live beside the runner
 * artifacts every other agent's does. A delivery receipt names a session file
 * (PR-002) and is checked against this, so both paths are decided here rather
 * than in whichever module happens to need one.
 */
export function sessionDirFor(actor: string): string {
  return required(actor, parseActor, "actor") === "principal"
    ? "principal/private/sessions"
    : runnerSessionDirFor(actor);
}

/** The directory an actor's model tools work in (INV04: one owner for both
 * kinds of agent). A Resident's is its workspace clone. The Principal's is its
 * private scratch (PR-003, FS-003: its CLI cache lives there too), a directory
 * of its own inside the private space and apart from the Human's session
 * history beside it (PR-004). */
export function modelWorkspaceFor(actor: string): string {
  return required(actor, parseActor, "actor") === "principal" ? "principal/private/workspace" : workspaceFor(actor);
}

export function mailObjectFileName(messageId: string): string {
  return `${required(messageId, parseMessageFileId, "message id")}.eml`;
}
export function mailObjectRelativePath(messageId: string): string {
  return `mail/objects/${mailObjectFileName(messageId)}`;
}
export function maildirCurName(messageId: string): string {
  return `${required(messageId, parseMessageFileId, "message id")}:2,`;
}
export function mailArchiveRelativePath(messageId: string): string {
  return `mail/archive/cur/${maildirCurName(messageId)}`;
}
export function mailArchiveDisplayPath(messageId: string): string {
  return `/${mailArchiveRelativePath(messageId)}`;
}
/** Review thread mail addressed to `residents` publishes to a workers-only
 * archive directory, never the public archive. */
export function mailWorkersRelativePath(messageId: string): string {
  return `mail/workers/cur/${maildirCurName(messageId)}`;
}
export function mailWorkersDisplayPath(messageId: string): string {
  return `/${mailWorkersRelativePath(messageId)}`;
}
/** The archive a message belongs to by audience. */
export function mailAudienceDisplayPath(message: { id: string; audience?: string }): string {
  return message.audience === "workers" ? mailWorkersDisplayPath(message.id) : mailArchiveDisplayPath(message.id);
}
export function mailInboxRelativePath(actor: string, messageId: string, folder: "new" | "cur"): string {
  if (folder !== "new" && folder !== "cur") throw new TypeError("invalid mailbox folder");
  const owner = required(actor, parseActor, "actor");
  const message = required(messageId, parseMessageFileId, "message id");
  const name = folder === "cur" ? maildirCurName(message) : message;
  return `mail/inboxes/${owner}/${folder}/${name}`;
}
/** The per-mailbox arrival journal beside new/cur: `<ms> <message id>\n`
 * appended when a message link appears in new/. An inbox entry's inode is the
 * immutable object's, so mtime says when the object was frozen, not when it
 * arrived here — the journal is the delivery evidence (AV-11). */
export function mailInboxArrivalRelativePath(actor: string): string {
  const owner = required(actor, parseActor, "actor");
  return `mail/inboxes/${owner}/arrival`;
}

/** Relative symlink target from the trusted world's context directory. */
export function contextRevisionLinkFor(oid: string): string {
  return `revisions/${required(oid, parseFullOid, "full oid")}`;
}
/** Relative to the trusted world root, not the state root or a caller-provided path. */
export function contextRevisionFor(oid: string): string {
  return `context/${contextRevisionLinkFor(oid)}`;
}
export function contextRevisionDisplayPath(oid: string): string {
  return `/world/${contextRevisionFor(oid)}`;
}
/** The world doc advising how to write mail the Principal can act on. The name
 * is derived once here so the world map, the role prompts, and the file
 * `src/views.ts` materializes cannot spell three paths. */
export const PRINCIPAL_MAIL_FILENAME = "PRINCIPAL-MAIL.md";

export function actorSocketDirectoryFor(actor: string, incarnation: number): string {
  const owner = required(actor, parseActor, "actor");
  if (!Number.isSafeInteger(incarnation) || incarnation < 0)
    throw new TypeError(`invalid incarnation ${incarnation}`);
  return `actors/${owner}/${incarnation}`;
}
export function actorSocketFor(actor: string, incarnation: number): string {
  return `${actorSocketDirectoryFor(actor, incarnation)}/control.sock`;
}

/** Unit naming only; constructing a name is not a resource/death-proof observation. */
export function unitNameFor(society: string, kind: string, suffix: "service" | "path" | "timer"): string {
  const societyName = required(society, parseSocietyName, "society name");
  if (parseActor(kind) === null && !["broker", "principal-relay", "reconcile"].includes(kind))
    throw new TypeError(`invalid unit kind ${kind}`);
  if (suffix !== "service" && suffix !== "path" && suffix !== "timer")
    throw new TypeError("invalid unit suffix");
  return `oma-${societyName}-${kind}.${suffix}`;
}
export function residentUnitsFor(society: string, resident: string): string[] {
  const name = required(resident, parseResidentName, "resident name");
  return [unitNameFor(society, name, "service"), unitNameFor(society, name, "path")];
}

/** Relations require the expected identity; grammar alone cannot establish ownership. */
export function isMessageIdForOperation(value: unknown, expected: { operationId: string }): boolean {
  const operation = parseOperationId(expected.operationId);
  return operation !== null && parseMessageId(value)?.operationId === operation;
}
export function isPublishedRefFor(value: unknown, expected: { actor: string; operationId: string }): boolean {
  const actor = parseActor(expected.actor);
  const operation = parseOperationId(expected.operationId);
  return actor !== null && operation !== null && value === publishedRefFor(actor, operation);
}
export function isMailObjectRelativePathFor(value: unknown, expected: { messageId: string }): boolean {
  const message = parseMessageFileId(expected.messageId);
  return message !== null && value === mailObjectRelativePath(message);
}
