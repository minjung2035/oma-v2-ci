/** P0V-86: the extension's copy of `src/domain/utf8.ts` -- PI-001 keeps the
 * trusted extension from importing it. Bytes are decoded as they are: a
 * malformed sequence is refused, and a U+FEFF stays as the character it is. A
 * test holds the two to the same answers. */
const whole = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
/** The text of `bytes`; throws a TypeError on malformed UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string {
  return whole.decode(bytes);
}
