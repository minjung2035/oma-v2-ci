/** Internal runtime orchestration contracts, not ledger or implementation owners. */
import type { Actor } from "../../implementation/contracts/identity.js";
import type { AgentStatus, PreparedBatch, RunLease, SandboxPlan, UnitObservation } from "../../implementation/contracts/runtime.js";
import type { ResourceLimits } from "../../implementation/contracts/host.js";
import type { BatchViewLimits } from "../protocol/batch-view.js";

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

/** Observation callback is an internal boundary value, not a Views implementation. */
export interface UnitObserve {
  (agent: Actor): { activeState: string; subState: string; result: string; execMainStatus: number } | null;
}

export interface SandboxHost {
  rootfs: string;
  node: string;
  pi: string;
  piModeArgs: string[];
  tmpBytes: number;
  checkResources: ResourceLimits;
  /** Host composition roots and existing limits, never new wire/config fields. */
  stateRoot?: string;
  runRoot?: string;
  limits?: BatchViewLimits;
}
