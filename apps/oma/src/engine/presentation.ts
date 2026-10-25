/** Actual TUI providers, composed here without an Engine -> TUI dependency. */
import type { EnginePresentation } from "@oma/engine/presentation";
import { stylePanel } from "@oma/tui/panel-style";
import { registerAskUserQuestionPresenter } from "@oma/tui/ask-user-question/presenter";
import { createCompactToolRuntime } from "@oma/tui/compact-tools";
export const enginePresentation: EnginePresentation = {
  stylePanel, createCompactTools: createCompactToolRuntime,
  registerQuestions: (pi, deps) => { registerAskUserQuestionPresenter(pi, deps); },
};
