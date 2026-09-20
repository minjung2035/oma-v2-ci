/** TUI-002: terminal key decoding.
 *
 * A terminal read is not a key boundary. UTF-8 code points, CSI reports and
 * bracketed pastes may all straddle reads, so one decoder instance owns that
 * stream state for the lifetime of the TUI. Unrecognised escape reports are
 * swallowed rather than typed into the prompt, and a paste is one key rather
 * than the keystrokes it would look like.
 *
 * The engine still names complete key tokens through `parseKey`; OMA owns only
 * framing those tokens from a byte stream and its typed `Key` vocabulary.
 */
import { parseKey } from "@earendil-works/pi-tui";
import { TERMINAL_BOUNDS } from "./limits.js";

export type Key =
  | { readonly kind: "char"; readonly value: string }
  /** One bracketed paste, as one input boundary. `truncated` means the
   * terminal's paste was over the declared bound or never ended, and the
   * content was dropped rather than offered as a shorter paste. */
  | { readonly kind: "paste"; readonly value: string; readonly truncated: boolean }
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
/** Bracketed paste (DEC 2004). The terminal brackets pasted text with these,
 * which is the only way a stream of bytes says "this arrived at once" rather
 * than "this was typed": without it every newline in a paste is an Enter, and
 * one paste becomes several prompts -- each submitted before the Human has
 * read what the next line says. */
const PASTE_START = `${String.fromCharCode(ESC)}[200~`;
const PASTE_END = `${String.fromCharCode(ESC)}[201~`;

/** What a paste may carry into a prompt. Line breaks are the point of a paste
 * and tabs are ordinary text, but every other control byte is either a
 * terminal instruction or a second paste marker, and neither is something the
 * Human meant to send. Display sanitising is a separate concern and belongs to
 * the view; this keeps them out of what is sent to the engine. */
function pastedText(bytes: number[]): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes))
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

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
  /** An assembling paste: its bytes, whether it has already passed its bound,
   * and how much of the end marker has matched so far. */
  private paste: { readonly bytes: number[]; truncated: boolean; matched: number } | null = null;

  /** How long the stream owner should wait for the rest of what this decoder
   * has started, or null when nothing is pending.
   *
   * Every unfinished token gets one, not just the lone Escape. An incomplete
   * report with no deadline is not merely stuck: the next real keystroke is a
   * byte in the CSI final range, so the decoder consumed the Human's next key
   * as the end of a report that never came.
   */
  get pendingDelayMs(): number | null {
    if (this.paste !== null) return TERMINAL_BOUNDS.pasteIdleMs.value;
    if (this.escape !== null || this.discardingCsi) return TERMINAL_BOUNDS.escapeDelayMs.value;
    return null;
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

      if (this.paste !== null) {
        // Inside a paste every byte is content until the end marker matches in
        // full. A partial match that breaks was content after all, so it is
        // given back rather than swallowed.
        if (byte === PASTE_END.charCodeAt(this.paste.matched)) {
          this.paste.matched += 1;
          index += 1;
          textStart = index;
          if (this.paste.matched === PASTE_END.length) keys.push(this.endPaste());
          continue;
        }
        if (this.paste.matched > 0) {
          for (let position = 0; position < this.paste.matched; position += 1)
            this.addPasteByte(PASTE_END.charCodeAt(position));
          this.paste.matched = 0;
          continue;
        }
        this.addPasteByte(byte);
        index += 1;
        textStart = index;
        continue;
      }

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
          const token = new TextDecoder().decode(Uint8Array.from(this.escape));
          this.escape = null;
          if (token === PASTE_START) {
            this.paste = { bytes: [], truncated: false, matched: 0 };
            continue;
          }
          const action = actionOf(token);
          if (action) keys.push(action);
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

  private addPasteByte(byte: number): void {
    const paste = this.paste;
    if (paste === null) return;
    // Over the bound the content is dropped, not cut: half a paste submitted
    // as if it were the whole is the failure this bound exists to prevent.
    // Scanning continues so the end marker still ends the paste.
    if (paste.bytes.length >= TERMINAL_BOUNDS.pasteBytes.value) { paste.truncated = true; return; }
    paste.bytes.push(byte);
  }

  private endPaste(): Key {
    const paste = this.paste;
    this.paste = null;
    if (paste === null || paste.truncated) return { kind: "paste", value: "", truncated: true };
    return { kind: "paste", value: pastedText(paste.bytes), truncated: false };
  }

  /** The terminal stopped in the middle of something, and the stream owner's
   * deadline has passed.
   *
   * A lone Escape is the Escape key. An unfinished report is dropped, and so
   * is the state that was waiting for it, so the next byte is read as the key
   * it is. An unfinished paste is reported as a rejected paste rather than
   * partially delivered, and never left pending: input must not die because a
   * terminal sent a paste start and no paste end.
   */
  flushPending(): Key[] {
    // A paste with no end marker is a fragment, whatever arrived of it. Handing
    // that prefix to the draft would put text in the prompt that reads like the
    // whole paste, which is the failure the paste bound exists to prevent, so
    // it ends as a rejected paste rather than a shorter one.
    if (this.paste !== null) { this.paste.truncated = true; return [this.endPaste()]; }
    if (this.discardingCsi) { this.discardingCsi = false; return []; }
    if (this.escape === null) return [];
    const lone = this.escape.length === 1;
    this.escape = null;
    if (!lone) return [];
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
    keys.push(...this.flushPending());
    this.escape = null;
    this.discardingCsi = false;
    this.paste = null;
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
