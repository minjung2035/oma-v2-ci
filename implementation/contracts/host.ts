/** TS-001: host contract owner. Declarations only; wire/persisted v1 unchanged. */
import type { Actor, Capability } from "./identity.js";
import type { AgentCreateInput, RiskTier } from "./values.js";

/** MUST [CREATE-002]: Broker-owned result of host policy resolution, never wire input. */
export interface ResolvedAgentSpec extends Pick<AgentCreateInput, 'name' | 'from' | 'brief'> {
  profile: string; capabilities: Capability[];
  modelProfile: string; resources: ResourceLimits;
}

/** MUST [CFG-005]: the contract declares the field names; the canonical runtime
 * descriptors (src/domain/resources.ts, src/domain/limits.ts) own ranges, units
 * and validation and are checked against these keys at compile time. Every value
 * is a non-negative safe integer verified at runtime, never by a cast.
 */
export interface ResourceLimits {
  memoryBytes: number;
  tasks: number;
  cpuQuotaPercent: number;
  tmpBytes: number;
  workspaceBytes: number;
  stagingBytes: number;
  checkTimeoutSeconds: number;
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

/** The effort levels the engine runs a model with, as it names them. */
export type EffortLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelProfile {
  provider: string; model: string; credentialRef: string; codecRevision: string;
  pricingRevision: string; maxInputTokens: number; maxOutputTokens: number;
  inferenceTimeoutSeconds: number;
  /** DR24: the effort the model runs with; the engine's default when absent. */
  thinking?: EffortLevel;
  // The engine owns provider selection and pricing (INF-001); these fields are
  // deployment-declared names it resolves, not a price formula OMA evaluates.
}

export interface AgentProfile {
  modelProfile: string; capabilities: Capability[]; delegable: Capability[];
  childProfile: string | null; resources: ResourceLimits;
}

export interface HostConfigV1 {
  schemaVersion: 1; society: string;
  installation: { node: string; libdir: string; rootfs: string; deploymentDigest: string; packages?: string };
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
    tiered?: TieredPolicy;
    checks: { id: string; argv: string[]; env: Record<string,string>; resources: ResourceLimits }[];
  };
  limits: ProtocolLimits;
  features: { notmuch: false; reflinkSeed: false; formalApproval: false; egress: false };
  // MUST: Optional enabled variants require their gated, reviewed schema.
}
