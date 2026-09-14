/** TS-001: runtime contract owner. Declarations only; wire/persisted v1 unchanged. */
import type { Actor, BatchId, Capability, MessageId } from "./identity.js";

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

export interface UnitObservation { activeState: string; subState: string; result: string; execMainStatus: number; cgroup: string; invocationId: string }

export interface SandboxPlan { argv: readonly string[]; env: Readonly<Record<string,string>>; inheritedFds: readonly number[] }
