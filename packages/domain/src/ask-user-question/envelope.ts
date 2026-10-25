/** BL2: the model-facing envelope for ask_user_question. The human's answer
 * is exactly the tool call's result — text the model reads plus the same
 * outcome as machine-readable `details`. It is never a queued prompt, never
 * a mail item, never a session switch. The envelope strings keep the
 * upstream wording so a transcript or a consumer written against the
 * upstream tool reads identically. Pure module: no engine import. */

import type { QuestionAnswer, QuestionnaireResult } from "./questionnaire.js";

export const DECLINE_MESSAGE = "User declined to answer questions";
export const ENVELOPE_PREFIX = "User has answered your questions:";
export const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";
export const NO_INPUT_PLACEHOLDER = "(no input)";

export interface AskToolResult {
  content: { type: "text"; text: string }[];
  details: QuestionnaireResult;
}

export function buildAskToolResult(text: string, details: QuestionnaireResult): AskToolResult {
  return { content: [{ type: "text" as const, text }], details };
}

/** The scalar form of one answer — what the `"Q"="A"` segment quotes. An
 * empty or absent answer still has a canonical spelling so the model is not
 * left guessing whether a blank means anything. */
export function formatAnswerScalar(answer: QuestionAnswer): string {
  switch (answer.kind) {
    case "multi":
      return answer.selected !== undefined && answer.selected.length > 0 ? answer.selected.join(", ") : NO_INPUT_PLACEHOLDER;
    case "custom":
      return answer.answer ? answer.answer : NO_INPUT_PLACEHOLDER;
    case "option":
      return answer.answer ?? NO_INPUT_PLACEHOLDER;
  }
}

/** `"Q"="A". selected preview: P.` — the per-question segment. The preview
 * echo quotes what the human was looking at when they chose. */
export function buildAnswerSegment(answer: QuestionAnswer): string {
  const parts: string[] = [`"${answer.question}"="${formatAnswerScalar(answer)}"`];
  if (answer.preview !== undefined && answer.preview.length > 0) parts.push(`selected preview: ${answer.preview}`);
  return `${parts.join(". ")}.`;
}

/** A questionnaire result (or a destroyed context's stand-in) becomes the
 * tool result the model sees. Cancelled and "no answers" both read as the
 * canonical decline so the model gets one "didn't answer" signal regardless
 * of why the dialog ended. The structured details still carry the partial
 * answers and the error code for consumers that read them. */
export function buildQuestionnaireResponse(result: QuestionnaireResult | undefined, questionCount: number): AskToolResult {
  if (result === undefined || result.cancelled) {
    return buildAskToolResult(DECLINE_MESSAGE, {
      answers: result?.answers ?? [],
      cancelled: true,
      ...(result?.error !== undefined ? { error: result.error } : {}),
    });
  }
  const segments: string[] = [];
  for (let index = 0; index < questionCount; index++) {
    const answer = result.answers.find((candidate) => candidate.questionIndex === index);
    if (answer !== undefined) segments.push(buildAnswerSegment(answer));
  }
  if (segments.length === 0) {
    return buildAskToolResult(DECLINE_MESSAGE, { answers: result.answers, cancelled: true });
  }
  return buildAskToolResult(`${ENVELOPE_PREFIX} ${segments.join(" ")} ${ENVELOPE_SUFFIX}`, result);
}
