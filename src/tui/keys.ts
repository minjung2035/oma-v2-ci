/** TUI-002: terminal key decoding only. This leaf owns no I/O, no process
 * state and no product policy; it turns bytes into the closed key vocabulary
 * that arch §23.4 fixes for Control Panel navigation.
 */
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

const CTRL_C = 0x03;
const CTRL_D = 0x04;
const CTRL_X = 0x18;
const ESC = 0x1b;
const LF = 0x0a;
const CR = 0x0d;
const DEL = 0x7f;
const BACKSPACE = 0x08;

const ARROWS: Readonly<Record<string, Key>> = Object.freeze({
  A: { kind: "up" },
  B: { kind: "down" },
  C: { kind: "right" },
  D: { kind: "left" },
});

/** A CSI sequence that is not one of the four arrows is consumed and dropped
 * rather than surfacing as text. Unknown terminal reports must not be typed
 * into the prompt.
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

export function decodeKeys(chunk: Uint8Array): Key[] {
  const keys: Key[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let index = 0;
  let text: number[] = [];
  const flush = (): void => {
    if (text.length === 0) return;
    const decoded = decoder.decode(Uint8Array.from(text));
    for (const value of decoded) if (value >= " ") keys.push({ kind: "char", value });
    text = [];
  };
  while (index < chunk.length) {
    const byte = chunk[index]!;
    if (byte === ESC) {
      flush();
      if (index + 1 < chunk.length && chunk[index + 1] === 0x5b) {
        const length = csiLength(chunk, index);
        if (length === 0) return keys;
        const final = String.fromCharCode(chunk[index + length - 1]!);
        const arrow = length === 3 ? ARROWS[final] : undefined;
        if (arrow) keys.push(arrow);
        index += length;
        continue;
      }
      keys.push({ kind: "escape" });
      index += 1;
      continue;
    }
    if (byte === CTRL_X) { flush(); keys.push({ kind: "panel" }); index += 1; continue; }
    if (byte === CTRL_C) { flush(); keys.push({ kind: "interrupt" }); index += 1; continue; }
    if (byte === CTRL_D) { flush(); keys.push({ kind: "eof" }); index += 1; continue; }
    if (byte === CR || byte === LF) { flush(); keys.push({ kind: "enter" }); index += 1; continue; }
    if (byte === DEL || byte === BACKSPACE) { flush(); keys.push({ kind: "backspace" }); index += 1; continue; }
    if (byte < 0x20) { flush(); index += 1; continue; }
    text.push(byte);
    index += 1;
  }
  flush();
  return keys;
}
