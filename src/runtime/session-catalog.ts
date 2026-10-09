/** A history's layout locates its birth record; a legacy Society needs binding
 * evidence too. No index, implicit import, or corruption-to-default fallback. */
import { listOwnedDirectory } from "../storage/directory.js";
import { basename, dirname, join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { isValidSocietyName, UUID_V4_RE } from "../domain/identifiers.js";
import { modelWorkspacePathAt, sessionDirPathAt } from "../storage/paths.js";
import { observeProjectBinding } from "./project-binding.js";
import { newSessionBirth, PERSONAL_SESSIONS, readSessionBirth, sessionRootForHistory, type SessionBirth } from "./session-mode.js";
import { assertSessionHistory } from "./session-history.js";

export const RESUME_SESSION_ENV = "OMA_RESUME_SESSION";
export async function sessionBirthForHistory(dataRoot: string, file: string, cwd: string): Promise<SessionBirth> {
  const root = sessionRootForHistory(dataRoot, file);
  if (root === null) throw new StoreError("INVALID_REQUEST", "That is not an OMA session history");
  const birth = readSessionBirth(root);
  if (birth?.mode === "personal") { await assertSessionHistory(file, birth); return birth; }
  if (basename(dirname(root)) === PERSONAL_SESSIONS || process.platform === "darwin")
    throw new StoreError("INVALID_REQUEST", "That history has no local Personal birth record");
  const binding = observeProjectBinding(root);
  if (binding.kind !== "bound" || binding.binding.society !== basename(root) || binding.binding.canonicalProjectPath !== cwd)
    throw new StoreError(binding.kind === "unavailable" ? "BROKER_UNAVAILABLE" : "INVALID_REQUEST", "That Society is not bound to this project");
  if (birth !== null && birth.cwd !== cwd) throw new StoreError("STORE_CORRUPT", "Society birth and project binding disagree");
  const saved = birth ?? newSessionBirth(root, "society", cwd);
  // Society's engine cwd is its private scratch, not the Human project binding.
  await assertSessionHistory(file, saved, modelWorkspacePathAt(root, "principal"));
  return saved;
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
  // Mac Society histories live in the guest. Host directory names (engine,
  // packages, run) are not evidence of a local Society or a guest binding.
  if (process.platform === "darwin") return Object.freeze(result);
  for (const id of names(dataRoot).filter(isValidSocietyName)) {
    const root = join(dataRoot, id), binding = observeProjectBinding(root);
    if (binding.kind === "unavailable") throw new StoreError("BROKER_UNAVAILABLE", binding.reason);
    if (binding.kind !== "bound" || binding.binding.society !== id || binding.binding.canonicalProjectPath !== cwd) continue;
    const birth = readSessionBirth(root);
    if (birth !== null && (birth.mode !== "society" || birth.cwd !== cwd)) throw new StoreError("STORE_CORRUPT", "Society birth and project binding disagree");
    result.push({ root, dir: sessionDirPathAt(root, "principal"), mode: "society" });
  }
  return Object.freeze(result);
}
