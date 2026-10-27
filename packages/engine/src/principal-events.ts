/** Pure engine-event and queue display projection; never decides run ownership. */
import { SKIPPED_EVENT, type PiEvent } from "./pi-rpc.js";
import { UNSEEN, UNSEEN_EXCEPT_LAYOUT } from "@oma/domain/unseen-text";
import { CONVERSATION_BOUNDS } from "@oma/domain/surface-bounds";

function textOf(message: unknown): string {
  if (typeof message === "string") return message;
  if (message === null || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") { parts.push(part); continue; }
    if (part === null || typeof part !== "object") continue;
    const value = (part as Record<string, unknown>).text;
    if (typeof value === "string") parts.push(value);
  }
  return parts.join("");
}

/** Pure event projection so transcript behaviour is testable without spawning
 * a real Pi process. What is running is not decided here: the session owns
 * that, and this only turns an event into the line the transcript shows.
 */
export function projectEvent(event: PiEvent): { readonly line?: string } {
  // DR15, P0-5: an event too large to hold was skipped; what it said is not
  // shown, and the screen says so rather than showing nothing.
  if (event.type === SKIPPED_EVENT)
    return { line: `⚠ An engine event (${String(event.bytes)} bytes) exceeded the display limit.` };
  if (event.type === "auto_retry_start")
    return { line: `⚠ Temporary model API error: waiting for retry ${String(event.attempt)}/${String(event.maxAttempts)}` };
  if (event.type === "auto_retry_end")
    return { line: event.success === true ? "Model API connection restored." : `⚠ Model API failed after ${String(event.attempt)} retries.` };
  if (event.type === "extension_error") {
    // An extension's failure is extension-provided text; what a screen cannot
    // show as written is stripped before it reaches the transcript.
    const clean = (value: unknown): string => (typeof value === "string" ? value : "").replace(UNSEEN, "");
    const where = clean(event.extensionPath).split("/").filter(Boolean).pop() ?? "extension";
    const hook = clean(event.event), detail = clean(event.error);
    return { line: `⚠ Extension ${where} failed${hook ? ` on ${hook}` : ""}${detail ? `: ${detail}` : ""}.` };
  }
  if (event.type === "message_end") {
    const message = event.message;
    if (message === null || typeof message !== "object" || Array.isArray(message)) return {};
    const record = message as Record<string, unknown>;
    const role = record.role;
    const text = textOf(record).trim();
    if (role === "assistant") {
      const stop = String(record.stopReason ?? "");
      if (stop === "error" || stop === "aborted")
        return { line: `⚠ Response ended with status: ${stop}.` };
      return text.length > 0 ? { line: text } : {};
    }
    if (role === "custom" && text.length > 0) return { line: `[Notice] ${text}` };
    return {};
  }
  return {};
}

/** B3: one queued prompt as one widget line -- unseen text out, line breaks
 * and runs of space folded, bounded cells. The queue keeps the real text;
 * only its picture is folded. */
export function queuePreviewLine(text: string): string {
  const flat = text.replace(UNSEEN_EXCEPT_LAYOUT, "").replace(/[\x00-\x1f\x7f]/gu, " ").replace(/\s+/gu, " ").trim();
  const cells = CONVERSATION_BOUNDS.queuePreviewCells.value;
  return flat.length > cells ? `${flat.slice(0, cells - 1).trimEnd()}…` : flat;
}
