/** Capabilities of the one ledger owner, independent of its SQLite composition.
 * Signatures reuse decoded reads and existing write inputs; no second repository.
 */
import type { Actor, MessageId, OperationId, RequestKey } from "../../implementation/contracts/identity.js";
import type { ErrorCode } from "../../implementation/contracts/errors.js";
import type { OperationPlan } from "../../implementation/contracts/durable.js";
import type { LedgerReader } from "./ledger-reader.js";
import type { AgentRow, BatchRow } from "./rows.js";
import type { DecodedOperation, OperationOf } from "./operation-codec.js";
import type { LedgerTransitions } from "./transitions.js";

export interface NewOperation {
  id: OperationId; actor: Actor; requestKey: RequestKey; requestHash: string;
  kind: OperationPlan["kind"]; payloadJson: string; planJson: string;
}
export interface NewAgent {
  name: Actor; specHash: string; role: "resident" | "principal"; desired: AgentRow["desired"];
  incarnation: number; profile: string; createdBy: string | null; specJson: string;
}
export interface StoreQueries {
  getOperation: LedgerReader["operation"];
  getOperationById: LedgerReader["operationById"];
  claimKey(actor: Actor, key: RequestKey, hash: string): "retry" | "reused" | "absent";
  retriedOperation(actor: Actor, key: RequestKey): DecodedOperation;
  recoverableOperations(): OperationId[];
  findPhysicalCreate: LedgerReader["physicalCreate"];
  findSucceededContext(candidate: string): OperationOf<"context.publish"> | null;
  latestAgentAction: LedgerReader["latestAction"];
  latestSocietyAction: LedgerReader["latestSocietyAction"];
  societyOpen(): boolean;
  submittedOperations: LedgerReader["submissions"];
  attestationFacts: LedgerReader["attestations"];
  getAgent: LedgerReader["agent"];
  listAgents: LedgerReader["agents"];
  subscribers(topic: string): string[];
  allSubscriptions: LedgerReader["subscriptions"];
  getDelivery: LedgerReader["delivery"];
  pendingDeliveries: LedgerReader["pendingDeliveries"];
  deliveriesForOperation: LedgerReader["operationDeliveries"];
  getBatch: LedgerReader["batch"];
  preparedBatches: LedgerReader["preparedBatches"];
  pendingBatchesFor(agent: Actor, incarnation: number): BatchRow[];
}
export interface StoreWrites {
  insertOperation(operation: NewOperation): void;
  claimOperation(operation: NewOperation): "inserted" | "retry";
  acceptOperation(operation: NewOperation): "inserted" | "retry";
  updateOperationPlanJson(id: OperationId, planJson: string): void;
  setOperationSucceeded(id: OperationId, resultJson: string): void;
  setOperationFailed(id: OperationId, code: ErrorCode): void;
  setOperationUnknown(id: OperationId): void;
  insertAgent(agent: NewAgent): void;
  updateAgent(agent: { name: string; desired?: AgentRow["desired"]; incarnation?: number }): void;
  follow: LedgerTransitions["follow"];
  unfollow(topic: string, agent: string): void;
  insertDeliveries: LedgerTransitions["insertDeliveries"];
  markMaterialized(message: MessageId, recipient: Actor): void;
  markAcknowledged(message: MessageId, recipient: Actor): void;
  insertPreparedBatch: LedgerTransitions["insertPreparedBatch"];
  linkDeliveriesToBatch: LedgerTransitions["linkDeliveriesToBatch"];
  completeBatch: LedgerTransitions["completeBatch"];
}
