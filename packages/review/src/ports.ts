/** Review's live ledger projection and captured synchronous acceptance scope. */
import type { Actor, MessageId, MessagePlan, OperationId, RequestKey } from "@oma/contracts";
import type { AgentRow, NewOperation } from "@oma/contracts/ledger";
import type { SynchronousResult } from "@oma/contracts/durable";
import type { DecodedOperation } from "@oma/protocol/operation-codec";
import type { MailRoutingReader } from "@oma/mail/ports";
import type { ReviewAuthorityLedger } from "./authority.js";
import type { ReviewEmission } from "@oma/mail";
import type { PreacceptArtifactOwner } from "@oma/contracts/files";

export interface ReviewTransaction {
  acceptOperation(input: NewOperation): "inserted" | "retry";
  insertDeliveries(input: readonly { messageId: MessageId; recipient: Actor; operationId: OperationId }[]): void;
  setOperationSucceeded(id: OperationId, resultJson: string): void;
}
export interface ReviewLedger extends ReviewAuthorityLedger, MailRoutingReader {
  getAgent(actor: Actor): AgentRow | null;
  societyOpen(): boolean;
  claimKey(actor: Actor, key: RequestKey, hash: string): "retry" | "reused" | "absent";
  retriedOperation(actor: Actor, key: RequestKey): DecodedOperation;
  getOperationById(id: OperationId): DecodedOperation | null;
  recoverableOperations(): OperationId[];
  observeFailure(error: unknown): void;
  transaction<T>(body: (tx: ReviewTransaction) => SynchronousResult<T>): T;
}
export interface ReviewMail {
  freezeReviewMessage(id: OperationId, ordinal: number, sender: Actor, input: ReviewEmission):
    Promise<{ message: MessagePlan; artifact: PreacceptArtifactOwner }>;
  materialize(id: OperationId): Promise<void>;
}
