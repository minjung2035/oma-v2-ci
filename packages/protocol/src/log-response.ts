/** VIEW-003 / CFG-003: bound the complete v1 log response, not just raw journal bytes. */
import type { PublicMethods } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";

type LogView = PublicMethods["logs.read"]["result"];
function envelope(id: string, result: LogView) {
  return { v: 1 as const, id, ok: true as const, result };
}
const size = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");
// Empty ID gives the smallest envelope; reserve the largest valid timestamp and
// the longer boolean spelling. Each actual request ID is accounted for below.
export { MIN_LOG_FRAME_BYTES } from "./log-limits.js";
import { MIN_LOG_FRAME_BYTES } from "./log-limits.js";
export function isLogResponseFrameLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= MIN_LOG_FRAME_BYTES &&
    value <= 0xffffffff
  );
}
function prefix(text: string, length: number): string {
  // Never create an unpaired surrogate when a binary-search boundary bisects a code point.
  if (
    length > 0 &&
    length < text.length &&
    /[\uD800-\uDBFF]/.test(text[length - 1]!) &&
    /[\uDC00-\uDFFF]/.test(text[length]!)
  )
    length--;
  return text.slice(0, length);
}
export function boundedLogResponse(
  id: string,
  view: LogView,
  frameBytes: number,
): ReturnType<typeof envelope> {
  if (!isLogResponseFrameLimit(frameBytes))
    throw new StoreError(
      "UNSUPPORTED_PROFILE",
      "frame limit cannot support log responses",
    );
  const full = envelope(id, {
    text: view.text,
    truncated: view.truncated,
    observedAtMs: view.observedAtMs,
  });
  if (size(full) <= frameBytes) return full;
  const limited = envelope(id, { ...full.result, text: "", truncated: true });
  if (size(limited) > frameBytes)
    throw new StoreError(
      "INVALID_REQUEST",
      "request id leaves no room for a log response",
    );
  let low = 0;
  // `truncated: true` must tell the truth: its spelling is one byte shorter
  // than `false`, so a text exactly one byte over budget would otherwise be
  // delivered whole under a flag claiming a cut that never happened. When
  // the view was not already truncated the search is capped at a strict
  // prefix; when it was, the truncating envelope is the full one and the
  // search can never reach the whole text anyway.
  let high = view.truncated ? view.text.length : Math.max(view.text.length - 1, 0);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    limited.result.text = prefix(view.text, middle);
    if (size(limited) <= frameBytes) low = middle;
    else high = middle - 1;
  }
  limited.result.text = prefix(view.text, low);
  return limited;
}
