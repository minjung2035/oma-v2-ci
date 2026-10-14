/** DR27: exact integration facts assembled by the host, never from model mail.
 * No asynchronous work, reviewer scheduling, or current-state rewrite of facts. */
import type { ExactCandidateIdentity, RiskTier } from "../../implementation/contracts/values.js";
import type { TieredAcceptance, TierSnapshot } from "../../implementation/contracts/integration.js";
import type { Store } from "../store.js";
import type { IntegrationSnapshot } from "./integration-policy.js";
import { deterministicTier } from "./integration-policy.js";
import { evaluateTier, sameCandidate } from "./approval.js";
import { attestationSnapshot } from "./attestation-snapshot.js";
import { StoreError } from "../domain/errors.js";
import type { ChangedPath } from "./observe.js";

export class TieredAuthority {
  constructor(private readonly store: Store, private readonly submitters: (base: string, candidate: string) => readonly string[]) {}
  evaluate(policy: IntegrationSnapshot, identity: ExactCandidateIdentity, actor: string, requested: RiskTier,
    changes: readonly ChangedPath[]): TieredAcceptance {
    if (policy.tiered === null) throw new StoreError("UNSUPPORTED_PROFILE", "tiered integration is not configured");
    const facts = attestationSnapshot(this.store.attestations.all(), identity);
    const reviews = facts.reviews.filter(review => sameCandidate(review.identity, identity));
    const reviewers = new Set(reviews.filter(review => review.value === "APPROVE" && !review.revoked).map(review => review.actor));
    const snapshot: TierSnapshot = { identity, requester: actor, requested,
      deterministic: deterministicTier(policy.tiered, changes), repositoryFloor: policy.tiered.repositoryFloor,
      floors: facts.floors, scopeAssessments: facts.scopeAssessments,
      reviews,
      submitters: [...new Set(this.submitters(identity.expectedBase, identity.candidate))].sort(),
      eligibleResidents: this.store.agents.all().filter(agent => agent.role === "resident" && agent.desired === "enabled" && reviewers.has(agent.name)).map(agent => agent.name).sort(),
      highPeerFloor: policy.tiered.highPeerFloor, principalDelegated: policy.tiered.principalDelegated,
    };
    const result = evaluateTier(snapshot);
    if (result.missing.length > 0) throw new StoreError("INTEGRATION_CONDITIONS", `Integration conditions missing: ${result.missing.join("; ")}`,
      { details: { missing: result.missing.join("; "), effectiveTier: result.effectiveTier } });
    return { requested, effective: result.effectiveTier, policyDigest: policy.policyIdentity, authorityDigest: result.digest,
      reasons: [...result.reasons], approvers: [...result.approvers], objections: [...result.objections],
      principalDecision: result.principalDecision, activeFloors: [...result.activeFloors], snapshot,
      policy: { tiered: policy.tiered, protectedPaths: policy.protectedPaths, checks: policy.checks } };
  }
}
