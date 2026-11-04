/** TS-001: public-wire contract owner. Declarations only. IPC-008 adds receipt
 * chunks and explicit status continuation; durable v1 records are unchanged. */
import type { ExactCandidateIdentity, RiskTier } from "./values.js";
import type { AttestationInput } from "./attestation.js";
import type { MutationMethod, Receipt } from "./durable.js";
import type { ErrorCode, Failure } from "./errors.js";
import type { Actor, Address, MessageId, OperationId, Oid, RequestKey } from "./identity.js";
import type { AgentStatus } from "./runtime.js";
import type { AgentCreateInput, BlobDescriptor, ContextEntry, MailInput } from "./values.js";

/** mail-v1 §8: one request entry in a Worker-facing review status answer. */
export interface ReviewStatusEntry {
  index: number; sequence: number; actor: Actor;
  kind: "review" | "vote" | "cancel" | "refresh" | "challenge.open" | "review.withdraw" | "review.invalidate" | "review.adopt" | "review.retry" | "review.preparation-failed" | "review.revise" | "review.integration" | "review.supersede" | "review.included"; verdict?: "approve" | "reject";
}
export interface ReviewRequestSummary {
  name: string; kind: "merge" | "challenge"; tier: RiskTier; title: string;
  requester: Actor; display: string;
}
export interface ReviewMainObservation { oid: Oid | null; observedAtMs: number }
export interface ReviewReviewer {
  name: Actor; desired: AgentStatus["desired"] | null;
  exclusions: ("author" | "not-enabled" | "missing-mail-send" | "missing-agent")[];
  latestVote: "approve" | "reject" | null;
}
export interface CreationObservation {
  capability: boolean; childProfile: string | null; childHasMailSend: boolean | null; observedAtMs: number;
  /** Active resident capacity and current enabled resident count, excluding the Principal and provisioning/history. */
  maxWorkers: number | null; workerCount: number;
  error?: { code: ErrorCode; message: string };
}
export type ReviewStatusQuery =
  | { name: string; reviewerAfter?: Actor; kind?: never; after?: never }
  | { kind: "merge" | "challenge"; after?: string; name?: never; reviewerAfter?: never };
/** The Worker's full request detail. */
export interface ReviewRequestStatus {
  name: string; kind: "merge" | "challenge"; tier: RiskTier; title: string;
  reason: string; requester: Actor; identity: ExactCandidateIdentity;
  revision: number; scope: string | null; proposal: ExactCandidateIdentity; contextDiff?: import("./files.js").ReviewDiffArtifact;
  attemptNumber: number; diff?: import("./files.js").ReviewDiffArtifact;
  integrationPhase: string; notice: "none" | "pending" | "delivered";
  retryable: boolean; nextAction: string;
  display: string; required: number; approvers: Actor[]; rejectors: Actor[];
  normalRequired: number; maxWorkers: number; capacityFallback: boolean; principalRequired: boolean;
  observedAtMs: number; remainingApprovals: number; acceptingWorkerVotes: boolean;
  reviewers: { items: ReviewReviewer[]; next: Actor | null };
  principal: { approval: MessageId | null; sent: boolean; decision: "approve" | "reject" | null;
    /** The approval the latest Principal vote named, even after it lapsed. */
    decisionApproval: MessageId | null };
  integration: { operation: OperationId; state: "pending" | "succeeded" | "failed" | "unknown";
    error: ErrorCode | null } | null;
  entries: ReviewStatusEntry[]; missing: string[]; main: ReviewMainObservation;
  target?: { name: string; integration: OperationId; identity: ExactCandidateIdentity };
}
/** The Worker's list answer, newest first, bounded by the frame limit. */
export interface ReviewRequestList {
  requests: ReviewRequestSummary[]; omitted: number; next: string | null; main: ReviewMainObservation;
}
/** What the Principal may see: only a request its approval mail named or one
 * already applied, and only these fields. */
export interface ReviewPrincipalStatus {
  revision: number; scope: string | null; proposal: ExactCandidateIdentity; contextDiff?: import("./files.js").ReviewDiffArtifact;
  observedAtMs?: number;
  integrationPhase: string; notice: "none" | "pending" | "delivered"; retryable: boolean; nextAction: string; attemptNumber: number;
  name: string; kind: "merge" | "challenge"; tier: RiskTier; title: string;
  identity: ExactCandidateIdentity; diff?: import("./files.js").ReviewDiffArtifact; approval: MessageId | null; display: string;
  target?: { name: string; integration: OperationId; identity: ExactCandidateIdentity };
}
export type ReviewStatusResult = ReviewRequestStatus | ReviewRequestList | ReviewPrincipalStatus;

/** Host linkage metadata, not an effect request or a model tool schema. */
export interface InvocationOrigin {
  readonly file: string;
  readonly session: string;
  readonly branch: string;
  readonly toolCall: string;
}
/** Original invocation completed without a new effect. The receipt belongs to
 * the explicitly referenced existing request, never to this invocation key. */
export interface InvocationResolution {
  readonly kind: "existing";
  readonly target: import("./identity.js").Json;
  readonly requestKey: RequestKey;
  readonly receipt: Receipt;
  readonly observedAtMs: number;
}
export type InvocationPreacceptReason = "INVALID_ARGUMENT" | "SOURCE_UNREADABLE" | "SOURCE_CHANGED" | "STALE_TARGET" |
  "WRONG_TARGET_KIND" | "CAPACITY_FULL" | "AUTHORITY_DENIED" | "GOAL_REVISION_CHANGED" | "NEEDS_OPERATOR";
/** The protected original owner closed this call before any completed freeze/send.
 * The diagnostic is not a receipt; it grants neither retries nor effect authority. */
export interface InvocationRejection {
  readonly proof: "protected-invocation-closed-before-send";
  readonly source: "caller-preparation" | "host-preflight";
  readonly reason: InvocationPreacceptReason;
  readonly failure: Failure;
  readonly observedAtMs: number;
}
/** A child publication is independently accepted; it is not the review receipt. */
export interface InvocationPublication {
  readonly key: RequestKey;
  readonly receipt: Receipt | null;
}
/** Bounded historical facts, never a fresh ref observation or execution authority. */
export interface InvocationMailObservation {
  readonly message: MessageId;
  readonly emlSha256: string;
  readonly bodySha256: string;
  readonly bodyBytes: number;
  readonly attachmentCount: number;
  readonly attachments: readonly { readonly commit: Oid; readonly objectFormat: "sha1" | "sha256";
    readonly publishedRef: string; readonly sourcePublication: OperationId | null; readonly sourcePublicationOrdinal?: number; readonly reachableFrom?: Oid;
    readonly publication: "canonical-before-acceptance" | "shared-before-acceptance" | "published-before-delivery" | "accepted-dependency" }[];
  readonly omittedAttachments: number;
  readonly delivery: { readonly recipientCount: number; readonly materialized: number; readonly presented: number };
  readonly source: "accepted-plan-and-delivery-facts; no fresh ref observation";
}
export interface InvocationLink {
  readonly key: RequestKey;
  readonly method: MutationMethod;
  readonly phase: "bound" | "frozen" | "sending" | "observed" | "resolved" | "rejected";
  readonly frozen: boolean;
  readonly resolution?: InvocationResolution;
  readonly rejection?: InvocationRejection;
  readonly publication?: InvocationPublication;
  readonly mail?: InvocationMailObservation;
}
export interface PublicMethods {
  "invocation.bind": { params: { contract: "collaboration-v1"; origin: InvocationOrigin; tool: string; arguments: import("./identity.js").Json }; result: InvocationLink };
  "invocation.prepare": { params: { contract: "collaboration-v1"; key: RequestKey } & (
    { params: import("./identity.js").Json; content?: BlobDescriptor; reject?: never } |
    { reject: Failure; params?: never; content?: never }); result: InvocationLink };
  "society.set": { params: { state: "open" | "closed" }; result: Receipt };
  "attest.record": { params: AttestationInput; result: Receipt };
  'mail.send': { params: MailInput; result: Receipt };
  'mail.ack': { params: { message: MessageId }; result: Receipt };
  'route.follow': { params: { topic: string }; result: Receipt };
  'route.unfollow': { params: { topic: string }; result: Receipt };
  'agent.create': { params: AgentCreateInput; result: Receipt };
  'agent.start': { params: { agent: Actor }; result: Receipt };
  'agent.stop': { params: { agent: Actor }; result: Receipt };
  'agent.continue': { params: { note: string }; result: Receipt };
  'agent.wait': { params: { observe?: true }; result: { accepted: boolean } };
  /** `prerequisites` is a bounded subset of the commits the broker holds --
   * main first, then published candidates, as many as one frame carries -- not
   * a complete list (G03-broker-02). A bundle built on any subset is complete,
   * only larger; `hasCandidate` is judged against all of them. */
  /** Reachability reads also recognize canonical-main and authenticated published-tip
   * ancestors. Omission preserves the legacy exact-tip query. */
  'git.known': { params: { candidate: Oid; reachable?: true }; result: { hasCandidate: boolean; prerequisites: Oid[] } };
  'git.submit': { params: { candidate: Oid; exportRef: string; prerequisites: Oid[]; to: Address[]; subject: string; body: string; paths: string[]; bundle?: BlobDescriptor }; result: Receipt };
  'git.integrate': { params: { candidate: Oid; expected: Oid; tier?: RiskTier }; result: Receipt };
  'context.publish': { params: { expected: Oid | null; entries: ContextEntry[]; content: BlobDescriptor; goalMail?: { subject: string } }; result: Receipt };
  'operation.get': { params: { key: RequestKey }; result: Receipt };
  /** Same actor/key, immutable bytes identified by sha256; a changed observation
   * refuses continuation rather than mixing pending and terminal receipts. */
  'operation.read': { params: { key: RequestKey; offset: number; sha256?: string }; result: { sha256: string; bytes: number; offset: number; data: string; next: number | null } };
  /** `next` is the exclusive agent-name cursor; absent means the page is complete.
   * Pages are live observations, not a multi-request registry snapshot. */
  'status.get': { params: { agent?: Actor; after?: Actor }; result: { observedAtMs: number; agents: AgentStatus[]; next?: Actor; creation: CreationObservation } };
  'logs.read': { params: { agent: Actor; sinceSeconds: number }; result: { text: string; truncated: boolean; observedAtMs: number } };
  /** mail-v1 §8: the read model over the review ledger. Workers see every
   * request; the Principal sees only a request its approval mail named (or an
   * applied one), and only the fields the approval flow already gave it. */
  'review.status': { params: ReviewStatusQuery; result: ReviewStatusResult };
}

export type PublicMethod = keyof PublicMethods;

export type ReadMethod = 'operation.get' | 'operation.read' | 'status.get' | 'logs.read' | 'git.known' | 'review.status';

export type EphemeralMethod = 'agent.wait' | 'invocation.bind' | 'invocation.prepare';

type RequestEnvelope<M extends PublicMethod> = {
  v: 1; id: string; method: M; params: PublicMethods[M]['params'];
};

export type MutationRequest<M extends MutationMethod = MutationMethod> =
  M extends MutationMethod ? RequestEnvelope<M> & { request: RequestKey } : never;

export type ReadRequest<M extends ReadMethod = ReadMethod> =
  M extends ReadMethod ? RequestEnvelope<M> & { request?: never } : never;

export type EphemeralRequest<M extends EphemeralMethod = EphemeralMethod> =
  M extends EphemeralMethod ? RequestEnvelope<M> & { request?: never } : never;

export type Request<M extends PublicMethod = PublicMethod> =
  M extends MutationMethod ? MutationRequest<M> :
  M extends ReadMethod ? ReadRequest<M> :
  M extends EphemeralMethod ? EphemeralRequest<M> : never;

export type Response<M extends PublicMethod = PublicMethod> = { v: 1; id: string; ok: true; result: PublicMethods[M]['result'] } |
  { v: 1; id: string; ok: false; error: Failure };
