/** MAIL-003..005: a bounded reader for OMA's pinned single-part text EML.
 * Not a general MIME/RFC parser: no attachments, comments, display-name address
 * syntax, arbitrary charsets or duplicate fields. CRLF and legacy LF folding
 * are accepted; returned Subject retains encoded words/folding for compatibility.
 * Approval policy supports the serializer's UTF-8 B words. Header names are
 * case-insensitive; References remain ordered, including repeated ancestors.
 * Body bytes are never decoded, reserialized or hashed by this parser.
 */
import { MAIL_HEADER_BYTES, headerMessageIdCheck, isMailKind, exactCandidateCheck } from "@oma/domain/mail-values";
import { isValidFullOid } from "@oma/domain/identifiers";
import { StoreError } from "@oma/domain/errors";
import { decodeUtf8 } from "@oma/domain/utf8";

export interface ParsedEmlHeaders {
  from: string | null; to: string[] | null; subject: string | null; dateMs: number | null;
  messageId: string | null; inReplyTo: string | null; references: string[];
  replyTo: string[] | null; omaKind: string | null; omaContext: string | null;
  approvalFor: { repo: string | null; targetRef: string | null; expectedBase: string | null;
    candidate: string | null; policyRevision: string | null } | null;
}
export interface HeaderReadLimits { readonly maxHeaderBytes: number }
const DEFAULT_HEADER_LIMIT = MAIL_HEADER_BYTES;
export const MAX_HEADER_LINE_BYTES = 998;
const allowed = new Set([
  "from", "to", "reply-to", "subject", "date", "message-id", "in-reply-to", "references",
  "mime-version", "content-type", "content-transfer-encoding", "content-disposition",
  "x-oma-kind", "x-oma-context", "x-oma-approval-repo", "x-oma-approval-target",
  "x-oma-approval-base", "x-oma-approval-candidate", "x-oma-approval-policy",
]);
const invalid = (reason: string): never => { throw new StoreError("INVALID_REQUEST", `invalid OMA mail headers: ${reason}`); };
const unfold = (value: string): string => value.replace(/\n/g, " ");

/** Header-only fixtures may end at EOF. For complete EML, stop at the first
 * empty line and do not inspect an unbounded or non-UTF-8 MIME body.
 */
function headerBlock(input: string | Uint8Array, limit: number): string {
  if (!Number.isSafeInteger(limit) || limit < 1) return invalid("invalid header limit");
  // P0V-118 (G07-03): one rule for what a header block is, whichever form it
  // arrived in: the bytes a message was stored as and the text it is read
  // from are judged alike once each is text.
  const accepted = (block: string): string =>
    Buffer.byteLength(block, "utf8") > limit || /\p{Cs}/u.test(block) ? invalid("header byte/Unicode limit") : block;
  if (typeof input === "string") {
    const crlf = input.indexOf("\r\n\r\n"); const lf = input.indexOf("\n\n");
    const ends = [crlf, lf].filter(index => index >= 0);
    return accepted(ends.length ? input.slice(0, Math.min(...ends)) : input);
  }
  let end = input.byteLength;
  const scanned = Math.min(input.byteLength, limit + 4);
  for (let i = 0; i < scanned; i++) {
    if (input[i] === 10 && input[i + 1] === 10) { end = i; break; }
    if (input[i] === 13 && input[i + 1] === 10 && input[i + 2] === 13 && input[i + 3] === 10) { end = i; break; }
  }
  if (end > limit) return invalid("header byte limit");
  let text: string;
  try { text = decodeUtf8(input.subarray(0, end)); } catch { return invalid("header is not UTF-8"); }
  return accepted(text);
}

function headerWords(value: string, allowQuotedPrintable = false): string {
  const source = unfold(value);
  const pattern = /=\?UTF-8\?([BQ])\?([^?\s]*)\?=/gi;
  let output = ""; let last = 0; let previousEncoded = false;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    const gap = source.slice(last, index);
    if (gap.includes("=?")) return invalid("unsupported encoded word");
    if (!(previousEncoded && /^\s*$/.test(gap))) output += gap;
    const encoded = match[2]!; let bytes: Buffer;
    if (match[1]!.toUpperCase() === "B") {
      bytes = Buffer.from(encoded, "base64");
      if (!encoded || encoded.length % 4 !== 0 || bytes.toString("base64") !== encoded) return invalid("malformed Base64 word");
    } else {
      if (!allowQuotedPrintable || !encoded || /[^\x21-\x7e]|=(?![0-9a-f]{2})/i.test(encoded)) return invalid("unsupported Q word");
      bytes = Buffer.from(encoded.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_word, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
    }
    try { output += decodeUtf8(bytes); } catch { return invalid("malformed encoded UTF-8"); }
    last = index + match[0].length; previousEncoded = true;
  }
  const tail = source.slice(last);
  if (tail.includes("=?")) return invalid("unsupported encoded word");
  return output + tail;
}
/** Decode the pinned writer's UTF-8 words once for reply composition. The raw
 * parser projection stays unchanged for existing durable/header consumers. */
export function decodeSubject(value: string | null): string {
  return headerWords(unfold(value ?? "").trim(), true);
}
/** A subject as a reader should see it (BATCH-002): decoded, or, when it is
 * not something this writer produces, the header exactly as it arrived. */
export function displaySubject(value: string | null): string {
  try { return decodeSubject(value); } catch { return unfold(value ?? "").trim(); }
}
function singleId(value: string | undefined): string | null {
  if (value === undefined) return null;
  const match = /^<([^<>\s]+)>$/.exec(unfold(value).trim());
  if (!match || headerMessageIdCheck(match[1]) !== null) return invalid("unsupported header message identity");
  return match[1]!;
}
function references(value: string | undefined): string[] {
  if (value === undefined) return [];
  const source = unfold(value); const out: string[] = []; let end = 0;
  for (const match of source.matchAll(/<([^<>\s]+)>/g)) {
    if (!/^\s*$/.test(source.slice(end, match.index)) || headerMessageIdCheck(match[1]) !== null)
      return invalid("malformed ordered References");
    out.push(match[1]!); end = match.index + match[0].length;
  }
  if (!/^\s*$/.test(source.slice(end))) return invalid("malformed References tail");
  return out;
}
function addresses(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const list = unfold(value).split(",").map(part => part.trim());
  if (list.some(part => !/^[^@\s<>(),;:\\"\[\]]+@[^@\s<>(),;:\\"\[\]]+$/.test(part)))
    return invalid("unsupported mailbox representation");
  return list;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function rfc5322Date(ms: number): string {
  const date = new Date(ms); const pad = (n: number) => String(n).padStart(2, "0");
  return `${DAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]!} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}
function dateMs(value: string | undefined): number | null {
  if (value === undefined) return null;
  const valueUnfolded = unfold(value).replace(/[ \t]+/g, " ").trim();
  const parsed = Date.parse(valueUnfolded);
  if (!Number.isFinite(parsed) || parsed < 0 || rfc5322Date(parsed) !== valueUnfolded) return invalid("unsupported Date or precision");
  return parsed;
}

export function parseEmlHeaders(input: string | Uint8Array, limits: HeaderReadLimits = { maxHeaderBytes: DEFAULT_HEADER_LIMIT }): ParsedEmlHeaders {
  const block = headerBlock(input, limits.maxHeaderBytes);
  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  let current: string | null = null;
  for (const raw of block.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") continue;
    if (Buffer.byteLength(line, "utf8") > MAX_HEADER_LINE_BYTES || /[\x00-\x08\x0b-\x1f\x7f]/.test(line)) return invalid("invalid line length/control character");
    if (/^[ \t]/.test(line)) {
      if (current === null) return invalid("orphan folded line");
      headers[current] = `${headers[current]}\n${line.trim()}`;
      continue;
    }
    const separator = line.indexOf(":");
    const name = line.slice(0, separator).toLowerCase();
    if (separator < 1 || !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || !allowed.has(name)) return invalid("unsupported header field");
    if (Object.hasOwn(headers, name)) return invalid(`duplicate ${name}`);
    headers[name] = line.slice(separator + 1).trim(); current = name;
  }
  if (headers["mime-version"] !== undefined && unfold(headers["mime-version"]).trim() !== "1.0") return invalid("unsupported MIME version");
  if (headers["content-type"] !== undefined && !/^text\/plain;\s*charset=(?:utf-8|"utf-8")$/i.test(unfold(headers["content-type"]))) return invalid("unsupported MIME content type");
  if (headers["content-transfer-encoding"] !== undefined && !/^(?:7bit|8bit|base64|quoted-printable)$/i.test(headers["content-transfer-encoding"])) return invalid("unsupported transfer encoding");
  if (headers["content-disposition"] !== undefined && headers["content-disposition"].toLowerCase() !== "inline") return invalid("unsupported content disposition");
  const kind = headers["x-oma-kind"] ?? null;
  if (kind !== null && !isMailKind(kind)) return invalid("unsupported mail kind");
  // RFC 5322 folding splits long values across continuation lines. Every value
  // this module validates is unfolded first, including the OMA metadata emitted
  // by buildEml, so an accepted original can always be read back.
  const unfolded = (name: string): string | null => {
    const value = headers[name];
    return value === undefined ? null : unfold(value).trim();
  };
  const revision = unfolded("x-oma-context");
  if (revision !== null && !isValidFullOid(revision)) return invalid("invalid context OID");
  // Remove wire folding whitespace before decoding; whitespace encoded in
  // the revision itself remains part of the exact approval identity.
  const approvalPolicy = unfolded("x-oma-approval-policy");
  const approval = { repo: unfolded("x-oma-approval-repo"), targetRef: unfolded("x-oma-approval-target"),
    expectedBase: unfolded("x-oma-approval-base"), candidate: unfolded("x-oma-approval-candidate"),
    policyRevision: approvalPolicy === null ? null : headerWords(approvalPolicy) };
  const hasApproval = Object.values(approval).some(value => value !== null);
  if (hasApproval && (kind !== "approval_required" || exactCandidateCheck(approval) !== null)) return invalid("inconsistent approval identity");
  if (kind === "approval_required" && !hasApproval) return invalid("missing approval identity");
  const from = headers.from === undefined ? null : addresses(headers.from);
  if (from !== null && from.length !== 1) return invalid("multiple From identities");
  return { from: from?.[0] ?? null, to: addresses(headers.to), subject: headers.subject ?? null,
    dateMs: dateMs(headers.date), messageId: singleId(headers["message-id"]), inReplyTo: singleId(headers["in-reply-to"]),
    references: references(headers.references), replyTo: addresses(headers["reply-to"]), omaKind: kind, omaContext: revision,
    approvalFor: hasApproval ? approval : null };
}
