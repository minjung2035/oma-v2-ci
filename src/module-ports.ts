/**
 * R40 / D12: internal ports describe existing owner semantics, not new wire methods.
 *
 * Owner     | old module declaration        | explicit internal boundary
 * Store     | getOperation -> Receipt       | validated row query + separate receipt query
 * Units     | Promise effects; no stop epoch | synchronous effects; required incarnation; observation returned
 * Views     | Promise results               | synchronous derived publication/query; observer input retained
 * Reconcile | sweep -> Promise<void>         | Promise<ReconcileMetrics>; startup activation input retained
 * Runner    | run(agent)                    | constructor-bound identity; run() only
 * Sandbox   | resident(lease)               | host-validated config + trusted composition directories
 *
 * PublicMethods, InternalMethods and their results remain wire contracts.
 * SyncUnitsPort is NOT the async lifecycle orchestration port. No Promise.resolve
 * adapter, capability omission, epoch omission or assertion cast bridges them.
 * Directory/config trust is a composition precondition, never actor input.
 */
import type { Actor, OperationId, RequestKey } from "../implementation/contracts/identity.js";
import type { AgentStatus, PreparedBatch, RunLease, SandboxPlan, UnitObservation } from "../implementation/contracts/runtime.js";
import type { Receipt } from "../implementation/contracts/durable.js";
import type { ResourceLimits } from "../implementation/contracts/host.js";
import type { Store as StoreImplementation, OperationRow, Transaction } from "./store.js";
import type { UnitsModule as UnitsImplementation } from "./units.js";
import type { ViewsModule as ViewsImplementation, UnitObserve } from "./views.js";
import type { ReconcileModule as ReconcileImplementation } from "./reconcile.js";
import type { RunnerModule as RunnerImplementation } from "./runner.js";
import type { SandboxModule as SandboxImplementation, SandboxHost } from "./sandbox.js";

/** These queries preserve recovery payload/plan/hash/identity evidence. */
export interface OperationRowsPort {
  getOperation(actor: Actor, key: RequestKey): OperationRow | null;
  getOperationById(id: OperationId): OperationRow | null;
  recoverableOperations(): readonly OperationId[];
}
export interface StorePort extends OperationRowsPort {
  transaction<T>(fn: (tx: Transaction) => T): T;
  close(): void;
}

/** R08 supplies the projection; Store row queries must not masquerade as this port. */
export interface OperationReceiptPort {
  getReceipt(actor: Actor, key: RequestKey): Receipt | null;
}
export type ReceiptProjector = (operation: OperationRow) => Receipt;

/** Low-level blocking effects. The incarnation is mandatory death-proof input. */
export interface SyncUnitsPort {
  ensureResident(agent: Actor, profile?: string, frozen?: ResourceLimits): void;
  start(agent: Actor, explicitRepair: boolean): void;
  stop(agent: Actor, incarnation: number): UnitObservation;
  observe(agent: Actor): UnitObservation;
  confirmDead(agent: Actor, incarnation: number): boolean;
}

/** A distinct orchestration abstraction, NOT implemented by UnitsModule today. */
export interface AsyncUnitsOrchestrationPort {
  ensureResident(agent: Actor, profile?: string, frozen?: ResourceLimits): Promise<void>;
  start(agent: Actor, explicitRepair: boolean): Promise<void>;
  stop(agent: Actor, incarnation: number): Promise<UnitObservation>;
  observe(agent: Actor): Promise<UnitObservation>;
  confirmDead(agent: Actor, incarnation: number): Promise<boolean>;
}

export interface DerivedViewsPort {
  refreshWorld(): void;
  publishInbox(batch: PreparedBatch): void;
  status(agent?: Actor, observe?: UnitObserve): AgentStatus[];
}
export interface ReconcileMetrics {
  examined: number;
  repaired: number;
  remaining: number;
}
export interface ReconcilePort {
  startup(allowActivation?: boolean): Promise<void>;
  sweep(): Promise<ReconcileMetrics>;
}
export interface BoundRunnerPort {
  run(): Promise<0>;
  stop(): Promise<void>;
}

/** Absolute host paths supplied by validated composition, never by IPC DTOs. */
export interface SandboxDirectories {
  workspace: string;
  home: string;
  archive: string;
  selfMail: string;
  view: string;
  world: string;
  projectGit: string;
}
export interface SandboxCompositionInput {
  readonly host: SandboxHost;
  readonly directories: SandboxDirectories;
}
export interface SandboxPort {
  resident(lease: RunLease, directories: SandboxDirectories): SandboxPlan;
  /** S01-CANDIDATE remains gated; this declaration does not attest to execution. */
  candidate(oid: string, checkProfile: string): SandboxPlan;
}

// These constraints are checked as part of production typechecking, not only tests.
// Actual class signatures are independently compared against explicit ports.
type Conforms<Port, Implementation extends Port> = Implementation;
export type ActualModuleConformance = {
  store: Conforms<StorePort, StoreImplementation>;
  units: Conforms<SyncUnitsPort, UnitsImplementation>;
  views: Conforms<DerivedViewsPort, ViewsImplementation>;
  reconcile: Conforms<ReconcilePort, ReconcileImplementation>;
  runner: Conforms<BoundRunnerPort, RunnerImplementation>;
  sandbox: Conforms<SandboxPort, SandboxImplementation>;
};
