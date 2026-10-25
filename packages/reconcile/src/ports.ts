/** The recovery coordinator owns ordering, never concrete feature or storage authority. */
import type { Actor, UnitObservation } from "@oma/contracts";
import type { AgentRow } from "@oma/contracts/ledger";
import type { DecodedOperation } from "@oma/protocol/operation-codec";
import type { GitObservation } from "@oma/contracts/git";
import type { PreacceptCollection } from "@oma/contracts/runtime";
export interface ReconcileLedger {
  recoverableOperations(): string[];
  getOperationById(id: string): DecodedOperation | null;
  listAgents(): AgentRow[];
  getAgent(actor: Actor): AgentRow | null;
  societyOpen(): boolean;
}
export interface ReconcileMail { reconcileOperation(id: string): Promise<void> }
export interface ReconcileGit { reconcile(id: string): Promise<void> }
export interface ReconcileReview { advanceAll(): Promise<void> }
export interface ReconcileLifecycle {
  reconcileSociety(id: string): void;
  reconcileCreate(id: string, allowed: boolean): Promise<void>;
  reconcileAction(id: string, allowed: boolean): void;
}
export interface ReconcileUnits {
  observeAsync(actor: Actor): Promise<UnitObservation>;
  observe(actor: Actor): UnitObservation;
  confirmDead(actor: Actor, incarnation: number): boolean;
  stop(actor: Actor, incarnation: number): UnitObservation;
  start(actor: Actor, explicitRepair: boolean): void;
  startLimitStatus(actor: Actor): string | null;
}
export interface ReconcileEffects {
  observeStoreFailure(error: unknown): void;
  quiesceResidents(): void;
  collectUnacceptedArtifacts(): PreacceptCollection;
  canonicalMain(): GitObservation<string>;
  assertCanonicalHealthy(): Promise<void>;
  hasPendingWork(actor: Actor): boolean;
}
