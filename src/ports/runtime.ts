/** Internal runtime orchestration contracts, not ledger or implementation owners. */
import type { Actor } from "../../implementation/contracts/identity.js";
import type { AgentStatus, PreparedBatch, RunLease, SandboxPlan, UnitObservation } from "../../implementation/contracts/runtime.js";
import type { ResourceLimits, ProtocolLimits } from "../../implementation/contracts/host.js";

/** Host-configured bounds shared by runtime composition and batch-view decoding. */
export type BatchViewLimits = Pick<ProtocolLimits, "frameBytes" | "batchMaxMessages">;

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
export interface SandboxCompositionInput {
  readonly host: SandboxHost;
  readonly directories: SandboxDirectories;
}
export interface SandboxPort {
  resident(lease: RunLease, directories: SandboxDirectories, env?: Readonly<Record<string, string>>): SandboxPlan;
}

/** Observation callback is an internal boundary value, not a Views implementation. */
export interface UnitObserve {
  /** null: not observed. "no-unit": observed, and systemd has no such unit
   * (LoadState=not-found) -- which is not a unit that ran and exited (INV02). */
  (agent: Actor): { activeState: string; subState: string; result: string; execMainStatus: number } | "no-unit" | null;
}

export interface SandboxHost {
  /** Host path of the trusted rootfs, mounted read-only at `/`. Never `/` or
   * `/home`: SB-001 requires a rootfs holding only pinned tools and empty
   * mount targets. */
  rootfs: string;
  /** Host path of the OMA installation, mounted read-only inside. It carries
   * the vendored engine, the trusted core extension and the model-facing CLI,
   * so the rootfs itself does not have to be rebuilt when OMA is updated. */
  libdir: string;
  /** DR25: host path of the package store `oma pi install` installs into,
   * mounted read-only inside when any role may load a package's extension. */
  packages?: string | undefined;
  /** Host path of the pinned Node, mounted read-only as a single file. */
  node: string;
  /** TUI-003: installation paths hidden inside the sandbox, relative to
   * `libdir`: a directory is covered by an empty read-only tmpfs, a file by
   * `/dev/null`. Only paths that exist are listed; bwrap needs a target. */
  hidden?: readonly { readonly path: string; readonly kind: "dir" | "file" }[];
  /** Operating-system paths mounted read-only at the same path, so a rootfs of
   * empty mount targets can still run programs. Absent when the rootfs carries
   * its own. Only `SYSTEM_BIND_CANDIDATES` are accepted. */
  systemBinds?: readonly string[];
  /** Engine entry, as the confined process sees it. */
  pi: string;
  piModeArgs: string[];
  tmpBytes: number;
  /** Host composition roots and existing limits, never new wire/config fields. */
  stateRoot?: string;
  runRoot?: string;
  limits?: BatchViewLimits;
}
