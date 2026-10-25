/** TUI-001: what the conversation keeps.
 *
 * A bound on how many times something was appended is not a bound on the
 * conversation: one engine reply is one append and can hold thousands of
 * displayed lines, so counting appends left the screen's memory decided by
 * whatever the model wrote. This module owns the transcript the way
 * `prompt.ts` owns the draft -- the split into logical lines, the byte ceiling
 * on one of them, and the ceiling on all of them are one state machine, so a
 * producer cannot hold a line the bound never sees.
 *
 * It performs no I/O and decides nothing about presentation: a stored line is
 * what was produced, and how it is drawn belongs to `view/text.ts`.
 */
import { CONVERSATION_BOUNDS } from "@oma/domain/surface-bounds";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const bytesOf = (text: string): number => Buffer.byteLength(text, "utf8");

/** Cuts on code points when one grapheme cluster is itself over the bound.
 *
 * A cluster is normally the unit a cut must not split, but a cluster is not
 * bounded: thousands of combining marks are one cluster, and honouring it
 * there would make a single produced line unbounded. A code point boundary at
 * least never emits an invalid UTF-8 sequence.
 */
function byCodePoints(text: string, limit: number): string[] {
  const out: string[] = [];
  let piece = "";
  let used = 0;
  for (const point of text) {
    const size = bytesOf(point);
    if (used + size > limit && piece.length > 0) { out.push(piece); piece = ""; used = 0; }
    piece += point;
    used += size;
  }
  if (piece.length > 0) out.push(piece);
  return out;
}

/** One produced line as stored lines, each within the declared byte bound. */
export function storedLines(line: string): string[] {
  const limit = CONVERSATION_BOUNDS.transcriptLineBytes.value;
  if (bytesOf(line) <= limit) return [line];
  const out: string[] = [];
  let piece = "";
  let used = 0;
  for (const { segment } of graphemes.segment(line)) {
    const size = bytesOf(segment);
    if (size > limit) {
      if (piece.length > 0) { out.push(piece); piece = ""; used = 0; }
      out.push(...byCodePoints(segment, limit));
      continue;
    }
    if (used + size > limit) { out.push(piece); piece = ""; used = 0; }
    piece += segment;
    used += size;
  }
  if (piece.length > 0) out.push(piece);
  return out;
}

export class Transcript {
  private stored: string[] = [];
  private bytes = 0;

  /** What the conversation holds, oldest first. */
  get lines(): readonly string[] { return this.stored; }

  /** Bytes currently held, so the declared total can be checked as a fact. */
  get heldBytes(): number { return this.bytes; }

  /** The one way anything enters the transcript. Newlines inside the text are
   * line boundaries here, whoever produced them: an engine reply, a broker
   * report and the Human's own echoed prompt are all held to the same bound. */
  append(text: string): void {
    for (const logical of text.replace(/\r\n?/g, "\n").split("\n"))
      for (const line of storedLines(logical)) this.push(line);
  }

  private push(line: string): void {
    this.stored.push(line);
    this.bytes += bytesOf(line);
    // Trimmed as each line arrives, never once at the end: one append of a
    // hundred-megabyte reply must not first be held in full.
    while (this.stored.length > CONVERSATION_BOUNDS.transcriptLines.value ||
      (this.bytes > CONVERSATION_BOUNDS.transcriptBytes.value && this.stored.length > 1)) {
      const dropped = this.stored.shift();
      if (dropped === undefined) break;
      this.bytes -= bytesOf(dropped);
    }
  }
}
