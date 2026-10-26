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
  textDelayMs: bound(50, "count", "milliseconds allowed for the rest of a UTF-8 code point split across terminal reads"),
  pasteBytes: bound(16 * 1024, "bytes", "one bracketed paste the decoder assembles; a report that does not end within it is broken input, not a paste"),
  pasteIdleMs: bound(1000, "count", "milliseconds a started paste may stall before the decoder stops waiting for its end marker"),
  pasteBurstMs: bound(50, "count", "milliseconds after a paste ends during which an Enter is the paste's own newline rather than a submission no Human pressed"),
  interactiveExitSeconds: bound(2, "count", "seconds for the interactive child to restore its terminal before forced termination"),
  startupScreenMs: bound(10_000, "count", "milliseconds a start may take before this process shows its own screen instead of waiting for the engine's"),
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
  // B3: the waiting queue's picture for the above-editor widget. The wire
  // snapshot is bounded before it is serialized -- a full queue is still one
  // small frame -- and the widget lines stay under the engine's own cap with
  // room for the header and a remainder line.
  queuePreviewPrompts: bound(8, "count", "queued prompts sent to the widget; header plus these plus a remainder stay under the engine's ten-line widget cap"),
  queuePreviewCells: bound(160, "cells", "one queued prompt is one widget line; longer is cut, never wrapped"),
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
  numberDraftDigits: bound(String(Number.MAX_SAFE_INTEGER).length, "count", "digits needed by the configuration safe-integer contract"),
  revisionDigestHex: bound(32, "count", "hex digits of the content digest a policy revision carries"),
  maxInitialWorkers: bound(64, "count", "bootstrap seeds a population, not a fleet"),
  seedNameAttempts: bound(4096, "count", "bounds the search for a free seed name"),
  engineNameChars: bound(200, "count", "a provider, model or effort name the engine's screen reports"),
});

/** Time-unit conversions for duration text — groupings, not caps; declared
 * here because the surface declares its numbers rather than inlining them. */
export const DURATION_UNITS = Object.freeze({ msPerSecond: 1000, perMinute: 60, perHour: 60 });

/** B1: the compact tool row's own bounds. A row is one line collapsed; what
 * expansion reveals is bounded by the transcript's own caps, not here. */
export const COMPACT_TOOL_BOUNDS = Object.freeze({
  indicatorMs: bound(80, "count", "milliseconds between repaints of a running row's status dot"),
  indicatorFrames: bound(14, "count", "the dot's pulse phases per cycle; the cosine walks them"),
  summaryCells: bound(160, "cells", "a call row's one-line argument summary before the ellipsis"),
  failureCells: bound(140, "cells", "the one-line reason a failed row carries on its status line"),
  trackedCalls: bound(2000, "count", "tool-call timings kept before the oldest finished is dropped"),
});

/** BL2: the ask_user_question overlay's own bounds. The batch bounds the
 * schema declares (questions, options, label/header lengths) live with the
 * contract in packages/domain/src/ask-user-question/questionnaire.ts; what lives here
 * is the layout floor only the renderer knows. */
export const ASK_QUESTION_BOUNDS = Object.freeze({
  previewSplitColumns: bound(72, "cells", "below this an option preview flows under the rows; at or above it earns a side pane"),
});

export const READ_BOUNDS = Object.freeze({
  mailHeaderBytes: bound(64 * 1024, "bytes", "headers are read, not whole attachments"),
  // P0V-43: one refresh reads the headers of at most this many messages, the
  // most recent first; the rest of a large mailbox is counted, not read. (The
  // body a message may have is the society's own limit, not a copy here.)
  mailListRows: bound(200, "count", "messages one refresh reads a header for"),
  // AV-11: the delivery-arrival journal is appended per delivery, one short
  // `<ms> <id>` line each; a listing reads only its newest window.
  mailArrivalJournalBytes: bound(256 * 1024, "bytes", "arrival-journal tail a mailbox listing reads"),
  extensionScanDepth: bound(3, "count", "installed extensions are not nested deeper"),
  extensionScanEntries: bound(1024, "count", "directory entries one extension scan examines before it reports a partial list"),
});

/** Every declared bound, for tests that assert the surface stays bounded. */
export const SURFACE_BOUNDS = Object.freeze({
  ...TERMINAL_BOUNDS,
  ...CONVERSATION_BOUNDS,
  ...CONFIG_BOUNDS,
  ...COMPACT_TOOL_BOUNDS,
  ...ASK_QUESTION_BOUNDS,
  ...READ_BOUNDS,
});
