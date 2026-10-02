/** MODE-005 / P0-1: an explicit resume must already have a Pi identity. The
 * engine may migrate its own entries, but may not repair an empty OMA history
 * into a different session. Inspect only the header, never truncate the history. */
import { StoreError } from "../domain/errors.js";
import { readUserFile } from "./user-files.js";
import type { SessionBirth } from "./session-mode.js";

// The bundled engine's header discovery bound; not a conversation-size limit.
const HEADER_BYTES = 1024 * 1024;
export async function inspectSessionHistory(file: string, birth: SessionBirth, engineCwd = birth.cwd): Promise<{ id: string; timestamp: string }> {
  const invalid = (): never => { throw new StoreError("STORE_CORRUPT", "Session history has no valid identity matching its birth"); };
  const text = readUserFile(file, HEADER_BYTES, { firstLine: true });
  if (text === null) throw new StoreError("INVALID_REQUEST", "Session history no longer exists");
  let header: unknown;
  try { header = JSON.parse(text); } catch { return invalid(); }
  if (!header || typeof header !== "object" || Array.isArray(header)) return invalid();
  const value = header as Record<string, unknown>;
  const { CURRENT_SESSION_VERSION } = await import("@earendil-works/pi-coding-agent");
  if (value.type !== "session" || typeof value.id !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value.id) ||
      typeof value.timestamp !== "string" || !Number.isFinite(Date.parse(value.timestamp)) || value.cwd !== engineCwd ||
      (value.version !== undefined && (!Number.isSafeInteger(value.version) || (value.version as number) < 1 || (value.version as number) > CURRENT_SESSION_VERSION))) return invalid();
  return { id: value.id, timestamp: value.timestamp };
}

export async function assertSessionHistory(file: string, birth: SessionBirth, engineCwd = birth.cwd): Promise<void> {
  await inspectSessionHistory(file, birth, engineCwd);
}
