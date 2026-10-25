import { prepareHostProjectDirectory } from "@oma/platform-mac/files";
/** Human saved-history observations. References locate facts, never grant a writer. */
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { SessionInfo } from "@oma/engine/session-metadata";
import { StoreError } from "@oma/domain/errors";
import { checkedGuestHistory, guestHistoryReference, parseGuestHistoryReference } from "@oma/protocol/guest-history";
import { readHostRecord } from "@oma/platform-mac/record";
import { bundledProjectBookmarks } from "@oma/platform-mac/bookmark";
import { macBundleResources } from "@oma/platform-mac/bundle";
import { MacGit } from "@oma/git/host-project";
import { hostApiRequest } from "./api-client.js";
const PREVIEW_CHARS = 160;

function request(dataRoot: string, method: string, params: Record<string, unknown>) {
  let token: string;
  try { token = readFileSync(join(dataRoot, "run", "token"), "utf8").trim(); }
  catch { throw new StoreError("BROKER_UNAVAILABLE", "Guest histories could not be observed; open the OMA app first"); }
  return hostApiRequest(join(dataRoot, "run", "hostapi.sock"), token, method, params, undefined, 30_000);
}

export async function inspectMacGuestHistory(dataRoot: string, reference: string): Promise<void> {
  const identity = parseGuestHistoryReference(reference);
  const result = await request(dataRoot, "session.inspect", { ...identity });
  if (Object.keys(result).sort().join(",") !== "mode,sessionId" || result.mode !== "society" || result.sessionId !== identity.sessionId)
    throw new StoreError("BROKER_UNAVAILABLE", "The selected guest history could not be observed");
}

export async function listMacGuestHistories(dataRoot: string, libdir: string, signal?: AbortSignal): Promise<SessionInfo[]> {
  const projects = readHostRecord(join(dataRoot, "host-record.json"))?.projects ?? [];
  if (projects.length === 0) return [];
  const bookmarks = bundledProjectBookmarks(libdir), git = new MacGit(join(macBundleResources(libdir), "git", "bin", "git"), prepareHostProjectDirectory);
  const found: SessionInfo[] = [], references = new Set<string>();
  for (const project of projects) {
    signal?.throwIfAborted();
    const cwd = realpathSync(await bookmarks.resolve(project.bookmark));
    await git.verifyIdentity(cwd, project);
    let after: string | undefined;
    do {
      signal?.throwIfAborted();
      const result = await request(dataRoot, "session.list", { projectId: project.projectId, ...(after === undefined ? {} : { after }) });
      if (Object.keys(result).sort().join(",") !== "after,sessions" || !Array.isArray(result.sessions) ||
          !(result.after === null || typeof result.after === "string"))
        throw new StoreError("BROKER_UNAVAILABLE", "Guest history list could not be observed");
      let last: string | undefined;
      for (const raw of result.sessions) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new StoreError("BROKER_UNAVAILABLE", "Guest history list could not be observed");
        const identity = checkedGuestHistory(raw.identity), path = guestHistoryReference(identity);
        if (identity.projectId !== project.projectId || identity.society !== project.society || references.has(path) ||
            (after !== undefined && identity.file.localeCompare(after, "en") <= 0) ||
            (last !== undefined && identity.file.localeCompare(last, "en") <= 0) ||
            typeof raw.created !== "string" || !Number.isFinite(Date.parse(raw.created)) ||
            typeof raw.modified !== "string" || !Number.isFinite(Date.parse(raw.modified)) ||
            typeof raw.firstMessage !== "string" || raw.firstMessage.length > PREVIEW_CHARS ||
            !Number.isSafeInteger(raw.messageCount) || raw.messageCount < 0 ||
            (raw.name !== undefined && (typeof raw.name !== "string" || raw.name.length > PREVIEW_CHARS)))
          throw new StoreError("BROKER_UNAVAILABLE", "Guest history list could not be observed");
        references.add(path); last = identity.file;
        found.push({ path, id: identity.sessionId, cwd, name: `[Society] ${raw.name ?? project.society}`,
          created: new Date(raw.created), modified: new Date(raw.modified), messageCount: raw.messageCount,
          firstMessage: raw.firstMessage, allMessagesText: `${raw.name ?? ""} ${raw.firstMessage}` });
      }
      if (result.after !== null && (result.after !== last || last === undefined))
        throw new StoreError("BROKER_UNAVAILABLE", "Guest history pagination did not advance");
      after = result.after === null ? undefined : result.after;
    } while (after !== undefined);
  }
  signal?.throwIfAborted();
  return found;
}
