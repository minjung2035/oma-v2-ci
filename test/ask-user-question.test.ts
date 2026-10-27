/** BL2: ask_user_question — schema-compatible validation, the answer
 * envelope, the headless model, the presenter seam, lifecycle boundaries and
 * role gating. The upstream ask-user-question package pins the limits, the
 * reserved labels, the envelope wording and the decline contract; the OMA
 * implementation is exercised end to end on a shared fake bus so the only
 * path an answer can take is the real one: the tool call's result. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  ASK_REQUEST_EVENT,
  ASK_CLAIM_EVENT,
  ASK_RESPONSE_EVENT,
  ASK_CANCEL_EVENT,
} from "@oma/protocol/ask-user-question";
import {
  CUSTOM_OPTION_LABEL,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  NEXT_LABEL,
  RESERVED_LABELS,
  normalizeQuestionParams,
  validateQuestionnaire,
  type AskQuestion,
  type QuestionParams,
  type QuestionnaireResult,
} from "@oma/domain/ask-user-question/questionnaire";
import {
  DECLINE_MESSAGE,
  ENVELOPE_PREFIX,
  ENVELOPE_SUFFIX,
  NO_INPUT_PLACEHOLDER,
  buildAnswerSegment,
  buildQuestionnaireResponse,
  formatAnswerScalar,
} from "@oma/domain/ask-user-question/envelope";
import { QuestionnaireModel } from "@oma/domain/ask-user-question/model";
import askExtension, { registerAskUserQuestion } from "@oma/extension/ask-user-question";
import { registerAskUserQuestionPresenter } from "@oma/tui/ask-user-question/presenter";
import { createAskComponent } from "@oma/tui/ask-user-question/component";
import {
  ASK_USER_QUESTION_TOOL_NAME as SURFACE_NAME,
  planToolSurface,
  principalToolSurfaceConfig,
  residentToolSurfaceConfig,
} from "@oma/domain/tool-surface";

// ---------- fixtures ----------

const option = (label: string, extra: Record<string, unknown> = {}) => ({ label, description: `${label} description`, ...extra });
const question = (overrides: Record<string, unknown> = {}): AskQuestion => ({
  question: "Which library?",
  header: "Library",
  options: [option("date-fns"), option("moment")],
  ...overrides,
}) as AskQuestion;
const params = (questions: readonly unknown[]): QuestionParams => ({ questions: questions as AskQuestion[] });

const THEME = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text, underline: (text: string) => text };

/** A fake ExtensionAPI carrying the two seams the feature actually uses:
 * the named-event hooks and the shared bus. Every emit is recorded, and any
 * prompt-shaped method the tool must never touch throws on contact. */
function fakePi() {
  const tools = new Map<string, { name: string; execute?: (...args: unknown[]) => unknown; parameters?: unknown }>();
  const hooks = new Map<string, ((...args: unknown[]) => unknown)[]>();
  const busHandlers = new Map<string, ((data: unknown) => void)[]>();
  const emitted: { channel: string; data: unknown }[] = [];
  const pi = {
    registerTool(def: { name: string }) { tools.set(def.name, def as never); },
    on(event: string, handler: (...args: unknown[]) => unknown) {
      const list = hooks.get(event) ?? [];
      list.push(handler);
      hooks.set(event, list);
      return () => undefined;
    },
    events: {
      on(channel: string, handler: (data: unknown) => void) {
        const list = busHandlers.get(channel) ?? [];
        list.push(handler);
        busHandlers.set(channel, list);
        return () => undefined;
      },
      emit(channel: string, data: unknown) {
        emitted.push({ channel, data });
        for (const handler of busHandlers.get(channel) ?? []) handler(data);
      },
    },
    // The answer path is a tool result, never a prompt. Anything named like
    // the queue, mail or session-switch machinery fails loudly if touched.
    sendUserMessage() { throw new Error("ask_user_question must not enqueue prompts"); },
    prompt() { throw new Error("ask_user_question must not enqueue prompts"); },
    sendMail() { throw new Error("ask_user_question must not enter mail"); },
    switchSession() { throw new Error("ask_user_question must not switch sessions"); },
    newSession() { throw new Error("ask_user_question must not switch sessions"); },
  };
  return {
    pi: pi as never,
    tools,
    emitted,
    emitBus: pi.events.emit,
    fire(event: string, ...args: unknown[]) {
      for (const handler of hooks.get(event) ?? []) handler(...args);
    },
  };
}

/** A presenter context recording `ctx.ui.custom` calls; the captured factory
 * yields the component a test then drives with raw key bytes. */
function fakeUiContext() {
  const calls: { factory: (...a: unknown[]) => unknown; options: unknown; done: (r: QuestionnaireResult) => void }[] = [];
  const ctx = {
    ui: {
      custom(factory: (...a: unknown[]) => unknown, options?: unknown) {
        return new Promise<QuestionnaireResult>((resolve) => {
          calls.push({ factory, options, done: resolve });
        });
      },
      // Every other UI verb is out of bounds for this tool.
      input() { throw new Error("questionnaire must not use ui.input"); },
      select() { throw new Error("questionnaire must not use ui.select"); },
      notify() { throw new Error("questionnaire must not use ui.notify"); },
    },
  };
  return { ctx, calls };
}

const toolExecute = async (
  host: ReturnType<typeof fakePi>,
  args: unknown,
  ctx: { hasUI: boolean } = { hasUI: true },
  signal?: AbortSignal,
) => {
  const def = host.tools.get(ASK_USER_QUESTION_TOOL_NAME) as {
    execute(id: string, params: unknown, signal: AbortSignal | undefined, update: undefined, ctx: unknown): Promise<{ content: { type: string; text: string }[]; details: QuestionnaireResult }>;
  };
  return def.execute("call-1", args, signal, undefined, ctx);
};

// ---------- contract / validation ----------

test("BL2: the registered name and the surface plan bind the same spelling", () => {
  assert.equal(ASK_USER_QUESTION_TOOL_NAME, "ask_user_question");
  assert.equal(SURFACE_NAME, ASK_USER_QUESTION_TOOL_NAME);
});

test("BL2/upstream: bounds are 1-4 questions of 2-4 options each", () => {
  assert.equal(MAX_QUESTIONS, 4);
  assert.equal(MAX_OPTIONS, 4);
  assert.equal(validateQuestionnaire(params([])).ok, false);
  assert.equal((validateQuestionnaire(params([])) as { error: string }).error, "no_questions");
  const five = Array.from({ length: 5 }, (_, index) => question({ question: `Q${index}?`, header: `H${index}` }));
  assert.equal((validateQuestionnaire(params(five)) as { error: string }).error, "too_many_questions");
  assert.equal((validateQuestionnaire(params([question({ options: [option("only")] })])) as { error: string }).error, "empty_options");
  const fiveOptions = question({ options: Array.from({ length: 5 }, (_, index) => option(`o${index}`)) });
  assert.equal((validateQuestionnaire(params([fiveOptions])) as { error: string }).error, "too_many_options");
});

test("BL2/upstream: missing required fields refuse before identity checks", () => {
  assert.equal((validateQuestionnaire(params([{ header: "H", options: [option("a"), option("b")] }])) as { error: string }).error, "missing_fields");
  assert.equal((validateQuestionnaire(params([question({ options: undefined })])) as { error: string }).error, "missing_fields");
  assert.equal((validateQuestionnaire(params([question({ options: [{ description: "d" }, option("ok")] })])) as { error: string }).error, "missing_fields");
});

test("BL2/upstream: the validator restates the schema's length bounds too", () => {
  // The comment over validateQuestionnaire claims every schema guard is
  // re-stated -- the header/label maxLength guards were missing, so a
  // schema-bypassing caller got a rendering bug instead of a refusal.
  const longHeader = question({ header: "x".repeat(17) });
  assert.equal((validateQuestionnaire(params([longHeader])) as { error: string }).error, "too_long");
  const longLabel = question({ options: [option("y".repeat(61)), option("ok")] });
  assert.equal((validateQuestionnaire(params([longLabel])) as { error: string }).error, "too_long");
  // Exactly at the bound is still admitted -- the guard bounds, it does not shrink.
  assert.equal(validateQuestionnaire(params([question({ header: "x".repeat(16) })])).ok, true);
  assert.equal(validateQuestionnaire(params([question({ options: [option("y".repeat(60)), option("ok")] })])).ok, true);
});

test("BL2/upstream: duplicate questions, duplicate labels and reserved labels refuse", () => {
  assert.equal((validateQuestionnaire(params([question(), question()])) as { error: string }).error, "duplicate_question");
  assert.equal(
    (validateQuestionnaire(params([question({ options: [option("a"), option("a")] })])) as { error: string }).error,
    "duplicate_option_label",
  );
  for (const label of ["Other", CUSTOM_OPTION_LABEL, NEXT_LABEL]) {
    const result = validateQuestionnaire(params([question({ options: [option(label), option("fine")] })]));
    assert.equal((result as { error: string }).error, "reserved_label", `${label} is a presenter row, never an authored option`);
  }
  assert.deepEqual(RESERVED_LABELS, ["Other", "Type something.", "Next"]);
});

test("BL2: valid batches accept multiSelect and previews; CR is normalized before identity checks", () => {
  assert.equal(validateQuestionnaire(params([question({ multiSelect: true })])).ok, true);
  assert.equal(validateQuestionnaire(params([question({ options: [option("a", { preview: "```\ncode\n```" }), option("b")] })])).ok, true);
  const normalized = normalizeQuestionParams({
    questions: [{ question: "Which\r one?", header: "H\r", options: [{ label: "A\r", description: "d\r\ne", preview: "p\r\nq" }, { label: "B", description: "d" }] }],
  });
  assert.equal(normalized.questions[0]!.question, "Which one?");
  assert.equal((normalized.questions[0]!.options[0] as { preview: string }).preview, "p\nq");
  // A lone CR cannot smuggle a reserved label past the check it must fail.
  const smuggled = normalizeQuestionParams({ questions: [{ question: "Q?", header: "H", options: [{ label: "Other\r", description: "d" }, { label: "x", description: "d" }] }] });
  assert.equal((validateQuestionnaire(smuggled) as { error: string }).error, "reserved_label");
});

test("BL2: normalizeQuestionParams degrades malformed input for the validator, never crashes", () => {
  assert.equal((validateQuestionnaire(normalizeQuestionParams(undefined)) as { error: string }).error, "no_questions");
  assert.equal((validateQuestionnaire(normalizeQuestionParams({ questions: "nope" })) as { error: string }).error, "no_questions");
  assert.equal((validateQuestionnaire(normalizeQuestionParams({ questions: [null] })) as { error: string }).error, "missing_fields");
});

// ---------- envelope ----------

test("BL2/upstream: the envelope pins its prefix, suffix and segment shape", () => {
  const result: QuestionnaireResult = {
    cancelled: false,
    answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "date-fns" }],
  };
  const response = buildQuestionnaireResponse(result, 1);
  assert.equal(response.content[0]!.text, `${ENVELOPE_PREFIX} "Which library?"="date-fns". ${ENVELOPE_SUFFIX}`);
  assert.deepEqual(response.details, result);
  assert.equal(buildAnswerSegment({ questionIndex: 0, question: "Q?", kind: "option", answer: "a", preview: "img" }), '"Q?"="a". selected preview: img.');
});

test("BL2/upstream: decline is one canonical message; cancelled carries partial answers and the error code", () => {
  const declined = buildQuestionnaireResponse({ answers: [], cancelled: true }, 1);
  assert.equal(declined.content[0]!.text, DECLINE_MESSAGE);
  assert.deepEqual(declined.details, { answers: [], cancelled: true });
  const lifecycle = buildQuestionnaireResponse({ answers: [{ questionIndex: 0, question: "Q?", kind: "option", answer: "a" }], cancelled: true }, 2);
  assert.equal(lifecycle.content[0]!.text, DECLINE_MESSAGE);
  assert.deepEqual(lifecycle.details.answers.length, 1);
  assert.equal(formatAnswerScalar({ questionIndex: 0, question: "Q", kind: "multi", answer: null, selected: [] }), NO_INPUT_PLACEHOLDER);
  assert.equal(formatAnswerScalar({ questionIndex: 0, question: "Q", kind: "custom", answer: null }), NO_INPUT_PLACEHOLDER);
  // Upstream absorbs a MISSING answer key too (undefined/null/"" all spell
  // the placeholder); a !== null guard throws TypeError on undefined.
  assert.equal(
    formatAnswerScalar({ questionIndex: 0, question: "Q", kind: "custom" } as never),
    NO_INPUT_PLACEHOLDER,
  );
  assert.equal(formatAnswerScalar({ questionIndex: 0, question: "Q", kind: "custom", answer: "" }), NO_INPUT_PLACEHOLDER);
});

// ---------- model (headless) ----------

test("BL2: the model appends the custom row always and Next only for multi-select", () => {
  const single = new QuestionnaireModel([question()]);
  assert.deepEqual(single.rowsOf(0).map(row => row.kind), ["option", "option", "custom"]);
  const multi = new QuestionnaireModel([question({ multiSelect: true })]);
  assert.deepEqual(multi.rowsOf(0).map(row => row.kind), ["option", "option", "custom", "next"]);
  assert.deepEqual(single.rowsOf(single.submitTab).map(row => row.kind), ["submit", "cancel"]);
});

test("BL2: single-select answer advances through the batch and submit returns all answers", () => {
  const model = new QuestionnaireModel([question(), question({ question: "Which DB?", header: "DB" })]);
  let outcome = model.confirm();
  assert.equal(outcome.type, "continue");
  assert.equal(model.tab, 1);
  assert.deepEqual(model.answersSoFar().map(answer => answer.answer), ["date-fns"]);
  model.nextTab(); // -> submit
  outcome = model.confirm();
  assert.equal(outcome.type, "done");
  if (outcome.type === "done") {
    assert.equal(outcome.result.cancelled, false);
    assert.equal(outcome.result.answers.length, 1);
  }
  // Answering the second question then submitting yields the full batch.
  const complete = new QuestionnaireModel([question(), question({ question: "Which DB?", header: "DB" })]);
  complete.confirm();
  complete.confirm();
  assert.equal(complete.tab, complete.submitTab);
  const done = complete.confirm();
  assert.equal(done.type, "done");
  if (done.type === "done") assert.equal(done.result.answers.length, 2);
});

test("BL2: multi-select toggles checkboxes and Next commits the selected labels", () => {
  const model = new QuestionnaireModel([question({ multiSelect: true, options: [option("a"), option("b"), option("c")] })]);
  model.toggle(); // a
  model.moveDown();
  model.toggle(); // b
  model.moveDown();
  model.moveDown();
  assert.equal(model.focusedRow().kind, "custom");
  model.moveDown();
  assert.equal(model.focusedRow().kind, "next");
  model.confirm();
  const answer = model.answersSoFar()[0]!;
  assert.equal(answer.kind, "multi");
  // Upstream details shape: a multi answer carries `answer: null` and the
  // chosen labels in `selected` — never an empty string.
  assert.equal(answer.answer, null);
  assert.deepEqual(answer.selected, ["a", "b"]);
  // Enter on a multi option row toggles rather than commits.
  const typing = new QuestionnaireModel([question({ multiSelect: true })]);
  typing.confirm();
  assert.equal(typing.isChecked(0), true);
});

test("BL2: custom free text commits as a custom answer and Esc still declines", () => {
  const model = new QuestionnaireModel([question()]);
  model.moveDown();
  model.moveDown();
  assert.equal(model.focusedRow().kind, "custom");
  model.confirm();
  assert.equal(model.inputMode, true);
  model.typeText("my own answer");
  model.backspace();
  model.typeText("!");
  model.confirm();
  assert.equal(model.inputMode, false);
  const answer = model.answersSoFar()[0]!;
  assert.equal(answer.kind, "custom");
  assert.equal(answer.answer, "my own answe!");
  // Upstream parity: an empty custom commit is `answer: null`, and a
  // multi-question batch can mix kinds.
  const emptyCustom = new QuestionnaireModel([question()]);
  emptyCustom.moveDown(); emptyCustom.moveDown();
  emptyCustom.confirm();
  emptyCustom.confirm(); // commit with no text
  assert.equal(emptyCustom.answersSoFar()[0]!.answer, null);
  // A pasted chunk is filtered to printable text — control bytes never reach
  // the buffer, the row, or the transcript-quoted result.
  const pasted = new QuestionnaireModel([question()]);
  pasted.moveDown(); pasted.moveDown(); pasted.confirm();
  pasted.typeText("line one\r\nline two\x07");
  pasted.confirm();
  assert.equal(pasted.answersSoFar()[0]!.answer, "line oneline two");
  // Escape from inside typing abandons the whole questionnaire, not just the row.
  const escaping = new QuestionnaireModel([question()]);
  escaping.moveDown();
  escaping.moveDown();
  escaping.confirm();
  escaping.typeText("draft");
  const done = escaping.cancel();
  assert.equal(done.type, "done");
  if (done.type === "done") {
    assert.equal(done.result.cancelled, true);
    assert.equal(done.result.answers.length, 0);
  }
});

test("BL2: cancel rows and Esc produce a cancelled result with partial answers kept", () => {
  const model = new QuestionnaireModel([question(), question({ question: "Second?", header: "S" })]);
  model.confirm(); // answer q1
  model.previousTab();
  model.previousTab(); // wrap back to submit? no: 1 -> 0 -> submit
  assert.equal(model.tab, model.submitTab);
  model.moveDown(); // cancel row
  const done = model.confirm();
  assert.equal(done.type, "done");
  if (done.type === "done") {
    assert.equal(done.result.cancelled, true);
    assert.equal(done.result.answers.length, 1, "a decline still reports what was already answered");
  }
  const esc = new QuestionnaireModel([question()]);
  const declined = esc.cancel();
  assert.equal(declined.type, "done");
});

// ---------- component ----------

test("BL2: the component renders tabs, rows and footer at any width and survives resize", () => {
  const model = new QuestionnaireModel([question({ options: [option("a", { preview: "preview body" }), option("b")] })]);
  const seen: QuestionnaireResult[] = [];
  const component = createAskComponent(model, THEME, value => { seen.push(value); });
  const wide = component.render(120);
  assert.ok(wide.some(line => line.includes("Library")));
  assert.ok(wide.some(line => line.includes("Submit")));
  assert.ok(wide.some(line => line.includes("Which library?")));
  assert.ok(wide.some(line => line.includes("preview body")), "wide layout shows the preview pane");
  const narrow = component.render(40);
  assert.ok(narrow.length > 0, "resize to a narrow terminal re-renders the same state");
  assert.equal(model.tab, 0);
  component.handleInput("\r"); // choose "a"
  assert.equal(model.tab, 1);
  assert.equal(seen.length, 0);
  component.handleInput("\x1b"); // Esc on submit tab
  assert.equal(seen[0]?.cancelled, true);
});

test("BL2: component keys drive the model — checkboxes, tabs, typing and commit", () => {
  const model = new QuestionnaireModel([question({ multiSelect: true })]);
  const component = createAskComponent(model, THEME, () => undefined);
  component.handleInput(" ");
  assert.equal(model.isChecked(0), true);
  component.handleInput("\x1b[C"); // right -> submit tab
  component.handleInput("\x1b[D"); // back
  model.moveDown();
  model.moveDown();
  assert.equal(model.focusedRow().kind, "custom");
  component.handleInput("\r"); // Type something.
  assert.equal(model.inputMode, true);
  component.handleInput("h");
  component.handleInput("i");
  component.handleInput("\x7f"); // backspace
  component.handleInput("\r");
  assert.equal(model.answersSoFar()[0]?.answer, "h");
  // Multi row commits through Next.
  const multi = new QuestionnaireModel([question({ multiSelect: true })]);
  const keys = createAskComponent(multi, THEME, () => undefined);
  keys.handleInput("\x1b[B");
  keys.handleInput(" "); // toggle "moment"
  keys.handleInput("\x1b[B");
  keys.handleInput("\x1b[B");
  assert.equal(multi.focusedRow().kind, "next");
  keys.handleInput("\r"); // Next
  assert.deepEqual(multi.answersSoFar()[0]?.selected, ["moment"]);
});

// ---------- extension ----------

test("BL2: registration is idempotent and the name is the one the surface pins", () => {
  const host = fakePi();
  registerAskUserQuestion(host.pi);
  registerAskUserQuestion(host.pi);
  assert.equal(host.tools.size, 1);
  assert.ok(host.tools.has("ask_user_question"));
});

test("BL2: the packaged entry point registers the same tool for Personal's -e", () => {
  const host = fakePi();
  (askExtension as (pi: unknown) => void)(host.pi);
  assert.ok(host.tools.has(ASK_USER_QUESTION_TOOL_NAME));
});

test("BL2: invalid input returns a structured refusal without ever reaching the bus", async () => {
  const host = fakePi();
  registerAskUserQuestion(host.pi);
  const result = await toolExecute(host, { questions: [] });
  assert.match(result.content[0]!.text, /At least one question is required/);
  assert.equal(result.details.error, "no_questions");
  assert.equal(result.details.cancelled, true);
  assert.equal(host.emitted.length, 0, "a refused call emits nothing");
});

test("BL2: no UI and no presenter are both structured refusals, not hangs", async () => {
  const host = fakePi();
  registerAskUserQuestion(host.pi);
  const noUi = await toolExecute(host, params([question()]), { hasUI: false });
  assert.equal(noUi.details.error, "no_ui");
  assert.match(noUi.content[0]!.text, /UI not available/);
  const noPresenter = await toolExecute(host, params([question()]));
  assert.equal(noPresenter.details.error, "no_presenter");
  assert.match(noPresenter.content[0]!.text, /never saw the questions/);
  // The request was emitted once and went unclaimed — proof the tool can
  // tell "nothing is listening" from "the human is still answering".
  assert.deepEqual(host.emitted.map(entry => entry.channel), [ASK_REQUEST_EVENT]);
});

test("BL2: an answered batch resolves as the tool result — text plus details — and never a prompt", async () => {
  const host = fakePi();
  registerAskUserQuestion(host.pi);
  const ui = fakeUiContext();
  registerAskUserQuestionPresenter(host.pi, { context: () => ui.ctx as never });
  const outcomePromise = toolExecute(host, params([question()]));
  await Promise.resolve();
  // One request, one synchronous claim; the dialog is the only thing shown.
  assert.deepEqual(host.emitted.map(entry => entry.channel), [ASK_REQUEST_EVENT, ASK_CLAIM_EVENT]);
  assert.equal(ui.calls.length, 1);
  const component = ui.calls[0]!.factory(undefined, THEME, undefined, ui.calls[0]!.done) as { handleInput(d: string): void };
  component.handleInput("\r"); // choose the first option
  component.handleInput("\r"); // Submit on the submit tab
  const result = await outcomePromise;
  assert.equal(result.details.cancelled, false);
  assert.equal(result.details.answers[0]!.answer, "date-fns");
  assert.match(result.content[0]!.text, /User has answered your questions:/);
  assert.deepEqual(
    host.emitted.map(entry => entry.channel).filter(channel => channel.startsWith("oma.ask.")),
    [ASK_REQUEST_EVENT, ASK_CLAIM_EVENT, ASK_RESPONSE_EVENT],
    "the whole exchange is request -> claim -> response on the tool seam",
  );
});

test("BL2: Esc returns the canonical decline as a normal structured result", async () => {
  const host = fakePi();
  registerAskUserQuestion(host.pi);
  const ui = fakeUiContext();
  registerAskUserQuestionPresenter(host.pi, { context: () => ui.ctx as never });
  const outcomePromise = toolExecute(host, params([question()]));
  await Promise.resolve();
  const component = ui.calls[0]!.factory(undefined, THEME, undefined, ui.calls[0]!.done) as { handleInput(d: string): void };
  component.handleInput("\x1b");
  const result = await outcomePromise;
  assert.equal(result.content[0]!.text, DECLINE_MESSAGE);
  assert.deepEqual(result.details, { answers: [], cancelled: true });
});

test("BL2: a custom answer typed in the dialog lands in the tool result", async () => {
  const host = fakePi();
  registerAskUserQuestion(host.pi);
  const ui = fakeUiContext();
  registerAskUserQuestionPresenter(host.pi, { context: () => ui.ctx as never });
  const outcomePromise = toolExecute(host, params([question()]));
  await Promise.resolve();
  const component = ui.calls[0]!.factory(undefined, THEME, undefined, ui.calls[0]!.done) as { handleInput(d: string): void };
  component.handleInput("\x1b[B");
  component.handleInput("\x1b[B");
  component.handleInput("\r"); // open "Type something."
  for (const char of "roll my own") component.handleInput(char);
  component.handleInput("\r"); // commit -> lands on the Submit tab
  component.handleInput("\r"); // Submit
  const result = await outcomePromise;
  assert.equal(result.details.answers[0]!.kind, "custom");
  assert.match(result.content[0]!.text, /="roll my own"/);
});

test("BL2: dialog open + every engine boundary resolves the pending call as a structured cancel", async () => {
  // The engine's real vocabulary: /new and /resume pass through
  // session_before_switch, reload and shutdown through session_shutdown, and
  // an aborted turn lifts the tool call's own signal. Whichever fires, an
  // unanswered question settles as the decline result — never a hang, and
  // never an answer fabricated for a session the human no longer sees.
  const boundaries = [
    ["slash-new", "session_before_switch", { reason: "new" }],
    ["slash-resume", "session_before_switch", { reason: "resume" }],
    ["reload", "session_shutdown", { reason: "reload" }],
    ["shutdown", "session_shutdown", { reason: "quit" }],
    ["abort", null, null],
  ] as const;
  for (const [name, event, payload] of boundaries) {
    const host = fakePi();
    registerAskUserQuestion(host.pi);
    const ui = fakeUiContext();
    registerAskUserQuestionPresenter(host.pi, { context: () => ui.ctx as never });
    const controller = new AbortController();
    const outcomePromise = toolExecute(host, params([question()]), { hasUI: true }, controller.signal);
    await Promise.resolve();
    assert.equal(ui.calls.length, 1, `${name}: the dialog is open`);
    if (event === null) controller.abort();
    else host.fire(event, payload);
    const result = await outcomePromise;
    assert.equal(result.content[0]!.text, DECLINE_MESSAGE, `${name} resolves the call`);
    assert.equal(result.details.cancelled, true);
    assert.equal(
      host.emitted.some(entry => entry.channel === ASK_CANCEL_EVENT || entry.channel === ASK_RESPONSE_EVENT),
      true,
      `${name} closes the presenter side too`,
    );
  }
});

test("BL2: a cancel emit that cannot be delivered still settles the pending call", async () => {
  // cancelPending emitted the close signal BEFORE settling — on an
  // already-invalidated event bus emit throws (the real loader's
  // assertActive), which used to leave the tool promise pending forever.
  // The settle is the obligation; the emit is best-effort.
  const host = fakePi();
  registerAskUserQuestion(host.pi);
  const ui = fakeUiContext();
  registerAskUserQuestionPresenter(host.pi, { context: () => ui.ctx as never });
  const outcomePromise = toolExecute(host, params([question()]));
  await Promise.resolve();
  assert.equal(ui.calls.length, 1, "the dialog is open");
  const events = (host.pi as unknown as { events: { emit: (channel: string, data: unknown) => void } }).events;
  const originalEmit = events.emit;
  events.emit = () => { throw new Error("event bus already invalidated"); };
  try {
    host.fire("session_shutdown", { reason: "quit" });
  } finally {
    events.emit = originalEmit;
  }
  const result = await outcomePromise;
  assert.equal(result.details.cancelled, true);
  assert.equal(result.content[0]!.text, DECLINE_MESSAGE);
});

test("BL2: an already-aborted call declines before ever touching the bus", async () => {
  // The signal can arrive aborted — the listener attach would never see it.
  // The decline is returned before a request exists, so no dialog can open
  // for a call nobody is waiting on.
  const host = fakePi();
  registerAskUserQuestion(host.pi);
  const ui = fakeUiContext();
  registerAskUserQuestionPresenter(host.pi, { context: () => ui.ctx as never });
  const controller = new AbortController();
  controller.abort();
  const result = await toolExecute(host, params([question()]), { hasUI: true }, controller.signal);
  assert.equal(result.details.cancelled, true);
  assert.equal(result.content[0]!.text, DECLINE_MESSAGE);
  assert.equal(host.emitted.length, 0, "a dead call emits no request and opens no dialog");
  assert.equal(ui.calls.length, 0);
});

test("BL2: a boundary destroys the dialog itself — the queue drains and no second dialog opens", async () => {
  // A question asked while the switch is already tearing down resolves
  // cancelled by the presenter's own drain, and a queued second request never
  // outlives the boundary either. The tool-side cancel and the presenter-side
  // drain are both idempotent, so firing both kinds is safe.
  const host = fakePi();
  registerAskUserQuestion(host.pi);
  const ui = fakeUiContext();
  registerAskUserQuestionPresenter(host.pi, { context: () => ui.ctx as never });
  const first = toolExecute(host, params([question()]));
  const second = toolExecute(host, params([question({ question: "Second?", header: "S" })]));
  await Promise.resolve();
  assert.equal(ui.calls.length, 1, "the second batch waits while the first is open");
  host.fire("session_before_switch", { reason: "new" });
  host.fire("session_shutdown", { reason: "new" });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.details.cancelled, true);
  assert.equal(b.details.cancelled, true);
  await Promise.resolve();
  assert.equal(ui.calls.length, 1, "no dialog is opened for a dead context's queue");
});

test("BL2: a destroyed context cancels queued questions and ignores malformed requests", async () => {
  const host = fakePi();
  registerAskUserQuestion(host.pi);
  let context = fakeUiContext() as ReturnType<typeof fakeUiContext> | undefined;
  registerAskUserQuestionPresenter(host.pi, { context: () => context?.ctx as never });
  // Malformed payloads never claim — including a well-formed envelope around
  // questions the model could not hold.
  host.emitBus(ASK_REQUEST_EVENT, { nope: true });
  host.emitBus(ASK_REQUEST_EVENT, "junk");
  host.emitBus(ASK_REQUEST_EVENT, { id: "forged", questions: [{ question: 7 }] });
  host.emitBus(ASK_REQUEST_EVENT, { id: "forged2", questions: [{ question: "Q?", header: "H", options: "no" }] });
  assert.equal(host.emitted.filter(entry => entry.channel === ASK_CLAIM_EVENT).length, 0);
  const first = toolExecute(host, params([question()]));
  const second = toolExecute(host, params([question({ question: "Second?", header: "S" })]));
  await Promise.resolve();
  assert.equal(context!.calls.length, 1, "one dialog at a time; the second waits in the queue");
  context = undefined; // the boundary dropped its context
  host.fire("session_shutdown", { reason: "shutdown" });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.details.cancelled, true);
  assert.equal(b.details.cancelled, true, "the queued question resolves too, never hangs");
});

// ---------- presenter ----------

test("BL2: a request with no live context claims then resolves cancelled — never a silent drop", async () => {
  const host = fakePi();
  registerAskUserQuestion(host.pi);
  registerAskUserQuestionPresenter(host.pi, { context: () => undefined });
  const result = await toolExecute(host, params([question()]));
  assert.equal(result.details.cancelled, true);
  assert.equal(host.emitted.some(entry => entry.channel === ASK_CLAIM_EVENT), true, "the claim still answers the tool");
});

test("BL2: presenter registration is idempotent — one claim, one dialog per request", async () => {
  const host = fakePi();
  registerAskUserQuestion(host.pi);
  const ui = fakeUiContext();
  registerAskUserQuestionPresenter(host.pi, { context: () => ui.ctx as never });
  registerAskUserQuestionPresenter(host.pi, { context: () => ui.ctx as never });
  const outcomePromise = toolExecute(host, params([question()]));
  await Promise.resolve();
  assert.equal(host.emitted.filter(entry => entry.channel === ASK_CLAIM_EVENT).length, 1);
  assert.equal(ui.calls.length, 1);
  ui.calls[0]!.done({ answers: [], cancelled: true });
  await outcomePromise;
});

// ---------- role surface ----------

test("BL2: the tool is DIRECT on the Principal surface and absent from the Resident surface", () => {
  assert.ok(principalToolSurfaceConfig().direct.includes(ASK_USER_QUESTION_TOOL_NAME));
  const resident = residentToolSurfaceConfig();
  const residentNames = [
    ...resident.direct,
    ...resident.disabled,
    ...resident.groups.flatMap(spec => spec.members.map(member => ("tool" in member ? member.tool : member.group))),
    ...resident.roots,
  ];
  assert.equal(residentNames.includes(ASK_USER_QUESTION_TOOL_NAME), false);
  const plan = planToolSurface(principalToolSurfaceConfig());
  assert.ok(plan.direct.includes(ASK_USER_QUESTION_TOOL_NAME));
  assert.equal(plan.grouped.includes(ASK_USER_QUESTION_TOOL_NAME), false, "direct exposure, never grouped");
});
