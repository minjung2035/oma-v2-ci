/** Host-owned metadata and exact saved-birth admission for the terminal bridge. */
import { readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { listEngineSessions } from "@oma/engine/session-metadata";
import { StoreError } from "@oma/domain/errors";
import { hostHistoryReference, parseHostHistoryReference, type HostHistoryInfo, type HostHistoryQuery } from "@oma/protocol/host-history";
import { TERMINAL_FRAME_BYTES } from "@oma/protocol/host-guest";
import { PERSONAL_SESSIONS, readSessionBirth } from "../../runtime/session-mode.js";
import { sessionHistoryDirectories } from "../../runtime/session-catalog.js";
import { inspectSessionHistory } from "../../runtime/session-history.js";

export async function inspectHostPersonalHistory(dataRoot: string, reference: string) {
  const identity = parseHostHistoryReference(reference), root = join(dataRoot, PERSONAL_SESSIONS, identity.birthId);
  const birth = readSessionBirth(root);
  if (birth === null || birth.mode !== "personal") throw new StoreError("INVALID_REQUEST", "That host Personal birth is unavailable");
  const file = join(birth.history, identity.file), header = await inspectSessionHistory(file, birth);
  if (header.id !== identity.sessionId) throw new StoreError("INVALID_REQUEST", "That host history no longer has its selected identity");
  if (realpathSync(birth.cwd) !== birth.cwd || !statSync(birth.cwd).isDirectory())
    throw new StoreError("INVALID_REQUEST", "That host history's saved directory is unavailable");
  return { birth, file };
}

export async function hostPersonalHistoryQuery(dataRoot: string, query: HostHistoryQuery): Promise<Record<string, unknown>> {
  if (query.method === "inspect") {
    await inspectHostPersonalHistory(dataRoot, query.reference!);
    return { reference: query.reference, mode: "personal" };
  }
  const found: HostHistoryInfo[] = [];
  for (const location of sessionHistoryDirectories(dataRoot, process.cwd()).filter(entry => entry.mode === "personal")) {
    let names: string[];
    try { names = readdirSync(location.dir).filter(file => file.endsWith(".jsonl")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") names = []; else throw error; }
    const infos = await listEngineSessions(location.dir);
    if (infos.length !== names.length || infos.some(info => !names.includes(basename(info.path))))
      throw new StoreError("BROKER_UNAVAILABLE", "Some host histories could not be observed; try again");
    for (const info of infos) {
      const reference = hostHistoryReference({ birthId: basename(location.root), file: basename(info.path), sessionId: info.id });
      await inspectHostPersonalHistory(dataRoot, reference);
      found.push({ reference, created: info.created.toISOString(), modified: info.modified.toISOString(),
        ...(info.name === undefined ? {} : { name: info.name.slice(0, 160) }), messageCount: info.messageCount,
        firstMessage: info.firstMessage.slice(0, 160) });
    }
  }
  found.sort((a, b) => a.reference.localeCompare(b.reference, "en"));
  const sessions: HostHistoryInfo[] = [];
  let last: string | undefined;
  for (const entry of found) {
    if (query.after !== undefined && entry.reference.localeCompare(query.after, "en") <= 0) continue;
    if (Buffer.byteLength(JSON.stringify({ sessions: [...sessions, entry] })) > TERMINAL_FRAME_BYTES - 4096)
      return { sessions, after: last };
    sessions.push(entry); last = entry.reference;
  }
  return { sessions, after: null };
}
