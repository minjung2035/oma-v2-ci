import type { NewAgent, NewOperation } from "@oma/contracts/ledger";
/** Capabilities of the one ledger owner, independent of its SQLite composition.
 * Signatures reuse decoded reads and existing write inputs; no second repository.
 */
import type { Actor, MessageId, OperationId, RequestKey } from "@oma/contracts/identity";
import type { ErrorCode } from "@oma/contracts/errors";
import type { OperationPlan } from "@oma/contracts/durable";
import type { LedgerReader } from "./ledger-reader.js";
import type { AgentRow, BatchRow } from "@oma/contracts/ledger";
import type { DecodedOperation, OperationOf } from "@oma/protocol/operation-codec";
import type { LedgerTransitions } from "./transitions.js";



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
  markMaterialized: LedgerTransitions["markMaterialized"];
  markAcknowledged(message: MessageId, recipient: Actor): void;
  insertPreparedBatch: LedgerTransitions["insertPreparedBatch"];
  linkDeliveriesToBatch: LedgerTransitions["linkDeliveriesToBatch"];
  completeBatch: LedgerTransitions["completeBatch"];
}
