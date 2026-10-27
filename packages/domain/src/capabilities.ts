/** CFG-005/CREATE-002: vocabulary only; no role grants or storage/effect dependency.
 * The closed literal set is declared by the contract owner; this module owns the
 * runtime vocabulary and validator that must satisfy it.
 */
import type { Capability } from "@oma/contracts/identity";

export type { Capability };

export const CAPABILITIES = Object.freeze([
  "mail.send",
  "route.follow",
  "agent.create",
  "agent.manage.self",
  "agent.manage.descendants",
  "git.submit",
  "code.integrate",
  "context.publish",
] as const) satisfies readonly Capability[];

/** Compile-time exhaustiveness in both directions: the runtime vocabulary and
 * the contract's literal set must name exactly the same capabilities. Adding a
 * capability to one without the other fails the build rather than the gate.
 */
type MissingFromVocabulary = Exclude<Capability, (typeof CAPABILITIES)[number]>;
type MissingFromContract = Exclude<(typeof CAPABILITIES)[number], Capability>;
const _vocabularyCoversContract: [MissingFromVocabulary] extends [never] ? true : never = true;
const _contractCoversVocabulary: [MissingFromContract] extends [never] ? true : never = true;
void _vocabularyCoversContract;
void _contractCoversVocabulary;

const known: ReadonlySet<string> = new Set(CAPABILITIES);

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && known.has(value);
}

/** The caller owns phase-specific error mapping, not this vocabulary. */
export function capabilityCheck(value: unknown): string | null {
  return isCapability(value) ? null : "invalid capability";
}
