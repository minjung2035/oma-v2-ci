/** DR27: historical reference semantics, independent of today's permissions. */
import type { LegacyAttestationInput, ReviewFact } from "../../implementation/contracts/attestation.js";
import type { ExactCandidateIdentity } from "../../implementation/contracts/values.js";

export interface AttestationReference {
  readonly actor: string;
  readonly fact: LegacyAttestationInput | ReviewFact | null;
  readonly integrated: ExactCandidateIdentity | null;
}
export function sameExactCandidate(a: ExactCandidateIdentity, b: ExactCandidateIdentity): boolean {
  return a.repo === b.repo && a.targetRef === b.targetRef && a.expectedBase === b.expectedBase &&
    a.candidate === b.candidate && a.policyRevision === b.policyRevision;
}
export function attestationTarget(fact: LegacyAttestationInput | ReviewFact): string | null {
  switch (fact.kind) {
    case "peer": case "decision": case "merge.open": return null;
    case "revoke": return fact.attestation;
    case "challenge": return fact.integration;
    case "finding": return fact.challenge;
    case "scope": return fact.finding;
    case "challenge.open": return fact.target.request;
    case "review": case "vote": case "cancel": case "refresh": return fact.request;
  }
}
export function attestationRelationProblem(actor: string, fact: LegacyAttestationInput, target: AttestationReference | null): string | null {
  if (["decision", "finding", "scope"].includes(fact.kind) && actor !== "principal") return "only the Principal may author this fact";
  if (["peer", "challenge"].includes(fact.kind) && actor === "principal") return "only a Resident may author this fact";
  switch (fact.kind) {
    case "peer": case "decision": return null;
    case "revoke":
      return target?.actor === actor && target.fact !== null && ["peer", "decision", "finding", "scope"].includes(target.fact.kind)
        ? null : "only the fact's author may revoke a review, finding or scope assessment";
    case "challenge":
      return target?.integrated && sameExactCandidate(fact.identity, target.integrated)
        ? null : "a challenge must name a succeeded integration receipt with the same exact identity";
    case "finding": return target?.fact?.kind === "challenge" ? null : "a finding must name an accepted challenge";
    case "scope": return target?.fact?.kind === "finding" && target.fact.valid
      ? null : "a scope assessment must name a valid finding";
  }
}

/** The decoded open request a review fact names, or null when it is not one. */
export interface ReviewRequestReference {
  readonly actor: string;
  readonly open: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }> | null;
}

/** Structural author/target relations of a review fact. Live rules
 * (SELF_REVIEW, quorum, staleness) belong to the accepting module, not decode. */
export function reviewFactRelationProblem(actor: string, fact: ReviewFact, request: ReviewRequestReference | null): string | null {
  switch (fact.kind) {
    case "merge.open":
      return actor === "principal" ? "the Principal may only author a review vote" : null;
    case "challenge.open":
      if (actor === "principal") return "the Principal may only author a review vote";
      return request?.open !== null && request?.open !== undefined && request.open.name === fact.target.name
        ? null : "a challenge must name an accepted review request";
    case "review":
      if (request === null || request.open === null) return "a review names an accepted review request";
      return actor === "principal" ? "the Principal may only author a review vote" : null;
    case "vote":
      return request === null || request.open === null ? "a vote names an accepted review request" : null;
    case "cancel":
      if (request === null || request.open === null) return "a cancel names an accepted review request";
      return request.actor === actor ? null : "only the requester may cancel its request";
    case "refresh":
      if (request === null || request.open === null) return "a refresh names an accepted review request";
      return request.actor === actor ? null : "a refresh fact belongs to its requester";
  }
}
