/** Public presentation and submission values; no effect or storage handles. */
import type { EffortLevel } from "@oma/contracts";

/** DR24: the engine's effort levels, in its order. */
export const EFFORT_LEVELS: readonly EffortLevel[] = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
/** Arch §23.6: every setting carries when it actually takes effect. The UI
 * must never leave the user guessing why a value did not change yet.
 */
export type ApplyScope =
  | "immediate"
  | "next-activation"
  | "next-session"
  | "restart"
  | "bootstrap-only"
  | "new-agents";

/** WP15: why a field cannot be edited right now, said where the apply time
 * would be (no target, or a value that would change nothing), or null. */
export interface ChoiceField {
  readonly kind: "choice"; readonly id: string; readonly label: string;
  readonly value: string; readonly options: readonly string[]; readonly apply: ApplyScope;
  readonly blocked: string | null;
}
export interface NumberField {
  readonly kind: "number"; readonly id: string; readonly label: string;
  readonly value: number; readonly min: number; readonly max: number; readonly apply: ApplyScope;
  readonly blocked: string | null;
}
export interface LinkField {
  readonly kind: "link"; readonly id: string; readonly label: string;
  /** What the link currently stands for, when it has a value to show. */
  readonly value?: string;
  readonly blocked?: string | null;
}
export type ConfigField = ChoiceField | NumberField | LinkField;

/** What the session did with a submitted prompt, answered in the same step it
 * was submitted.
 *
 * The transcript shows what was accepted, so acceptance cannot be something
 * the screen learns later: a prompt echoed first and refused afterwards reads
 * exactly like a prompt the Principal is working on, and the Human has no way
 * to tell those apart -- nor anything left to retype from.
 */
export type PromptOutcome =
  | { readonly kind: "accepted" }
  | { readonly kind: "refused"; readonly reason: string };
