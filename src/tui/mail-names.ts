/** B4: the mail screen's party names. A stored header keeps its RFC address --
 * the durable fact -- and this translates the address's local part into the
 * role the screen calls it: a broadcast to the workers is `worker`, the <N>th
 * roster worker is `worker<N>`, the Principal is `principal`, and a topic
 * keeps its own logical label. A name the roster does not know keeps what the
 * header said: the screen never guesses a role.
 *
 * The mapping is display-only. Logical addresses (`residents`, `topic/foo`,
 * the actor's own name) stay the durable identity, and this file's words are
 * chosen the way parseDisplayedAddress's local parts arrive on the wire:
 * `commons`/`residents`/`principal`, `topic-<name>`, or an actor's name.
 */

/** The roster the screen names workers from: the society's agent names. A
 * roster that was not observed is `undefined`, and a missing roster maps only
 * the fixed names -- every actor keeps its own name rather than an invented
 * ordinal. */
export type MailRoster = readonly string[] | undefined;

/** The workers of one roster, in the name order `agents` already comes in --
 * sorted again here so a caller's order cannot renumber the workers the rows
 * name. The Principal is named `principal`, never `worker<N>`. */
function workerOrdinals(roster: MailRoster): readonly string[] | undefined {
  if (roster === undefined) return undefined;
  return [...new Set(roster)].filter(name => name !== "principal").sort();
}

/** One header local part's screen name. The fixed names map without a roster;
 * an actor maps only when the roster places it. */
export function mailPartyName(local: string, workers: readonly string[] | undefined): string {
  if (local === "residents" || local === "commons") return "worker";
  if (local === "principal") return "principal";
  const at = workers === undefined ? -1 : workers.indexOf(local);
  if (at >= 0) return `worker${at + 1}`;
  // A topic keeps its own logical label; anything else keeps what the header
  // said -- an actor the roster has lost is still the name its mail was
  // written under, never an invented role.
  if (local.startsWith("topic-") && local.length > "topic-".length) return `topic/${local.slice("topic-".length)}`;
  return local;
}

/** The namer for one mailbox read: the workers' ordinals are taken from the
 * roster once, so a sender and the recipient lists agree on them. */
export function mailNamerFor(roster: MailRoster): (local: string) => string {
  const workers = workerOrdinals(roster);
  return local => mailPartyName(local, workers);
}
