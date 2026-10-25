/** BL2: the questionnaire's renderer-agnostic state machine. It knows what a
 * question batch is, which tab and row are focused, what is checked, and
 * what the in-progress free text says; it knows nothing about terminals,
 * themes, or overlays. Every transition is a method whose outcome is a
 * value, so the whole interaction — single select, multi select, custom
 * text, review, submit, cancel — is exercised in a headless test without
 * touching a TTY. Pure module: no engine import. */

import {
  CUSTOM_OPTION_LABEL,
  type AskQuestion,
  type QuestionAnswer,
  type QuestionnaireResult,
} from "./questionnaire.js";

/** A focusable row. Question tabs list authored options then the appended
 * sentinels; the trailing Submit tab holds the review actions. */
export type AskRow =
  | { readonly kind: "option"; readonly index: number }
  | { readonly kind: "custom" }
  | { readonly kind: "next" }
  | { readonly kind: "submit" }
  | { readonly kind: "cancel" };

export type AskOutcome = { readonly type: "continue" } | { readonly type: "done"; readonly result: QuestionnaireResult };

const CONTINUE: AskOutcome = { type: "continue" };
const grapheme = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export class QuestionnaireModel {
  /** `tab` in 0..questions.length; questions.length is the Submit tab. */
  tab = 0;
  /** Focused row inside the current tab. */
  row = 0;
  /** Free-text mode on the current question's "Type something." row. */
  inputMode = false;
  inputText = "";
  private readonly checked: boolean[][];
  private readonly answered = new Map<number, QuestionAnswer>();
  constructor(readonly questions: readonly AskQuestion[]) {
    this.checked = questions.map((question) => question.options.map(() => false));
  }

  get submitTab(): number {
    return this.questions.length;
  }
  get onSubmitTab(): boolean {
    return this.tab === this.submitTab;
  }
  /** The rows a tab shows, in order. */
  rowsOf(tab: number = this.tab): readonly AskRow[] {
    if (tab === this.submitTab) return [{ kind: "submit" }, { kind: "cancel" }];
    const question = this.questions[tab];
    if (question === undefined) return [{ kind: "cancel" }];
    const rows: AskRow[] = question.options.map((_option, index) => ({ kind: "option", index }));
    rows.push({ kind: "custom" });
    if (question.multiSelect === true) rows.push({ kind: "next" });
    return rows;
  }
  focusedRow(): AskRow {
    return this.rowsOf(this.tab)[this.row] ?? { kind: "submit" };
  }
  /** Answers committed so far, in question order — including the partial set
   * a cancelled result still carries. */
  answersSoFar(): QuestionAnswer[] {
    return [...this.answered.values()].sort((a, b) => a.questionIndex - b.questionIndex);
  }
  isChecked(optionIndex: number): boolean {
    return this.checked[this.tab]?.[optionIndex] === true;
  }
  answerFor(questionIndex: number): QuestionAnswer | undefined {
    return this.answered.get(questionIndex);
  }

  moveDown(): void {
    const rows = this.rowsOf(this.tab);
    this.row = (this.row + 1) % rows.length;
  }
  moveUp(): void {
    const rows = this.rowsOf(this.tab);
    this.row = (this.row - 1 + rows.length) % rows.length;
  }
  nextTab(): void {
    this.leaveInput();
    this.tab = (this.tab + 1) % (this.submitTab + 1);
    this.clampRow();
  }
  previousTab(): void {
    this.leaveInput();
    this.tab = (this.tab - 1 + this.submitTab + 1) % (this.submitTab + 1);
    this.clampRow();
  }
  private clampRow(): void {
    this.row = Math.min(this.row, this.rowsOf(this.tab).length - 1);
  }
  private leaveInput(): void {
    this.inputMode = false;
    this.inputText = "";
  }
  /** Advance after an answer commits: forward through the batch, ending on
   * the Submit tab once the last question is behind the human. The new tab's
   * focus starts on its first row — clamping the old position could land on
   * "cancel" and make the next Enter read as a decline. */
  private advance(): void {
    if (this.tab < this.submitTab) this.tab += 1;
    this.row = 0;
  }

  toggle(): void {
    if (this.inputMode) return;
    const focused = this.focusedRow();
    const question = this.questions[this.tab];
    const checks = this.checked[this.tab];
    if (focused.kind !== "option" || question?.multiSelect !== true || checks === undefined) return;
    checks[focused.index] = checks[focused.index] !== true;
  }

  /** Enter on the focused row. The outcome is a value — the caller decides
   * when a `done` becomes a dismissed dialog. */
  confirm(): AskOutcome {
    if (this.inputMode) {
      this.commitCustom();
      return CONTINUE;
    }
    const focused = this.focusedRow();
    if (focused.kind === "submit") return { type: "done", result: this.result(false) };
    if (focused.kind === "cancel") return { type: "done", result: this.result(true) };
    const question = this.questions[this.tab];
    if (question === undefined) return CONTINUE;
    switch (focused.kind) {
      case "option": {
        if (question.multiSelect === true) {
          this.toggle();
          return CONTINUE;
        }
        const option = question.options[focused.index];
        if (option === undefined) return CONTINUE;
        this.answered.set(this.tab, {
          questionIndex: this.tab,
          question: question.question,
          kind: "option",
          answer: option.label,
          ...(option.preview !== undefined ? { preview: option.preview } : {}),
        });
        this.advance();
        return CONTINUE;
      }
      case "custom":
        this.inputMode = true;
        this.inputText = "";
        return CONTINUE;
      case "next": {
        const checks = this.checked[this.tab] ?? [];
        const selected = question.options
          .filter((_option, index) => checks[index] === true)
          .map((option) => option.label);
        this.answered.set(this.tab, {
          questionIndex: this.tab,
          question: question.question,
          kind: "multi",
          answer: null,
          selected,
        });
        this.advance();
        return CONTINUE;
      }
    }
  }

  /** The committed free text is a `custom` answer on the current question —
   * on a multi tab it stands in for the checked set, mirroring the upstream
   * rule that one row holds one question's answer. A typed answer replaces
   * the checks, so the boxes clear instead of claiming a multi commit that
   * never ran. */
  private commitCustom(): void {
    const question = this.questions[this.tab];
    if (question === undefined) return;
    if (question.multiSelect === true) this.checked[this.tab]?.fill(false);
    this.answered.set(this.tab, {
      questionIndex: this.tab,
      question: question.question,
      kind: "custom",
      // Upstream spells an empty commit as null, not "" — details parity.
      answer: this.inputText.length > 0 ? this.inputText : null,
    });
    this.inputMode = false;
    this.inputText = "";
    this.advance();
  }

  /** A typed/pasted chunk becomes answer text. The row is single-line and the
   * result is quoted into the transcript, so control bytes — the same class
   * the params normalizer strips — can never enter the buffer. A multi-line
   * paste lands as its printable characters on one line. */
  typeText(text: string): void {
    if (this.inputMode) this.inputText += text.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
  }
  backspace(): void {
    if (!this.inputMode) return;
    const parts = [...grapheme.segment(this.inputText)].map((part) => part.segment);
    this.inputText = parts.slice(0, -1).join("");
  }
  /** Escape is a decline everywhere — including mid-way through typing a
   * custom answer — matching the "Esc abandons the questionnaire" contract. */
  cancel(): AskOutcome {
    this.inputMode = false;
    return { type: "done", result: this.result(true) };
  }

  result(cancelled: boolean): QuestionnaireResult {
    return { answers: this.answersSoFar(), cancelled };
  }
}

/** The display label of a row the presenter synthesized (not an authored
 * option) — single spelling shared by the component and tests. */
export function rowLabel(row: AskRow): string {
  switch (row.kind) {
    case "custom":
      return CUSTOM_OPTION_LABEL;
    case "next":
      return "Next";
    case "submit":
      return "Submit";
    case "cancel":
      return "Cancel";
    case "option":
      return "";
  }
}
