/** TUI-001/007: product surface orchestration.
 *
 * The app owns no policy of its own. It routes decoded keys through the pure
 * state machine, performs the effects that machine asks for through injected
 * ports, and redraws. Ports keep the file, socket and process owners out of
 * this module so the whole flow is testable without a terminal.
 */
import { decodeKeys, type Key } from "./keys.js";
import { assertNever } from "../domain/exhaustive.js";
import {
  INITIAL, categoryOf, cursorOf, step,
  type Effect, type ExtensionRow, type MailRow, type PanelData, type State,
} from "./model.js";
import { applyLabel, render } from "./render.js";
import type { ConfigField } from "./model.js";
import { CONVERSATION_BOUNDS } from "./limits.js";
import type { Terminal } from "./screen.js";

export interface AppPorts {
  readonly configFields: () => readonly ConfigField[];
  readonly dashboard: () => PanelData["dashboard"];
  readonly mail: () => readonly MailRow[];
  readonly extensions: () => readonly ExtensionRow[];
  readonly body: (path: string) => string | null;
  readonly setField: (field: string, value: string | number) => void;
  readonly setExtension: (id: string, role: "principal" | "workers", enabled: boolean) => void;
  readonly submitPrompt: (text: string) => void;
  readonly quit: () => void;
}

const EMPTY: PanelData = Object.freeze({
  dashboard: Object.freeze([]), config: Object.freeze([]),
  extensions: Object.freeze([]), mail: Object.freeze([]),
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TuiApp {
  private state: State = INITIAL;
  private data: PanelData = EMPTY;
  private transcript: string[] = [];
  private notice: string | null = null;
  private busy = false;

  constructor(private readonly ports: AppPorts, private readonly terminal: Terminal) {}

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

  line(text: string): void {
    this.transcript.push(text);
    const keep = CONVERSATION_BOUNDS.transcriptLines.value;
    if (this.transcript.length > keep) this.transcript = this.transcript.slice(-keep);
    this.draw();
  }

  setBusy(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    this.draw();
  }

  note(text: string | null): void { this.notice = text; this.draw(); }

  feed(chunk: Uint8Array): void {
    for (const key of decodeKeys(chunk)) this.key(key);
  }

  key(key: Key): void {
    const result = step(this.state, key, this.data);
    this.state = result.state;
    for (const effect of result.effects) this.run(effect);
    this.draw();
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
          this.notice = `${effect.id} · ${effect.role === "principal" ? "Principal" : "Workers"} ${effect.enabled ? "사용" : "해제"} · 저장됨`;
          return;
        case "submit-prompt":
          this.notice = null;
          this.transcript.push(`> ${effect.text}`);
          this.ports.submitPrompt(effect.text);
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
      this.notice = `저장하지 못했습니다: ${messageOf(error)}`;
      this.refresh();
    }
  }

  /** Arch §23.6: a confirmed value is a saved value, and the message states
   * when it actually takes effect.
   */
  private saved(field: string, value: string): string {
    const declared = this.data.config.find(entry => entry.id === field);
    const scope = declared && declared.kind !== "link" ? ` · ${applyLabel(declared.apply)}` : "";
    const label = declared?.label ?? field;
    return `${label} = ${value} · 저장됨${scope}`;
  }

  draw(): void {
    const detail = this.state.detail;
    const body = detail.kind === "mail"
      ? this.ports.body(this.data.mail[detail.row]?.path ?? "")
      : null;
    const status = this.busy ? "· 응답 생성 중" : "";
    const notice = this.notice === null
      ? (status.length > 0 ? status : null)
      : `${this.notice}${status.length > 0 ? ` ${status}` : ""}`;
    this.terminal.draw(render({
      state: this.state, data: this.data, transcript: this.transcript,
      body, notice, columns: this.terminal.columns, rows: this.terminal.rows,
    }));
  }

  /** Exposed for tests and for the mail detail screen's current selection. */
  selectedMail(): MailRow | undefined {
    if (categoryOf(this.state) !== "mail") return undefined;
    return this.data.mail[cursorOf(this.state, this.data, "mail")];
  }
}
