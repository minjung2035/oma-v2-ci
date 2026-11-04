import { publishedUnconfirmed, exceptionText, StoreError } from "@oma/domain/errors";
/** TUI-001/007: product surface orchestration.
 *
 * The app owns no policy of its own. It routes decoded keys through the pure
 * state machine, performs the effects that machine asks for through injected
 * ports, and redraws. Ports keep the file, socket and process owners out of
 * this module so the whole flow is testable without a terminal.
 */
import { KeyDecoder, type Key } from "./keys.js";
import { assertNever } from "@oma/domain/exhaustive";
import {
  INITIAL, categoryOf, cursorOf, step,
  mailIdentity, type DashboardData, type Effect, type ExtensionRow, type MailBody, type MailboxRead, type MailRow, type Notice, type PanelData, type State,
} from "./model.js";
import { mailScrollLimit, render, type ViewInput } from "./view/index.js";
import type { ConfigField, EngineCommand } from "./model.js";
import { Transcript } from "./transcript.js";
import { returnedPrompt, type PromptOutcome } from "./prompt.js";
import type { Terminal } from "./screen.js";

export interface AppPorts {
  readonly configFields: () => readonly ConfigField[];
  readonly dashboard: () => DashboardData;
  readonly mail: () => MailboxRead;
  readonly extensions: () => readonly ExtensionRow[];
  readonly body: (path: string) => MailBody | null;
  /** WP15.03: what a confirmed value did -- saved, already the value, or
   * saved while the configuration could not be read back. */
  readonly setField: (field: string, value: string | number) => SetFieldOutcome;
  readonly setExtension: (id: string, role: "principal" | "workers", enabled: boolean) => void;
  /** Answers, in this call, whether the session took the prompt. A port that
   * reported acceptance later could only report it into a transcript that had
   * already shown the prompt as sent. */
  readonly submitPrompt: (text: string) => PromptOutcome;
  /** Separate host-console input; never falls back to submitPrompt or an engine. */
  readonly submitControl?: (text: string) => Exclude<PromptOutcome, { kind: "accepted" }>;
  readonly controlAvailable?: () => boolean;
  /** Local editor navigation, including a delayed standalone Escape. No engine
   * input or control command is forwarded through this notification. */
  readonly controlEditorClosed?: () => void;
  /** Opens one of the engine's own selectors on its screen. */
  readonly engineCommand?: (command: EngineCommand) => void;
  readonly quit: () => void;
}

export type SetFieldOutcome =
  | { readonly kind: "saved" } | { readonly kind: "unchanged" }
  | { readonly kind: "saved-unread"; readonly reason: string };

const EMPTY: PanelData = Object.freeze({
  dashboard: Object.freeze({
    status: Object.freeze({ kind: "unknown" as const, observedAtMs: 0, reason: "Not yet observed" }),
    configuredWorkers: 0, unread: null, principalModel: Object.freeze({ configured: "unknown", session: null })
}),
  config: Object.freeze([]), extensions: Object.freeze([]), mail: Object.freeze([]), mailUnreadable: null, mailOmitted: 0,
});


export class TuiApp {
  private state: State = INITIAL;
  private data: PanelData = EMPTY;
  private readonly transcript = new Transcript();
  /** Private, bounded console presentation; never part of a relayed panel or prompt. */
  private readonly controlTranscript = new Transcript();
  private controlNotice: Notice | null = null;
  private notice: Notice | null = null;
  private busy = false;
  private readonly keys = new KeyDecoder();
  private inputOrigin: "terminal" | "engine" | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** The open message's body, read once per path rather than once per draw:
   * a Maildir path names immutable content, and a different path is a
   * different message -- so the path itself is the invalidation (NB-04). */
  private mailBody: { readonly path: string; readonly body: MailBody | null } | null = null;
  /** NB-15: set when the terminal's stream refused a write. A synchronous
   * throw from `output.write` would escape through the input `data` listener
   * as an uncaughtException; a stream that cannot take a frame is dead to
   * draws, so they are skipped rather than thrown again. */
  private outputDead = false;

  constructor(private readonly ports: AppPorts, private readonly terminal: Terminal, private readonly frameBytes: number) {}

  private controlsAvailable(): boolean {
    return !this.closed && !this.outputDead && this.ports.submitControl !== undefined && this.ports.controlAvailable?.() === true;
  }

  /** Navigation is not authority: no command/draft can arrive from an engine. */
  openControlEditor(): boolean {
    if (!this.controlsAvailable()) return false;
    if (this.state.open && this.state.detail.kind === "control") return true;
    this.resetInput();
    this.state = { ...this.state, open: true, edit: { kind: "none" }, detail: { kind: "control", draft: returnedPrompt("") } };
    this.draw();
    return !this.outputDead;
  }

  /** Re-reads every source. Called at start, after an effect and on demand;
   * the UI never keeps a value that a port no longer reports.
   */
  refresh(): void {
    if (this.closed) return;
    const mailbox = this.ports.mail();
    this.data = Object.freeze({
      dashboard: this.ports.dashboard(),
      config: this.ports.configFields(),
      extensions: this.ports.extensions(),
      mail: mailbox.rows,
      mailUnreadable: mailbox.unreadable,
      mailOmitted: mailbox.omitted,
      ...(this.controlsAvailable() ? { humanControls: true } : {}),
    });
  }

  get snapshot(): State { return this.state; }
  get panel(): PanelData { return this.data; }
  /** What the conversation currently holds, so the declared bounds can be
   * checked as facts rather than inferred from a rendered frame. */
  get lines(): readonly string[] { return this.transcript.lines; }
  get heldBytes(): number { return this.transcript.heldBytes; }

  line(text: string): void {
    this.append(text);
    this.draw();
  }

  controlLine(text: string): void {
    if (this.closed) return;
    this.controlTranscript.append(text);
    this.draw();
  }

  /** Input fragments cannot survive a terminal-ownership handoff. */
  resetInput(): void {
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.keys.finish();
    this.inputOrigin = null;
  }

  private inputFrom(origin: "terminal" | "engine"): void {
    if (this.inputOrigin === origin) return;
    this.resetInput();
    this.inputOrigin = origin;
  }

  /** The one way anything enters the transcript. Every producer goes through
   * it, and the transcript -- not this file -- owns what one produced line
   * costs: a reply is one call here and any number of displayed lines. */
  private append(text: string): void {
    this.transcript.append(text);
  }

  setBusy(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    this.draw();
  }

  note(text: string | null): void { this.notice = text === null ? null : { kind: "text", text }; this.draw(); }

  /** A prompt the session took but could not deliver, named and given back.
   *
   * A prompt that waited for a running turn was echoed as sent when it was
   * taken, so a later failure has to say which one it was: `⚠ Could not send`
   * under three echoed prompts names none of them. The text is
   * written into the conversation as not sent -- the transcript owns its own
   * bounds, and a long prompt is stored as several lines rather than cut -- and
   * is put back into the draft when the draft is empty, so the usual case
   * needs no retyping at all. A draft with something in it is the Human's and
   * is not overwritten; the conversation still holds the text to copy from.
   */
  returnPrompt(text: string, reason: string): void {
    this.append(`✗ Unsent input: ${text.replace(/\n/g, "\n  ")}`);
    const draft = this.state.prompt;
    const empty = draft.text.length === 0 && draft.overflow === null;
    if (empty) this.state = { ...this.state, prompt: returnedPrompt(text) };
    this.notice = { kind: "send-failed", message: reason, kept: empty ? "draft" : "conversation" };
    this.draw();
  }

  /** P0-4: the decoder and its timer end with this app, before terminal return. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.keys.finish();
  }

  feed(chunk: Uint8Array, origin: "terminal" | "engine" = "terminal"): void {
    if (this.closed) return;
    // Never complete a terminal token using bytes relayed by another owner.
    this.inputFrom(origin);
    // One decoder lives as long as the app: terminal reads are neither UTF-8,
    // escape-sequence nor paste boundaries. Whatever the decoder has started
    // and not finished gets exactly one deadline -- the decoder says how long,
    // because it is the one that knows what it is waiting for -- after which
    // it gives up rather than reading the Human's next key as the missing end
    // of a terminal's unfinished report.
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    for (const key of this.keys.push(chunk)) this.apply(key, origin);
    if (this.closed) return;
    const delay = this.keys.pendingDelayMs;
    if (delay !== null) {
      const timer = setTimeout(() => {
        if (this.closed || this.pendingTimer !== timer) return;
        this.pendingTimer = null;
        for (const key of this.keys.flushPending()) this.apply(key, origin);
        this.draw();
      }, delay);
      this.pendingTimer = timer;
      timer.unref();
    }
    this.draw();
  }

  key(key: Key, origin: "terminal" | "engine" = "terminal"): void {
    this.inputFrom(origin);
    this.apply(key, origin);
    this.draw();
  }

  private apply(key: Key, origin: "terminal" | "engine"): void {
    if (this.closed) return;
    if (origin === "engine" && this.state.detail.kind === "control") return;
    // Ctrl-L, the terminal convention: the whole screen again, nothing else.
    if (key.kind === "redraw") {
      try { this.terminal.repaint(); } catch { this.outputDead = true; }
      return;
    }
    const wasControl = this.state.detail.kind === "control";
    const data = origin === "engine" && this.data.humanControls === true ? { ...this.data, humanControls: false } : this.data;
    const result = step(this.state, key, data, this.frameBytes);
    this.state = result.state;
    for (const effect of result.effects) this.run(effect, origin);
    if (origin === "terminal" && wasControl && this.state.detail.kind !== "control") this.ports.controlEditorClosed?.();
  }

  private run(effect: Effect, origin: "terminal" | "engine"): void {
    try {
      switch (effect.kind) {
        case "set-choice": {
          const outcome = this.ports.setField(effect.field, effect.value);
          this.refresh();
          this.notice = this.saved(effect.field, effect.value, outcome);
          return;
        }
        case "set-number": {
          const outcome = this.ports.setField(effect.field, effect.value);
          this.refresh();
          this.notice = this.saved(effect.field, String(effect.value), outcome);
          return;
        }
        case "engine-command":
          this.ports.engineCommand?.(effect.command);
          return;
        case "set-extension":
          this.ports.setExtension(effect.id, effect.role, effect.enabled);
          this.refresh();
          const source = this.ports.extensions().find(row => row.id === effect.id)?.source;
          this.notice = { kind: "extension", id: effect.id, role: effect.role, enabled: effect.enabled,
            apply: effect.role === "principal" ? "next-session" : "next-activation", ...(source === undefined ? {} : { source }) };
          return;
        case "submit-control": {
          if (this.state.detail.kind !== "control") throw new StoreError("INTERNAL_ERROR", "Human control input lost its separate editor");
          // The engine UI relay is useful for navigation, not Human authority.
          // Preserve this separate draft even when admission or presentation throws.
          this.state = { ...this.state, detail: { kind: "control", draft: returnedPrompt(effect.text) } };
          const outcome = origin === "terminal" && this.controlsAvailable() && this.ports.submitControl !== undefined
            ? this.ports.submitControl(effect.text)
            : { kind: "refused" as const, reason: "Human controls require the supervising host's local console; engine-relayed input cannot submit them." };
          if (outcome.kind === "refused") this.controlNotice = { kind: "text", text: `${outcome.reason} The original command remains in the Human control draft; it was not sent as a Principal prompt.` };
          else { this.state = { ...this.state, detail: { kind: "control", draft: returnedPrompt("") } }; this.controlNotice = null; }
          return;
        }
        case "submit-prompt": {
          // Taking the prompt and showing it are one step. The session answers
          // here whether it took it, so the transcript holds what was sent and
          // nothing else; a refusal gives the text back to the draft, where
          // the Human can fix or resend it rather than retype it from a line
          // that reads as though the Principal already has it.
          // Locally mistyped control text becomes a private draft, never a
          // generic prompt or relayed panel field. It still needs a separate
          // Human submission there; an engine-origin input cannot take this path.
          if (origin === "terminal" && this.controlsAvailable() && /^\/control\s+\S/u.test(effect.text.trim())) {
            this.openControlEditor();
            this.state = { ...this.state, prompt: returnedPrompt(""), detail: { kind: "control", draft: returnedPrompt(effect.text) } };
            this.controlNotice = { kind: "text", text: "Nothing was submitted. The original command is retained only in this private Human control draft. Inspect it before pressing Enter to request the control." };
            return;
          }
          const outcome = this.ports.submitPrompt(effect.text);
          if (outcome.kind === "refused") {
            this.state = { ...this.state, prompt: returnedPrompt(effect.text) };
            this.notice = { kind: "send-failed", message: outcome.reason, kept: "draft" };
            return;
          }
          if (outcome.kind === "handled") { this.notice = null; return; }
          this.notice = null;
          // A pasted prompt is several lines; the continuation is indented so
          // the echo reads as the one thing that was sent.
          this.append(`> ${effect.text.replace(/\n/g, "\n  ")}`);
          return;
        }
        case "prompt-limit":
          if (this.state.detail.kind === "control") {
            if (effect.active) this.controlNotice = { kind: "prompt-limit", cause: effect.cause };
            else if (this.controlNotice?.kind === "prompt-limit") this.controlNotice = null;
          } else if (effect.active) this.notice = { kind: "prompt-limit", cause: effect.cause };
          else if (this.notice?.kind === "prompt-limit") this.notice = null;
          return;
        case "quit":
          this.close();
          this.ports.quit();
          return;
        default:
          // Closed effect union: a new variant must be handled, not ignored.
          return assertNever(effect);
      }
    } catch (error) {
      if (effect.kind === "submit-control") {
        this.controlNotice = { kind: "text", text: `The Human control outcome was not observed: ${exceptionText(error)}. Preserve the original command/key in the separate control draft; do not invent a replacement.` };
        return;
      }
      // A rejected write must state that nothing was saved rather than leaving
      // the previous value looking like it changed -- and a committed one whose
      // flush failed must not say that (P0-5): it was saved.
      this.notice = publishedUnconfirmed(error)
        ? { kind: "saved-unconfirmed", message: exceptionText(error) }
        : { kind: "save-failed", message: exceptionText(error) };
      this.refresh();
    }
  }

  /** Arch §23.6: a confirmed value is a saved value, and the message states
   * when it actually takes effect.
   */
  private saved(field: string, value: string, outcome: SetFieldOutcome): Notice {
    const declared = this.data.config.find(entry => entry.id === field);
    const label = declared?.label ?? field;
    if (outcome.kind === "unchanged") return { kind: "unchanged", label, value };
    if (outcome.kind === "saved-unread") return { kind: "saved-unread", label, value, reason: outcome.reason };
    return {
      kind: "saved", label, value,
      apply: declared && declared.kind !== "link" ? declared.apply : null,
    };
  }

  draw(): void {
    if (this.closed || this.outputDead) return;
    const humanControls = this.controlsAvailable();
    if ((this.data.humanControls === true) !== humanControls) this.data = Object.freeze({ ...this.data, humanControls });
    const detail = this.state.detail;
    // P0V-41: the message open is the one the Human opened, found by identity
    // in this refresh's list, not whatever now sits at its old position.
    const open = detail.kind === "mail" ? this.data.mail.find(row => mailIdentity(row) === detail.id) : undefined;
    let body: MailBody | null = null;
    if (open === undefined) this.mailBody = null;
    else {
      if (this.mailBody?.path !== open.path) this.mailBody = { path: open.path, body: this.ports.body(open.path) };
      body = this.mailBody.body;
    }
    const privateControl = this.state.open && detail.kind === "control" && humanControls;
    const input: ViewInput = {
      state: this.state, data: this.data, transcript: privateControl ? this.controlTranscript.lines : this.transcript.lines,
      body, notice: privateControl ? this.controlNotice : this.notice, busy: this.busy,
      columns: this.terminal.columns, rows: this.terminal.rows,
    };
    // The scroll stays within the body this screen can show (P0V-40).
    if (detail.kind === "mail" && detail.scroll > mailScrollLimit(input)) {
      this.state = { ...this.state, detail: { ...detail, scroll: mailScrollLimit(input) } };
    }
    try {
      this.terminal.draw(render({ ...input, state: this.state }));
    } catch { this.outputDead = true; }
  }

  /** Exposed for tests and for the mail detail screen's current selection. */
  selectedMail(): MailRow | undefined {
    if (categoryOf(this.state) !== "mail") return undefined;
    return this.data.mail[cursorOf(this.state, this.data, "mail")];
  }
}
