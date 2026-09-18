/** TUI-002: terminal key decoding.
 *
 * Splitting a read into tokens is this module's job, because only the product
 * knows that an unrecognised escape report must be swallowed rather than typed
 * into the prompt. Naming each token is the engine's job: `parseKey` already
 * covers the control and navigation vocabulary, including sequences this
 * product does not itself enumerate, so there is no second key table here.
 *
 * The typed `Key` union stays OMA's, because the pure state machine is written
 * against it and a string id would push that decision into every caller.
 */
import { parseKey } from "@earendil-works/pi-tui";

export type Key =
  | { readonly kind: "char"; readonly value: string }
  | { readonly kind: "enter" }
  | { readonly kind: "escape" }
  | { readonly kind: "backspace" }
  | { readonly kind: "up" }
  | { readonly kind: "down" }
  | { readonly kind: "left" }
  | { readonly kind: "right" }
  | { readonly kind: "panel" }
  | { readonly kind: "interrupt" }
  | { readonly kind: "eof" };

/** The engine's key ids this surface acts on. Anything else is deliberately
 * ignored rather than guessed at.
 */
const ACTIONS: Readonly<Record<string, Key>> = Object.freeze({
  up: { kind: "up" },
  down: { kind: "down" },
  left: { kind: "left" },
  right: { kind: "right" },
  enter: { kind: "enter" },
  return: { kind: "enter" },
  escape: { kind: "escape" },
  esc: { kind: "escape" },
  backspace: { kind: "backspace" },
  "ctrl+x": { kind: "panel" },
  "ctrl+c": { kind: "interrupt" },
  "ctrl+d": { kind: "eof" },
});

const ESC = 0x1b;

/** A CSI sequence this product does not act on is consumed whole and dropped.
 * Terminal reports must never reach the prompt as text.
 */
function csiLength(bytes: Uint8Array, start: number): number {
  let index = start + 2;
  while (index < bytes.length) {
    const byte = bytes[index]!;
    if (byte >= 0x40 && byte <= 0x7e) return index - start + 1;
    index += 1;
  }
  return 0;
}

function actionOf(token: string): Key | undefined {
  const id = parseKey(token);
  return id === undefined ? undefined : ACTIONS[id];
}

export function decodeKeys(chunk: Uint8Array): Key[] {
  const keys: Key[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let index = 0;
  let text: number[] = [];
  const flush = (): void => {
    if (text.length === 0) return;
    for (const value of decoder.decode(Uint8Array.from(text)))
      if (value >= " ") keys.push({ kind: "char", value });
    text = [];
  };
  const push = (token: string): void => {
    const action = actionOf(token);
    if (action) keys.push(action);
  };
  while (index < chunk.length) {
    const byte = chunk[index]!;
    if (byte === ESC) {
      flush();
      if (index + 1 < chunk.length && chunk[index + 1] === 0x5b) {
        const length = csiLength(chunk, index);
        if (length === 0) return keys;
        push(decoder.decode(chunk.subarray(index, index + length)));
        index += length;
        continue;
      }
      push(String.fromCharCode(ESC));
      index += 1;
      continue;
    }
    if (byte < 0x20 || byte === 0x7f) {
      flush();
      push(String.fromCharCode(byte));
      index += 1;
      continue;
    }
    text.push(byte);
    index += 1;
  }
  flush();
  return keys;
}
