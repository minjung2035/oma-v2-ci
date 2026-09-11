// MUST [ID-001..003]: identifier grammar, reserved names, and ID generation.
import { randomUUID } from "node:crypto";
import type {
  MessageId,
  OperationId,
  BatchId,
  Oid,
} from "../implementation/contracts.js";

/** MUST [ID-001]: society/agent name `[a-z][a-z0-9-]{0,31}`. */
export const ACTOR_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
/** MUST [ID-001]: topic `[a-z][a-z0-9-]{0,63}`. */
export const TOPIC_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
/** MUST [ID-002]: request key `[A-Za-z0-9._-]{1,96}`. */
export const REQUEST_KEY_RE = /^[A-Za-z0-9._-]{1,96}$/;
/** MUST [ID-002]: canonical lowercase RFC 4122 UUIDv4. */
export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const OPERATION_ID_RE = new RegExp(`^op-${UUID_V4_RE.source.slice(1, -1)}$`);
export const BATCH_ID_RE = new RegExp(`^b-${UUID_V4_RE.source.slice(1, -1)}$`);
export const MESSAGE_ID_RE = new RegExp(`^m-(${UUID_V4_RE.source.slice(1, -1)})-(\\d+)$`);
/** MUST [ID-003]: full lowercase hex OID (sha1 40 or sha256 64). */
export const FULL_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** MUST [ID-001]: names forbidden for Residents. */
export const RESERVED_ACTOR_NAMES: readonly string[] = [
  "principal",
  "commons",
  "residents",
  "topic",
  "broker",
  "principal-relay",
  "reconcile",
];

export function isValidActorName(name: string): boolean {
  if (!ACTOR_NAME_RE.test(name)) return false;
  if (RESERVED_ACTOR_NAMES.includes(name)) return false;
  // MUST [MAIL-004]: `topic-` prefix collides with the topic address form.
  if (name.startsWith("topic-")) return false;
  return true;
}

export function isValidSocietyName(name: string): boolean {
  return ACTOR_NAME_RE.test(name);
}

export function isValidTopicName(name: string): boolean {
  return TOPIC_NAME_RE.test(name);
}

export function isValidRequestKey(key: unknown): key is string {
  return typeof key === "string" && REQUEST_KEY_RE.test(key);
}

export function isValidOperationId(id: unknown): id is OperationId {
  return typeof id === "string" && OPERATION_ID_RE.test(id);
}

export function isValidBatchId(id: unknown): id is BatchId {
  return typeof id === "string" && BATCH_ID_RE.test(id);
}

export function isValidMessageId(id: unknown): id is MessageId {
  if (typeof id !== "string") return false;
  const match = MESSAGE_ID_RE.exec(id);
  if (!match) return false;
  const ordinal = Number(match[2]);
  return Number.isSafeInteger(ordinal) && ordinal >= 0;
}

export function isValidFullOid(oid: string): oid is Oid {
  return FULL_OID_RE.test(oid);
}

/** MUST [ID-002]: lowercase UUIDv4. */
export function uuidV4(): string {
  return randomUUID(); // node crypto: lowercase RFC 4122 v4
}

export function generateOperationId(): OperationId {
  return `op-${uuidV4()}`;
}

export function generateBatchId(): BatchId {
  return `b-${uuidV4()}`;
}

/** MUST [ID-002]: message file id `m-<operation UUID>-<ordinal>`, ordinal fixed per operation plan. */
export function generateMessageId(
  operationId: OperationId,
  ordinal: number,
): MessageId {
  if (!isValidOperationId(operationId))
    throw new Error(`invalid operation id ${operationId}`);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0)
    throw new Error(`invalid message ordinal ${ordinal}`);
  return `m-${operationId.slice(3)}-${ordinal}`;
}

/** Parse `m-<uuid>-<ordinal>` back into (operationId, ordinal); null if malformed. */
export function parseMessageId(
  id: string,
): { operationId: OperationId; ordinal: number } | null {
  const match = MESSAGE_ID_RE.exec(id);
  if (!match) return null;
  const ordinal = Number(match[2]);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) return null;
  return { operationId: `op-${match[1]}` as OperationId, ordinal };
}

/** MUST [ID-003]: `/`-separated relative path; rejects NUL, `.`/`..` components, absolute paths. */
export function isValidWirePath(path: string): boolean {
  if (path.length === 0 || path.length > 4096) return false;
  if (path.includes("\0") || path.startsWith("/") || path.includes("//"))
    return false;
  for (const part of path.split("/")) {
    if (part === "." || part === ".." || part === "") return false;
  }
  return true;
}
