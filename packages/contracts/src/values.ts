/** TS-001: values contract owner. Declarations only; wire/persisted v1 unchanged. */
import type { Actor, Address, MessageId, OperationId, Oid } from "./identity.js";

export interface BlobDescriptor { bytes: number; sha256: string; mediaType: 'text/plain; charset=utf-8' | 'application/x-git-bundle' | 'application/vnd.oma.context-v1' | 'application/vnd.oma.provider-v1' | 'application/vnd.oma.attachments-v1' }

export interface GitReference { repo: 'project' | 'context'; oid: Oid; path?: string }

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ExactCandidateIdentity {
  repo: 'project'; targetRef: 'refs/heads/main';
  expectedBase: Oid; candidate: Oid; policyRevision: string;
}

export interface MailRootFreeze { readonly version: "mail-root-v1"; readonly operation: OperationId; readonly dateMs: number }
/** A shared commit and its observed reachability anchor. Null publication is
 * canonical-main reachability, not a fabricated accepted publication. */
export interface SharedCommitReference {
  readonly commit: Oid;
  readonly objectFormat: "sha1" | "sha256";
  readonly publication: OperationId | null;
  readonly publishedRef: string;
  readonly publicationOrdinal?: number;
  readonly reachableFrom?: Oid;
}
export interface AttachmentUpload {
  readonly exportRef: string;
  readonly prerequisites: readonly Oid[];
  readonly bundle: BlobDescriptor;
}
/** Private stage belongs to the accepted mail root, not a standalone submit call. */
export interface MailAttachmentSource extends SharedCommitReference {
  readonly local?: { readonly dependency: OperationId; readonly exportRef: string;
    readonly prerequisites: readonly Oid[]; readonly bundle: { readonly path: string; readonly bytes: number; readonly sha256: string } };
}
export interface MailAttachmentPlan {
  readonly version: "collaboration-v1";
  readonly freeze?: MailRootFreeze;
  readonly observedAtMs: number;
  readonly sources: readonly MailAttachmentSource[];
}

export interface MailInput {
  to: Address[]; subject: string; kind: 'message' | 'question' | 'result' | 'alert' | 'context' | 'approval_required' | 'critical';
  body: string; replyToMessage?: MessageId; refs?: GitReference[];
  approvalFor?: ExactCandidateIdentity;
  content?: BlobDescriptor;
  collaboration?: { version: "collaboration-v1"; freeze?: MailRootFreeze; resolutions: Oid[]; attachments: { commit: Oid; objectFormat: "sha1" | "sha256"; stage?: AttachmentUpload }[] };
}
/** Logical notification content exchanged by workflows and the Mail renderer. */
export interface MailNotificationDraft {
  readonly to: readonly Address[];
  readonly kind: "result" | "context";
  readonly contextRevision: Oid | null;
  readonly subject: string;
  readonly body: string;
}

export interface CreateRootFreeze { readonly version: "create-root-v1"; readonly operation: OperationId; readonly dateMs: number }
/** Protected original-call expectation, not a delegable capability or accepted fact. */
export interface CreateResolution { readonly specHash: string; readonly policyRevision: string }
export interface CreateSourcePlan {
  readonly version: "collaboration-v1"; readonly freeze: CreateRootFreeze; readonly observedAtMs: number;
  readonly publication?: MailAttachmentSource;
}
/** MUST [CREATE-001]: Actor input only; forbidden properties also reject
 * structurally compatible variables carrying broker-resolved authority.
 */
export interface AgentCreateInput {
  name: Actor; from: Oid; brief: string;
  content?: BlobDescriptor;
  collaboration?: { version: "collaboration-v1"; freeze: CreateRootFreeze; stage?: { exportRef: string; prerequisites: Oid[] } };
  profile?: never; capabilities?: never;
}

export interface ContextEntry { path: string; bytes: number; sha256: string }
