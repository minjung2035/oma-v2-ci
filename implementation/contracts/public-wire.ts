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
  kind: "review" | "vote" | "cancel" | "refresh" | "challenge.open"; verdict?: "approve" | "reject";
}
export interface ReviewRequestSummary {
  name: string; kind: "merge" | "challenge"; tier: RiskTier; title: string;
  requester: Actor; display: string;
}
export interface ReviewMainObservation { oid: Oid | null; observedAtMs: number }
/** The Worker's full request detail. */
export interface ReviewRequestStatus {
  name: string; kind: "merge" | "challenge"; tier: RiskTier; title: string;
  reason: string; requester: Actor; identity: ExactCandidateIdentity;
  display: string; required: number; approvers: Actor[]; rejectors: Actor[];
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
  requests: ReviewRequestSummary[]; omitted: number; main: ReviewMainObservation;
}
/** What the Principal may see: only a request its approval mail named or one
 * already applied, and only these fields. */
export interface ReviewPrincipalStatus {
  name: string; kind: "merge" | "challenge"; tier: RiskTier; title: string;
  identity: ExactCandidateIdentity; approval: MessageId | null; display: string;
  target?: { name: string; integration: OperationId; identity: ExactCandidateIdentity };
}
export type ReviewStatusResult = ReviewRequestStatus | ReviewRequestList | ReviewPrincipalStatus;

export interface PublicMethods {
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
  'git.known': { params: { candidate: Oid }; result: { hasCandidate: boolean; prerequisites: Oid[] } };
  'git.submit': { params: { candidate: Oid; exportRef: string; prerequisites: Oid[]; to: Address[]; subject: string; body: string; paths: string[]; bundle?: BlobDescriptor }; result: Receipt };
  'git.integrate': { params: { candidate: Oid; expected: Oid; tier?: RiskTier }; result: Receipt };
  'context.publish': { params: { expected: Oid | null; entries: ContextEntry[]; content: BlobDescriptor; goalMail?: { subject: string } }; result: Receipt };
  'operation.get': { params: { key: RequestKey }; result: Receipt };
  /** Same actor/key, immutable bytes identified by sha256; a changed observation
   * refuses continuation rather than mixing pending and terminal receipts. */
  'operation.read': { params: { key: RequestKey; offset: number; sha256?: string }; result: { sha256: string; bytes: number; offset: number; data: string; next: number | null } };
  /** `next` is the exclusive agent-name cursor; absent means the page is complete.
   * Pages are live observations, not a multi-request registry snapshot. */
  'status.get': { params: { agent?: Actor; after?: Actor }; result: { observedAtMs: number; agents: AgentStatus[]; next?: Actor } };
  'logs.read': { params: { agent: Actor; sinceSeconds: number }; result: { text: string; truncated: boolean; observedAtMs: number } };
  /** mail-v1 §8: the read model over the review ledger. Workers see every
   * request; the Principal sees only a request its approval mail named (or an
   * applied one), and only the fields the approval flow already gave it. */
  'review.status': { params: { name?: string }; result: ReviewStatusResult };
}

export type PublicMethod = keyof PublicMethods;

export type ReadMethod = 'operation.get' | 'operation.read' | 'status.get' | 'logs.read' | 'git.known' | 'review.status';

export type EphemeralMethod = 'agent.wait';

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
