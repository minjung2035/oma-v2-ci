/** BL2: the in-process seam between the ask_user_question tool and the
 * OMA-owned presenter. Both live in the same engine process — the tool in
 * the loaded extension, the presenter in the host's UI boundary — so the
 * seam is a channel on Pi's event bus, not a prompt, not mail, and not a
 * session switch. A request is claimed synchronously so the tool can tell
 * "no presenter is listening" apart from "the human is still answering".
 * Pure module: channel names and payload guards only, no engine import. */

import { isQuestionnaireResult, type AskQuestion, type QuestionnaireResult } from "@oma/domain/ask-user-question/questionnaire";

/** The tool's canonical name — pinned here so the extension registration and
 * the domain surface plan bind the same spelling (a test asserts it). */
export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

export const ASK_REQUEST_EVENT = "oma.ask.request";
export const ASK_CLAIM_EVENT = "oma.ask.claim";
export const ASK_RESPONSE_EVENT = "oma.ask.response";
export const ASK_CANCEL_EVENT = "oma.ask.cancel";

/** The tool emits this when a validated batch of questions needs a human. */
export interface AskRequest {
  readonly id: string;
  readonly questions: readonly AskQuestion[];
}
/** Emitted by whichever side takes the request, before any UI work starts.
 * The tool reads the claim as proof the answer can arrive at all. */
export interface AskClaim {
  readonly id: string;
}
/** The presenter's completion: the answers, a decline, or a destroyed
 * context's structured cancel. One response per request, always. */
export interface AskResponse {
  readonly id: string;
  readonly result: QuestionnaireResult;
}
/** Sent when the tool's own lifecycle (abort, session boundary) ends the
 * wait before the human answers; the presenter closes the matching dialog. */
export interface AskCancel {
  readonly id: string;
}

function isIdPayload(value: unknown): value is { id: string } {
  return value !== null && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}
/** The request guard is the presenter's input boundary: the tool validates
 * before it emits, but the bus is shared, so a payload the model could choke
 * on is dropped here rather than inside the dialog. */
function isAskQuestionShape(value: unknown): value is AskQuestion {
  if (value === null || typeof value !== "object") return false;
  const q = value as Record<string, unknown>;
  return typeof q.question === "string" && typeof q.header === "string" &&
    Array.isArray(q.options) &&
    (q.options as unknown[]).every(
      option => option !== null && typeof option === "object" &&
        typeof (option as { label?: unknown }).label === "string" &&
        typeof (option as { description?: unknown }).description === "string",
    );
}
export function isAskRequest(value: unknown): value is AskRequest {
  const questions = (value as { questions?: unknown }).questions;
  return isIdPayload(value) && Array.isArray(questions) && questions.every(isAskQuestionShape);
}
export function isAskClaim(value: unknown): value is AskClaim {
  return isIdPayload(value);
}
export function isAskCancel(value: unknown): value is AskCancel {
  return isIdPayload(value);
}
export function isAskResponse(value: unknown): value is AskResponse {
  return isIdPayload(value) && isQuestionnaireResult((value as { result?: unknown }).result);
}
