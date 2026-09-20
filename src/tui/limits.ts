/** Declared bounds for the product surface.
 *
 * Core states its limits once in a frozen descriptor (RESOURCE_FIELDS,
 * PROTOCOL_LIMIT_FIELDS, SURFACE_LIMITS) rather than spreading numbers through
 * the code that uses them. The product surface follows the same rule: every
 * bound a screen relies on is named here, so what the UI will and will not grow
 * to is readable in one place and testable without rendering anything.
 *
 * They never relax a wire, durable or quota limit, and nothing here is
 * authority. Column widths are layout and live with the view
 * (`view/layout.ts`), so a layout rewrite does not touch this file.
 */

export interface SurfaceBound {
  readonly value: number;
  readonly unit: "cells" | "lines" | "bytes" | "count";
  readonly why: string;
}

export const bound = (value: number, unit: SurfaceBound["unit"], why: string): SurfaceBound =>
  Object.freeze({ value, unit, why });

export const TERMINAL_BOUNDS = Object.freeze({
  minColumns: bound(20, "cells", "narrower than this cannot show a label and a value"),
  minRows: bound(6, "lines", "conversation, divider, prompt and hint need this many"),
  assumedColumns: bound(80, "cells", "used when the stream reports no width"),
  assumedRows: bound(24, "lines", "used when the stream reports no height"),
  escapeSequenceBytes: bound(64, "bytes", "an incomplete terminal report must not grow without limit"),
  escapeDelayMs: bound(50, "count", "milliseconds allowed to distinguish a lone Escape key from a split terminal report"),
  pasteBytes: bound(16 * 1024, "bytes", "one bracketed paste the decoder assembles; a report that does not end within it is broken input, not a paste"),
  pasteIdleMs: bound(1000, "count", "milliseconds a started paste may stall before the decoder stops waiting for its end marker"),
});

export const CONVERSATION_BOUNDS = Object.freeze({
  // Three bounds, because one of them alone is not a bound. A produced line is
  // whatever the engine wrote, newlines included: counting produced entries
  // would let one reply hold thousands of displayed lines, and counting lines
  // alone would let one line hold megabytes. The transcript therefore stores
  // logical lines, each within a byte bound, and holds a bounded number and a
  // bounded total of them.
  transcriptLines: bound(500, "lines", "a long session must not grow without limit"),
  transcriptBytes: bound(256 * 1024, "bytes", "how much conversation the screen keeps, whatever the length of one produced line"),
  transcriptLineBytes: bound(1024, "bytes", "one stored transcript line; a longer produced line is stored as several"),
  // The two largest things a Human can put into this process. A prompt is
  // composed one key at a time and a paste arrives as keys too, so without a
  // ceiling one paste decides how much memory the screen holds; and a prompt
  // typed while the engine is running waits here rather than in the engine, so
  // without a ceiling a long run decides how many of them accumulate.
  promptBytes: bound(16 * 1024, "bytes", "one Human prompt before its Pi command envelope"),
  waitingPrompts: bound(16, "count", "prompts already typed that the running turn has not reached yet"),
});

/** Human request ids are decimal safe integers, so this is the largest command
 * envelope a prompt can acquire during one session. The byte admission below
 * and the sender both use this convention; neither has to guess how much of
 * the configured frame the other will consume. */
export function humanPromptRequestId(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new RangeError("Human prompt sequence must be a positive safe integer");
  return `oma-tui-${sequence}`;
}

const LARGEST_HUMAN_PROMPT_ID = humanPromptRequestId(Number.MAX_SAFE_INTEGER);
const EMPTY_HUMAN_PROMPT_FRAME_BYTES = Buffer.byteLength(JSON.stringify({
  id: LARGEST_HUMAN_PROMPT_ID,
  type: "prompt",
  message: "",
}), "utf8");

/** A raw UTF-8 ceiling strictly inside the configured Pi frame. JSON escaping
 * can consume more than one wire byte per input byte, so fitting this ceiling
 * is necessary but not sufficient; `humanPromptFitsFrame` checks the exact
 * serialized command as the second gate. */
export function humanPromptByteLimit(frameBytes: number): number {
  if (!Number.isSafeInteger(frameBytes) || frameBytes <= 0) return 0;
  return Math.max(0, Math.min(
    CONVERSATION_BOUNDS.promptBytes.value,
    frameBytes - EMPTY_HUMAN_PROMPT_FRAME_BYTES,
  ));
}

export function humanPromptFrameBytes(message: string): number {
  return Buffer.byteLength(JSON.stringify({
    id: LARGEST_HUMAN_PROMPT_ID,
    type: "prompt",
    message,
  }), "utf8");
}

export function humanPromptFitsFrame(message: string, frameBytes: number): boolean {
  return Buffer.byteLength(message, "utf8") <= humanPromptByteLimit(frameBytes) &&
    humanPromptFrameBytes(message) <= frameBytes;
}

export const CONFIG_BOUNDS = Object.freeze({
  numberDraftDigits: bound(9, "count", "a settings number never needs more digits"),
  revisionDigestHex: bound(32, "count", "hex digits of the content digest a policy revision carries"),
  maxWorkerLimit: bound(4096, "count", "an editable cap the quota validator still has to accept"),
  maxInitialWorkers: bound(64, "count", "bootstrap seeds a population, not a fleet"),
  seedNameAttempts: bound(4096, "count", "bounds the search for a free seed name"),
});

export const READ_BOUNDS = Object.freeze({
  mailHeaderBytes: bound(64 * 1024, "bytes", "headers are read, not whole attachments"),
  mailBodyBytes: bound(256 * 1024, "bytes", "matches the wire mail body limit"),
  extensionScanDepth: bound(3, "count", "installed extensions are not nested deeper"),
  roleExtensions: bound(16, "count", "the operations contract's per-role maximum"),
});

/** Every declared bound, for tests that assert the surface stays bounded. */
export const SURFACE_BOUNDS = Object.freeze({
  ...TERMINAL_BOUNDS,
  ...CONVERSATION_BOUNDS,
  ...CONFIG_BOUNDS,
  ...READ_BOUNDS,
});
