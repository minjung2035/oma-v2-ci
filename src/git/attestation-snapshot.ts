/** TIER/CHAL: one ordered projection of immutable facts. Desired state, current
 * delegation and delivery observations cannot silently revoke accepted evidence. */
import type { ExactCandidateIdentity } from "../../implementation/contracts/values.js";
import type { OperationOf } from "../storage/operation-codec.js";
import { StoreError } from "../domain/errors.js";
import { sameExactCandidate } from "../domain/attestation-relations.js";
import type { TieredReviewFact, ChallengeFloor, ScopeAssessment } from "./approval.js";

export function attestationSnapshot(rows: readonly { readonly sequence: number; readonly operation: OperationOf<"attest.record"> }[],
  identity: ExactCandidateIdentity): { readonly reviews: readonly TieredReviewFact[]; readonly floors: readonly ChallengeFloor[];
    readonly scopeAssessments: readonly ScopeAssessment[] } {
  const ids = new Set<string>(); let last = 0;
  const revoked = new Set<string>();
  for (const { sequence, operation } of rows) {
    if (!Number.isSafeInteger(sequence) || sequence <= last || ids.has(operation.id))
      throw new StoreError("STORE_CORRUPT", "attestation facts are not in unique acceptance order");
    last = sequence; ids.add(operation.id);
    if (operation.plan.fact.kind === "revoke") revoked.add(operation.plan.fact.attestation);
  }
  const reviews: TieredReviewFact[] = [], floors: ChallengeFloor[] = [];
  const scope = new Map<string, ScopeAssessment | null>();
  for (const { sequence, operation } of rows) {
    const fact = operation.plan.fact;
    if (fact.kind === "peer" || fact.kind === "decision") reviews.push(Object.freeze({ id: operation.id, sequence,
      actor: operation.actor, identity: fact.identity, value: fact.verdict, revoked: revoked.has(operation.id) }));
    if (fact.kind === "finding" && fact.valid && !revoked.has(operation.id)) {
      if (fact.floor === null) throw new StoreError("STORE_CORRUPT", "valid finding has no floor");
      floors.push(Object.freeze({ finding: operation.id, minimum: fact.floor, scope: fact.scope }));
    }
    if (fact.kind === "scope" && sameExactCandidate(fact.identity, identity))
      scope.set(fact.finding, revoked.has(operation.id) ? null : Object.freeze({ finding: fact.finding,
        identity: fact.identity, applies: fact.applies, attestation: operation.id }));
  }
  return Object.freeze({ reviews: Object.freeze(reviews), floors: Object.freeze(floors),
    scopeAssessments: Object.freeze([...scope.values()].filter((value): value is ScopeAssessment => value !== null)) });
}
