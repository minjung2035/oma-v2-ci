/** MAIL-004/005: RFC presentation adapter. These strings never become recipient
 * authority. Membership/existence is supplied by the accepting owner separately.
 */
import type { Actor, Address } from "../../implementation/contracts.js";
import { isValidActorName, isValidMessageId, isValidSocietyName, isValidTopicName } from "../domain/identifiers.js";
import { parseRfcMessageId, type RfcMessageId } from "../domain/mail-values.js";
import { selectReplyTargets } from "./facts.js";

export function actorAddress(actor: Actor, society: string): string { return `${actor}@${society}.oma.invalid`; }
export function listAddress(logical: "commons" | "residents" | "principal", society: string): string {
  return `${logical}@${society}.oma.invalid`;
}
export function topicAddress(topic: string, society: string): string { return `topic-${topic}@${society}.oma.invalid`; }
export function displayAddress(address: Address, society: string): string {
  if (address === "principal" || address === "commons" || address === "residents") return listAddress(address, society);
  return address.startsWith("topic/") ? topicAddress(address.slice(6), society) : actorAddress(address, society);
}
export function rfcMessageIdFor(id: string, society: string): RfcMessageId {
  if (!isValidMessageId(id) || !isValidSocietyName(society)) throw new TypeError("invalid mail identity for RFC presentation");
  const identity = parseRfcMessageId(`${id}@${society}.oma.invalid`);
  if (identity === null) throw new TypeError("invalid generated RFC message identity");
  return identity;
}

/** Compatibility display helper; production chooses logical Reply-To before
 * serialization. The selection policy is shared, but RFC list grammar is not
 * confused with logical topic/foo or internal file identity grammar.
 */
export function defaultReplyTo(from: string, to: readonly string[]): string[] {
  return selectReplyTargets(from, to, address => /^(commons|residents|topic-[a-z][a-z0-9-]*)@/.test(address));
}

export function parseDisplayedAddress(value: string, society: string, knownActors: ReadonlySet<string>): Address | null {
  const raw = value.trim().replace(/^<|>$/g, "");
  if (raw === "commons" || raw === "residents" || raw === "principal") return raw;
  if (raw.startsWith("topic/") && isValidTopicName(raw.slice(6))) return raw;
  if (isValidActorName(raw) && knownActors.has(raw)) return raw;
  const suffix = `@${society}.oma.invalid`;
  if (!raw.endsWith(suffix)) return null;
  const local = raw.slice(0, -suffix.length);
  if (local === "commons" || local === "residents" || local === "principal") return local;
  if (local.startsWith("topic-") && isValidTopicName(local.slice(6))) return `topic/${local.slice(6)}`;
  return isValidActorName(local) && knownActors.has(local) ? local : null;
}
