/** TUI-023: one bounded Human prompt draft.
 *
 * Admission, Unicode editing and submission are one state machine because an
 * overflow bit detached from its text is exactly how a retained prefix can be
 * mistaken for the Human's complete request. This module performs no I/O and
 * does not word notices; it reports closed transitions to the TUI model.
 */
import { humanPromptFitsFrame } from "./limits.js";

export interface PromptDraft {
  readonly text: string;
  readonly overflow: boolean;
}

export type PromptTransition =
  | { readonly kind: "none"; readonly draft: PromptDraft }
  | { readonly kind: "show-limit"; readonly draft: PromptDraft }
  | { readonly kind: "clear-limit"; readonly draft: PromptDraft }
  | { readonly kind: "submit"; readonly draft: PromptDraft; readonly text: string };

export const EMPTY_PROMPT: PromptDraft = Object.freeze({ text: "", overflow: false });
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function withoutLastGrapheme(text: string): string {
  const last = [...graphemes.segment(text)].at(-1);
  return last === undefined ? "" : text.slice(0, last.index);
}

export function appendPrompt(draft: PromptDraft, value: string, frameBytes: number): PromptTransition {
  if (draft.overflow) return { kind: "none", draft };
  const candidate = draft.text + value;
  if (!humanPromptFitsFrame(candidate, frameBytes))
    return { kind: "show-limit", draft: { text: draft.text, overflow: true } };
  return { kind: "none", draft: { text: candidate, overflow: false } };
}

export function erasePrompt(draft: PromptDraft): PromptTransition {
  const next = { text: withoutLastGrapheme(draft.text), overflow: false };
  return { kind: draft.overflow ? "clear-limit" : "none", draft: next };
}

export function submitPrompt(draft: PromptDraft): PromptTransition {
  if (draft.overflow) return { kind: "show-limit", draft };
  const text = draft.text.trim();
  return text.length === 0
    ? { kind: "none", draft: EMPTY_PROMPT }
    : { kind: "submit", draft: EMPTY_PROMPT, text };
}
