import { actorAddress } from "@oma/domain/actor-address";
/** MAIL-003: pinned nodemailer adapter. Existing EML is never passed through
 * this code for recovery. Only fresh facts are rendered; archive integrity uses
 * the original emitted bytes, not decoded/re-encoded text or a new timestamp.
 */
import { createTransport } from "nodemailer";
import { encodeWord } from "nodemailer/lib/mime-funcs";
import type { MailInput, Oid } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { exactCandidateCheck, mailHeaderValueCheck } from "@oma/domain/mail-values";
import { sha256Hex } from "@oma/domain/canonical-json";
import { displayAddress, rfcMessageIdFor } from "./addresses.js";
import { freezeMessageDate, freezeMessageFacts, type FrozenMessageFacts, type MessageFactsInput, type RenderedMessage } from "./facts.js";
import { MAX_HEADER_LINE_BYTES, decodeSubject, parseEmlHeaders, type ParsedEmlHeaders } from "./headers.js";

/** Compatibility input for callers testing the pre-refactor serializer. These
 * are RFC presentation values, not MessagePlan logical routing/authority.
 */
export interface EmlParams {
  from: string; to: string[]; replyTo: string[]; subject: string; kind: MailInput["kind"];
  contextRevision: Oid | null; inReplyTo: string | null; references: string[];
  messageId: string; body: string; dateMs?: number; approvalFor?: MailInput["approvalFor"];
}
export interface EmlEmission { text: string; bytes: number; sha256: string; dateMs: number }
export interface RenderedMessageWithHeaders extends RenderedMessage { readonly headerFacts: Readonly<ParsedEmlHeaders> }

/** P0V-118 (G07-02): a header value is a string on one line. A value of
 * another type is refused here as the request it is, not coerced into its
 * spelling ("undefined") and left to fail later as a TypeError. */
function assertNoCrlf(value: unknown, what: string): void {
  const invalid = mailHeaderValueCheck(value);
  if (invalid) throw new StoreError("INVALID_REQUEST", `${what} ${invalid}`);
}

/** Retain the exact pinned transport/sendMail options and authoritative header
 * insertion order. New workflow callers use buildFrozenMessage below instead of
 * independently constructing a second set of logical/date/identity facts.
 */
export async function buildEml(p: EmlParams): Promise<EmlEmission> {
  if (p.approvalFor) { const error = exactCandidateCheck(p.approvalFor); if (error) throw new StoreError("INVALID_REQUEST", error); }
  assertNoCrlf(p.subject, "subject");
  for (const [list, what] of [[p.to, "to"], [p.replyTo, "replyTo"], [p.references, "references"]] as const)
    if (!Array.isArray(list)) throw new StoreError("INVALID_REQUEST", `${what} is not a list`);
  if (typeof p.body !== "string") throw new StoreError("INVALID_REQUEST", "body is not a string");
  for (const header of [p.from, ...p.to, ...p.replyTo, p.messageId, ...(p.inReplyTo ? [p.inReplyTo] : []), ...p.references]) assertNoCrlf(header, "header");
  const dateMs = freezeMessageDate(p.dateMs);
  // RFC 2047 words preserve whitespace and literal encoded-word syntax, as
  // well as giving an unbroken long subject legal fold points.
  const encodedSubject = Buffer.byteLength(p.subject, "utf8") + "Subject: ".length > MAX_HEADER_LINE_BYTES ||
    p.subject !== p.subject.trim() || /[ \t]{2}|=\?|[\x00-\x1f\x7f]/.test(p.subject);
  const transporter = createTransport({ streamTransport: true, buffer: true, newline: "\r\n" });
  const info = await transporter.sendMail({
    from: p.from, to: p.to.join(", "), replyTo: p.replyTo.length > 0 ? p.replyTo.join(", ") : undefined,
    // MAIL-003/P0-2: preserve the text's bytes, including LF, BOM and no final
    // newline. 7bit/quoted-printable normalize them; accepted mail is never rebuilt.
    subject: encodedSubject ? undefined : p.subject, text: { content: Buffer.from(p.body, "utf8"), contentTransferEncoding: "base64" }, messageId: `<${p.messageId}>`,
    ...(p.inReplyTo ? { inReplyTo: `<${p.inReplyTo}>` } : {}),
    ...(p.references.length > 0 ? { references: p.references.map(reference => `<${reference}>`) } : {}),
    date: new Date(dateMs), headers: {
      ...(encodedSubject ? { Subject: { prepared: true, foldLines: true, value: encodeWord(p.subject, "B", 52) } } : {}),
      "X-OMA-Kind": p.kind, ...(p.contextRevision ? { "X-OMA-Context": p.contextRevision } : {}),
      ...(p.approvalFor ? {
        "X-OMA-Approval-Repo": p.approvalFor.repo, "X-OMA-Approval-Target": p.approvalFor.targetRef,
        "X-OMA-Approval-Base": p.approvalFor.expectedBase, "X-OMA-Approval-Candidate": p.approvalFor.candidate,
        "X-OMA-Approval-Policy": encodeWord(p.approvalFor.policyRevision, "B"),
      } : {}),
    },
  });
  const raw = (info as unknown as { message: unknown }).message;
  if (!Buffer.isBuffer(raw)) throw new StoreError("INTERNAL_ERROR", "MIME adapter did not emit a byte buffer");
  const sha256 = sha256Hex(raw);
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw)) throw new StoreError("INTERNAL_ERROR", "MIME adapter emitted unsupported non-UTF-8 bytes");
  // Every fresh caller, including submit/context, must reject unreadable mail
  // before it can become accepted immutable evidence. Recovery remains strict.
  const headers = parseEmlHeaders(text, { maxHeaderBytes: raw.byteLength });
  if (decodeSubject(headers.subject) !== p.subject)
    throw new StoreError("INTERNAL_ERROR", "MIME emission differs from the requested subject");
  return { text, bytes: raw.byteLength, sha256, dateMs };
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
export async function renderFrozenMessage(
  facts: FrozenMessageFacts, content: { readonly subject: string; readonly body: string },
): Promise<RenderedMessageWithHeaders> {
  const from = actorAddress(facts.sender, facts.society);
  const to = facts.to.map(address => displayAddress(address, facts.society));
  const replyTo = facts.replyHeaders.replyTo.map(address => displayAddress(address, facts.society));
  const messageId = rfcMessageIdFor(facts.id, facts.society);
  const emitted = await buildEml({ from, to, replyTo, subject: content.subject, body: content.body,
    kind: facts.kind, contextRevision: facts.contextRevision, messageId, dateMs: facts.dateMs,
    inReplyTo: facts.replyHeaders.inReplyTo, references: [...facts.replyHeaders.references],
    ...(facts.approvalFor === undefined ? {} : { approvalFor: { ...facts.approvalFor } }),
  });
  const actual = parseEmlHeaders(emitted.text, { maxHeaderBytes: emitted.bytes });
  if (actual.from !== from || !same(actual.to ?? [], to) || !same(actual.replyTo ?? [], replyTo) ||
    actual.messageId !== messageId || actual.omaKind !== facts.kind || actual.omaContext !== facts.contextRevision ||
    actual.dateMs !== Math.floor(facts.dateMs / 1000) * 1000 ||
    actual.inReplyTo !== facts.replyHeaders.inReplyTo || !same(actual.references, facts.replyHeaders.references))
    throw new StoreError("INTERNAL_ERROR", "MIME emission differs from frozen message facts");
  const approval = facts.approvalFor;
  if (approval === undefined ? actual.approvalFor !== null : actual.approvalFor === null ||
    actual.approvalFor.repo !== approval.repo || actual.approvalFor.targetRef !== approval.targetRef ||
    actual.approvalFor.expectedBase !== approval.expectedBase || actual.approvalFor.candidate !== approval.candidate ||
    actual.approvalFor.policyRevision !== approval.policyRevision)
    throw new StoreError("INTERNAL_ERROR", "MIME emission differs from frozen approval claim");
  return Object.freeze({ ...emitted, facts, headerFacts: Object.freeze(actual) });
}
export function buildFrozenMessage(input: MessageFactsInput, content: { readonly subject: string; readonly body: string }): Promise<RenderedMessageWithHeaders> {
  return renderFrozenMessage(freezeMessageFacts(input), content);
}
