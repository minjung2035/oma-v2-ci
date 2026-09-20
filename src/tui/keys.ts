/** TUI-002: terminal key decoding.
 *
 * A terminal read is not a key boundary. UTF-8 code points and CSI reports may
 * both straddle reads, so one decoder instance owns that stream state for the
 * lifetime of the TUI. Unrecognised escape reports are swallowed rather than
 * typed into the prompt.
 *
 * The engine still names complete key tokens through `parseKey`; OMA owns only
 * framing those tokens from a byte stream and its typed `Key` vocabulary.
 */
import { parseKey } from "@earendil-works/pi-tui";
import { TERMINAL_BOUNDS } from "./limits.js";

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
const CSI = 0x5b;

function actionOf(token: string): Key | undefined {
  const id = parseKey(token);
  return id === undefined ? undefined : ACTIONS[id];
}

function chars(text: string, keys: Key[]): void {
  for (const value of text)
    if (value >= " ") keys.push({ kind: "char", value });
}

function isCsiFinal(byte: number): boolean {
  return byte >= 0x40 && byte <= 0x7e;
}

/** Stateful decoder for one terminal input stream.
 *
 * `TextDecoder` retains an incomplete UTF-8 code point between `push` calls.
 * `escape` retains an incomplete ESC/CSI token. An overlong CSI enters a
 * discard state until its final byte, so hostile terminal input cannot grow
 * memory or leak the tail of a report into the prompt.
 */
export class KeyDecoder {
  private decoder = new TextDecoder("utf-8", { fatal: false });
  private escape: number[] | null = null;
  private discardingCsi = false;

  get hasPendingEscape(): boolean {
    return this.escape?.length === 1;
  }

  push(chunk: Uint8Array): Key[] {
    const keys: Key[] = [];
    let textStart = 0;
    const flushText = (end: number, final: boolean): void => {
      chars(this.decoder.decode(chunk.subarray(textStart, end), { stream: !final }), keys);
      if (final) this.decoder = new TextDecoder("utf-8", { fatal: false });
    };

    let index = 0;
    while (index < chunk.length) {
      const byte = chunk[index]!;

      if (this.discardingCsi) {
        if (byte === ESC) {
          this.discardingCsi = false;
          this.escape = [ESC];
        } else if (isCsiFinal(byte)) {
          this.discardingCsi = false;
        }
        index += 1;
        textStart = index;
        continue;
      }

      if (this.escape !== null) {
        if (this.escape.length === 1 && byte !== CSI) {
          const action = actionOf(String.fromCharCode(ESC));
          if (action) keys.push(action);
          this.escape = null;
          textStart = index;
          continue;
        }
        this.escape.push(byte);
        index += 1;
        textStart = index;
        if (this.escape.length >= 3 && isCsiFinal(byte)) {
          const action = actionOf(new TextDecoder().decode(Uint8Array.from(this.escape)));
          if (action) keys.push(action);
          this.escape = null;
        } else if (this.escape.length >= TERMINAL_BOUNDS.escapeSequenceBytes.value) {
          this.escape = null;
          this.discardingCsi = true;
        }
        continue;
      }

      if (byte === ESC || byte < 0x20 || byte === 0x7f) {
        flushText(index, true);
        if (byte === ESC) {
          this.escape = [ESC];
        } else {
          const action = actionOf(String.fromCharCode(byte));
          if (action) keys.push(action);
        }
        index += 1;
        textStart = index;
        continue;
      }
      index += 1;
    }
    flushText(chunk.length, false);
    return keys;
  }

  /** Resolve the only ambiguous prefix after the terminal's short ESC delay. */
  flushEscape(): Key[] {
    if (!this.hasPendingEscape) return [];
    this.escape = null;
    const action = actionOf(String.fromCharCode(ESC));
    return action ? [action] : [];
  }

  /** End-of-stream/test helper: emit complete text and a lone Escape, while an
   * incomplete terminal report remains swallowed.
   */
  finish(): Key[] {
    const keys: Key[] = [];
    chars(this.decoder.decode(), keys);
    this.decoder = new TextDecoder("utf-8", { fatal: false });
    keys.push(...this.flushEscape());
    this.escape = null;
    this.discardingCsi = false;
    return keys;
  }
}

/** Decode a complete, already-bounded byte string. Stream owners must keep a
 * `KeyDecoder` instance instead; this helper is for closed fixtures only.
 */
export function decodeKeys(chunk: Uint8Array): Key[] {
  const decoder = new KeyDecoder();
  return [...decoder.push(chunk), ...decoder.finish()];
}
