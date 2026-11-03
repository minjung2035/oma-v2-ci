/** AV23, AV26 -- arch §5.1, BATCH-002, TUI-011: a stored message as a reader
 * meets it. The pinned MIME writer (MAIL-003) stores a text body with a
 * transfer encoding -- Korean text as Base64 -- and the eml reader in
 * headers.ts never decodes a body. A reader, the Human's Mail screen or a
 * model's read tool, is shown the header block as stored and the body as its
 * sender wrote it. The stored bytes are not changed; an encoding this cannot
 * undo exactly leaves the message as stored, and nothing is guessed. The
 * Society model actions no longer decode raw archives in the extension. The
 * record publisher uses the strict decodedMailBody contract below. */

import { decodeUtf8 } from "@oma/domain/utf8";

/** The whole message, its body with the declared transfer encoding undone.
 * P0V-45, P0-2: the header block ends where `headerEnd` says, CRLF or LF, and
 * the body keeps every character its sender wrote, a leading U+FEFF included. */
export function readableMail(text: string): string {
  const end = headerEnd(text);
  if (end.at < 0) return text;
  const newline = end.length === 4 ? "\r\n" : "\n";
  const head = text.slice(0, end.at);
  const encoded = text.slice(end.at + end.length);
  const unfolded = head.split(`${newline} `).join(" ").split(`${newline}\t`).join(" ").split(newline);
  const declared = unfolded.filter(line => /^content-transfer-encoding:/i.test(line));
  if (declared.length !== 1) return text;
  const encoding = declared[0]!.slice(declared[0]!.indexOf(":") + 1).trim().toLowerCase();
  let bytes: Buffer;
  if (encoding === "base64") {
    try { bytes = base64Bytes(encoded, newline); } catch { return text; }
  } else return text;
  let body: string;
  try { body = decodeUtf8(bytes); } catch { return text; }
  return `${head}${newline}${newline}${body}`;
}

/** Where the header block ends: the first blank line, CRLF as the writer
 * emits it or LF as older mail has it; -1 with its length 0 when there is none. */
export function headerEnd(text: string): { readonly at: number; readonly length: number } {
  const crlf = text.indexOf("\r\n\r\n");
  const lf = text.indexOf("\n\n");
  if (crlf >= 0 && (lf < 0 || crlf < lf)) return { at: crlf, length: 4 };
  return lf >= 0 ? { at: lf, length: 2 } : { at: -1, length: 0 };
}

/** The body of `readableMail`, or "" for a message with no body. */
export function readableBody(text: string): string {
  const shown = readableMail(text);
  const end = headerEnd(shown);
  return end.at < 0 ? "" : shown.slice(end.at + end.length);
}

function base64Bytes(encoded: string, newline: string): Buffer {
  const compact = encoded.split(newline).join("");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0)
    throw new TypeError("mail has malformed Base64");
  const bytes = Buffer.from(compact, "base64");
  if (bytes.toString("base64") !== compact) throw new TypeError("mail has noncanonical Base64");
  return bytes;
}

/** MCS-R03: a record body must be decoded, not the display fallback. Unsupported
 * or malformed transport bytes fail instead of silently becoming sender text.
 * This does not change the legacy readableMail/readableBody display contract. */
export function decodedMailBody(text: string): string {
  const end = headerEnd(text);
  if (end.at < 0) throw new TypeError("mail has no header/body separator");
  const newline = end.length === 4 ? "\r\n" : "\n";
  const head = text.slice(0, end.at);
  const encoded = text.slice(end.at + end.length);
  const fields = head.split(`${newline} `).join(" ").split(`${newline}\t`).join(" ").split(newline)
    .filter(line => /^content-transfer-encoding:/i.test(line));
  if (fields.length > 1) throw new TypeError("mail has duplicate transfer encodings");
  const encoding = fields.length === 0 ? "7bit" : fields[0]!.slice(fields[0]!.indexOf(":") + 1).trim().toLowerCase();
  let bytes: Buffer;
  if (encoding === "base64") {
    bytes = base64Bytes(encoded, newline);
  } else if (encoding === "quoted-printable") {
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(encoded)) throw new TypeError("mail has non-ASCII quoted-printable");
    const joined = encoded.split(`=${newline}`).join("");
    if (/=(?![0-9a-f]{2})/i.test(joined)) throw new TypeError("mail has malformed quoted-printable");
    bytes = Buffer.from(joined.replace(/=([0-9a-f]{2})/gi,
      (_word, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
  } else if (encoding === "7bit" || encoding === "8bit") {
    if (encoding === "7bit" && /[^\x00-\x7f]/.test(encoded)) throw new TypeError("mail has non-ASCII 7bit text");
    if (/\p{Cs}/u.test(encoded)) throw new TypeError("mail has malformed Unicode");
    bytes = Buffer.from(encoded, "utf8");
  } else throw new TypeError("mail has an unsupported transfer encoding");
  return decodeUtf8(bytes);
}
