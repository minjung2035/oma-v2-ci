/** MODE-005 / P0-1: an explicit resume must already have a Pi identity. The
 * engine may migrate its own entries, but may not repair an empty OMA history
 * into a different session. Inspect only the header, never truncate the history.
 * What that header means is the engine's (pi-compat/session.ts); what OMA owns
 * is the bounded first-line read and the refusal. */
import { StoreError } from "@oma/domain/errors";
import { readUserFile } from "./user-files.js";
import type { SessionBirth } from "./session-mode.js";
import { sessionHeaderIdentity } from "@oma/engine/pi-compat/session";

// The bundled engine's header discovery bound; not a conversation-size limit.
const HEADER_BYTES = 1024 * 1024;
export async function inspectSessionHistory(file: string, birth: SessionBirth, engineCwd = birth.cwd): Promise<{ id: string; timestamp: string }> {
  const invalid = (): never => { throw new StoreError("STORE_CORRUPT", "Session history has no valid identity matching its birth"); };
  const text = readUserFile(file, HEADER_BYTES, { firstLine: true });
  if (text === null) throw new StoreError("INVALID_REQUEST", "Session history no longer exists");
  let header: unknown;
  try { header = JSON.parse(text); } catch { return invalid(); }
  const identity = await sessionHeaderIdentity(header, engineCwd);
  if (identity === null) return invalid();
  return identity;
}

export async function assertSessionHistory(file: string, birth: SessionBirth, engineCwd = birth.cwd): Promise<void> {
  await inspectSessionHistory(file, birth, engineCwd);
}
