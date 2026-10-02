/** DR27: historical reference semantics, independent of today's permissions. */
import type { AttestationInput } from "../../implementation/contracts/attestation.js";
import type { ExactCandidateIdentity } from "../../implementation/contracts/values.js";

export interface AttestationReference {
  readonly actor: string;
  readonly fact: AttestationInput | null;
  readonly integrated: ExactCandidateIdentity | null;
}
export function sameExactCandidate(a: ExactCandidateIdentity, b: ExactCandidateIdentity): boolean {
  return a.repo === b.repo && a.targetRef === b.targetRef && a.expectedBase === b.expectedBase &&
    a.candidate === b.candidate && a.policyRevision === b.policyRevision;
}
export function attestationTarget(fact: AttestationInput): string | null {
  switch (fact.kind) {
    case "peer": case "decision": return null;
    case "revoke": return fact.attestation;
    case "challenge": return fact.integration;
    case "finding": return fact.challenge;
    case "scope": return fact.finding;
  }
}
export function attestationRelationProblem(actor: string, fact: AttestationInput, target: AttestationReference | null): string | null {
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
