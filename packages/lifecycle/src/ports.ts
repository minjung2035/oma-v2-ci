/** Lifecycle owns its exact live reads, captured acceptance writes and external effects. */
import type { Actor, AuthContext, MessageId, MessagePlan, OperationId, RequestKey, ExecutionObservation } from "@oma/contracts";
import type { AgentRow, DeliveryRow, NewAgent, NewOperation } from "@oma/contracts/ledger";
import type { SynchronousResult } from "@oma/contracts/durable";
import type { ErrorCode } from "@oma/contracts/errors";
import type { PreacceptArtifactOwner } from "@oma/contracts/files";
import type { PublicationEvidence } from "@oma/contracts/publication";
import type { DecodedOperation, OperationOf, ValidatedPlan } from "@oma/protocol/operation-codec";
import type { MailPreacceptScope } from "@oma/mail/ports";

export interface LifecycleTransaction {
  acceptOperation(input: NewOperation): "inserted" | "retry";
  insertAgent(agent: NewAgent): void;
  updateAgent(agent: { name: Actor; desired?: AgentRow["desired"]; incarnation?: number }): void;
  insertDeliveries(input: readonly { messageId: MessageId; recipient: Actor; operationId: OperationId }[]): void;
  setOperationSucceeded(id: OperationId, resultJson: string): void;
  setOperationFailed(id: OperationId, code: ErrorCode): void;
  setOperationUnknown(id: OperationId): void;
  markAcknowledged(id: MessageId, recipient: Actor): void;
  follow(topic: string, actor: Actor): void;
  unfollow(topic: string, actor: Actor): void;
}
export interface LifecycleLedger {
  getAgent(actor: Actor): AgentRow | null;
  listAgents(): AgentRow[];
  societyOpen(): boolean;
  claimKey(actor: Actor, key: RequestKey, hash: string): "retry" | "reused" | "absent";
  retriedOperation(actor: Actor, key: RequestKey): DecodedOperation;
  getOperation(actor: Actor, key: RequestKey): DecodedOperation | null;
  getOperationById(id: OperationId): DecodedOperation | null;
  recoverableOperations(): OperationId[];
  findPhysicalCreate(actor: Actor, specHash: string): OperationOf<"agent.create"> | null;
  latestAgentAction(agent: Actor, actor?: Actor): OperationOf<"agent.start"> | OperationOf<"agent.stop"> | null;
  latestSocietyAction(): OperationOf<"society.set"> | null;
  getDelivery(id: MessageId, recipient: Actor): DeliveryRow | null;
  transaction<T>(body: (tx: LifecycleTransaction) => SynchronousResult<T>): T;
}
export interface LifecycleUnits {
  assertResidentNamesFree(agent: Actor): void;
  ensureResident(agent: Actor, profile: string, modelProfile: string): void;
  start(agent: Actor, explicitRepair: boolean, authorize?: () => void): void | Promise<void>;
  stop(agent: Actor, incarnation: number): ExecutionObservation | Promise<ExecutionObservation>;
  observe(agent: Actor): ExecutionObservation;
  confirmDead(agent: Actor, incarnation: number): boolean;
}
export interface LifecycleWorkspace {
  canonicalMain(): string;
  assertCanonicalBase(oid: string): void;
  ensure(plan: ValidatedPlan<"agent.create">, readinessProven: boolean): Promise<void>;
  /** Physical directory verification and Git observation only. Lifecycle compares the frozen base. */
  observeProvisioningHead(path: string): { readonly status: number | null; readonly stdout: string };
}
export interface LifecycleMail {
  freezeCreateInitial(auth: AuthContext, id: OperationId, recipient: Actor, brief: string):
    Promise<{ message: MessagePlan; artifact: PreacceptArtifactOwner }>;
  publishCreateInitial(message: MessagePlan): void;
  publishGated(id: OperationId, evidence: PublicationEvidence): Promise<void>;
}
export interface LifecycleEffects {
  nextOperationId(): OperationId;
  newPreacceptScope(): MailPreacceptScope;
  bootstrapPeer(): AuthContext["peer"];
  ensureAgentDirectories(actor: Actor): void;
}
