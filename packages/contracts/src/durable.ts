/** TS-001: durable contract owner. Declarations only; current persisted plan intent (v3 writer and historical v2 reader owned by protocol). */
import type { RiskTier } from "./values.js";
import type { ReviewFact } from "./attestation.js";
import type { Failure } from "./errors.js";
import type { ResolvedAgentSpec } from "./host.js";
import type { Actor, Address, MessageId, Oid, OperationId } from "./identity.js";
import type { ContextEntry, ExactCandidateIdentity, MailInput } from "./values.js";

export type OperationResult =
  | { kind: "society.set"; state: "open" | "closed" }
  | { kind: "attest.record"; request: string; messages: MessageId[]; recipientCount: number }
  | { kind: 'mail.send' | 'agent.continue'; message: MessageId; recipientCount: number; archivePath: string }
  | { kind: 'mail.ack'; message: MessageId; acknowledged: true }
  | { kind: 'route.follow' | 'route.unfollow'; topic: string; subscribed: boolean }
  | { kind: 'agent.create' | 'agent.start' | 'agent.stop'; agent: Actor; desired: 'provisioning' | 'enabled' | 'stopped' | 'retired'; remainingOperations: OperationId[] }
  | { kind: 'git.submit'; candidate: Oid; publishedRef: string; message: MessageId; recipientCount: number }
  | { kind: 'git.integrate'; base: Oid; candidate: Oid; target: 'refs/heads/main'; policyRevision: string; changed: boolean; merge?: { name: string; notices: MessageId[]; recipientCount: number } }
  | { kind: 'context.publish'; previous: Oid | null; revision: Oid; message: MessageId; recipientCount: number };

export interface Receipt<T = OperationResult> {
  operation: OperationId;
  state: 'pending' | 'succeeded' | 'failed' | 'unknown';
  result?: T;
  error?: Failure;
  reason?: string;
}

/** MUST [IPC-004]: Durable mutations require an idempotency key.
 * Read and ephemeral requests forbid the top-level key; operation.get uses params.key.
 */
export type MutationMethod = OperationPlan['kind'];

/** MUST [DB-009]: plan_json carries this closed intent union inside the current envelope, not an arbitrary object bag. */
export interface MessagePlan {
  id: MessageId; objectPath: string; sha256: string; bytes: number; dateMs: number;
  to: Address[]; recipients: Actor[]; kind: MailInput['kind'];
  approvalFor?: ExactCandidateIdentity;
  /** Workers-only mail is published to S/mail/workers, never the public archive. */
  audience?: "workers";
  review?: ReviewMailMeta;
  contextRevision: Oid | null; replyHeaders: { replyTo: Address[]; inReplyTo: string | null; references: string[] };
}

/** Which review-system role a broker-owned message plays; the durable check
 * pins the allowed kind/addressing/audience per role. */
export type ReviewMailMeta =
  | { role: "thread"; request: OperationId; name: string; revision: number }
  | { role: "approval"; request: OperationId; name: string; votes: OperationId[] }
  | { role: "withdrawn"; request: OperationId; name: string; approval: MessageId }
  | { role: "decision"; request: OperationId; name: string; approval: MessageId }
  | { role: "notice"; request: OperationId; name: string; part: number; parts: number; sha256: string; bytes: number };

export type OperationPlan =
  | { kind: "society.set"; state: "open" | "closed" }
  | { kind: "attest.record"; fact: ReviewFact; messages: MessagePlan[] }
  | { kind: 'mail.send' | 'agent.continue'; message: MessagePlan }
  | { kind: 'mail.ack'; recipient: Actor; message: MessageId }
  | { kind: 'route.follow' | 'route.unfollow'; topic: string; agent: Actor }
  | ({ kind: 'agent.create'; spec: ResolvedAgentSpec; specHash: string; parent: Actor;
      workspacePath: string; initialMessage: MessagePlan | null; existingCreation: OperationId | null } &
      ({ execution: 'native' } | { unitNames: string[] }))
  | { kind: 'agent.start' | 'agent.stop'; agent: Actor; previousIncarnation: number;
      desired: 'enabled' | 'stopped'; remainingOperations: OperationId[] }
  | { kind: 'git.submit'; candidate: Oid; exportRef: string; prerequisites: Oid[];
      bundle: { path: string; sha256: string; bytes: number } | null;
      publishedRef: string; message: MessagePlan }
  | { kind: 'git.integrate'; repo: 'project'; target: 'refs/heads/main'; base: Oid;
      candidate: Oid; policyRevision: string; checkProfileDigest: string; policyIdentity: string; noopRef: string | null;
      merge?: { version: 1; request: OperationId; name: string; tier: RiskTier; notice: MessagePlan[] } }
  | { kind: 'context.publish'; base: Oid | null; candidate: Oid;
      target: 'refs/heads/main'; entries: ContextEntry[]; stagingPath: string; message: MessagePlan; goalMail?: { subject: string }; noopRef: string | null };

/** Receipt-facing lookup only. Raw rows, JSON audit bytes and decoder brands stay private. */
export type OperationLookup = { readonly id: OperationId; readonly kind: MutationMethod } & (
  | { readonly state: "pending" | "unknown"; readonly result: null; readonly errorCode: null }
  | { readonly state: "succeeded"; readonly result: OperationResult; readonly errorCode: null }
  | { readonly state: "failed"; readonly result: null; readonly errorCode: Failure["code"] }
);
export type SynchronousResult<T> = T & (Extract<T, PromiseLike<unknown>> extends never ? unknown : never);

