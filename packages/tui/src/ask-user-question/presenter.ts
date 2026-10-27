/** BL2: the presenter — the OMA-owned public hook that turns a validated
 * ask_user_question request into a `ctx.ui.custom` overlay and returns the
 * outcome on the event bus. It is registered by the host's UI boundary, so
 * the context it renders into is exactly the context the boundary last
 * handed the session: when the boundary tears that context down (reload,
 * session switch, shutdown) the presenter resolves every pending question
 * as a structured cancel. A destroyed UI context never leaves the tool's
 * promise hanging, never crashes, and the answer stays inside the tool
 * call's result — it is never a queued prompt or a mail item. */

import { createAskComponent, type AskComponent, type AskThemeLike } from "./component.js";
import { QuestionnaireModel } from "@oma/domain/ask-user-question/model";
import {
  ASK_CANCEL_EVENT,
  ASK_CLAIM_EVENT,
  ASK_REQUEST_EVENT,
  ASK_RESPONSE_EVENT,
  isAskCancel,
  isAskRequest,
} from "@oma/protocol/ask-user-question";
import type { AskQuestion, QuestionnaireResult } from "@oma/domain/ask-user-question/questionnaire";

/** The slice of ExtensionContext the presenter needs: one `ctx.ui.custom`.
 * Declared structurally so the boundary can hand in its live context without
 * this module importing engine types — the same seam `registerToolRenderer`
 * proved for compact-tools. */
export interface AskUiContext {
  ui: {
    custom(
      factory: (tui: unknown, theme: AskThemeLike, keybindings: unknown, done: (result: QuestionnaireResult) => void) => AskComponent,
      options?: unknown,
    ): Promise<QuestionnaireResult>;
  };
}

/** The extension API surface a host boundary hands over: session events for
 * lifecycle, the bus for the request seam. */
export interface AskPresenterPi {
  on(event: string, handler: (...args: unknown[]) => unknown): unknown;
  events: {
    on(channel: string, handler: (data: unknown) => void): unknown;
    emit(channel: string, data: unknown): void;
  };
}

export interface AskPresenterDeps {
  /** The boundary's live extension context, or undefined while the engine is
   * between sessions. Called at request time, never cached — a captured
   * context is exactly the stale-context bug this seam exists to prevent. */
  context(): AskUiContext | undefined;
}

const CANCELLED: QuestionnaireResult = { answers: [], cancelled: true };

const OVERLAY_OPTIONS = {
  overlay: true,
  overlayOptions: {
    anchor: "bottom-center",
    width: "100%",
    maxHeight: "100%",
    margin: { left: 0, right: 0, bottom: 0 },
  },
} as const;

const registered = new WeakSet<AskPresenterPi>();

/** One presenter per engine load. A second call on the same `pi` is a no-op
 * so a reload or a double composition can never double-claim a request and
 * stack two dialogs on one question. */
export function registerAskUserQuestionPresenter(pi: AskPresenterPi, deps: AskPresenterDeps): void {
  if (registered.has(pi)) return;
  registered.add(pi);
  // Requests wait their turn: parallel tool calls still see one dialog at a
  // time, in claim order, rather than stacking overlays.
  const queue: { id: string; questions: readonly AskQuestion[] }[] = [];
  const open = new Map<string, () => void>();
  let active = 0;

  const respond = (id: string, result: QuestionnaireResult): void => {
    pi.events.emit(ASK_RESPONSE_EVENT, { id, result });
  };

  const next = (): void => {
    while (active === 0 && queue.length > 0) {
      const request = queue.shift();
      if (request === undefined) return;
      const ctx = deps.context();
      if (ctx === undefined) {
        // The boundary already let this context go — a structured cancel is
        // the honest answer, not a silent drop.
        respond(request.id, CANCELLED);
        continue;
      }
      active += 1;
      let cancelDialog: (() => void) | undefined;
      const close = (result: QuestionnaireResult): void => {
        open.delete(request.id);
        active -= 1;
        respond(request.id, result ?? CANCELLED);
        next();
      };
      try {
        void Promise.resolve(
          ctx.ui.custom(
            (_tui, theme, _keybindings, done) => {
              cancelDialog = () => done(CANCELLED);
              return createAskComponent(new QuestionnaireModel(request.questions), theme, done);
            },
            OVERLAY_OPTIONS,
          ),
        ).then((result) => close(result), () => close(CANCELLED));
      } catch {
        close(CANCELLED);
        continue;
      }
      open.set(request.id, () => cancelDialog?.());
    }
  };

  const cancelAll = (): void => {
    for (const request of queue.splice(0)) respond(request.id, CANCELLED);
    for (const dismiss of open.values()) dismiss();
  };

  pi.events.on(ASK_REQUEST_EVENT, (data) => {
    if (!isAskRequest(data)) return;
    // The claim is synchronous: the tool emits the request and reads the
    // claim before yielding, so "no presenter" is decided deterministically.
    pi.events.emit(ASK_CLAIM_EVENT, { id: data.id });
    queue.push({ id: data.id, questions: data.questions });
    next();
  });
  pi.events.on(ASK_CANCEL_EVENT, (data) => {
    if (!isAskCancel(data)) return;
    const index = queue.findIndex((request) => request.id === data.id);
    if (index >= 0) {
      const [request] = queue.splice(index, 1);
      if (request !== undefined) respond(request.id, CANCELLED);
      return;
    }
    open.get(data.id)?.();
  });
  // Session boundaries are the destroyed-UI-context contract: the dialog
  // resolves as a cancel before the switch, never a hang carried into the
  // next session.
  pi.on("session_shutdown", cancelAll);
  pi.on("session_before_switch", cancelAll);
}
