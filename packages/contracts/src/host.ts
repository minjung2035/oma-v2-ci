/** TS-001: host contract owner. Declarations only; current host configuration schema 3. */
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
  schemaVersion: 4; society: string;
  installation: { node: string; libdir: string; deploymentDigest: string; packages?: string };
  modelProfiles: Record<string, ModelProfile>;
  agentProfiles: Record<string, AgentProfile>;
  principalProfile: string;
  initialResidents: { name: Actor; profile: string; brief: string }[];
  integration: {
    policyRevision: string; protectedPaths: string[];
    tiered?: TieredPolicy;
    checks: { id: string; argv: string[]; env: Record<string,string> }[];
  };
  limits: ProtocolLimits;
}
