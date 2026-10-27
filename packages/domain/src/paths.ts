/** FS-001..003: root binding only. Roots come from host composition, never an IPC path.
 * Lexical identity is NOT a symlink/FD-containment proof; secure filesystem effects
 * retain their own checks. Relative test roots retain their existing join semantics.
 */
import { isAbsolute, join, relative, sep } from "node:path";
import { StoreError } from "./errors.js";
/** The shared committed project configuration, beside its Society roots. */
export function projectSettingsPathAt(dataRoot: string, project: string): string {
  return join(dataRoot, ".projects", project, "config.json");
}
import {
  agentRootFor, workspaceFor, runnerViewFor, batchViewFor, runnerReceiptFor, runnerSessionDirFor, sessionDirFor,
  mailObjectRelativePath, mailArchiveRelativePath, mailWorkersRelativePath, mailInboxRelativePath,
  mailInboxArrivalRelativePath,
  submitStagingFor, submitBundleFor, contextStagingFor, contextRevisionFor, modelWorkspaceFor,
  actorSocketDirectoryFor, actorSocketFor,
} from "./derived.js";

export function agentRootPathAt(stateRoot: string, actor: string): string {
  return join(stateRoot, agentRootFor(actor));
}
export function workspacePathAt(stateRoot: string, actor: string): string {
  return join(stateRoot, workspaceFor(actor));
}
export function runnerViewPathAt(stateRoot: string, actor: string): string {
  return join(stateRoot, runnerViewFor(actor));
}
export function batchViewPathAt(stateRoot: string, actor: string, batchId: string): string {
  return join(stateRoot, batchViewFor(actor, batchId));
}
export function runnerReceiptPathAt(stateRoot: string, actor: string, batchId: string): string {
  return join(stateRoot, runnerReceiptFor(actor, batchId));
}
export function runnerSessionDirPathAt(stateRoot: string, actor: string): string {
  return join(stateRoot, runnerSessionDirFor(actor));
}
/** Where this agent's engine keeps its session (PR-003 for the Principal). */
/** The society's canonical project repository. */
export function projectGitPathAt(stateRoot: string): string {
  return join(stateRoot, "repos", "project.git");
}
/** DR18 (D-8): the project's committed branch history, as of the last start,
 * which a Resident may fetch from and submit (read-only in its sandbox). */
export function projectMirrorPathAt(stateRoot: string): string {
  return join(stateRoot, "repos", "project-mirror.git");
}
export function sessionDirPathAt(stateRoot: string, actor: string): string {
  return join(stateRoot, sessionDirFor(actor));
}
export function modelWorkspacePathAt(stateRoot: string, actor: string): string {
  return join(stateRoot, modelWorkspaceFor(actor));
}
/** PR-003/PR-004: refuses a model scope that overlaps, in either direction, a
 * directory the product keeps from the model -- the Human's or an engine's
 * session history, an engine's own settings and credentials, batch views.
 * Checked where an engine is started, on the paths it is started with (INV09:
 * the guard's guarantee is only as wide as the directory it is given). */
export function assertModelScope(workspace: string, kept: readonly string[]): void {
  const within = (root: string, path: string): boolean => {
    const offset = relative(root, path);
    return offset === "" || (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
  };
  if (kept.some(path => within(workspace, path) || within(path, workspace)))
    throw new StoreError("UNSUPPORTED_PROFILE", "the model's workspace overlaps a directory the product keeps from the model");
}
export function mailObjectPathAt(stateRoot: string, messageId: string): string {
  return join(stateRoot, mailObjectRelativePath(messageId));
}
export function mailArchivePathAt(stateRoot: string, messageId: string): string {
  return join(stateRoot, mailArchiveRelativePath(messageId));
}
export function mailWorkersPathAt(stateRoot: string, messageId: string): string {
  return join(stateRoot, mailWorkersRelativePath(messageId));
}
/** The archive directory a message belongs to by audience. */
export function mailAudiencePathAt(stateRoot: string, message: { id: string; audience?: "workers" }): string {
  return message.audience === "workers" ? mailWorkersPathAt(stateRoot, message.id) : mailArchivePathAt(stateRoot, message.id);
}
export function mailInboxPathAt(stateRoot: string, actor: string, messageId: string, folder: "new" | "cur"): string {
  return join(stateRoot, mailInboxRelativePath(actor, messageId, folder));
}
export function mailInboxArrivalPathAt(stateRoot: string, actor: string): string {
  return join(stateRoot, mailInboxArrivalRelativePath(actor));
}
export function submitStagingPathAt(stateRoot: string, operationId: string): string {
  return join(stateRoot, submitStagingFor(operationId));
}
export function submitBundlePathAt(stateRoot: string, operationId: string): string {
  return join(stateRoot, submitBundleFor(operationId));
}
export function contextStagingPathAt(stateRoot: string, operationId: string): string {
  return join(stateRoot, contextStagingFor(operationId));
}
export function contextRevisionPathAt(worldRoot: string, oid: string): string {
  return join(worldRoot, contextRevisionFor(oid));
}
export function actorSocketDirectoryAt(runRoot: string, actor: string, incarnation: number): string {
  return join(runRoot, actorSocketDirectoryFor(actor, incarnation));
}
export function actorSocketPathAt(runRoot: string, actor: string, incarnation: number): string {
  return join(runRoot, actorSocketFor(actor, incarnation));
}

function matches(value: unknown, derive: () => string): boolean {
  if (typeof value !== "string") return false;
  try { return value === derive(); }
  catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

// Expected root and identity are mandatory. No validator accepts only the claimed path.
export function isWorkspacePathFor(value: unknown, expected: { stateRoot: string; actor: string }): boolean {
  return matches(value, () => workspacePathAt(expected.stateRoot, expected.actor));
}
export function isSubmitStagingPathFor(value: unknown, expected: { stateRoot: string; operationId: string }): boolean {
  return matches(value, () => submitStagingPathAt(expected.stateRoot, expected.operationId));
}
export function isSubmitBundlePathFor(value: unknown, expected: { stateRoot: string; operationId: string }): boolean {
  return matches(value, () => submitBundlePathAt(expected.stateRoot, expected.operationId));
}
export function isContextStagingPathFor(value: unknown, expected: { stateRoot: string; operationId: string }): boolean {
  return matches(value, () => contextStagingPathAt(expected.stateRoot, expected.operationId));
}
export function isMailObjectPathFor(value: unknown, expected: { stateRoot: string; messageId: string }): boolean {
  return matches(value, () => mailObjectPathAt(expected.stateRoot, expected.messageId));
}
export function isMailArchivePathFor(value: unknown, expected: { stateRoot: string; messageId: string }): boolean {
  return matches(value, () => mailArchivePathAt(expected.stateRoot, expected.messageId));
}
export function isActorSocketPathFor(value: unknown, expected: { runRoot: string; actor: string; incarnation: number }): boolean {
  return matches(value, () => actorSocketPathAt(expected.runRoot, expected.actor, expected.incarnation));
}
