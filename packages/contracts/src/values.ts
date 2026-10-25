/** TS-001: values contract owner. Declarations only; wire/persisted v1 unchanged. */
import type { Actor, Address, MessageId, Oid } from "./identity.js";

export interface BlobDescriptor { bytes: number; sha256: string; mediaType: 'text/plain; charset=utf-8' | 'application/x-git-bundle' | 'application/vnd.oma.context-v1' | 'application/vnd.oma.provider-v1' }

export interface GitReference { repo: 'project' | 'context'; oid: Oid; path?: string }

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ExactCandidateIdentity {
  repo: 'project'; targetRef: 'refs/heads/main';
  expectedBase: Oid; candidate: Oid; policyRevision: string;
}

export interface MailInput {
  to: Address[]; subject: string; kind: 'message' | 'question' | 'result' | 'alert' | 'context' | 'approval_required' | 'critical';
  body: string; replyToMessage?: MessageId; refs?: GitReference[];
  approvalFor?: ExactCandidateIdentity;
}
/** Logical notification content exchanged by workflows and the Mail renderer. */
export interface MailNotificationDraft {
  readonly to: readonly Address[];
  readonly kind: "result" | "context";
  readonly contextRevision: Oid | null;
  readonly subject: string;
  readonly body: string;
}

/** MUST [CREATE-001]: Actor input only; forbidden properties also reject
 * structurally compatible variables carrying broker-resolved authority.
 */
export interface AgentCreateInput {
  name: Actor; from: Oid; brief: string;
  profile?: never; capabilities?: never;
}

export interface ContextEntry { path: string; bytes: number; sha256: string }
