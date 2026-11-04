/** BL2: ask_user_question, OMA's bundled human-input tool. The tool
 * validates a batch of questions and waits for the OMA-owned presenter —
 * registered inside the host's UI boundary — to hand back the human's
 * answers on the extension event bus. The answer is this call's tool result:
 * it never enters the prompt queue, mail, or session machinery. Every
 * refusal (no UI, invalid input, no presenter) and every lifecycle end
 * (abort, session boundary) is a structured result, never a hang and never
 * a thrown exception the engine has to guess about.
 *
 * The file is also the Personal host's `-e` extension entry point: the same
 * registration runs wherever a human sits at the terminal. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  ASK_CANCEL_EVENT,
  ASK_CLAIM_EVENT,
  ASK_REQUEST_EVENT,
  ASK_RESPONSE_EVENT,
  ASK_USER_QUESTION_TOOL_NAME,
  isAskClaim,
  isAskResponse,
} from "@oma/protocol/ask-user-question";
import {
  ERROR_NO_PRESENTER,
  ERROR_NO_UI,
  MAX_HEADER_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  normalizeQuestionParams,
  validateQuestionnaire,
  type QuestionnaireResult,
} from "@oma/domain/ask-user-question/questionnaire";
import { buildAskToolResult, buildQuestionnaireResponse, DECLINE_MESSAGE } from "@oma/domain/ask-user-question/envelope";

const boundExtensions = new WeakSet<ExtensionAPI>();

/** The engine-facing declaration of the shared contract: same fields, same
 * bounds, same reserved-label story as the validator in the client module. */
const OptionSchema = Type.Object({
  label: Type.String({
    maxLength: MAX_LABEL_LENGTH,
    description: `Short user-facing choice, ideally 1-5 words; at most ${MAX_LABEL_LENGTH} characters. Put a recommended choice first and suffix its label with "(Recommended)" when useful.`,
  }),
  description: Type.String({
    description:
      "Brief explanation of the outcome or trade-off if this option is selected.",
  }),
  preview: Type.Optional(
    Type.String({
      description:
        "Optional comparison text shown when this option is focused, such as a code snippet, configuration or mockup. Prefer for concrete single-select comparisons.",
    }),
  ),
});

const QuestionSchema = Type.Object({
  question: Type.String({
    description:
      "Clear, specific question about a decision the user must make. Phrase it for multiple choices when multiSelect is true; question text must be unique in this batch.",
  }),
  header: Type.String({
    maxLength: MAX_HEADER_LENGTH,
    description: `Short UI header, at most ${MAX_HEADER_LENGTH} characters, such as "Auth method" or "Approach".`,
  }),
  options: Type.Array(OptionSchema, {
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
    description:
      "Two to four distinct choices with unique labels; make them mutually exclusive unless multiSelect is true. Do not supply reserved labels Other, Type something., or Next; the UI adds its own custom-answer and navigation rows.",
  }),
  multiSelect: Type.Optional(
    Type.Boolean({
      default: false,
      description:
        "Allow multiple selected options when true; defaults to false for one selected option.",
    }),
  ),
});

const QuestionParamsSchema = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    maxItems: MAX_QUESTIONS,
    description: "One to four questions for the user. Ask only what is needed to unblock a material decision; group related questions in one call.",
  }),
});

const PROMPT_SNIPPET = `Ask the user for a blocking decision with 1-${MAX_QUESTIONS} structured questions and ${MIN_OPTIONS}-${MAX_OPTIONS} options each.`;
const PROMPT_GUIDELINES: string[] = [
  "Use ask_user_question for material requirements, preferences or trade-offs that cannot be resolved from available context. Do not ask the user to do repository research or make routine implementation decisions you can safely handle.",
  "Group related clarifications into one call. Keep choices concrete, explain their consequences and put a recommended option first when justified.",
  "Cancellation is not consent. If no UI or presenter is available, the user has not seen the questionnaire; ask in ordinary chat when a user decision is still required.",
];

const TOOL_DESCRIPTION = `Ask the user 1-${MAX_QUESTIONS} structured questions and wait for the answer in this tool result. Each question needs a header, question text and ${MIN_OPTIONS}-${MAX_OPTIONS} labeled options with descriptions. Use multiSelect for compatible choices; optional previews show concrete comparisons.

The UI adds a custom-answer row and allows Esc to cancel. Do not author reserved labels "Other", "Type something.", or "Next". Results include answers, cancelled and an error code when applicable. Invalid input, missing UI/presenter, abort or session end returns a refusal or cancellation, not approval. This tool does not send mail or record review authority.`;

/**
 * One registration per engine load. The boundary and a reload path can both
 * reach this function with the same `pi`; the second call must not replace
 * the live registration or double-subscribe the bus.
 */
export function registerAskUserQuestion(pi: ExtensionAPI): void {
  if (boundExtensions.has(pi)) return;
  boundExtensions.add(pi);

  // One wait per in-flight call, keyed by a request id the presenter echoes.
  // The map is the whole contract: a response resolves it, a cancel settles
  // it as `cancelled`, and a session boundary drains it — a pending question
  // can never outlive the context it was asked in.
  let sequence = 0;
  const pending = new Map<string, (result: QuestionnaireResult) => void>();
  const claims = new Set<string>();
  pi.events.on(ASK_CLAIM_EVENT, (data) => {
    if (isAskClaim(data)) claims.add(data.id);
  });
  pi.events.on(ASK_RESPONSE_EVENT, (data) => {
    if (!isAskResponse(data)) return;
    const resolve = pending.get(data.id);
    if (resolve !== undefined) {
      pending.delete(data.id);
      resolve(data.result);
    }
  });
  const settle = (id: string, result: QuestionnaireResult): void => {
    const resolve = pending.get(id);
    if (resolve !== undefined) {
      pending.delete(id);
      resolve(result);
    }
  };
  const cancelPending = (id: string): void => {
    // Tell the presenter to close the dialog, then settle locally — the tool
    // call resolves even if nothing was ever listening on the cancel side.
    try {
      pi.events.emit(ASK_CANCEL_EVENT, { id });
    } catch {
      // an already-invalidated event bus cannot deliver the close signal;
      // the local settle still has to resolve the pending tool call
    }
    settle(id, { answers: [], cancelled: true });
  };
  const cancelAll = (): void => {
    for (const id of [...pending.keys()]) cancelPending(id);
  };
  // The destroyed-UI-context contract: /new, /resume, reload and shutdown all
  // pass through these session events, and every one of them resolves an
  // unanswered question as a structured cancel before the switch proceeds.
  pi.on("session_shutdown", cancelAll);
  pi.on("session_before_switch", cancelAll);

  pi.registerTool({
    name: ASK_USER_QUESTION_TOOL_NAME,
    label: "Ask User Question",
    description: TOOL_DESCRIPTION,
    promptSnippet: PROMPT_SNIPPET,
    promptGuidelines: PROMPT_GUIDELINES,
    parameters: QuestionParamsSchema,
    // A question batch blocks on a human; two batches must never fight for
    // one terminal, so calls run one at a time like the group's facade.
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const typed = normalizeQuestionParams(params);
      if (!ctx.hasUI) {
        return buildAskToolResult(ERROR_NO_UI, { answers: [], cancelled: true, error: "no_ui" });
      }
      const validation = validateQuestionnaire(typed);
      if (!validation.ok) {
        return buildAskToolResult(validation.message, { answers: [], cancelled: true, error: validation.error });
      }
      // A call whose signal is already aborted is dead before it starts:
      // the abort listener below would never fire on it, so decline here —
      // before the bus, before any dialog could open for a call nobody waits
      // on.
      if (signal?.aborted === true) {
        return buildAskToolResult(DECLINE_MESSAGE, { answers: [], cancelled: true });
      }
      const id = `oma.ask.${++sequence}`;
      const outcome = new Promise<QuestionnaireResult>((resolve) => pending.set(id, resolve));
      pi.events.emit(ASK_REQUEST_EVENT, { id, questions: typed.questions });
      // The claim is synchronous by construction: the presenter claims inside
      // the same emit, so an unclaimed request means no OMA presenter exists
      // in this engine — a structured refusal, not a hang.
      if (!claims.delete(id)) {
        pending.delete(id);
        return buildAskToolResult(ERROR_NO_PRESENTER, { answers: [], cancelled: true, error: "no_presenter" });
      }
      const onAbort = (): void => cancelPending(id);
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const result = await outcome;
        return buildQuestionnaireResponse(result, typed.questions.length);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  });
}

/** OMA's own packaged entry point — what Personal's `-e` loads — not a
 * vendored upstream module. */
export default function extension(pi: ExtensionAPI): void {
  registerAskUserQuestion(pi);
}
