import type { PreacceptArtifactOwner } from "@oma/contracts/files";
import type { MailNotificationDraft } from "@oma/contracts/values";
/** Capabilities required by Git workflows. App composition retains concrete owners. */
import type { Actor, Address, MessageId, MessagePlan, OperationId, Oid, RequestKey } from "@oma/contracts";
import type { AgentRow, NewOperation } from "@oma/contracts/ledger";
import type { SynchronousResult } from "@oma/contracts/durable";
import type { ErrorCode } from "@oma/contracts/errors";
import type { PublicationEvidence } from "@oma/contracts/publication";
import type { DecodedOperation, OperationOf } from "@oma/protocol/operation-codec";
import type { ContextPublicationEvidence, SubmissionPublicationEvidence } from "@oma/contracts/publication";

export interface GitTransaction {
  acceptOperation(input: NewOperation): "inserted" | "retry";
  insertDeliveries(input: readonly { messageId: MessageId; recipient: Actor; operationId: OperationId }[]): void;
  setOperationSucceeded(id: OperationId, resultJson: string): void;
  setOperationFailed(id: OperationId, code: ErrorCode): void;
  setOperationUnknown(id: OperationId): void;
}
export interface GitLedger {
  readonly inTransaction: boolean;
  getAgent(actor: Actor): AgentRow | null;
  societyOpen(): boolean;
  claimKey(actor: Actor, key: RequestKey, hash: string): "retry" | "reused" | "absent";
  retriedOperation(actor: Actor, key: RequestKey): DecodedOperation;
  getOperationById(id: OperationId): DecodedOperation | null;
  recoverableOperations(): OperationId[];
  findSucceededContext(revision: Oid): OperationOf<"context.publish"> | null;
  submissions(): readonly OperationOf<"git.submit">[];
  transaction<T>(body: (tx: GitTransaction) => SynchronousResult<T>): T;
}
export interface GitMessaging {
  /** Validates live routing before rendering; T obtains its own current recipient snapshot. */
  freezeNotification(id: MessageId, sender: Actor, input: MailNotificationDraft): Promise<{ message: MessagePlan; artifact: PreacceptArtifactOwner }>;
  recipients(to: readonly Address[]): Actor[];
  frozenDisposition(id: OperationId, message: { readonly id: MessageId; readonly sha256: string }):
    "unaccepted-known" | "accepted-referenced" | "accepted-unreferenced";
  publishGated(id: OperationId, evidence: PublicationEvidence): Promise<void>;
}
/** Read-only current review decision, synchronous with the final CAS gate. */
export interface ReviewAuthority { assertApplicable(request: OperationId): void }

export interface SubmissionPublication {
  submission(operation: OperationOf<"git.submit">): SubmissionPublicationEvidence;
}
export interface ContextPublication {
  observe(operation: OperationOf<"context.publish">): ContextPublicationEvidence;
  hasNoopWitness(operation: OperationOf<"context.publish">): boolean;
  authorizeNoop(operation: OperationOf<"context.publish">): boolean;
}
