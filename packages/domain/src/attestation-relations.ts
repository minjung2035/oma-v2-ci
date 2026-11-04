/** DR27: historical reference semantics, independent of today's permissions. */
import type { ReviewFact } from "@oma/contracts/attestation";

export function attestationTarget(fact: ReviewFact): string | null {
  switch (fact.kind) {
    case "merge.open": return null;
    case "challenge.open": return fact.target.request;
    case "review": case "vote": case "cancel": case "refresh":
    case "review.withdraw": case "review.invalidate": case "review.adopt":
    case "review.revise": case "review.integration": case "review.supersede": case "review.included":
    case "review.retry": case "review.preparation-failed": return fact.request;
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
      if (fact.version !== 1 && fact.qualification.role !== (actor === "principal" ? "principal" : "resident"))
        return "vote qualification role differs from actor";
      return request === null || request.open === null ? "a vote names an accepted review request" : null;
    case "review.withdraw": case "review.adopt":
      return request === null || request.open === null ? "a vote names an accepted review request" : null;
    case "review.invalidate":
      return actor !== "principal" ? "host invalidation belongs to the Principal identity"
        : request === null || request.open === null ? "invalidation names an accepted request" : null;
    case "cancel":
      if (request === null || request.open === null) return "a cancel names an accepted review request";
      return request.actor === actor ? null : "only the requester may cancel its request";
    case "review.revise": case "review.integration": case "review.supersede": case "review.included":
      return request?.actor === actor ? null : "broker-derived proposal fact belongs to its requester";
    case "review.retry":
      if (fact.version === 3 && fact.host === true) return actor === "principal" && request?.open ? null : "host retry needs the Principal host identity";
      return request?.actor === actor ? null : "requester retry identity differs";
    case "review.preparation-failed":
    case "refresh":
      if (request === null || request.open === null) return "a refresh names an accepted review request";
      return request.actor === actor ? null : "a refresh fact belongs to its requester";
  }
}
