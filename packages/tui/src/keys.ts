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
import { TERMINAL_BOUNDS } from "@oma/domain/surface-bounds";
import { decodeUtf8 } from "@oma/domain/utf8";
import { UNSEEN_EXCEPT_LAYOUT } from "@oma/domain/unseen-text";

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
  | { readonly kind: "eof" }
  | { readonly kind: "redraw" };

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
  "ctrl+l": { kind: "redraw" },
});

const ESC = 0x1b;
const CSI = 0x5b;
/** P0V-79: `ESC O` introduces a report as `ESC [` does. The xterm family sends
 * F1–F4 this way, and the cursor keys and Home/End too while a terminal is in
 * application cursor mode; read as an Escape and two characters, a key would
 * type `OP` into the prompt. */
const SS3 = 0x4f;
/** The most bytes one UTF-8 code point takes, which is how far back the
 * decoder has to look to know whether it is holding half of one. */
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
  // P0V-108: what the screen will not show is not sent either -- the draft
  // the Human reads is the text the engine gets.
  return decodeText(bytes, false).text
    .replace(/\r\n?/g, "\n")
    .replace(UNSEEN_EXCEPT_LAYOUT, "");
}

function actionOf(token: string): Key | undefined {
  const id = parseKey(token);
  return id === undefined ? undefined : ACTIONS[id];
}

/** P0V-46, P0-2: the one reading of the text bytes a terminal sends, typed or
 * pasted. A well-formed UTF-8 sequence is text, whatever character it encodes
 * -- U+FFFD included, which a Human can type. A byte that is not part of a
 * well-formed sequence (a code point the terminal cut and never finished, or
 * bytes that were never UTF-8) is no key anyone pressed and is dropped. Typed
 * text used to drop every U+FFFD, the real one too, and a paste used to keep
 * the ones decoding had put in place of broken bytes. With `open`, the bytes
 * of a sequence that is not finished yet are returned as `rest` for the next
 * read to complete. */
export function decodeText(bytes: ArrayLike<number>, open: boolean): { readonly text: string; readonly rest: number[] } {
  const kept: number[] = [];
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index]!;
    const length = lead < 0x80 ? 1 : lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0;
    if (length === 0) { index += 1; continue; }
    let have = 1;
    let broken = false;
    for (; have < length && index + have < bytes.length; have += 1) {
      const next = bytes[index + have]!;
      // RFC 3629: no overlong forms, no surrogates, nothing past U+10FFFF.
      const low = have === 1 && lead === 0xe0 ? 0xa0 : have === 1 && lead === 0xf0 ? 0x90 : 0x80;
      const high = have === 1 && lead === 0xed ? 0x9f : have === 1 && lead === 0xf4 ? 0x8f : 0xbf;
      if (next < low || next > high) { broken = true; break; }
    }
    if (broken) { index += 1; continue; }
    if (have < length) {
      if (open) return { text: decodeKept(kept), rest: Array.from({ length: bytes.length - index }, (_, at) => bytes[index + at]!) };
      break;
    }
    for (let at = 0; at < length; at += 1) kept.push(bytes[index + at]!);
    index += length;
  }
  return { text: decodeKept(kept), rest: [] };
}
/** P0V-67, P0-2: these bytes are one read of a stream, not the start of a
 * document, so a U+FEFF at their start is a character like any other --
 * where the terminal happened to cut its reads must not change the text. */
function decodeKept(kept: readonly number[]): string {
  return decodeUtf8(Uint8Array.from(kept));
}

function chars(text: string, keys: Key[]): void {
  // P0V-108, NB-07: typed input takes the same cut a paste does -- a C1
  // control or a format character the screen cannot show must not land in
  // the draft and be sent anyway (the layout characters survive; C0 bytes
  // and DEL are read as keys before they ever reach text).
  for (const value of text.replace(UNSEEN_EXCEPT_LAYOUT, ""))
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
 *
 * The clock is injected so the post-paste burst below is a fact tests can
 * state rather than a race they have to win.
 */
export class KeyDecoder {
  /** The bytes of a code point a read ended in the middle of, held for the
   * next read to finish -- so "half a code point is pending" is something this
   * class can answer, and give a deadline to. */
  private pendingText: number[] = [];
  private escape: number[] | null = null;
  private discardingCsi = false;
  /** An assembling paste: its bytes, whether it has already passed its bound,
   * how much of the end marker has matched so far, and whether its end marker
   * has already arrived in this read. */
  private paste: { readonly bytes: number[]; truncated: boolean; matched: number; ended: boolean } | null = null;
  /** When the last paste ended, for the burst rule in `afterPaste`. */
  private pasteEndedAtMs: number | null = null;

  /** Elapsed time only (the paste burst), so a monotonic clock: a wall clock
   * set back after a paste would hold every Enter as a newline for as long as
   * the jump (R6-03, MAC-650). */
  constructor(private readonly now: () => number = () => performance.now()) {}

  /** How long the stream owner should wait for the rest of what this decoder
   * has started, or null when nothing is pending.
   *
   * Every unfinished token gets one, not just the lone Escape. An incomplete
   * report with no deadline is not merely stuck: the next real keystroke is a
   * byte in the CSI final range, so the decoder consumed the Human's next key
   * as the end of a report that never came. A half-delivered code point is the
   * same shape of bug -- the next byte is read as its continuation -- so it
   * gets a deadline too.
   */
  get pendingDelayMs(): number | null {
    if (this.paste !== null) return TERMINAL_BOUNDS.pasteIdleMs.value;
    if (this.escape !== null || this.discardingCsi) return TERMINAL_BOUNDS.escapeDelayMs.value;
    if (this.incompleteText) return TERMINAL_BOUNDS.textDelayMs.value;
    return null;
  }

  push(chunk: Uint8Array): Key[] {
    const keys: Key[] = [];
    let textStart = 0;
    const flushText = (end: number, final: boolean): void => {
      const region = chunk.subarray(textStart, end);
      const decoded = decodeText([...this.pendingText, ...region], !final);
      this.pendingText = decoded.rest;
      chars(decoded.text, keys);
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
          if (this.paste.matched === PASTE_END.length) {
            // The paste is over, but this read is not. Whatever the terminal
            // put after the end marker in the same read stays content of this
            // paste rather than becoming keys, and the paste key is emitted at
            // the end of the read. Bracketed paste is the terminal's promise
            // that pasted bytes are not keystrokes; a terminal that passes a
            // clipboard's own `ESC[201~` through unchanged breaks it, and
            // without this the newline behind that marker would submit the
            // text in front of it as a prompt the Human never pressed Enter
            // for. The cost is that a key genuinely typed within the same read
            // as a paste joins the draft as text instead of acting -- which is
            // a delay, not a submission.
            this.paste.ended = true;
            this.paste.matched = 0;
          }
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
        if (this.escape.length === 1 && byte !== CSI && byte !== SS3) {
          const action = actionOf(String.fromCharCode(ESC));
          if (action) keys.push(action);
          this.escape = null;
          textStart = index;
          continue;
        }
        this.escape.push(byte);
        index += 1;
        textStart = index;
        // NB-08: the Linux console's F1-F5 are `ESC [ [ A`-`ESC [ [ E`, so a
        // `[` directly after `ESC [` opens that report rather than ending
        // one; terminating there would let the real final byte land as typed
        // text. The report ends on the next byte in the final range.
        const linuxConsole = this.escape.length === 3 && this.escape[1] === CSI && byte === CSI;
        if (this.escape.length >= 3 && isCsiFinal(byte) && !linuxConsole) {
          // A report is bytes the engine names, not text: one code unit per byte.
          const token = String.fromCharCode(...this.escape);
          this.escape = null;
          if (token === PASTE_START) {
            this.paste = { bytes: [], truncated: false, matched: 0, ended: false };
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
          if (action) keys.push(this.afterPaste(action));
        }
        index += 1;
        textStart = index;
        continue;
      }
      index += 1;
    }
    flushText(chunk.length, false);
    // Emitted here rather than where the marker matched, so one read that
    // contains a paste contains nothing but that paste. Bytes that were part
    // way through matching another end marker when the read ran out were
    // content after all -- the paste closes here, so there is no later read to
    // finish that match in -- and they are given back rather than dropped.
    if (this.paste !== null && this.paste.ended) {
      for (let position = 0; position < this.paste.matched; position += 1)
        this.addPasteByte(PASTE_END.charCodeAt(position));
      keys.push(this.endPaste());
    }
    return keys;
  }

  private resetText(): void {
    this.pendingText = [];
  }

  /** Whether a read ended in the middle of a code point that the terminal has
   * not finished yet. */
  private get incompleteText(): boolean {
    return this.pendingText.length > 0;
  }

  /** Defence in depth for a clipboard that carries its own paste end marker.
   *
   * Absorbing the rest of the read covers the injected marker and the newline
   * behind it arriving together. This covers them arriving in consecutive
   * reads: for the declared burst after a paste ends, an Enter is taken as the
   * newline it was in the clipboard rather than as a submission. A Human
   * cannot press Enter within that burst; a terminal replaying clipboard bytes
   * always does.
   */
  private afterPaste(action: Key): Key {
    if (action.kind !== "enter" || this.pasteEndedAtMs === null) return action;
    if (this.now() - this.pasteEndedAtMs >= TERMINAL_BOUNDS.pasteBurstMs.value) return action;
    return { kind: "char", value: "\n" };
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
    this.pasteEndedAtMs = this.now();
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
    // Half a code point is not a character. It is dropped with the decoder
    // state that was waiting for the rest of it, so the next byte begins what
    // it says it begins instead of completing a code point the terminal
    // abandoned -- and no U+FFFD is invented in its place.
    if (this.incompleteText) this.resetText();
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
    // The stream is over: an unfinished code point is never finished.
    chars(decodeText(this.pendingText, false).text, keys);
    this.resetText();
    keys.push(...this.flushPending());
    this.escape = null;
    this.discardingCsi = false;
    this.paste = null;
    this.pasteEndedAtMs = null;
    return keys;
  }
}

/** Whole-buffer decoding for closed fixtures lives in test/fixtures/keys.ts;
 * stream owners keep a `KeyDecoder` instance. */
