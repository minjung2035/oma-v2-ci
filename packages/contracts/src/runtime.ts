import type { BatchViewLimits } from "./host.js";
/** TS-001: runtime contract owner. Declarations only; wire/persisted v1 unchanged. */
import type { Actor, BatchId, Capability, MessageId } from "./identity.js";

export interface AuthContext {
  readonly actor: Actor; readonly incarnation: number; readonly role: 'resident' | 'principal';
  readonly channel: 'actor' | 'trusted-runner' | 'principal-extension' | 'host';
  readonly capabilities: ReadonlySet<Capability>;
  readonly peer: { pid: number; uid: number; gid: number };
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

/** Transient execution status; neither current authority nor descendant death
 * proof. The existing status wire words remain unchanged. */
export interface ExecutionObservation { activeState: string; subState: string; result: string; execMainStatus: number; invocationId: string; scope: string }

/** A live kernel scope capability, not a durable DTO or authority token. The
 * common run owner cannot interpret the OS identity or infer death from EOF. */
export interface ExecutionScopePin {
  readonly identity: unknown;
  population(): "empty" | "populated" | "unknown";
  matches(scope: string): boolean;
  close(): void;
}
export interface ResidentLogEntry {
  readonly actor: string; readonly invocationId: string; readonly incarnation: number | null;
  readonly atMs: number; readonly stream: "stdout" | "stderr"; readonly bytes: Uint8Array;
}
export type ResidentLogObservation = { readonly kind: "entry"; readonly entry: ResidentLogEntry } | { readonly kind: "incomplete" };

export interface SandboxPlan { argv: readonly string[]; env: Readonly<Record<string,string>>; inheritedFds: readonly number[] }

/** Transient model view, never a durable identity or execution capability.
 * Host paths enter argv/env through one mapping; reported sessions leave
 * through its matching reverse mapping. */
export interface PathView {
  map(hostPath: string): string;
  sessionPathToHost(enginePath: string): string | null;
}
export interface SandboxEndpoints { readonly inference?: string; readonly egress?: string }



/** Absolute host paths supplied by validated composition, never by IPC DTOs. */
export interface SandboxDirectories {
  workspace: string;
  home: string;
  archive: string;
  /** mail-v1: the worker-only review archive, bound read-only per Resident. */
  workerArchive: string;
  selfMail: string;
  view: string;
  world: string;
  projectGit: string;
  /** DR18 (D-8): the project's committed history, bound read-only if it exists. */
  projectMirror: string;
  /** Writable session store for the confined engine. SB-006 already treats its
   * contents as model-origin data; the mount makes that explicit. */
  sessions: string;
}


export interface SandboxHost {
  /** Host path of the OMA installation, read-only to the Worker. It carries
   * the vendored engine, the trusted core extension and the model-facing CLI,
   * independently of the platform confinement mechanism. */
  libdir: string;
  /** DR25: host path of the package store `oma pi install` installs into,
   * mounted read-only inside when any role may load a package's extension. */
  packages?: string | undefined;
  /** Host path of the pinned Node, mounted read-only as a single file. */
  node: string;
  /** TUI-003: installation-relative entries hidden from model code. The
   * platform applies its own read-only mask or denial mechanism. */
  hidden?: readonly { readonly path: string; readonly kind: "dir" | "file" }[];
  /** Engine entry, as the confined process sees it. */
  pi: string;
  piModeArgs: string[];
  /** Host composition roots and existing limits, never new wire/config fields. */
  stateRoot?: string;
  runRoot?: string;
  limits?: BatchViewLimits;
}

/** A reported session boundary. This DTO alone is not a verified receipt or execution authority. */
export interface DeliveryBoundary {
  readonly batchId: string;
  readonly incarnation: number;
  readonly sessionPath: string;
  readonly entryId: string;
  readonly adapterRevision: string;
}

/** The storage receipt decoder issues the checked identity; its WeakSet and
 * durable publication stay in that owner. A type cast is not receipt evidence. */
export interface DeliveryReceipt extends DeliveryBoundary {
  readonly schemaVersion: 1;
  readonly actor: Actor;
  readonly messageIds: readonly string[];
}
declare const checkedReceipt: unique symbol;
export type CheckedReceipt = DeliveryReceipt & { readonly [checkedReceipt]: true };

/** The two rebuildable documents for one already-decided delivery batch. */
export interface BatchViewDocuments { readonly json: string; readonly index: string }

/** Counts of accepted operations; never process death or effect proof. */
export interface RecoveryCounts { examined: number; repaired: number; remaining: number }
/** Startup-owned physical artifact observations, including unproven ownership. */
export interface PreacceptCollection {
  readonly removed: readonly string[];
  readonly kept: readonly { readonly path: string; readonly reason: string }[];
}

/** D01/BATCH-004: what a broker-owned settlement must hold. The next run of
 * `actor` has begun only after its previous invocation's scope was proven
 * empty or removed (or this broker's startup quiesced every scope before
 * admitting runs), and no endpoint of that next run exists yet, so nothing at
 * `incarnation` can still act. `confirm` re-checks this immediately before the
 * ledger transition; it is not a flag that stays true. */
export interface SettlementQuiescence {
  readonly actor: Actor;
  readonly incarnation: number;
  confirm(): void;
}

export interface StatusSnapshot {
  /** When this observation started; the time every value in it is about. */
  readonly observedAtMs: number;
  /** An agent absent here was not observed and is unknown. */
  readonly units: ReadonlyMap<Actor, ExecutionObservation | "no-unit">;
  readonly failure: "timeout" | "unavailable" | null;
}

/** What `runner.observe` last told the broker about one agent's run: the
 * authenticated incarnation it came from plus the wire payload verbatim.
 * Memory-only and never authority -- the status projection keeps only the
 * timestamp, and only while the observation's run is still the ledger's. */
export interface RunnerObservation {
  readonly incarnation: number;
  readonly reason: string;
  readonly toolName?: string;
  readonly observedAtMs: number;
}


/** Observation callback is an internal boundary value, not a Views implementation. */
export interface UnitObserve {
  /** null: not observed. "no-unit": the native slot has no recorded execution.
   * This retained wire word never claims an execution ran and exited (INV02). */
  (agent: Actor): { activeState: string; subState: string; result: string; execMainStatus: number } | "no-unit" | null;
}

/** The engine a tenure paid for. `close()` asks it to stop; `exited` is the
 * only thing that says it has. */
export interface FencedEngine {
  close(): void;
  readonly exited: Promise<void>;
}

