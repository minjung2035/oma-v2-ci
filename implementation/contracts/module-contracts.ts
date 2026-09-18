/** TS-001: module-contracts contract owner. Declarations only; wire/persisted v1 unchanged. */
import type { Receipt } from "./durable.js";
import type { Actor, OperationId, RequestKey } from "./identity.js";
import type { PublicMethod, PublicMethods, Request, Response } from "./public-wire.js";
import type { AuthContext, BoundaryEvidence, PreparedBatch } from "./runtime.js";
import type { MailInput } from "./values.js";

/** R40/D12: internal owner ports, not wire DTOs. See src/module-ports.ts for
 * the reviewed signature inventory and production compile-time conformance.
 * Store row queries and receipt projection intentionally remain separate.
 */
export type Store = import('../../src/module-ports.js').StorePort;

export type OperationReceiptPort = import('../../src/module-ports.js').OperationReceiptPort;


export interface MailModule {
  send(auth: AuthContext, key: RequestKey, input: MailInput): Promise<Receipt>;
  materialize(operation: OperationId): Promise<void>;
  prepare(auth: AuthContext): Promise<PreparedBatch | null>;
  complete(auth: AuthContext, evidence: BoundaryEvidence): Promise<void>;
}

export type UnitsModule = import('../../src/module-ports.js').SyncUnitsPort;

export type AsyncUnitsOrchestrationPort = import('../../src/module-ports.js').AsyncUnitsOrchestrationPort;

export interface GitModule {
  submit(auth: AuthContext, key: RequestKey, input: PublicMethods['git.submit']['params'], bytes?: AsyncIterable<Uint8Array>): Promise<Receipt>;
  integrate(auth: AuthContext, key: RequestKey, input: PublicMethods['git.integrate']['params']): Promise<Receipt>;
  publishContext(auth: AuthContext, key: RequestKey, input: PublicMethods['context.publish']['params'], bytes: AsyncIterable<Uint8Array>): Promise<Receipt>;
  reconcile(operation: OperationId): Promise<void>;
}

export type SandboxModule = import('../../src/module-ports.js').SandboxPort;

export interface PiAdapter {
  startOrResume(sessionPath: string | null): Promise<string>;
  deliver(batch: PreparedBatch): Promise<void>;
  boundary(): Promise<BoundaryEvidence | null>;
  waitAtSafeBoundary(): Promise<void>;
  close(): Promise<void>;
}


export type ViewsModule = import('../../src/module-ports.js').DerivedViewsPort;

export type ReconcileModule = import('../../src/module-ports.js').ReconcilePort;

export interface BrokerModule {
  start(): Promise<void>;
  dispatch<M extends PublicMethod>(auth: AuthContext, request: Request<M>): Promise<Response<M>>;
  drainAndClose(): Promise<void>;
}

export type RunnerModule = import('../../src/module-ports.js').BoundRunnerPort;

export interface CliModule { main(argv: readonly string[]): Promise<0 | 2 | 3 | 4> }
