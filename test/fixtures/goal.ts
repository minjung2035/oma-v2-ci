/** P0V-93 (R6-16): whether the society has a GOAL has one owner in the
 * product, `GitModule.hasCommittedContext`, and every composition passes it.
 * A test without a context repository says what it stands in with -- here,
 * the published context's presence, which the broker used to fall back to. */
import { existsSync } from "node:fs";
import { join } from "node:path";

export function goalPublishedAt(stateRoot: string): () => boolean {
  return () => existsSync(join(stateRoot, "world", "context", "current"));
}
