/** DR27: host-owned rules and the immutable decision named by publication. */
import type { ExactCandidateIdentity, RiskTier } from "./values.js";
import type { ResourceLimits, TieredPolicy } from "./host.js";
export type { TieredPolicy } from "./host.js";
export interface TieredAcceptance {
  requested: RiskTier;
  effective: RiskTier;
  policyDigest: string;
  authorityDigest: string;
  reasons: string[];
  approvers: string[];
  objections: string[];
  principalDecision: string | null;
  activeFloors: string[];
  snapshot: TierSnapshot;
  policy: IntegrationPolicyEvidence;
}

export type PrincipalDecision = "ACCEPT" | "REQUEST_REVISION" | "REJECT";
export interface TieredReviewFact {
  readonly id: string;
  /** Durable acceptance order, never a wall clock or arrival timestamp. */
  readonly sequence: number;
  readonly actor: string;
  readonly identity: ExactCandidateIdentity;
  readonly value: "APPROVE" | "OBJECT" | PrincipalDecision;
  readonly revoked: boolean;
}
export interface ChallengeFloor {
  /** The authorized finding, linked by its owner to an actual integration. */
  readonly finding: string;
  readonly minimum: "MEDIUM" | "HIGH";
  /** Scope is semantic evidence authored by the Principal, not a path/hash
   * heuristic. An exact Principal assessment determines candidate membership. */
  readonly scope: string;
}
export interface ScopeAssessment {
  readonly finding: string;
  readonly identity: ExactCandidateIdentity;
  readonly applies: boolean;
  readonly attestation: string;
}
export interface TierSnapshot {
  readonly identity: ExactCandidateIdentity;
  readonly requester: string;
  readonly requested: RiskTier;
  readonly deterministic: { readonly tier: RiskTier; readonly reasons: readonly string[] };
  readonly repositoryFloor: RiskTier;
  /** null is unknown, [] is a completely observed empty fact set. */
  readonly floors: readonly ChallengeFloor[] | null;
  readonly scopeAssessments: readonly ScopeAssessment[] | null;
  /** Authenticated submit provenance for the changed commits, not Git Author
   * strings. Republishing a commit must retain its previous submitters. */
  readonly submitters: readonly string[] | null;
  readonly eligibleResidents: readonly string[] | null;
  readonly reviews: readonly TieredReviewFact[] | null;
  readonly highPeerFloor: number;
  readonly principalDelegated: boolean;
}

export interface IntegrationCheckSnapshot {
  readonly id: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutSeconds: number;
  readonly tmpBytes?: number;
  readonly resources?: Readonly<ResourceLimits>;
}
export interface IntegrationPolicyEvidence {
  readonly tiered: Readonly<TieredPolicy>;
  readonly protectedPaths: readonly string[];
  readonly checks: readonly IntegrationCheckSnapshot[];
}
