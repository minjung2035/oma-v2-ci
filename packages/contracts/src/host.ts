/** TS-001: host contract owner. Declarations only; host configuration schemas 4/5. */
import type { Actor, Capability } from "./identity.js";
import type { AgentCreateInput, RiskTier } from "./values.js";

/** MUST [CREATE-002]: Broker-owned result of host policy resolution, never wire input. */
export interface ResolvedAgentSpec extends Pick<AgentCreateInput, 'name' | 'from' | 'brief'> {
  profile: string; capabilities: Capability[];
  modelProfile: string;
}

export interface TieredPolicy {
  repositoryFloor: RiskTier;
  highPeerFloor: number;
  principalDelegated: boolean;
  rules: { path: string; tier: RiskTier; statuses: ("A" | "M" | "D" | "T")[] }[];
}

export interface ProtocolLimits {
  frameBytes: number;
  mailBodyBytes: number;
  subjectBytes: number;
  addresses: number;
  replyReferences: number;
  contextFiles: number;
  contextBytes: number;
  bundleBytes: number;
  logBytes: number;
  batchMaxMessages: number;
  idleStreamSeconds: number;
  receiptWaitSeconds: number;
}

/** Limits needed to decode a delivery view, without a runtime owner. */
export type BatchViewLimits = Pick<ProtocolLimits, "frameBytes" | "batchMaxMessages">;

/** The effort levels the engine runs a model with, as it names them. */
export type EffortLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelProfile {
  provider: string; model: string;
  inferenceTimeoutSeconds: number;
  /** DR24: the effort the model runs with; the engine's default when absent. */
  thinking?: EffortLevel;
  // The engine owns provider selection and pricing (INF-001); provider/model
  // are deployment-declared names it resolves, not a price formula OMA
  // evaluates.
}

export interface AgentProfile {
  modelProfile: string; capabilities: Capability[]; delegable: Capability[];
  childProfile: string | null;
}

export interface HostConfig {
  storage?: { closeMode: "keep-hot" | "on-close" };
  resources?: WorkloadResourceProfile;
  /** Version-5 operator closure, applied at broker restart. Absence preserves
   * existing admission checks; neither value approves a new model surface.
   * Canonical replay/recovery and supervising-host controls remain available. */
  collaborationFreshMutations?: "closed";
  schemaVersion: 4 | 5; society: string;
  /** Explicit host request; only a Society with no Resident history can accept it. */
  firstWorkerRecovery?: { version: 1; key: string; name: string; profile: string; brief: string };
  installation: { node: string; libdir: string; deploymentDigest: string; packages?: string };
  modelProfiles: Record<string, ModelProfile>;
  agentProfiles: Record<string, AgentProfile>;
  principalProfile: string;
  /** Maximum currently enabled resident identities; historical registrations do not consume slots. */
  maxWorkers: number;
  initialResidents: { name: Actor; profile: string; brief: string }[];
  integration: {
    pipeline?: import("./check-pipeline.js").CheckPipeline;
    policyRevision: string; protectedPaths: string[];
    tiered?: TieredPolicy;
    checks: { id: string; argv: string[]; env: Record<string,string> }[];
  };
  limits: ProtocolLimits;
}

/** Optional Linux workload budget, separate from logical Worker capacity. */
export interface WorkloadResourceProfile {
  version: 1; cpuCores?: number; memoryMaxBytes?: number; swapMaxBytes?: number; tasksMax?: number;
  checkWallTimeMs?: number; tmpfsMaxBytes?: number; maxConcurrentCheckPipelines?: number;
}
