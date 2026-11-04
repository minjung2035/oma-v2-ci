/** Application commands and presentation observations. No engine/tenure handle escapes. */
import type { PiEvent } from "@oma/protocol/jsonl";
import type { PromptOutcome } from "@oma/domain/settings";
import type { SessionMode } from "@oma/domain/session-mode";

/** Identity is stable for one engine; a replacement receives a new adapter. */
export interface ConversationUi {
  sendUi(event: PiEvent): void;
  /** Wait for local output capacity, not an engine receipt. */
  sendUiAndWait(event: PiEvent): Promise<void>;
}
export interface ConversationCommands {
  session(): ConversationUi | null;
  sessionDirectory(): string;
  owned(): boolean;
  finished(): boolean;
  submit(text: string): PromptOutcome;
  control?(text: string): Exclude<PromptOutcome, { kind: "accepted" }>;
  consoleReleased?(): void;
  deliver(): void;
  shutdown(code: number): Promise<void>;
  relaunch(resume: string | null, mode?: SessionMode): Promise<void>;
}
export interface SocietyConversationView {
  notice(text: string): void;
  draw(): void;
  refresh(): void;
  reclaim(): void;
  /** An active private editor keeps ownership until the local Human leaves it. */
  mayHandOffConsole?(): boolean;
  starting(model: string | null): void;
  onUi(session: ConversationUi, event: PiEvent): void;
  line(text: string): void;
  /** Local Human console only; no fallback to ordinary or engine-relayed output. */
  controlLine?(text: string): void;
  /** Opens an empty editor only after local stdin ownership is established. */
  openControlEditor?(): boolean;
  busy(value: boolean): void;
  ending(): void;
  ended(reason: string, finished: boolean, disowned: boolean): void;
  returnPrompt(text: string, reason: string): void;
  disowned(reason: string, had: boolean): void;
}
