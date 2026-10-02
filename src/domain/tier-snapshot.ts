/** DB-009/TIER-008: retained evidence is checked without consulting current
 * grants, defaults or refs. Historical decisions are never reauthorized here. */
import type { TieredAcceptance } from "../../implementation/contracts/integration.js";
import type { ExactCandidateIdentity } from "../../implementation/contracts/values.js";
import { isValidActor, isValidActorName, isValidOperationId } from "./identifiers.js";
import { canonicalJson, sha256Hex } from "./canonical-json.js";
import { sameExactCandidate } from "./attestation-relations.js";
import { exactCandidateCheck } from "./mail-values.js";
import { evaluateTier } from "./tier-evaluation.js";
import { riskTierCheck, integrationPolicyEvidenceCheck } from "./integration-policy.js";
import { checkArray, checkBool, checkEnum, checkInt, checkObject, checkString, type Check } from "../validate.js";

const actor: Check = value => isValidActor(value) ? null : "invalid actor";
const resident: Check = value => isValidActorName(value) ? null : "invalid Resident";
const operation: Check = value => isValidOperationId(value) ? null : "invalid operation";
const snapshotCheck = checkObject({
  identity: exactCandidateCheck, requester: actor, requested: riskTierCheck,
  deterministic: checkObject({ tier: riskTierCheck, reasons: checkArray(checkString()) }),
  repositoryFloor: riskTierCheck, highPeerFloor: checkInt({ min: 1 }), principalDelegated: checkBool(),
  submitters: checkArray(actor), eligibleResidents: checkArray(resident),
  floors: checkArray(checkObject({ finding: operation, minimum: checkEnum(["MEDIUM", "HIGH"]), scope: checkString({ min: 1 }) })),
  scopeAssessments: checkArray(checkObject({ finding: operation, identity: exactCandidateCheck, applies: checkBool(), attestation: operation })),
  reviews: checkArray(checkObject({ id: operation, sequence: checkInt({ min: 1 }), actor, identity: exactCandidateCheck,
    value: checkEnum(["APPROVE", "OBJECT", "ACCEPT", "REQUEST_REVISION", "REJECT"]), revoked: checkBool() })),
});
const digest = checkString({ re: /^[0-9a-f]{64}$/ });
export const tieredAcceptanceCheck = checkObject({
  requested: riskTierCheck, effective: riskTierCheck, policyDigest: digest, authorityDigest: digest,
  reasons: checkArray(checkString()), approvers: checkArray(resident), objections: checkArray(operation),
  activeFloors: checkArray(operation), principalDecision: value => value === null ? null : operation(value),
  snapshot: snapshotCheck, policy: integrationPolicyEvidenceCheck,
});
export function tieredAcceptanceRelation(accepted: TieredAcceptance, identity: ExactCandidateIdentity,
  requester: string, checkDigest: string): string | null {
  const { snapshot, policy } = accepted;
  if (!sameExactCandidate(snapshot.identity, identity) || snapshot.requester !== requester || snapshot.requested !== accepted.requested)
    return "integration snapshot differs from accepted request identity";
  if (snapshot.repositoryFloor !== policy.tiered.repositoryFloor || snapshot.highPeerFloor !== policy.tiered.highPeerFloor ||
      snapshot.principalDelegated !== policy.tiered.principalDelegated)
    return "integration authority differs from the retained policy";
  if (sha256Hex(canonicalJson(policy)) !== accepted.policyDigest || sha256Hex(canonicalJson(policy.checks)) !== checkDigest)
    return "integration policy evidence differs from its digest";
  try {
    const result = evaluateTier(snapshot);
    if (result.missing.length !== 0 || result.digest !== accepted.authorityDigest || result.effectiveTier !== accepted.effective ||
        result.principalDecision !== accepted.principalDecision ||
        (["reasons", "approvers", "objections", "activeFloors"] as const).some(key =>
          canonicalJson(result[key]) !== canonicalJson(accepted[key])))
      return "integration decision differs from its retained evidence";
  } catch { return "integration authority evidence is inconsistent"; }
  return null;
}
