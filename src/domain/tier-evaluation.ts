/** POL-002/TIER-001..008: a pure decision over a fully observed authority
 * snapshot. This neither assigns reviewers nor interprets mail or Git authors.
 * Callers must rebuild the snapshot immediately before canonical CAS. */
import type { ExactCandidateIdentity, RiskTier } from "../../implementation/contracts/values.js";
import { sameExactCandidate } from "./attestation-relations.js";
import { canonicalJson, sha256Hex } from "./canonical-json.js";
import { StoreError } from "./errors.js";

export type { PrincipalDecision, ReviewFact, ChallengeFloor, ScopeAssessment, TierSnapshot } from "../../implementation/contracts/integration.js";
import type { ReviewFact, TierSnapshot } from "../../implementation/contracts/integration.js";
export interface TierEvaluation {
  readonly effectiveTier: RiskTier;
  readonly reasons: readonly string[];
  readonly approvers: readonly string[];
  readonly objections: readonly string[];
  readonly principalDecision: string | null;
  readonly activeFloors: readonly string[];
  readonly missing: readonly string[];
  readonly digest: string;
}
const TIERS: readonly RiskTier[] = ["LOW", "MEDIUM", "HIGH"];
export function maximumTier(...tiers: readonly RiskTier[]): RiskTier {
  if (tiers.length === 0 || tiers.some(tier => !TIERS.includes(tier)))
    throw new StoreError("REF_STATE_UNKNOWN", "integration tier input was not observed");
  return TIERS[Math.max(...tiers.map(tier => TIERS.indexOf(tier)))]!;
}
export const sameCandidate = sameExactCandidate;

export function evaluateTier(snapshot: TierSnapshot): TierEvaluation {
  if (snapshot.floors === null || snapshot.scopeAssessments === null || snapshot.submitters === null ||
      snapshot.eligibleResidents === null || snapshot.reviews === null)
    throw new StoreError("REF_STATE_UNKNOWN", "integration authority snapshot is incomplete");
  if (!Number.isSafeInteger(snapshot.highPeerFloor) || snapshot.highPeerFloor < 1)
    throw new StoreError("UNSUPPORTED_PROFILE", "HIGH requires at least one eligible peer");
  const missing: string[] = [];
  const reasons = [...snapshot.deterministic.reasons];
  let reentry: RiskTier = "LOW";
  const floors = new Set<string>();
  for (const floor of snapshot.floors) {
    if (floors.has(floor.finding) || (floor.minimum !== "MEDIUM" && floor.minimum !== "HIGH") || !floor.scope.trim())
      throw new StoreError("STORE_CORRUPT", "challenge floor snapshot is inconsistent");
    floors.add(floor.finding);
    const decisions = snapshot.scopeAssessments.filter(assessment => assessment.finding === floor.finding &&
      sameCandidate(assessment.identity, snapshot.identity));
    if (decisions.length > 1) throw new StoreError("STORE_CORRUPT", "challenge scope has multiple current assessments");
    const assessment = decisions[0];
    if (!assessment) missing.push(`Principal scope assessment for finding ${floor.finding}`);
    else if (assessment.applies) {
      reentry = maximumTier(reentry, floor.minimum);
      reasons.push(`challenge ${floor.finding}: ${floor.minimum}`);
    }
  }
  const effectiveTier = maximumTier(snapshot.deterministic.tier, snapshot.repositoryFloor, reentry, snapshot.requested);
  const identities = new Set<string>(); const sequences = new Set<number>();
  for (const review of snapshot.reviews) {
    if (identities.has(review.id) || sequences.has(review.sequence) || !Number.isSafeInteger(review.sequence) || review.sequence < 1)
      throw new StoreError("STORE_CORRUPT", "review snapshot contains duplicate or invalid fact order");
    identities.add(review.id); sequences.add(review.sequence);
    if ((review.value === "ACCEPT" || review.value === "REQUEST_REVISION" || review.value === "REJECT") && review.actor !== "principal")
      throw new StoreError("STORE_CORRUPT", "a Principal decision has another author");
    if ((review.value === "APPROVE" || review.value === "OBJECT") && review.actor === "principal")
      throw new StoreError("STORE_CORRUPT", "a peer attestation has the Principal as author");
  }
  const exact = snapshot.reviews.filter(review => sameCandidate(review.identity, snapshot.identity));
  const authors = new Set([snapshot.requester, ...snapshot.submitters]);
  const eligible = new Set(snapshot.eligibleResidents);
  const approvers = [...new Set(exact.filter(review => review.value === "APPROVE" && !review.revoked &&
    eligible.has(review.actor) && !authors.has(review.actor)).map(review => review.actor))].sort();
  // An authenticated objection is not erased by retirement, a changed grant,
  // or by its author also being a submitter. Only its own revoke removes it.
  const objections = exact.filter(review => review.value === "OBJECT" && !review.revoked).map(review => review.id).sort();
  if (objections.length > 0) missing.push("revoke or resolve active exact OBJECT attestations");
  const required = effectiveTier === "LOW" ? 0 : effectiveTier === "MEDIUM" ? 1 : snapshot.highPeerFloor;
  if (approvers.length < required) missing.push(`${required} distinct eligible peer APPROVE (found ${approvers.length})`);
  // The latest decision is a fact even when revoked. Revoking a REJECT must
  // not resurrect an older ACCEPT. An explicit new decision is required.
  const latest = exact.filter(review => review.actor === "principal")
    .reduce<ReviewFact | null>((last, review) => last === null || review.sequence > last.sequence ? review : last, null);
  if (effectiveTier === "HIGH") {
    if (!snapshot.principalDelegated) missing.push("Human delegation of HIGH decisions to the Principal");
    if (latest === null || latest.revoked || latest.value !== "ACCEPT") missing.push("current exact Principal ACCEPT");
  }
  const result = { effectiveTier, reasons: Object.freeze(reasons), approvers: Object.freeze(approvers),
    objections: Object.freeze(objections), principalDecision: latest?.id ?? null,
    activeFloors: Object.freeze([...floors].sort()), missing: Object.freeze(missing) };
  return Object.freeze({ ...result, digest: sha256Hex(canonicalJson({ snapshot, result })) });
}
