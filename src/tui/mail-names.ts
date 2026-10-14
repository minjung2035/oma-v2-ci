/** Mail display preserves actor and broadcast identities. */
export type MailRoster = readonly string[] | undefined;

/** Keep actor identities stable when the roster grows or its order changes. */
export function mailPartyName(local: string, workers: readonly string[] | undefined): string {
  if (local === "residents" || local === "commons") return local;
  if (workers?.includes(local)) return local;
  if (local.startsWith("topic-") && local.length > "topic-".length) return `topic/${local.slice("topic-".length)}`;
  return local;
}

export function mailNamerFor(roster: MailRoster): (local: string) => string {
  return local => mailPartyName(local, roster);
}
