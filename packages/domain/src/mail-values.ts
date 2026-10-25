/** MAIL-003..005 / PR-005: pure mail vocabulary, not delivery or approval authority.
 * Internal file IDs and supported RFC ancestry have separate grammars. Legacy
 * bare internal ancestry remains readable; newly emitted Message-ID uses the
 * society-qualified form. Ordered References are never sorted or deduplicated.
 */
import type { ExactCandidateIdentity, MailInput } from "@oma/contracts/values";
import { isValidActorName, isValidFullOid, isValidMessageId, isValidTopicName } from "./identifiers.js";

const KINDS = Object.freeze({
  message: true, question: true, result: true, alert: true, context: true,
  approval_required: true, critical: true,
} satisfies Record<MailInput["kind"], true>);
/** The most header bytes an OMA mail reader accepts before the blank line. */
export const MAIL_HEADER_BYTES = 256 * 1024;
/** P0V-36, P0-2: the most bytes a stored message can take when its body is
 * within `bodyBytes`. The two are different units: the body limit counts the
 * UTF-8 text the sender wrote, and the stored message is that text after its
 * transfer encoding, plus its header block. Quoted-printable is the widest
 * retained legacy encoding (fresh bodies use Base64): every byte may become "=XX", and every output
 * line of at most 76 characters may end in a soft break ("=" CRLF). A reader
 * that bounded the stored file by the body limit refused ordinary mail (a
 * Korean body of about 190 KB, under a 256 KiB body limit). */
export function storedMailBytes(bodyBytes: number): number {
  const encoded = 3 * bodyBytes;
  return MAIL_HEADER_BYTES + encoded + 3 * Math.ceil(encoded / 73) + 2;
}
/** MAIL-003/P0V-118: one header value is one string line, never coerced. */
export function mailHeaderValueCheck(value: unknown): string | null {
  return typeof value !== "string" ? "not a string" : /[\r\n]/.test(value) ? "contains CR/LF" : null;
}
export function isMailKind(value: unknown): value is MailInput["kind"] {
  return typeof value === "string" && Object.hasOwn(KINDS, value);
}
export function messageKindCheck(value: unknown): string | null {
  return isMailKind(value) ? null : "invalid mail kind";
}
export function isLogicalAddress(value: unknown): value is string {
  return typeof value === "string" && (
    value === "principal" || value === "commons" || value === "residents" ||
    isValidActorName(value) || (value.startsWith("topic/") && isValidTopicName(value.slice(6)))
  );
}
export function logicalAddressCheck(value: unknown): string | null {
  return isLogicalAddress(value) ? null : "invalid logical address";
}

/** Supported OMA header identity, intentionally not a general RFC message-id
 * parser and not the internal MessageId parser. A header id is always
 * `id@society.oma.invalid`; the pre-release bare form is not a header identity.
 */
export function headerMessageIdCheck(value: unknown): string | null {
  if (typeof value !== "string") return "expected message identity string";
  const at = value.indexOf("@");
  if (at < 0 || value.indexOf("@", at + 1) >= 0) return "invalid message id";
  return isValidMessageId(value.slice(0, at)) && /^[a-z][a-z0-9-]{0,31}\.oma\.invalid$/.test(value.slice(at + 1))
    ? null : "invalid message id";
}

declare const rfcIdentity: unique symbol;
export type RfcMessageId = string & { readonly [rfcIdentity]: true };
export function parseRfcMessageId(value: unknown): RfcMessageId | null {
  return typeof value === "string" && value.includes("@") && headerMessageIdCheck(value) === null
    ? value as RfcMessageId : null;
}

/** One exact tuple grammar. Its container determines whether it is a mail claim
 * or authenticated attestation; these bytes alone never confer authority. */
export function exactCandidateCheck(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "expected approval identity object";
  const identity = value as Record<string, unknown>;
  const fields = ["repo", "targetRef", "expectedBase", "candidate", "policyRevision"];
  if (Object.keys(identity).length !== fields.length || fields.some(field => !Object.hasOwn(identity, field)))
    return "approval identity must be a closed tuple";
  if (identity.repo !== "project" || identity.targetRef !== "refs/heads/main") return "invalid approval repository/target";
  if (!isValidFullOid(identity.expectedBase) || !isValidFullOid(identity.candidate)) return "invalid approval full OID";
  if (identity.expectedBase.length !== identity.candidate.length) return "approval OIDs must use the same object format";
  if (typeof identity.policyRevision !== "string" || Buffer.byteLength(identity.policyRevision, "utf8") < 1 ||
    Buffer.byteLength(identity.policyRevision, "utf8") > 128 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(identity.policyRevision))
    return "invalid approval policy revision";
  return null;
}
export function isExactCandidateIdentity(value: unknown): value is ExactCandidateIdentity {
  return exactCandidateCheck(value) === null;
}
