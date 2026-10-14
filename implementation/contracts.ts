/** TS-001: compatibility/spec facade. Concept owners remain normative declarations.
 * This file adds no runtime dependency, adapter implementation, or wire/DB version.
 * See contracts/README.md for dependency direction and compatibility checks.
 */
export type { Actor, Oid, OperationId, MessageId, BatchId, RequestKey, Json, Address, Capability } from "./contracts/identity.js";
export type { ErrorCode, Failure } from "./contracts/errors.js";
export type { BlobDescriptor, GitReference, RiskTier, ExactCandidateIdentity, MailInput, AgentCreateInput, ContextEntry } from "./contracts/values.js";
export type { OperationResult, Receipt, MutationMethod, MessagePlan, OperationPlan } from "./contracts/durable.js";
export type { AuthContext, AgentStatus, PreparedBatch, BoundaryEvidence, RunLease, UnitObservation, SandboxPlan } from "./contracts/runtime.js";
export type { ResolvedAgentSpec, ResourceLimits, ProtocolLimits, EffortLevel, ModelProfile, AgentProfile, HostConfigV1, HostEgressConfig } from "./contracts/host.js";
export type { PublicMethods, PublicMethod, ReadMethod, EphemeralMethod, MutationRequest, ReadRequest, EphemeralRequest, Request, Response } from "./contracts/public-wire.js";
export type { InternalMethods, InternalResults, InternalRequest, InternalResponse, Notification } from "./contracts/internal-wire.js";
export type { Store, OperationReceiptPort, UnitsModule, SandboxModule, ViewsModule, ReconcileModule, RunnerModule } from "./contracts/module-contracts.js";
