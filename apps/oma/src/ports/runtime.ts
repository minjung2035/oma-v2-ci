import type { RecoveryCounts } from "@oma/contracts/runtime";
import type { SandboxHost, SandboxDirectories } from "@oma/contracts/runtime";
/** Internal runtime orchestration contracts, not ledger or implementation owners. */
import type { Actor } from "@oma/contracts/identity";
import type { AgentStatus, PreparedBatch, RunLease, SandboxPlan, ExecutionObservation } from "@oma/contracts/runtime";
import type { BatchViewLimits } from "@oma/contracts/host";

/** Host-configured bounds shared by runtime composition and batch-view decoding. */
export type { BatchViewLimits } from "@oma/contracts/host";

/** Low-level blocking effects. The incarnation is mandatory death-proof input. */
export interface ResidentExecutionPort {
  ensureResident(agent: Actor, profile: string, modelProfile: string): void;
  start(agent: Actor, explicitRepair: boolean, authorize?: () => void): Promise<void>;
  stop(agent: Actor, incarnation: number): Promise<ExecutionObservation>;
  observe(agent: Actor): ExecutionObservation;
  confirmDead(agent: Actor, incarnation: number): boolean;
}

export interface DerivedViewsPort {
  refreshWorld(): void;
  publishInbox(batch: PreparedBatch): void;
  status(agent?: Actor, observe?: UnitObserve): AgentStatus[];
}
export interface ReconcilePort {
  startup(allowActivation?: boolean): Promise<void>;
  sweep(): Promise<RecoveryCounts>;
}
export interface BoundRunnerPort {
  run(): Promise<0>;
  stop(): Promise<void>;
}
export interface SandboxCompositionInput {
  readonly host: SandboxHost;
  readonly directories: SandboxDirectories;
}
export interface SandboxPort {
  resident(lease: RunLease, directories: SandboxDirectories, env?: Readonly<Record<string, string>>): SandboxPlan;
}

import type { UnitObserve } from "@oma/contracts/runtime";
