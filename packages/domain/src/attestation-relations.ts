/** DR27: historical reference semantics, independent of today's permissions. */
import type { ReviewFact } from "@oma/contracts/attestation";

export function attestationTarget(fact: ReviewFact): string | null {
  switch (fact.kind) {
    case "merge.open": return null;
    case "challenge.open": return fact.target.request;
    case "review": case "vote": case "cancel": case "refresh": return fact.request;
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
