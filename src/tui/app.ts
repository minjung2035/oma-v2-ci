/** TUI-001/007: product surface orchestration.
 *
 * The app owns no policy of its own. It routes decoded keys through the pure
 * state machine, performs the effects that machine asks for through injected
 * ports, and redraws. Ports keep the file, socket and process owners out of
 * this module so the whole flow is testable without a terminal.
 */
import { KeyDecoder, type Key } from "./keys.js";
import { assertNever } from "../domain/exhaustive.js";
import {
  INITIAL, categoryOf, cursorOf, step,
  type DashboardData, type Effect, type ExtensionRow, type MailRow, type Notice, type PanelData, type State,
} from "./model.js";
import { render } from "./view/index.js";
import type { ConfigField } from "./model.js";
import { CONVERSATION_BOUNDS, TERMINAL_BOUNDS } from "./limits.js";
import type { Terminal } from "./screen.js";

export interface AppPorts {
  readonly configFields: () => readonly ConfigField[];
  readonly dashboard: () => DashboardData;
  readonly mail: () => readonly MailRow[];
  readonly extensions: () => readonly ExtensionRow[];
  readonly body: (path: string) => string | null;
  readonly setField: (field: string, value: string | number) => void;
  readonly setExtension: (id: string, role: "principal" | "workers", enabled: boolean) => void;
  readonly submitPrompt: (text: string) => void;
  readonly quit: () => void;
}

const EMPTY: PanelData = Object.freeze({
  dashboard: Object.freeze({
    status: Object.freeze({ kind: "unknown" as const, observedAtMs: 0, reason: "아직 관측하지 않음" }),
    configuredWorkers: 0, workerLimit: 0, unread: 0, principalModel: "unknown", rootfs: null,
  }),
  config: Object.freeze([]), extensions: Object.freeze([]), mail: Object.freeze([]),
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TuiApp {
  private state: State = INITIAL;
  private data: PanelData = EMPTY;
  private transcript: string[] = [];
  private notice: Notice | null = null;
  private busy = false;
  private readonly keys = new KeyDecoder();
  private escapeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ports: AppPorts, private readonly terminal: Terminal, private readonly frameBytes: number) {}

  /** Re-reads every source. Called at start, after an effect and on demand;
   * the UI never keeps a value that a port no longer reports.
   */
  refresh(): void {
    this.data = Object.freeze({
      dashboard: this.ports.dashboard(),
      config: this.ports.configFields(),
      extensions: this.ports.extensions(),
      mail: this.ports.mail(),
    });
  }

  get snapshot(): State { return this.state; }
  get panel(): PanelData { return this.data; }
  /** What the conversation currently holds, so the declared line bound can be
   * checked as a fact rather than inferred from a rendered frame. */
  get lines(): readonly string[] { return this.transcript; }

  line(text: string): void {
    this.append(text);
    this.draw();
  }

  /** The one way a line enters the transcript. Every producer goes through it,
   * so the declared line bound holds for all of them -- a producer that pushed
   * its own line would be a second owner of how far the transcript grows, and
   * the Human's own prompts were exactly that. */
  private append(text: string): void {
    this.transcript.push(text);
    const keep = CONVERSATION_BOUNDS.transcriptLines.value;
    if (this.transcript.length > keep) this.transcript = this.transcript.slice(-keep);
  }

  setBusy(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    this.draw();
  }

  note(text: string | null): void { this.notice = text === null ? null : { kind: "text", text }; this.draw(); }

  feed(chunk: Uint8Array): void {
    // One decoder lives as long as the app: terminal reads are neither UTF-8
    // nor escape-sequence boundaries. A lone Escape is the one ambiguous
    // prefix, so it gets a short delay in which a following CSI byte can arrive.
    if (this.escapeTimer !== null) clearTimeout(this.escapeTimer);
    this.escapeTimer = null;
    for (const key of this.keys.push(chunk)) this.apply(key);
    if (this.keys.hasPendingEscape) {
      this.escapeTimer = setTimeout(() => {
        this.escapeTimer = null;
        for (const key of this.keys.flushEscape()) this.apply(key);
        this.draw();
      }, TERMINAL_BOUNDS.escapeDelayMs.value);
      this.escapeTimer.unref();
    }
    this.draw();
  }

  key(key: Key): void {
    this.apply(key);
    this.draw();
  }

  private apply(key: Key): void {
    const result = step(this.state, key, this.data, this.frameBytes);
    this.state = result.state;
    for (const effect of result.effects) this.run(effect);
  }

  private run(effect: Effect): void {
    try {
      switch (effect.kind) {
        case "set-choice":
          this.ports.setField(effect.field, effect.value);
          this.refresh();
          this.notice = this.saved(effect.field, effect.value);
          return;
        case "set-number":
          this.ports.setField(effect.field, effect.value);
          this.refresh();
          this.notice = this.saved(effect.field, String(effect.value));
          return;
        case "set-extension":
          this.ports.setExtension(effect.id, effect.role, effect.enabled);
          this.refresh();
          this.notice = { kind: "extension", id: effect.id, role: effect.role, enabled: effect.enabled };
          return;
        case "submit-prompt":
          this.notice = null;
          this.append(`> ${effect.text}`);
          this.ports.submitPrompt(effect.text);
          return;
        case "prompt-limit":
          if (effect.active) this.notice = { kind: "prompt-limit" };
          else if (this.notice?.kind === "prompt-limit") this.notice = null;
          return;
        case "quit":
          this.ports.quit();
          return;
        default:
          // Closed effect union: a new variant must be handled, not ignored.
          return assertNever(effect);
      }
    } catch (error) {
      // A rejected write must state that nothing was saved rather than leaving
      // the previous value looking like it changed.
      this.notice = { kind: "save-failed", message: messageOf(error) };
      this.refresh();
    }
  }

  /** Arch §23.6: a confirmed value is a saved value, and the message states
   * when it actually takes effect.
   */
  private saved(field: string, value: string): Notice {
    const declared = this.data.config.find(entry => entry.id === field);
    return {
      kind: "saved", label: declared?.label ?? field, value,
      apply: declared && declared.kind !== "link" ? declared.apply : null,
    };
  }

  draw(): void {
    const detail = this.state.detail;
    const body = detail.kind === "mail"
      ? this.ports.body(this.data.mail[detail.row]?.path ?? "")
      : null;
    this.terminal.draw(render({
      state: this.state, data: this.data, transcript: this.transcript,
      body, notice: this.notice, busy: this.busy,
      columns: this.terminal.columns, rows: this.terminal.rows,
    }));
  }

  /** Exposed for tests and for the mail detail screen's current selection. */
  selectedMail(): MailRow | undefined {
    if (categoryOf(this.state) !== "mail") return undefined;
    return this.data.mail[cursorOf(this.state, this.data, "mail")];
  }
}
