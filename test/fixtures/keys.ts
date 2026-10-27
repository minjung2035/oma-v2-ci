/** Decode a complete, already-bounded byte string for closed fixtures. Stream
 * owners keep a `KeyDecoder` instance; production code must not batch-decode.
 */
import { KeyDecoder, type Key } from "@oma/tui/keys";

export function decodeKeys(chunk: Uint8Array): Key[] {
  const decoder = new KeyDecoder();
  return [...decoder.push(chunk), ...decoder.finish()];
}
