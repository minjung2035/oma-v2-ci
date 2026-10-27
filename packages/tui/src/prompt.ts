import type { PromptOutcome } from "@oma/domain/settings";
export type { PromptOutcome } from "@oma/domain/settings";
/** TUI-023: one bounded Human prompt draft.
 *
 * Admission, Unicode editing and submission are one state machine because an
 * overflow bit detached from its text is exactly how a retained prefix can be
 * mistaken for the Human's complete request. This module performs no I/O and
 * does not word notices; it reports closed transitions to the TUI model.
 */
import { humanPromptFitsFrame } from "@oma/domain/surface-bounds";

/** Why the draft is refusing to grow, or null when it is not.
 *
 * The cause is part of the state because the way out differs. `typed` means
 * the Human's own text reached the bound, and the way out is to shorten it.
 * `paste` means a paste was refused whole -- it added nothing -- and the way
 * out is to do anything else: erasing there would delete a character the Human
 * typed to recover from a paste that never touched the draft.
 */
export type PromptOverflow = "typed" | "paste";

export interface PromptDraft {
  readonly text: string;
  readonly overflow: PromptOverflow | null;
}

export type PromptTransition =
  | { readonly kind: "none"; readonly draft: PromptDraft }
  | { readonly kind: "show-limit"; readonly draft: PromptDraft; readonly cause: PromptOverflow }
  | { readonly kind: "clear-limit"; readonly draft: PromptDraft }
  | { readonly kind: "submit"; readonly draft: PromptDraft; readonly text: string };

export const EMPTY_PROMPT: PromptDraft = Object.freeze({ text: "", overflow: null });
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function withoutLastGrapheme(text: string): string {
  const last = [...graphemes.segment(text)].at(-1);
  return last === undefined ? "" : text.slice(0, last.index);
}

export function appendPrompt(draft: PromptDraft, value: string, frameBytes: number): PromptTransition {
  // Typed overflow means the draft is already at the bound, so it cannot take
  // another character. A refused paste left the draft below the bound, so
  // typing is how the Human continues -- and it clears the refusal.
  if (draft.overflow === "typed") return { kind: "none", draft };
  const candidate = draft.text + value;
  if (!humanPromptFitsFrame(candidate, frameBytes))
    return { kind: "show-limit", draft: { text: draft.text, overflow: "typed" }, cause: "typed" };
  const next = { text: candidate, overflow: null };
  return draft.overflow === null ? { kind: "none", draft: next } : { kind: "clear-limit", draft: next };
}

export function erasePrompt(draft: PromptDraft): PromptTransition {
  // A refused paste added nothing, so the first edit after it only takes the
  // refusal back. Erasing here would spend the Human's own last character on a
  // paste that was never admitted: `hello` would become `hell` because the
  // clipboard was too large.
  if (draft.overflow === "paste") return { kind: "clear-limit", draft: { text: draft.text, overflow: null } };
  const next = { text: withoutLastGrapheme(draft.text), overflow: null };
  return { kind: draft.overflow === null ? "none" : "clear-limit", draft: next };
}

/** One bracketed paste, admitted whole or not at all.
 *
 * A paste is one thing the Human did, so it is one admission decision. The
 * same is true of a paste the terminal never finished or that passed the
 * decoder's bound: what is left of it is a fragment nobody chose to send.
 */
export function pastePrompt(draft: PromptDraft, value: string, truncated: boolean, frameBytes: number): PromptTransition {
  if (draft.overflow !== null) return { kind: "none", draft };
  if (truncated) return { kind: "show-limit", draft: { text: draft.text, overflow: "paste" }, cause: "paste" };
  const grown = appendPrompt(draft, value, frameBytes);
  // A paste that does not fit is refused as a paste: it is the paste that was
  // not admitted, and the draft is exactly what it was before.
  if (grown.kind === "show-limit")
    return { kind: "show-limit", draft: { text: draft.text, overflow: "paste" }, cause: "paste" };
  return grown;
}

/** A refused prompt returns to the draft it was submitted from, so nothing the
 * Human typed is lost to a session that would not take it. */
export function returnedPrompt(text: string): PromptDraft {
  return { text, overflow: null };
}

export function submitPrompt(draft: PromptDraft): PromptTransition {
  // Either cause blocks submission: a draft at its bound is not the Human's
  // complete request, and a draft whose paste was refused is missing it.
  if (draft.overflow !== null) return { kind: "show-limit", draft, cause: draft.overflow };
  const text = draft.text.trim();
  return text.length === 0
    ? { kind: "none", draft: EMPTY_PROMPT }
    : { kind: "submit", draft: EMPTY_PROMPT, text };
}
