/** Application commands and presentation observations. No engine/tenure handle escapes. */
import type { PiEvent } from "../protocol/jsonl.js";
import type { PromptOutcome } from "../protocol/settings.js";

/** Identity is stable for one engine; a replacement receives a new adapter. */
export interface ConversationUi { sendUi(event: PiEvent): void }
export interface ConversationCommands {
  session(): ConversationUi | null;
  sessionDirectory(): string;
  owned(): boolean;
  finished(): boolean;
  submit(text: string): PromptOutcome;
  deliver(): void;
  shutdown(code: number): Promise<void>;
  relaunch(resume: string | null): Promise<void>;
}
export interface SocietyConversationView {
  errorWords(error: unknown): string;
  surfaceWords(text: string, instead: string): string;
  notice(text: string): void;
  draw(): void;
  refresh(): void;
  reclaim(): void;
  starting(model: string | null): void;
  onUi(session: ConversationUi, event: PiEvent): void;
  line(text: string): void;
  busy(value: boolean): void;
  ending(): void;
  ended(reason: string, finished: boolean, disowned: boolean): void;
  returnPrompt(text: string, reason: string): void;
  disowned(reason: string, had: boolean): void;
}
