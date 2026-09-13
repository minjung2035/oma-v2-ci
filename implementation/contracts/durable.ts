/** TS-001: durable contract owner. Declarations only; wire/persisted v1 unchanged. */
import type { Failure } from "./errors.js";
import type { ResolvedAgentSpec } from "./host.js";
import type { Actor, Address, MessageId, Oid, OperationId } from "./identity.js";
import type { ContextEntry, ExactCandidateIdentity, MailInput } from "./values.js";

export type OperationResult =
  | { kind: 'mail.send' | 'agent.continue'; message: MessageId; recipientCount: number; archivePath: string }
  | { kind: 'mail.ack'; message: MessageId; acknowledged: true }
  | { kind: 'route.follow' | 'route.unfollow'; topic: string; subscribed: boolean }
  | { kind: 'agent.create' | 'agent.start' | 'agent.stop'; agent: Actor; desired: 'provisioning' | 'enabled' | 'stopped' | 'retired'; remainingOperations: OperationId[] }
  | { kind: 'git.submit'; candidate: Oid; publishedRef: string; message: MessageId; recipientCount: number }
  | { kind: 'git.integrate'; base: Oid; candidate: Oid; target: 'refs/heads/main'; policyRevision: string; changed: boolean }
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

/** MUST [DB-009]: plan_json is this closed union, not an arbitrary object bag. */
export interface MessagePlan {
  id: MessageId; objectPath: string; sha256: string; bytes: number; dateMs: number;
  to: Address[]; recipients: Actor[]; kind: MailInput['kind'];
  approvalFor?: ExactCandidateIdentity;
  contextRevision: Oid | null; replyHeaders: { replyTo: Address[]; inReplyTo: string | null; references: string[] };
}

export type OperationPlan =
  | { kind: 'mail.send' | 'agent.continue'; message: MessagePlan }
  | { kind: 'mail.ack'; recipient: Actor; message: MessageId }
  | { kind: 'route.follow' | 'route.unfollow'; topic: string; agent: Actor }
  | { kind: 'agent.create'; spec: ResolvedAgentSpec; specHash: string; parent: Actor;
      workspacePath: string; unitNames: string[]; initialMessage: MessagePlan | null;
      existingCreation: OperationId | null }
  | { kind: 'agent.start' | 'agent.stop'; agent: Actor; previousIncarnation: number;
      desired: 'enabled' | 'stopped'; remainingOperations: OperationId[] }
  | { kind: 'git.submit'; candidate: Oid; exportRef: string; prerequisites: Oid[];
      bundle: { path: string; sha256: string; bytes: number } | null;
      publishedRef: string; message: MessagePlan }
  | { kind: 'git.integrate'; repo: 'project'; target: 'refs/heads/main'; base: Oid;
      candidate: Oid; policyRevision: string; checkProfileDigest: string }
  | { kind: 'context.publish'; base: Oid | null; candidate: Oid;
      target: 'refs/heads/main'; entries: ContextEntry[]; stagingPath: string; message: MessagePlan };
