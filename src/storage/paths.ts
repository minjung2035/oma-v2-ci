/** FS-001..003: root binding only. Roots come from host composition, never an IPC path.
 * Lexical identity is NOT a symlink/FD-containment proof; secure filesystem effects
 * retain their own checks. Relative test roots retain their existing join semantics.
 */
import { join } from "node:path";
import {
  agentRootFor, workspaceFor, runnerViewFor, batchViewFor,
  mailObjectRelativePath, mailArchiveRelativePath, mailInboxRelativePath,
  submitStagingFor, submitBundleFor, contextStagingFor, contextRevisionFor,
  actorSocketDirectoryFor, actorSocketFor,
} from "../domain/derived.js";

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
export function mailObjectPathAt(stateRoot: string, messageId: string): string {
  return join(stateRoot, mailObjectRelativePath(messageId));
}
export function mailArchivePathAt(stateRoot: string, messageId: string): string {
  return join(stateRoot, mailArchiveRelativePath(messageId));
}
export function mailInboxPathAt(stateRoot: string, actor: string, messageId: string, folder: "new" | "cur"): string {
  return join(stateRoot, mailInboxRelativePath(actor, messageId, folder));
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
