/** BL2: the OpenTUI half of the questionnaire. It renders the model's state
 * into lines for a pi-tui `Component` and maps raw key bytes onto model
 * transitions — nothing else. All behavior that decides *what* an answer is
 * lives in the model; all behavior that decides *how* keys arrive lives in
 * pi-tui's key matcher. Width-driven render means a terminal resize just
 * redraws the same state narrower; there is no resize state to lose. */

import {
  CURSOR_MARKER,
  isKeyRelease,
  isKeyRepeat,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { QuestionnaireModel, rowLabel, type AskOutcome } from "@oma/domain/ask-user-question/model";
import type { QuestionnaireResult } from "@oma/domain/ask-user-question/questionnaire";
import { ASK_QUESTION_BOUNDS, TERMINAL_BOUNDS } from "@oma/domain/surface-bounds";

/** The slice of the engine Theme this component draws with — a structural
 * subset so the presenter can hand in the real Theme without importing it. */
export interface AskThemeLike {
  fg(
    color: "accent" | "borderAccent" | "muted" | "dim" | "success" | "warning" | "error" | "text" | "customMessageLabel",
    text: string,
  ): string;
  bg(color: "selectedBg", text: string): string;
  bold(text: string): string;
  underline(text: string): string;
}

export interface AskComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
}

const PREVIEW_SPLIT_WIDTH = ASK_QUESTION_BOUNDS.previewSplitColumns.value;
const FOCUS = "›";

export function createAskComponent(
  model: QuestionnaireModel,
  theme: AskThemeLike,
  done: (result: QuestionnaireResult) => void,
): AskComponent {
  const finish = (outcome: AskOutcome): void => {
    if (outcome.type === "done") done(outcome.result);
  };

  const keyForList = (data: string): void => {
    if (matchesKey(data, "escape")) return finish(model.cancel());
    if (matchesKey(data, "left")) return model.previousTab();
    if (matchesKey(data, "right") || matchesKey(data, "tab")) return model.nextTab();
    if (matchesKey(data, "shift+tab")) return model.previousTab();
    if (matchesKey(data, "up")) return model.moveUp();
    if (matchesKey(data, "down")) return model.moveDown();
    // Upstream key grammar: Space only ever toggles a multi checkbox (the
    // model no-ops it everywhere else); Enter alone commits a row.
    if (matchesKey(data, "enter")) return finish(model.confirm());
    if (data === " ") return model.toggle();
  };
  const keyForInput = (data: string): void => {
    if (matchesKey(data, "escape")) return finish(model.cancel());
    if (matchesKey(data, "enter")) return finish(model.confirm());
    if (matchesKey(data, "backspace")) return model.backspace();
    // Everything else printable is answer text — control bytes, key-release
    // markers and CSI sequences never reach the buffer.
    if (!data.startsWith("\x1b") && !/^[\x00-\x1f\x7f]/.test(data)) model.typeText(data);
  };

  return {
    render(width: number): string[] {
      const inner = Math.max(TERMINAL_BOUNDS.minColumns.value, width - 2);
      const lines: string[] = [renderTabBar(model, theme, inner), theme.fg("borderAccent", "─".repeat(Math.min(inner, width)))];
      if (model.onSubmitTab) {
        lines.push(...renderReview(model, theme, inner));
      } else {
        lines.push(...renderQuestion(model, theme, inner));
      }
      lines.push(renderFooter(model, theme, inner));
      return lines.map((line) => truncateToWidth(line, width));
    },
    handleInput(data: string): void {
      if (isKeyRelease(data) || isKeyRepeat(data)) return;
      if (model.inputMode) keyForInput(data);
      else keyForList(data);
    },
    invalidate(): void {},
  };
}

function renderTabBar(model: QuestionnaireModel, theme: AskThemeLike, width: number): string {
  const chips = model.questions.map((question, index) => {
    const answered = model.answerFor(index) !== undefined;
    const label = `${answered ? "✓ " : ""}${question.header.length > 0 ? question.header : `Q${index + 1}`}`;
    return index === model.tab ? theme.underline(theme.bold(theme.fg("accent", ` ${label} `))) : theme.fg("muted", ` ${label} `);
  });
  const submit = model.onSubmitTab
    ? theme.underline(theme.bold(theme.fg("accent", " Submit ")))
    : theme.fg("muted", " Submit ");
  const bar = [...chips, submit].join(theme.fg("dim", "│"));
  return ` ${truncateToWidth(bar, width - 1)}`;
}

function renderQuestion(model: QuestionnaireModel, theme: AskThemeLike, width: number): string[] {
  const question = model.questions[model.tab];
  if (question === undefined) return [];
  const lines: string[] = ["", ...wrapTextWithAnsi(theme.bold(question.question), width).map((line) => ` ${line}`), ""];
  const multi = question.multiSelect === true;
  const rows = model.rowsOf(model.tab);
  const focusedOption = model.focusedRow();
  const previewText = focusedOption.kind === "option" ? question.options[focusedOption.index]?.preview : undefined;
  const sideBySide = previewText !== undefined && width >= PREVIEW_SPLIT_WIDTH;
  const listWidth = sideBySide ? Math.floor(width / 2) : width;
  const rowLines: string[] = [];
  rows.forEach((row, index) => {
    const focused = index === model.row && !model.inputMode;
    const prefix = focused ? theme.fg("accent", `${FOCUS} `) : "  ";
    if (row.kind === "option") {
      const option = question.options[row.index];
      if (option === undefined) return;
      const marker = multi ? `${model.isChecked(row.index) ? "[x]" : "[ ]"} ` : "";
      const label = focused ? theme.bold(option.label) : option.label;
      rowLines.push(`${prefix}${marker}${truncateToWidth(label, Math.max(10, listWidth - 10))}`);
      rowLines.push(`      ${theme.fg("dim", truncateToWidth(option.description, Math.max(10, listWidth - 8)))}`);
    } else if (row.kind === "custom") {
      const label = model.inputMode ? theme.bold(rowLabel(row)) : rowLabel(row);
      rowLines.push(`${prefix}${label}`);
    } else {
      rowLines.push(`${prefix}${rowLabel(row)}`);
    }
  });
  if (model.inputMode) {
    rowLines.push(`  ${theme.fg("accent", FOCUS)} ${model.inputText}${CURSOR_MARKER}`);
  }
  if (sideBySide) {
    return [...lines, ...withPreviewPane(rowLines, String(previewText), theme, width, listWidth)];
  }
  if (previewText !== undefined) {
    rowLines.push("", ...String(previewText).split("\n").flatMap((line) => wrapTextWithAnsi(line, width - 8)).map((line) => `      ${theme.fg("dim", line)}`));
  }
  return [...lines, ...rowLines];
}

/** The focused option's preview sits in a pane beside the option list — the
 * upstream side-by-side reading — when the terminal is wide enough;
 * otherwise it flows under the rows. Plain text, not markdown: the human
 * compares shapes, the formatting stays honest. */
function withPreviewPane(rowLines: string[], preview: string, theme: AskThemeLike, width: number, listWidth: number): string[] {
  const previewWidth = width - listWidth - 3;
  const previewLines = preview.split("\n").flatMap((line) => wrapTextWithAnsi(line, Math.max(10, previewWidth)));
  const height = Math.max(rowLines.length, previewLines.length);
  const merged: string[] = [];
  for (let index = 0; index < height; index++) {
    const left = rowLines[index] ?? "";
    const pad = " ".repeat(Math.max(0, listWidth - visibleWidth(left)));
    const right = previewLines[index] ?? "";
    merged.push(`${left}${pad}${theme.fg("borderAccent", "│")} ${theme.fg("dim", right)}`);
  }
  return merged;
}

function renderReview(model: QuestionnaireModel, theme: AskThemeLike, width: number): string[] {
  const lines: string[] = ["", ` ${theme.bold("Review answers")}`, ""];
  model.questions.forEach((question, index) => {
    const answer = model.answerFor(index);
    const shown = answer === undefined
      ? theme.fg("warning", "(unanswered)")
      : theme.fg("success", answer.kind === "multi" ? (answer.selected ?? []).join(", ") || "(no input)" : answer.answer || "(no input)");
    for (const line of wrapTextWithAnsi(`${question.header}: ${shown}`, width - 4)) {
      lines.push(`  ${line}`);
    }
  });
  lines.push("");
  const rows = model.rowsOf(model.tab);
  rows.forEach((row, index) => {
    const focused = index === model.row;
    const prefix = focused ? theme.fg("accent", `${FOCUS} `) : "  ";
    const label = rowLabel(row);
    lines.push(`${prefix}${row.kind === "submit" ? theme.bold(label) : label}`);
  });
  return lines;
}

function renderFooter(model: QuestionnaireModel, theme: AskThemeLike, width: number): string {
  const hint = model.inputMode
    ? "Enter commit · Esc abandon"
    : model.onSubmitTab
      ? "←/→ back · ↑/↓ select · Enter choose"
      : "←/→ tabs · ↑/↓ select · Enter choose · Esc abandon";
  return theme.fg("dim", ` ${truncateToWidth(hint, width - 1)}`);
}
