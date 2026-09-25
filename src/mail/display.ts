/** AV23, AV26 -- arch §5.1, BATCH-002, TUI-011: a stored message as a reader
 * meets it. The pinned MIME writer (MAIL-003) stores a text body with a
 * transfer encoding -- Korean text as Base64 -- and the eml reader in
 * headers.ts never decodes a body. A reader, the Human's Mail screen or a
 * model's read tool, is shown the header block as stored and the body as its
 * sender wrote it. The stored bytes are not changed; an encoding this cannot
 * undo exactly leaves the message as stored, and nothing is guessed. The
 * trusted extension imports no runtime module (PI-001) and mirrors
 * `readableMail`; a test binds the two (INV04). */

/** The whole message, its body with the declared transfer encoding undone. */
export function readableMail(text: string): string {
  const split = text.indexOf("\r\n\r\n");
  if (split < 0) return text;
  const head = text.slice(0, split);
  const encoded = text.slice(split + 4);
  const unfolded = head.replace(/\r\n[ \t]+/g, " ").split("\r\n");
  const declared = unfolded.filter(line => /^content-transfer-encoding:/i.test(line));
  if (declared.length !== 1) return text;
  const encoding = declared[0]!.slice(declared[0]!.indexOf(":") + 1).trim().toLowerCase();
  let bytes: Buffer;
  if (encoding === "base64") {
    const compact = encoded.replace(/\r\n/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) return text;
    bytes = Buffer.from(compact, "base64");
    if (bytes.toString("base64") !== compact) return text;
  } else if (encoding === "quoted-printable") {
    const joined = encoded.replace(/=\r\n/g, "");
    if (/=(?![0-9A-F]{2})/.test(joined)) return text;
    bytes = Buffer.from(joined.replace(/=([0-9A-F]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))), "latin1");
  } else return text;
  let body: string;
  try { body = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return text; }
  return `${head}\r\n\r\n${body}`;
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
