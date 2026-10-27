/** Layout locates a birth record; only that record owns session identity.
 * No index, implicit import, or corruption-to-default fallback. */
import { listOwnedDirectory } from "@oma/storage/directory";
import { basename, join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { isValidSocietyName, UUID_V4_RE } from "@oma/domain/identifiers";
import { modelWorkspacePathAt } from "@oma/domain/paths";
import { observeProjectBinding } from "./project-binding.js";
import { PERSONAL_SESSIONS, readSessionBirth, sessionRootForHistory, type SessionBirth } from "./session-mode.js";
import { assertSessionHistory } from "./session-history.js";

export async function sessionBirthForHistory(dataRoot: string, file: string, cwd: string): Promise<SessionBirth> {
  const root = sessionRootForHistory(dataRoot, file);
  if (root === null) throw new StoreError("INVALID_REQUEST", "That is not an OMA session history");
  const birth = readSessionBirth(root);
  if (birth === null)
    throw new StoreError("INVALID_REQUEST", "This history has no OMA birth record; use a new development session directory");
  if (birth.mode === "personal") { await assertSessionHistory(file, birth); return birth; }
  const binding = observeProjectBinding(root);
  if (binding.kind !== "bound" || binding.binding.society !== basename(root) || binding.binding.canonicalProjectPath !== cwd)
    throw new StoreError(binding.kind === "unavailable" ? "BROKER_UNAVAILABLE" : "INVALID_REQUEST", "That Society is not bound to this project");
  if (birth.cwd !== cwd) throw new StoreError("STORE_CORRUPT", "Society birth and project binding disagree");
  // Society's engine cwd is its private scratch, not the Human project binding.
  await assertSessionHistory(file, birth, modelWorkspacePathAt(root, "principal"));
  return birth;
}
const names = (root: string): string[] => {
  return listOwnedDirectory(root)?.map(entry => entry.name) ?? [];
};
export interface SessionHistoryDirectory { readonly root: string; readonly dir: string; readonly mode: "society" | "personal" }
export function sessionHistoryDirectories(dataRoot: string, cwd: string): readonly SessionHistoryDirectory[] {
  const result: SessionHistoryDirectory[] = [];
  for (const id of names(join(dataRoot, PERSONAL_SESSIONS)).filter(id => UUID_V4_RE.test(id))) {
    const root = join(dataRoot, PERSONAL_SESSIONS, id), birth = readSessionBirth(root);
    if (birth === null) continue;
    if (birth.mode !== "personal") throw new StoreError("STORE_CORRUPT", "Personal history has another birth mode");
    result.push({ root, dir: birth.history, mode: birth.mode });
  }
  for (const id of names(dataRoot).filter(isValidSocietyName)) {
    const root = join(dataRoot, id), binding = observeProjectBinding(root);
    if (binding.kind === "unavailable") throw new StoreError("BROKER_UNAVAILABLE", binding.reason);
    if (binding.kind !== "bound" || binding.binding.society !== id || binding.binding.canonicalProjectPath !== cwd) continue;
    const birth = readSessionBirth(root);
    if (birth === null) continue;
    if (birth.mode !== "society" || birth.cwd !== cwd) throw new StoreError("STORE_CORRUPT", "Society birth and project binding disagree");
    result.push({ root, dir: birth.history, mode: birth.mode });
  }
  return Object.freeze(result);
}
