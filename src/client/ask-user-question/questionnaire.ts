/** BL2, ask_user_question: the contract the tool and the presenter share.
 * Limits, the wire question/answer/result shapes, and the pure normalizer +
 * validator all live here so the extension side and the TUI side can never
 * disagree about what a question is. Bounds and error vocabulary follow the
 * upstream ask-user-question schema (1-4 questions, 2-4 options each) so the
 * tool's model-facing surface stays drop-compatible; OMA adds
 * `missing_fields` because this validator cannot assume the engine enforced
 * the schema. The TypeBox schema that declares the same shape to the engine
 * lives in src/extension/ask-user-question.ts (typebox stays on the
 * extension side of PI-001); a test binds the two spellings.
 * No engine import: this module is pure. */

export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;

/** The free-text row every question appends automatically. The label is part
 * of the contract: it is shown to the human and it is what the model is told
 * not to author. */
export const CUSTOM_OPTION_LABEL = "Type something.";
/** The commit row a multi-select question appends after its options. */
export const NEXT_LABEL = "Next";
/** Labels the presenter reserves for its own rows. "Other" stays reserved
 * for parity even though no OMA row uses it: the model is conditioned to
 * reach for it, and refusing it keeps the runtime sentinel the single way to
 * answer outside the authored options. */
export const RESERVED_LABELS: readonly string[] = Object.freeze(["Other", CUSTOM_OPTION_LABEL, NEXT_LABEL]);
const RESERVED_LABEL_SET: ReadonlySet<string> = new Set(RESERVED_LABELS);

/** One authored choice. `preview` is optional text rendered beside the list
 * when the option is focused. */
export interface AskOption {
  readonly label: string;
  readonly description: string;
  readonly preview?: string;
}
/** One question in a batch. */
export interface AskQuestion {
  readonly question: string;
  readonly header: string;
  readonly options: readonly AskOption[];
  readonly multiSelect?: boolean;
}
export interface QuestionParams {
  readonly questions: readonly AskQuestion[];
}

/** One answered question, as the envelope and the result details carry it.
 * `kind` is the discriminator: `option` carries the chosen label in `answer`,
 * `custom` carries the typed text (`null` when the human committed an empty
 * input), `multi` carries `answer: null` with the chosen labels in
 * `selected`. The `string | null` shape is the upstream contract — a consumer
 * diffing details sees the same bytes. `preview` echoes the chosen option's
 * preview field so the envelope can quote what the human saw. */
export interface QuestionAnswer {
  readonly questionIndex: number;
  readonly question: string;
  readonly kind: "option" | "custom" | "multi";
  readonly answer: string | null;
  readonly selected?: string[];
  readonly preview?: string;
}

export type QuestionnaireError =
  | "no_ui"
  | "no_presenter"
  | "no_questions"
  | "missing_fields"
  | "empty_options"
  | "too_many_options"
  | "too_many_questions"
  | "duplicate_question"
  | "duplicate_option_label"
  | "reserved_label"
  | "too_long";

/** What the presenter hands back. `cancelled` is a first-class outcome, not
 * an exception: a declined questionnaire still carries the partial answers. */
export interface QuestionnaireResult {
  readonly answers: readonly QuestionAnswer[];
  readonly cancelled: boolean;
  readonly error?: QuestionnaireError;
}

export function isQuestionnaireResult(value: unknown): value is QuestionnaireResult {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.answers) && typeof v.cancelled === "boolean";
}

/** A raw CR inside a tool-call string is a cursor-control byte, not text: it
 * would fragment rows in the terminal and split what the validator compares
 * from what the human sees. CRLF folds to LF (multi-line previews stay), a
 * lone CR is deleted. */
export function normalizeLineTerminators(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "");
}

function normalizeRecord<T extends Record<string, unknown>>(obj: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const key of keys) {
    const value = out[key];
    if (typeof value === "string") out[key] = normalizeLineTerminators(value);
  }
  return out;
}

/** Copy `params` with every user-facing string line-terminator-normalized.
 * Runs before validation so reserved-label and duplicate checks compare the
 * text the human will see. Malformed structure is left for the validator to
 * refuse: a non-array `questions` becomes `[]` so the no_questions check —
 * not a crash — answers it. The input is never mutated. */
export function normalizeQuestionParams(params: unknown): QuestionParams {
  const source = params !== null && typeof params === "object" ? (params as { questions?: unknown }) : {};
  const questions = Array.isArray(source.questions) ? source.questions : [];
  return {
    questions: questions.map((question) => {
      const q = (question !== null && typeof question === "object" ? question : {}) as Record<string, unknown>;
      const options = Array.isArray(q.options) ? q.options : [];
      const normalized = normalizeRecord(q, ["question", "header"]);
      normalized.options = options.map((option) => {
        const o = (option !== null && typeof option === "object" ? option : {}) as Record<string, unknown>;
        return normalizeRecord(o, ["label", "description", "preview"]);
      });
      return normalized as unknown as AskQuestion;
    }),
  };
}

export const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";
export const ERROR_NO_PRESENTER =
  "Error: no OMA question presenter is attached to this host (the TUI boundary is not loaded). The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead, without using this tool.";
export const ERROR_NO_QUESTIONS = "Error: At least one question is required";
export const ERROR_TOO_MANY_QUESTIONS = `Error: At most ${MAX_QUESTIONS} questions are allowed per invocation`;
export const ERROR_MISSING_FIELDS = "Error: Every question requires question, header, and options with label and description";
export const ERROR_TOO_LONG = `Error: Header must be at most ${MAX_HEADER_LENGTH} characters; option label at most ${MAX_LABEL_LENGTH}`;
export const ERROR_DUPLICATE_QUESTION = "Error: Question text must be unique within an invocation";
export const ERROR_TOO_FEW_OPTIONS = `Error: Each question requires at least ${MIN_OPTIONS} options`;
export const ERROR_TOO_MANY_OPTIONS = `Error: Each question allows at most ${MAX_OPTIONS} options`;
export const ERROR_RESERVED_LABEL = `Error: Option label is reserved (${RESERVED_LABELS.join(", ")})`;
export const ERROR_DUPLICATE_OPTION_LABEL = "Error: Option labels must be unique within a question";

export type ValidationResult = { ok: true } | { ok: false; error: QuestionnaireError; message: string };

/** Every guard the schema expresses, re-stated so a caller that bypassed
 * schema validation still gets a structured refusal instead of a rendering
 * bug. Check order is fixed (counts, then required fields, then question
 * identity, then per-option identity); reserved labels are refused before
 * duplicates so a forged sentinel can never hide behind a repeat. */
export function validateQuestionnaire(typed: QuestionParams): ValidationResult {
  if (!Array.isArray(typed.questions) || typed.questions.length === 0) {
    return { ok: false, error: "no_questions", message: ERROR_NO_QUESTIONS };
  }
  if (typed.questions.length > MAX_QUESTIONS) {
    return { ok: false, error: "too_many_questions", message: ERROR_TOO_MANY_QUESTIONS };
  }
  for (const question of typed.questions) {
    const options = question.options;
    if (
      typeof question.question !== "string" || typeof question.header !== "string" ||
      !Array.isArray(options) ||
      (options as readonly AskOption[]).some(
        (option) => typeof option.label !== "string" || typeof option.description !== "string",
      )
    ) {
      return { ok: false, error: "missing_fields", message: ERROR_MISSING_FIELDS };
    }
    if (
      question.header.length > MAX_HEADER_LENGTH ||
      (options as readonly AskOption[]).some((option) => option.label.length > MAX_LABEL_LENGTH)
    ) {
      return { ok: false, error: "too_long", message: ERROR_TOO_LONG };
    }
  }
  const seenQuestions = new Set<string>();
  for (const question of typed.questions) {
    if (seenQuestions.has(question.question)) {
      return { ok: false, error: "duplicate_question", message: ERROR_DUPLICATE_QUESTION };
    }
    seenQuestions.add(question.question);
  }
  for (const question of typed.questions) {
    if (question.options.length < MIN_OPTIONS) {
      return { ok: false, error: "empty_options", message: ERROR_TOO_FEW_OPTIONS };
    }
    if (question.options.length > MAX_OPTIONS) {
      return { ok: false, error: "too_many_options", message: ERROR_TOO_MANY_OPTIONS };
    }
    const seenLabels = new Set<string>();
    for (const option of question.options) {
      if (RESERVED_LABEL_SET.has(option.label)) {
        return { ok: false, error: "reserved_label", message: ERROR_RESERVED_LABEL };
      }
      if (seenLabels.has(option.label)) {
        return { ok: false, error: "duplicate_option_label", message: ERROR_DUPLICATE_OPTION_LABEL };
      }
      seenLabels.add(option.label);
    }
  }
  return { ok: true };
}
