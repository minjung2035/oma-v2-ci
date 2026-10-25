/** ID-001..003: pure grammar and boundary parsers; no storage, host effects, or wire migration. */
declare const identityBrand: unique symbol;
type Identity<Name extends string> = string & { readonly [identityBrand]: Name };

export type Actor = Identity<"Actor">;
export type ResidentName = Identity<"ResidentName">;
export type SocietyName = Identity<"SocietyName">;
export type TopicName = Identity<"TopicName">;
export type RequestKey = Identity<"RequestKey">;
export type OperationId = Identity<"OperationId">;
export type MessageId = Identity<"MessageId">;
export type BatchId = Identity<"BatchId">;
export type FullOid = Identity<"FullOid">;
export type RepositoryRelativePath = Identity<"RepositoryRelativePath">;

export const ACTOR_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const TOPIC_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
export const REQUEST_KEY_RE = /^[A-Za-z0-9._-]{1,96}$/;
export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PLATFORM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isPlatformUuid(value: unknown): value is string { return typeof value === "string" && PLATFORM_UUID.test(value); }
export const OPERATION_ID_RE = new RegExp(`^op-${UUID_V4_RE.source.slice(1, -1)}$`);
export const BATCH_ID_RE = new RegExp(`^b-${UUID_V4_RE.source.slice(1, -1)}$`);
export const MESSAGE_ID_RE = new RegExp(`^m-(${UUID_V4_RE.source.slice(1, -1)})-(\\d+)$`);
export const FULL_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export const RESERVED_ACTOR_NAMES: readonly string[] = Object.freeze([
  "principal", "commons", "residents", "topic", "broker", "principal-relay", "reconcile",
]);

/** Resident naming, not the broader authenticated Actor context. */
export function isValidActorName(value: unknown): value is ResidentName {
  return typeof value === "string" && ACTOR_NAME_RE.test(value) &&
    !RESERVED_ACTOR_NAMES.includes(value) && !value.startsWith("topic-");
}

export function isValidActor(value: unknown): value is Actor {
  return value === "principal" || isValidActorName(value);
}

export function isValidSocietyName(value: unknown): value is SocietyName {
  return typeof value === "string" && ACTOR_NAME_RE.test(value);
}

export function isValidTopicName(value: unknown): value is TopicName {
  return typeof value === "string" && TOPIC_NAME_RE.test(value);
}

export function isValidRequestKey(value: unknown): value is RequestKey {
  return typeof value === "string" && REQUEST_KEY_RE.test(value);
}

/** Broker-derived request keys are never valid on the wire (`~` is outside the
 * caller grammar): `~apply.<operation id>` names a review request's single
 * integration, `~refresh.<operation id>.<n>` its nth broker-derived refresh. */
const DERIVED_APPLY_RE = /^~apply\.(.+)$/;
const DERIVED_REFRESH_RE = /^~refresh\.(.+)\.(\d+)$/;
const PLAIN_ORDINAL_RE = /^(0|[1-9][0-9]*)$/;
export function isDerivedRequestKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const apply = DERIVED_APPLY_RE.exec(value);
  if (apply !== null) return isValidOperationId(apply[1]);
  const refresh = DERIVED_REFRESH_RE.exec(value);
  return refresh !== null && isValidOperationId(refresh[1]) &&
    PLAIN_ORDINAL_RE.test(refresh[2]!) && Number.isSafeInteger(Number(refresh[2]));
}
export function applyRequestKeyFor(operationId: string): string {
  return `~apply.${operationId}`;
}
export function refreshRequestKeyFor(operationId: string, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new TypeError("refresh ordinal must be a non-negative integer");
  return `~refresh.${operationId}.${ordinal}`;
}
/** The ordinal n of `~refresh.<operationId>.<n>`, or null when the key is not
 * a refresh derivation for exactly that operation. */
export function refreshKeyOrdinalOf(key: string, operationId: string): number | null {
  const prefix = `~refresh.${operationId}.`;
  if (!key.startsWith(prefix)) return null;
  const tail = key.slice(prefix.length);
  return PLAIN_ORDINAL_RE.test(tail) && Number.isSafeInteger(Number(tail)) ? Number(tail) : null;
}

/** A request name carries the full immutable open operation UUID. */
const UUID_TAIL = UUID_V4_RE.source.slice(1, -1);
const REVIEW_REQUEST_NAME_RE = new RegExp(`^(merge|challenge)-${UUID_TAIL}$`);
export function isReviewRequestName(value: unknown): value is string {
  return typeof value === "string" && REVIEW_REQUEST_NAME_RE.test(value);
}
/** The name a fresh open mints: kind + the operation's whole UUID. */
export function reviewRequestNameFor(kind: "merge" | "challenge", operationId: string): string {
  return `${kind}-${operationId.slice(3)}`;
}
export function reviewRequestNameOwnedBy(kind: "merge" | "challenge", operationId: string, name: string): boolean {
  return name === reviewRequestNameFor(kind, operationId);
}

export function isValidOperationId(value: unknown): value is OperationId {
  return typeof value === "string" && OPERATION_ID_RE.test(value);
}

export function isValidBatchId(value: unknown): value is BatchId {
  return typeof value === "string" && BATCH_ID_RE.test(value);
}

/** Internal file ID only. RFC Message-ID/reply ancestry has a different grammar. */
export function isValidMessageId(value: unknown): value is MessageId {
  if (typeof value !== "string") return false;
  const match = MESSAGE_ID_RE.exec(value);
  if (!match) return false;
  const ordinal = Number(match[2]);
  return Number.isSafeInteger(ordinal) && ordinal >= 0;
}

export function isValidFullOid(value: unknown): value is FullOid {
  return typeof value === "string" && FULL_OID_RE.test(value);
}

/** A code-unit scan for an unpaired surrogate: a lone surrogate is a decoding
 * artifact, never a path this product wrote. Letting it through re-encodes as
 * replacement bytes and renames on disk. No identifier grammar restates this;
 * it is a well-formedness probe, so it stays a code-unit walk, not a regex. */
const hasLoneSurrogate = (text: string): boolean => {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit < 0xd800 || unit >= 0xe000) continue;
    if (unit >= 0xdc00) return true; // a trailing half with no leading half
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next < 0xe000) { index++; continue; }
    return true; // a leading half not followed by its trailing half
  }
  return false;
};

/** General repository-relative path; context documents have a narrower policy. */
export function isValidWirePath(value: unknown): value is RepositoryRelativePath {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return false;
  if (value.includes("\0") || value.startsWith("/") || value.includes("//") || hasLoneSurrogate(value)) return false;
  for (const part of value.split("/")) {
    if (part === "." || part === ".." || part === "") return false;
  }
  return true;
}

export function parseActor(value: unknown): Actor | null {
  return isValidActor(value) ? value : null;
}
export function parseResidentName(value: unknown): ResidentName | null {
  return isValidActorName(value) ? value : null;
}
export function parseSocietyName(value: unknown): SocietyName | null {
  return isValidSocietyName(value) ? value : null;
}
export function parseTopicName(value: unknown): TopicName | null {
  return isValidTopicName(value) ? value : null;
}
export function parseRequestKey(value: unknown): RequestKey | null {
  return isValidRequestKey(value) ? value : null;
}
export function parseOperationId(value: unknown): OperationId | null {
  return isValidOperationId(value) ? value : null;
}
export function parseBatchId(value: unknown): BatchId | null {
  return isValidBatchId(value) ? value : null;
}
export function parseMessageFileId(value: unknown): MessageId | null {
  return isValidMessageId(value) ? value : null;
}
export function parseFullOid(value: unknown): FullOid | null {
  return isValidFullOid(value) ? value : null;
}
export function parseRepositoryRelativePath(value: unknown): RepositoryRelativePath | null {
  return isValidWirePath(value) ? value : null;
}

/** Preserve the existing decomposition result, including safe legacy decimal ordinals. */
export function parseMessageId(value: unknown): { operationId: OperationId; ordinal: number } | null {
  if (!isValidMessageId(value)) return null;
  const match = MESSAGE_ID_RE.exec(value)!;
  const operationId = parseOperationId(`op-${match[1]}`);
  if (operationId === null) return null;
  return { operationId, ordinal: Number(match[2]) };
}
