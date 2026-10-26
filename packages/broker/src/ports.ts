/** Broker-owned capabilities. No Store or feature implementor types. */
import type {
  Actor, AuthContext, Failure, ProtocolLimits, PublicMethods, RequestKey, AgentCreateInput,
  Oid, MessageId, MailInput, Receipt, Json, AgentStatus, PreparedBatch, BoundaryEvidence,
  ExecutionObservation, RunLease,
} from "@oma/contracts";
import type { AgentRow, BatchRow } from "@oma/contracts/ledger";
import type { SynchronousResult } from "@oma/contracts/durable";
import type { StatusSnapshot, RunnerObservation, SettlementQuiescence, RecoveryCounts } from "@oma/contracts/runtime";
import type { RawDescriptor, ConnectionSpool } from "@oma/contracts/files";
import type { SettlementOutcome } from "@oma/domain/batch-settlement";
import type { AdmissionGate } from "@oma/domain/admission";
import type { ConnectionPeerPin } from "./peer-pin.js";
import type { Duplex } from "node:stream";
import type { RpcSocket } from "./connection.js";
export interface PeerIdentity { readonly pid: number; readonly uid: number; readonly gid: number }
export interface PinnedPeerIdentity extends PeerIdentity {
  /** OS-specific identity equality over freshly received kernel facts. */
  sameSender(sender: unknown): boolean;
  alive(): boolean;
  close(): void;
}
export type BoundPeer = PeerIdentity & ConnectionPeerPin & {
  sameSender(sender: unknown): boolean;
  /** Issued by the direct spawn owner, never decoded from a request. */
  readonly inheritedRunner?: { readonly actor: Actor; readonly invocationId: string };
};

export interface PublicAgentView {
  readonly name: Actor;
  readonly incarnation: number;
  readonly desired: AgentStatus["desired"];
  readonly specJson: string;
}
export interface PublicStorePort {
  readonly listAgents: () => readonly { readonly name: Actor }[];
  readonly getAgent: (actor: Actor) => PublicAgentView | null;
  readonly getReceipt: (actor: Actor, key: RequestKey) => Receipt | null;
  readonly hasOperation: (actor: Actor, key: RequestKey) => boolean;
}
export interface PublicMailPort {
  readonly send: (auth: AuthContext, key: RequestKey, input: MailInput, requestContext?: { kind: "mail.send" | "agent.continue"; params: Json }) => Promise<Receipt>;
}
export interface PublicUnitsPort {
  /** WP23: the broker's shared diagnostic refresh; never authority. */
  readonly statusSnapshot: () => Promise<StatusSnapshot>;
}
export interface PublicViewsPort {
  readonly status: (agent: Actor | undefined, snapshot: StatusSnapshot) => AgentStatus[];
}
export interface PublicLifecyclePort {
  readonly setSociety?: (auth: AuthContext, state: "open" | "closed", key: RequestKey) => Receipt | Promise<Receipt>;
  readonly create: (auth: AuthContext, input: AgentCreateInput, key: RequestKey) => Promise<Receipt>;
  readonly start: (auth: AuthContext, agent: Actor, key: RequestKey) => Receipt | Promise<Receipt>;
  readonly stop: (auth: AuthContext, agent: Actor, key: RequestKey) => Receipt | Promise<Receipt>;
  readonly ack: (auth: AuthContext, message: MessageId, key: RequestKey) => Receipt;
  readonly follow: (auth: AuthContext, topic: string, subscribe: boolean, key: RequestKey) => Receipt;
}
export interface PublicReviewPort {
  record(auth: AuthContext, key: RequestKey, input: PublicMethods["attest.record"]["params"]): Promise<Receipt>;
  status(auth: AuthContext, name: string | undefined, frameBytes: number, responseId: string): PublicMethods["review.status"]["result"];
}
export interface PublicGitPort {
  readonly knownRefs: () => { main: string; published: string[] };
  readonly isPublished: (oid: Oid) => boolean;
  readonly submit: (auth: AuthContext, key: RequestKey, input: PublicMethods["git.submit"]["params"], bytes: AsyncIterable<Uint8Array>) => Promise<Receipt>;
  readonly integrate: (auth: AuthContext, key: RequestKey, input: PublicMethods["git.integrate"]["params"]) => Promise<Receipt>;
  readonly publishContext: (auth: AuthContext, key: RequestKey, input: PublicMethods["context.publish"]["params"], bytes: AsyncIterable<Uint8Array>) => Promise<Receipt>;
}
export interface PublicDispatchDependencies {
  readonly store: PublicStorePort;
  readonly mail: PublicMailPort;
  readonly units: PublicUnitsPort;
  readonly views: PublicViewsPort;
  readonly lifecycle: PublicLifecyclePort;
  readonly git: PublicGitPort | null;
  readonly review: PublicReviewPort | null;
  readonly limits: ProtocolLimits;
  waitRun(auth: AuthContext, observe: boolean): boolean;
  isDraining(): boolean;
  assertAdmission(): void;
  /** D04: refuses what the category would consume beyond the logical limits. */
  failureAnswer(id: string, error: unknown): object;
  refreshViews(): void;
  readLogs(agent: string, sinceSeconds: number): Promise<{ text: string; truncated: boolean; observedAtMs: number }>;
}
export interface InternalStorePort {
  readonly getAgentIdentity: (
    actor: Actor,
  ) => { readonly incarnation: number } | null;
  readonly pendingDeliveryCount: (agent: Actor) => number;
  readonly getBatchAgent: (id: string) => Actor | null;
  readonly preparedBatchIds: (agent: Actor) => readonly string[];
}
export interface InternalMailPort {
  readonly prepare: (auth: AuthContext) => Promise<PreparedBatch | null>;
  readonly complete: (
    auth: AuthContext,
    evidence: BoundaryEvidence,
  ) => Promise<void>;
  readonly moveToCur: (agent: Actor, ids: readonly string[]) => number;
}
export interface InternalPeerPort {
  readonly requireRunnerPeer: (
    peer: BoundPeer,
    agent: Actor,
    invocationId?: string,
  ) => void;
  readonly runnerActor: (peer: BoundPeer) => Actor;
  readonly runnerAuth: (
    agent: Actor,
    incarnation: number,
    peer: BoundPeer,
  ) => AuthContext;
}
export interface InternalDispatchDependencies {
  readonly store: InternalStorePort;
  readonly mail: InternalMailPort;
  readonly peers: InternalPeerPort;
  isDraining(): boolean;
  assertAdmission(): void;
  /** D04: refuses what the category would consume beyond the logical limits. */
  failureAnswer(id: string, error: unknown): object;
  refreshViews(): void;
  openRun(actor: Actor, invocationId: string): Promise<RunLease>;
}
/** What admitting an internal method needs from the broker. */
export type InternalAdmission = Pick<InternalDispatchDependencies, "isDraining" | "assertAdmission">;

export type PublicDispatchPorts = Pick<PublicDispatchDependencies,
  "store" | "mail" | "units" | "views" | "lifecycle" | "git" | "review" | "limits">;
export type InternalDispatchDataPorts = Pick<InternalDispatchDependencies,
  "store" | "mail">;
export interface BrokerTransaction { updateIncarnation(actor: Actor, incarnation: number): void }
export interface BrokerLedger {
  agentNames(): Actor[];
  getAgent(actor: Actor): AgentRow | null;
  listAgents(): AgentRow[];
  preparedBatches(actor: Actor): BatchRow[];
  societyOpen(): boolean;
  transaction<T>(body: (tx: BrokerTransaction) => SynchronousResult<T>): T;
}
export interface BrokerMail {
  prepare(auth: AuthContext): Promise<PreparedBatch | null>;
  complete(auth: AuthContext, evidence: BoundaryEvidence): Promise<void>;
  settleFromReceipt(quiescence: SettlementQuiescence, batch: string): SettlementOutcome;
}
export interface BrokerUnits {
  observe(actor: Actor): ExecutionObservation;
  scopeRoot(actor: Actor): { readonly pid: number; readonly startTime: string } | null;
  runnerAlive(actor: Actor): boolean;
  readLogs(actor: Actor, sinceSeconds: number, limit: number): Promise<{ text: string; truncated: boolean; observedAtMs: number }>;
  bindRunRevoker(revoke: (actor: Actor) => void): void;
}
export interface BrokerViews {
  refreshWorld(): void;
  publishStatus(snapshot: StatusSnapshot): void;
  observeRunnerSource(read: (actor: Actor) => RunnerObservation | null): void;
}
export interface BrokerReconcile { sweep(): Promise<RecoveryCounts> }
export interface BrokerStatusRefresh { request(): Promise<StatusSnapshot> }
/** Endpoint mechanics supplied by an OS adapter. Readiness and close are
 * observed separately from the Broker's authority and durable lifetime. */
export interface BrokerListener {
  once(event: "listening", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  listen(path: string): unknown;
  /** Callback confirms the listener is closed or never acquired. A thrown
   * close is unanswered; it must not release the Broker's durable owners. */
  close(callback?: () => void): unknown;
}
export interface BrokerEffects {
  pinPeer(socket: Duplex): PinnedPeerIdentity | null;
  assertEndpoint(path: string): void;
  openListener(serve: (socket: Duplex) => void, maxConnections?: number): { readonly listener: BrokerListener; prepare(): void };
  peerStream(socket: Duplex, authorizeSender: (sender: unknown) => boolean): RpcSocket;
  bindAdmission(gate: AdmissionGate): void;
  ensureRunRoot(): void;
  ensureActorDirectory(actor: Actor, incarnation: number): void;
  prepareEndpoint(path: string): void;
  removeStatusView(): void;
  makeSpool(descriptor: RawDescriptor): ConnectionSpool;
  closeLedger(): void;
}
export interface BrokerDependencies {
  readonly acquireRunScope: (scope: string) => import("@oma/contracts/runtime").ExecutionScopePin;
  readonly ledger: BrokerLedger;
  readonly mail: BrokerMail;
  readonly units: BrokerUnits;
  readonly views: BrokerViews;
  readonly reconcile: BrokerReconcile | null;
  readonly status: BrokerStatusRefresh;
  readonly public: PublicDispatchPorts;
  readonly internal: InternalDispatchDataPorts;
  readonly effects: BrokerEffects;
}
