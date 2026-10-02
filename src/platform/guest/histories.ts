/** Read-only saved history admission, rooted in the guest's existing binding. */
import { basename, join } from "node:path";
import { readdirSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { StoreError } from "../../domain/errors.js";
import { isUuid, PLATFORM_FRAME_BYTES } from "../../protocol/host-guest.js";
import { isValidSocietyName } from "../../domain/identifiers.js";
import { checkedGuestHistory, type GuestHistory } from "../../protocol/guest-history.js";
import { observeProjectBinding } from "../../runtime/project-binding.js";
import { newSessionBirth, readSessionBirth } from "../../runtime/session-mode.js";
import { inspectSessionHistory } from "../../runtime/session-history.js";
import { modelWorkspacePathAt, sessionDirPathAt } from "../../storage/paths.js";

export class GuestHistories {
  constructor(private readonly societiesDir: string, private readonly projectsDir: string) {}

  private birth(projectId: unknown, society: unknown) {
    if (!isUuid(projectId) || !isValidSocietyName(society)) throw new StoreError("INVALID_REQUEST", "Invalid history project or Society");
    const root = join(this.societiesDir, society), cwd = join(this.projectsDir, projectId);
    const binding = observeProjectBinding(root);
    if (binding.kind === "unavailable") throw new StoreError("BROKER_UNAVAILABLE", "The history's project binding could not be observed");
    if (binding.kind === "unreadable") throw new StoreError("STORE_CORRUPT", "The history's project binding is damaged");
    if (binding.kind !== "bound" || binding.binding.society !== society || binding.binding.canonicalProjectPath !== cwd)
      throw new StoreError("INVALID_REQUEST", "That history belongs to another project");
    const saved = readSessionBirth(root) ?? newSessionBirth(root, "society", cwd);
    if (saved.mode !== "society" || saved.cwd !== cwd || saved.id !== society)
      throw new StoreError("STORE_CORRUPT", "Society history and its birth disagree");
    return { root, saved };
  }

  async inspect(value: unknown): Promise<{ file: string; mode: "society"; sessionId: string }> {
    const identity = checkedGuestHistory(value), { root, saved } = this.birth(identity.projectId, identity.society);
    const file = join(saved.history, identity.file);
    const header = await inspectSessionHistory(file, saved, modelWorkspacePathAt(root, "principal"));
    if (header.id !== identity.sessionId) throw new StoreError("INVALID_REQUEST", "That history no longer has its selected identity");
    return { file, mode: "society", sessionId: header.id };
  }

  async list(projectId: unknown, society: unknown, after?: unknown): Promise<Record<string, unknown>> {
    const { root, saved } = this.birth(projectId, society);
    if (after !== undefined) checkedGuestHistory({ projectId, society, file: after, sessionId: "cursor" });
    const sessions = [];
    const RESPONSE_MARGIN = 4096, PREVIEW_CHARS = 160;
    let last: string | undefined;
    let names: string[];
    try { names = readdirSync(saved.history).filter(file => file.endsWith(".jsonl")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") names = [];
      else throw new StoreError("BROKER_UNAVAILABLE", "Guest history directory could not be observed");
    }
    const infos = (await SessionManager.listAll(sessionDirPathAt(root, "principal"))).sort((a, b) => basename(a.path).localeCompare(basename(b.path), "en"));
    if (infos.length !== names.length || infos.some(info => !names.includes(basename(info.path))))
      throw new StoreError("BROKER_UNAVAILABLE", "Some guest histories could not be observed; try the list again");
    for (const info of infos) {
      if (typeof after === "string" && basename(info.path).localeCompare(after, "en") <= 0) continue;
      const identity: GuestHistory = checkedGuestHistory({ projectId, society, file: basename(info.path), sessionId: info.id });
      await this.inspect(identity);
      const entry = { identity, created: info.created.toISOString(), modified: info.modified.toISOString(),
        ...(info.name === undefined ? {} : { name: info.name.slice(0, PREVIEW_CHARS) }), messageCount: info.messageCount,
        firstMessage: info.firstMessage.slice(0, PREVIEW_CHARS) };
      if (Buffer.byteLength(JSON.stringify({ sessions: [...sessions, entry] })) > PLATFORM_FRAME_BYTES - RESPONSE_MARGIN)
        return { sessions, after: last };
      sessions.push(entry);
      last = identity.file;
    }
    return { sessions, after: null };
  }
}
