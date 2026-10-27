import type { PreacceptArtifactOwner } from "@oma/contracts/files";
import type { Actor, MessageId, OperationId, RequestKey } from "@oma/contracts/identity";
import type { AgentRow, BatchRow, DeliveryRow, NewOperation } from "@oma/contracts/ledger";
import type { SynchronousResult } from "@oma/contracts/durable";
import type { DecodedOperation } from "@oma/protocol/operation-codec";
import type { PreparedBatch, MessagePlan, CheckedReceipt, PublicationEvidence } from "@oma/contracts";
import type { ImmutableObservation } from "@oma/contracts/files";
import type { OperationOf } from "@oma/protocol/operation-codec";
import type { BatchViewLimits } from "@oma/protocol/batch-view";
import type { StoreError } from "@oma/domain/errors";


/** Mail owns the capabilities its use cases need. No concrete ledger or SQL API. */

export interface MailOperationReader {
  getOperationById(id: OperationId): DecodedOperation | null;
}
export interface MailRoutingReader {
  listAgents(): readonly { readonly name: Actor; readonly role: AgentRow["role"]; readonly desired: AgentRow["desired"] }[];
  subscribers(topic: string): readonly Actor[];
}
/** Every method is a closure over the original synchronous root transaction. */
export interface MailTransaction {
  acceptOperation(input: NewOperation): "inserted" | "retry";
  insertDeliveries(input: readonly { messageId: MessageId; recipient: Actor; operationId: OperationId }[]): void;
  setOperationSucceeded(id: OperationId, resultJson: string): void;
  markMaterialized(messageId: MessageId, recipient: Actor): void;
  insertPreparedBatch(input: { id: string; agent: Actor; incarnation: number; messageIds: MessageId[]; sessionPath: string | null }): void;
  linkDeliveriesToBatch(id: string, messages: MessageId[]): void;
  completeBatch(id: string, messages: MessageId[], actor: Actor, incarnation: number, sessionPath: string): void;
}
export interface MailLedger extends MailOperationReader, MailRoutingReader {
  getAgent(actor: Actor): AgentRow | null;
  societyOpen(): boolean;
  claimKey(actor: Actor, key: RequestKey, hash: string): "retry" | "reused" | "absent";
  retriedOperation(actor: Actor, key: RequestKey): DecodedOperation;
  getOperation(actor: Actor, key: RequestKey): DecodedOperation | null;
  recoverableOperations(): OperationId[];
  deliveriesForOperation(id: OperationId): DeliveryRow[];
  getDelivery(id: MessageId, actor: Actor): DeliveryRow | null;
  pendingDeliveryRows(actor: Actor): IterableIterator<DeliveryRow>;
  getBatch(id: string): BatchRow | null;
  preparedBatches(actor: Actor): BatchRow[];
  transaction<T>(body: (tx: MailTransaction) => SynchronousResult<T>): T;
}

export interface MailPreacceptScope {
  register(registration: {
    readonly operationId: string;
    readonly resource: string;
    readonly owner: PreacceptArtifactOwner;
    readonly observe: () => "unaccepted-known" | "accepted-referenced" | "accepted-unreferenced";
  }): void;
  settle(): void;
  settleFailure(primary: unknown): never;
}
export type MailMessageBytes = Pick<MessagePlan, "id" | "sha256" | "bytes">;
/** Held until all publication, arrival and flush decisions of one use end. */
export interface MailInbox {
  observeInboxMessage(folder: "new" | "cur", message: MailMessageBytes): ImmutableObservation;
  publishInboxMessage(folder: "new" | "cur", message: MailMessageBytes): void;
  moveNewToCur(id: MessageId): void;
  removeNew(id: MessageId): void;
  flushNew(): void;
  flushCur(): void;
  appendMailArrival(id: MessageId): void;
  close(): void;
}
export type MailReceiptDecision =
  | { readonly action: "settle"; readonly receipt: CheckedReceipt }
  | { readonly action: "present"; readonly missing: "receipt" | "receipt-directory" }
  | { readonly action: "hold"; readonly error: StoreError };
/** Four actual observers remain the sole issuers/consumers of parent proofs. */
export interface MailPublicationAuthority {
  consumeIntegration(proof: PublicationEvidence | undefined, operation: OperationOf<"git.integrate">): void;
  consumeSubmission(proof: PublicationEvidence | undefined, operation: OperationOf<"git.submit">): void;
  consumeContext(proof: PublicationEvidence | undefined, operation: OperationOf<"context.publish">): void;
  consumeCreation(proof: PublicationEvidence | undefined, operation: OperationOf<"agent.create">): void;
}
export interface MailRecoveryEffects {
  readMessage(message: MailMessageBytes): Buffer;
  observeArchive(message: MessagePlan): ImmutableObservation;
}
export interface MailEffects extends MailRecoveryEffects {
  nextOperationId(): OperationId;
  nextBatchId(): string;
  newPreacceptScope(): MailPreacceptScope;
  freezeMailObject(id: MessageId, text: string, sha256: string): PreacceptArtifactOwner;
  publishMailArchive(message: MessagePlan): void;
  openInbox(actor: Actor): MailInbox;
  readReceipt(batch: PreparedBatch, frameBytes: number): CheckedReceipt;
  receiptDecision(batch: PreparedBatch, frameBytes: number, attempts: { readonly first: number; readonly last: number }): MailReceiptDecision;
  publishBatchView(batch: PreparedBatch, limits: BatchViewLimits | undefined,
    info: (id: MessageId) => { readonly review: MessagePlan["review"]; readonly displayPath: string } | null): void;
  readonly publication: MailPublicationAuthority;
}
