/** One run has one owner. Claims and queue handoff are synchronous and perform no I/O.
 * Unknown prompt acceptance retains the claim until refusal, settlement or session end. */
import { CONVERSATION_BOUNDS } from "./surface-bounds.js";

export type TurnOwner = "human" | "delivery";
interface Prompt { readonly id: string; readonly role: TurnOwner; readonly text: string }
export class TurnAdmission {
  private owner: TurnOwner | null = null;
  private readonly waiting: string[] = [];
  private unanswered: Prompt | null = null;
  private ended = false;
  static readonly WAITING = CONVERSATION_BOUNDS.waitingPrompts.value;
  get busy(): boolean { return this.owner !== null; }
  get queued(): readonly string[] { return [...this.waiting]; }

  claimHuman(text: string): "started" | "queued" | "full" {
    if (this.busy) {
      if (this.waiting.length >= TurnAdmission.WAITING) return "full";
      this.waiting.push(text);
      return "queued";
    }
    this.owner = "human";
    return "started";
  }
  claimDelivery(): boolean {
    if (this.busy) return false;
    this.owner = "delivery";
    return true;
  }
  /** The next Human owns the run before the caller can write or observe idle. */
  settle(): string | null {
    this.unanswered = null;
    const next = this.waiting.shift() ?? null;
    this.owner = next === null ? null : "human";
    return next;
  }
  release(owner: TurnOwner): { released: boolean; next: string | null } {
    return this.owner === owner ? { released: true, next: this.settle() } : { released: false, next: null };
  }
  writing(id: string, text: string, role: TurnOwner): void { this.unanswered = { id, role, text }; }
  response(id: unknown): Prompt | null {
    if (this.unanswered === null || this.unanswered.id !== id) return null;
    const prompt = this.unanswered;
    this.unanswered = null;
    return prompt;
  }
  notWritten(id: string): void { if (this.unanswered?.id === id) this.unanswered = null; }
  end(): { unconfirmed: string | null; unsent: readonly string[] } {
    if (this.ended) return { unconfirmed: null, unsent: [] };
    this.ended = true;
    const unconfirmed = this.unanswered?.role === "human" ? this.unanswered.text : null;
    this.unanswered = null;
    return { unconfirmed, unsent: this.waiting.splice(0) };
  }
}
