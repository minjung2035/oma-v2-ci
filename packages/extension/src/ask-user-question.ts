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
    description: `MAX ${MAX_LABEL_LENGTH} CHARACTERS — hard limit, requests over the limit are rejected. The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.`,
  }),
  description: Type.String({
    description:
      "Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.",
  }),
  preview: Type.Optional(
    Type.String({
      description:
        "Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options.",
    }),
  ),
});

const QuestionSchema = Type.Object({
  question: Type.String({
    description:
      'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"',
  }),
  header: Type.String({
    maxLength: MAX_HEADER_LENGTH,
    description: `MAX ${MAX_HEADER_LENGTH} CHARACTERS — hard limit, requests over the limit are rejected. Very short chip/tag shown next to the question. Examples: "Auth method", "Library", "Approach".`,
  }),
  options: Type.Array(OptionSchema, {
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
    description:
      "The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). The 'Type something.' row is appended automatically — do NOT author it.",
  }),
  multiSelect: Type.Optional(
    Type.Boolean({
      default: false,
      description:
        "Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
    }),
  ),
});

const QuestionParamsSchema = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    maxItems: MAX_QUESTIONS,
    description: "Questions to ask the user (1-4 questions)",
  }),
});

const PROMPT_SNIPPET = `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous`;
const PROMPT_GUIDELINES: string[] = [
  `Use ask_user_question whenever the user's request is underspecified and you cannot proceed without concrete decisions — you can ask up to ${MAX_QUESTIONS} questions per invocation.`,
  `Each question MUST have ${MIN_OPTIONS}-${MAX_OPTIONS} options. Every option requires a concise label (1-5 words) and a description explaining what the choice means or its trade-offs. The user can additionally type a custom answer via the automatically appended "Type something." row on every question, or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.`,
  `Set multiSelect: true when multiple answers are valid. Provide an options[].preview text string when an option benefits from side-by-side context (mockups, code snippets, configs). If you recommend a specific option, make that the first option and append "(Recommended)" to its label.`,
  "Do not stack multiple ask_user_question calls back-to-back — group all clarifying questions into one invocation.",
];

const TOOL_DESCRIPTION = `Ask the user one or more structured questions during execution. Use when you need to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

Usage notes:
- Users can type a custom answer via the automatically appended "Type something." row on every question or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.
- Use multiSelect: true when multiple answers are valid.
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.

Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare: ASCII mockups, code snippets, configuration examples. Preview text is rendered in a pane beside the option list when the terminal is wide enough, otherwise below it. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are intended for single-select questions.`;

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
