/** MUST [TS-001]: Contract declarations only; not an executable implementation.
 * MUST: Validate external values at runtime; TypeScript casts are not validation.
 * SPIKE-dependent adapters MUST NOT be shipped as a guessed implementation.
 */
export type Actor = string;
export type Oid = string;
export type OperationId = string;
export type MessageId = string;
export type BatchId = string;
export type RequestKey = string;
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Address = Actor | `topic/${string}`;
export type Capability = 'mail.send' | 'route.follow' | 'agent.create' |
  'agent.manage.self' | 'agent.manage.descendants' | 'git.submit' |
  'code.integrate' | 'context.publish';
export type ErrorCode =
  | 'INVALID_REQUEST' | 'UNSUPPORTED_VERSION' | 'UNKNOWN_METHOD' | 'FRAME_TOO_LARGE'
  | 'STREAM_INVALID' | 'AUTH_FAILED' | 'STALE_RUN' | 'CAPABILITY_DENIED'
  | 'REQUEST_KEY_REUSED' | 'REQUEST_NOT_FOUND' | 'ADDRESS_NOT_FOUND'
  | 'AGENT_CONFLICT' | 'AGENT_NOT_READY' | 'AGENT_RETIRED' | 'GOAL_REQUIRED'
  | 'LIMIT_EXCEEDED' | 'STORAGE_FULL' | 'DB_BUSY' | 'STORE_CORRUPT'
  | 'BROKER_UNAVAILABLE' | 'DEADLINE_EXCEEDED' | 'RUN_TERMINATION_UNKNOWN'
  | 'START_LIMIT' | 'PRINCIPAL_DISCONNECTED' | 'ATTACH_CONFLICT'
  | 'BATCH_CONFLICT' | 'SESSION_BOUNDARY_UNCONFIRMED'
  | 'INVALID_OID' | 'CANDIDATE_NOT_PUBLISHED' | 'BUNDLE_INVALID'
  | 'PREREQUISITE_MISSING' | 'PUBLISHED_REF_CONFLICT' | 'STALE_BASE'
  | 'NOT_DESCENDANT' | 'PROTECTED_PATH' | 'CHECK_FAILED' | 'POLICY_CHANGED'
  | 'REF_STATE_UNKNOWN' | 'CANCELLED_BEFORE_COMMIT' | 'CONTEXT_CONFLICT'
  | 'QUOTA_EXCEEDED' | 'PROVIDER_FAILED' | 'PROVIDER_OUTCOME_UNKNOWN'
  | 'UNSUPPORTED_PROFILE' | 'SPIKE_UNRESOLVED' | 'INTERNAL_ERROR';
export interface Failure { code: ErrorCode; message: string; retry: 'never' | 'same-key' | 'after-repair'; details?: Json }
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
export interface BlobDescriptor { bytes: number; sha256: string; mediaType: 'text/plain; charset=utf-8' | 'application/x-git-bundle' | 'application/vnd.oma.context-v1' | 'application/vnd.oma.provider-v1' }
export interface GitReference { repo: 'project' | 'context'; oid: Oid; path?: string }
export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH';
export interface ExactCandidateIdentity {
  repo: 'project'; targetRef: 'refs/heads/main';
  expectedBase: Oid; candidate: Oid; policyRevision: string;
}
export interface MailInput {
  to: Address[]; subject: string; kind: 'message' | 'question' | 'result' | 'alert' | 'context' | 'approval_required' | 'critical';
  body: string; replyToMessage?: MessageId; refs?: GitReference[];
  approvalFor?: ExactCandidateIdentity;
}
/** MUST [CREATE-001]: Actor input only; forbidden properties also reject
 * structurally compatible variables carrying broker-resolved authority.
 */
export interface AgentCreateInput {
  name: Actor; from: Oid; brief: string;
  profile?: never; capabilities?: never;
}
/** MUST [CREATE-002]: Broker-owned result of host policy resolution, never wire input. */
export interface ResolvedAgentSpec extends Pick<AgentCreateInput, 'name' | 'from' | 'brief'> {
  profile: string; capabilities: Capability[];
  modelProfile: string; resources: ResourceLimits;
}
export interface ContextEntry { path: string; bytes: number; sha256: string }
export interface PublicMethods {
  'mail.send': { params: MailInput; result: Receipt };
  'mail.ack': { params: { message: MessageId }; result: Receipt };
  'route.follow': { params: { topic: string }; result: Receipt };
  'route.unfollow': { params: { topic: string }; result: Receipt };
  'agent.create': { params: AgentCreateInput; result: Receipt };
  'agent.start': { params: { agent: Actor }; result: Receipt };
  'agent.stop': { params: { agent: Actor }; result: Receipt };
  'agent.continue': { params: { note: string }; result: Receipt };
  'agent.wait': { params: Record<string, never>; result: { accepted: boolean } };
  'git.known': { params: { candidate: Oid }; result: { hasCandidate: boolean; prerequisites: Oid[] } };
  'git.submit': { params: { candidate: Oid; exportRef: string; prerequisites: Oid[]; to: Address[]; subject: string; body: string; paths: string[]; bundle?: BlobDescriptor }; result: Receipt };
  'git.integrate': { params: { candidate: Oid; expected: Oid }; result: Receipt };
  'context.publish': { params: { expected: Oid | null; entries: ContextEntry[]; content: BlobDescriptor }; result: Receipt };
  'operation.get': { params: { key: RequestKey }; result: Receipt };
  'status.get': { params: { agent?: Actor }; result: { observedAtMs: number; agents: AgentStatus[] } };
  'logs.read': { params: { agent: Actor; sinceSeconds: number }; result: { text: string; truncated: boolean; observedAtMs: number } };
}
export type PublicMethod = keyof PublicMethods;
/** MUST [IPC-004]: Durable mutations require an idempotency key.
 * Read and ephemeral requests forbid the top-level key; operation.get uses params.key.
 */
export type MutationMethod = OperationPlan['kind'];
export type ReadMethod = 'operation.get' | 'status.get' | 'logs.read' | 'git.known';
export type EphemeralMethod = 'agent.wait';
type RequestEnvelope<M extends PublicMethod> = {
  v: 1; id: string; method: M; params: PublicMethods[M]['params'];
};
export type MutationRequest<M extends MutationMethod = MutationMethod> =
  M extends MutationMethod ? RequestEnvelope<M> & { request: RequestKey } : never;
export type ReadRequest<M extends ReadMethod = ReadMethod> =
  M extends ReadMethod ? RequestEnvelope<M> & { request?: never } : never;
export type EphemeralRequest<M extends EphemeralMethod = EphemeralMethod> =
  M extends EphemeralMethod ? RequestEnvelope<M> & { request?: never } : never;
export type Request<M extends PublicMethod = PublicMethod> =
  M extends MutationMethod ? MutationRequest<M> :
  M extends ReadMethod ? ReadRequest<M> :
  M extends EphemeralMethod ? EphemeralRequest<M> : never;
export type Response<M extends PublicMethod = PublicMethod> = { v: 1; id: string; ok: true; result: PublicMethods[M]['result'] } |
  { v: 1; id: string; ok: false; error: Failure };
export interface AuthContext {
  readonly actor: Actor; readonly incarnation: number; readonly role: 'resident' | 'principal';
  readonly channel: 'actor' | 'trusted-runner' | 'principal-extension' | 'host';
  readonly capabilities: ReadonlySet<Capability>;
  readonly peer: { pid: number; uid: number; gid: number; cgroup: string | null };
}
export interface AgentStatus {
  agent: Actor; desired: 'provisioning' | 'enabled' | 'stopped' | 'retired';
  activeState: string | null; subState: string | null; unitResult: string | null;
  execMainStatus: number | null; pending: number; preparedBatches: number;
  reason: string | null; runnerObservedAtMs: number | null;
}
export interface PreparedBatch {
  id: BatchId; agent: Actor; incarnation: number; messageIds: MessageId[];
  sessionPath: string | null; deliveryMode: 'steer' | 'followUp';
  notice: string; indexPath: '/inbox.md';
}
export interface BoundaryEvidence {
  batchId: BatchId; incarnation: number; sessionPath: string;
  adapterRevision: string; receiptPath: string;
  // MUST [S-03]: Version-specific proof format is gated; a caller boolean is not proof.
}
export interface RunLease { actor: Actor; incarnation: number; socketHostPath: string }
export interface InternalMethods {
  'runner.open': { agent: Actor; invocationId: string };
  'runner.pending': Record<string, never>;
  'batch.prepare': Record<string, never>;
  'batch.read': { batchId: BatchId };
  'batch.complete': BoundaryEvidence;
  'runner.observe': { reason: string; toolName?: string; observedAtMs: number };
  'principal.attach': { sessionHandle: string; credential: string };
  'principal.detach': Record<string, never>;
  'host.principalRelay': Record<string, never>;
  'host.reconcile': Record<string, never>;
}
export interface InternalResults {
  'runner.open': RunLease;
  'runner.pending': { pending: number; recoverableBatchIds: BatchId[] };
  'batch.prepare': PreparedBatch | null;
  'batch.read': PreparedBatch;
  'batch.complete': { completed: true };
  'runner.observe': { accepted: true };
  'principal.attach': { actor: 'principal'; incarnation: number };
  'principal.detach': { detached: true };
  'host.principalRelay': { moved: number; pending: number };
  'host.reconcile': { examined: number; repaired: number; remaining: number };
}
export type InternalRequest<M extends keyof InternalMethods = keyof InternalMethods> =
  M extends keyof InternalMethods ? { v: 1; id: string; method: M; params: InternalMethods[M] } : never;
export type InternalResponse<M extends keyof InternalMethods = keyof InternalMethods> =
  { v: 1; id: string; ok: true; result: InternalResults[M] } |
  { v: 1; id: string; ok: false; error: Failure };
export type Notification = { v: 1; event: 'mail_available' | 'run_revoked' };
export interface InferenceStart {
  v: 1; stream: 'inference'; request: string; profile: string;
  codecRevision: string; payload: BlobDescriptor;
  // SPIKE [S-04]: Payload media type/schema needs a verified Pi provider codec;
  // Only application/vnd.oma.provider-v1 is permitted here; no arbitrary HTTP.
}
export interface InferenceEvent {
  v: 1; request: string; sequence: number;
  event: 'data' | 'end' | 'error'; data?: Json; error?: Failure;
}
export interface Store {
  transaction<T>(fn: (tx: Transaction) => T): T;
  getOperation(actor: Actor, key: RequestKey): Receipt | null;
  recoverableOperations(): readonly OperationId[];
}
export interface Transaction { readonly transactionBrand: unique symbol }
export interface MailModule {
  send(auth: AuthContext, key: RequestKey, input: MailInput): Promise<Receipt>;
  materialize(operation: OperationId): Promise<void>;
  prepare(auth: AuthContext): Promise<PreparedBatch | null>;
  complete(auth: AuthContext, evidence: BoundaryEvidence): Promise<void>;
}
export interface UnitObservation { activeState: string; subState: string; result: string; execMainStatus: number; cgroup: string; invocationId: string }
export interface UnitsModule {
  ensureResident(agent: Actor): Promise<void>;
  start(agent: Actor, explicitRepair: boolean): Promise<void>;
  stop(agent: Actor): Promise<UnitObservation>;
  observe(agent: Actor): Promise<UnitObservation>;
  confirmDead(agent: Actor, incarnation: number): Promise<boolean>;
}
export interface GitModule {
  submit(auth: AuthContext, key: RequestKey, input: PublicMethods['git.submit']['params'], bytes?: AsyncIterable<Uint8Array>): Promise<Receipt>;
  integrate(auth: AuthContext, key: RequestKey, input: PublicMethods['git.integrate']['params']): Promise<Receipt>;
  publishContext(auth: AuthContext, key: RequestKey, input: PublicMethods['context.publish']['params'], bytes: AsyncIterable<Uint8Array>): Promise<Receipt>;
  reconcile(operation: OperationId): Promise<void>;
}
export interface SandboxPlan { argv: readonly string[]; env: Readonly<Record<string,string>>; inheritedFds: readonly number[] }
export interface SandboxModule { resident(lease: RunLease): SandboxPlan; candidate(oid: Oid, checkProfile: string): SandboxPlan }
export interface PiAdapter {
  startOrResume(sessionPath: string | null): Promise<string>;
  deliver(batch: PreparedBatch): Promise<void>;
  boundary(): Promise<BoundaryEvidence | null>;
  waitAtSafeBoundary(): Promise<void>;
  close(): Promise<void>;
}
export interface InferenceModule {
  open(auth: AuthContext, input: InferenceStart, payload: AsyncIterable<Uint8Array>): AsyncIterable<InferenceEvent>;
  cancel(auth: AuthContext, request: string): Promise<void>;
  fence(actor: Actor, incarnation: number): Promise<void>;
}
export interface ViewsModule { refreshWorld(): Promise<void>; publishInbox(batch: PreparedBatch): Promise<void>; status(agent?: Actor): Promise<AgentStatus[]> }
export interface ReconcileModule { startup(): Promise<void>; sweep(): Promise<void> }
export interface BrokerModule {
  start(): Promise<void>;
  dispatch<M extends PublicMethod>(auth: AuthContext, request: Request<M>): Promise<Response<M>>;
  drainAndClose(): Promise<void>;
}
export interface RunnerModule { run(agent: Actor): Promise<0>; stop(): Promise<void> }
export interface CliModule { main(argv: readonly string[]): Promise<0 | 2 | 3 | 4> }

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

/** MUST [CFG-005]: Closed host configuration; prices/versions are host inputs.
 * MUST: Reject missing values, extra fields, negative/unsafe integers and
 * inconsistent reserves. No default unlimited quota.
 */
export interface ResourceLimits {
  memoryBytes: number; tasks: number; cpuQuotaPercent: number; tmpBytes: number;
  workspaceBytes: number; stagingBytes: number; checkTimeoutSeconds: number;
}
export interface ProtocolLimits {
  frameBytes: number; mailBodyBytes: number; subjectBytes: number; addresses: number;
  replyReferences: number; contextFiles: number; contextBytes: number;
  bundleBytes: number; logBytes: number; batchMaxMessages: number;
  idleStreamSeconds: number; receiptWaitSeconds: number;
}
export interface ModelProfile {
  provider: string; model: string; credentialRef: string; codecRevision: string;
  pricingRevision: string; maxInputTokens: number; maxOutputTokens: number;
  inferenceTimeoutSeconds: number;
  // SPIKE [S-04]: Price formula/upper-bound codec is pinned deployment data.
}
export interface AgentProfile {
  modelProfile: string; capabilities: Capability[]; delegable: Capability[];
  childProfile: string | null; resources: ResourceLimits;
}
export interface HostConfigV1 {
  schemaVersion: 1; society: string;
  installation: { node: string; libdir: string; rootfs: string; deploymentDigest: string };
  modelProfiles: Record<string, ModelProfile>;
  agentProfiles: Record<string, AgentProfile>;
  principalProfile: string;
  initialResidents: { name: Actor; profile: string; brief: string }[];
  quota: {
    societyAgents: number; lineageAgents: number;
    societyUnits: number; lineageUnits: number; principalReservedUnits: number;
    inferenceSlots: number; principalReservedSlots: number;
    storageBytes: number;
  };
  integration: {
    policyRevision: string; protectedPaths: string[];
    checks: { id: string; argv: string[]; env: Record<string,string>; resources: ResourceLimits }[];
  };
  limits: ProtocolLimits;
  features: { notmuch: false; reflinkSeed: false; formalApproval: false; egress: false };
  // MUST: Optional enabled variants require their gated, reviewed schema.
}
