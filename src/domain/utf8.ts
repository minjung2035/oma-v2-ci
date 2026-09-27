/** P0V-86 (R6-09, P0-6, P0-2): the one reading of UTF-8 bytes in this product.
 *
 * Bytes are decoded as they are. A malformed sequence is refused, never
 * replaced; a U+FEFF stays where it stands, as the character it is. Whether
 * some bytes begin a document or are the middle of a stream is not something
 * a decoder can know, and each place that decided for itself made a defect of
 * the same shape: a mail body lost its U+FEFF (P0V-45), a key read lost one at
 * every read boundary (P0V-67), and the wire took a BOM-prefixed frame as JSON
 * (R6-09). A reader whose grammar has no place for the character -- strict
 * JSON (IPC-001) -- refuses it there, as it refuses any other character out of
 * place. The trusted extension, which imports nothing of OMA's (PI-001),
 * mirrors this in `src/extension/utf8.ts`, and a rule holds both to it. */

/** A decoder for one stream, for a caller that decodes piece by piece. */
export function utf8Decoder(): TextDecoder {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
}

const whole = utf8Decoder();
/** The text of `bytes`; throws a TypeError on malformed UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string {
  return whole.decode(bytes);
}
