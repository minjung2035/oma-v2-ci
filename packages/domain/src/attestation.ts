/** Closed fact grammar shared by wire and immutable ledger decoding. */
import { exactCandidateCheck } from "./mail-values.js";
import { isValidActor, isValidFullOid, isValidMessageId, isValidOperationId, isReviewRequestName } from "./identifiers.js";
function object(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
// ---------------------------------------------------------------------------
// mail-v1 review grammar: caller inputs (ReviewInput) and the broker-frozen
// facts (ReviewFact) that plan.fact carries for those operations.
// ---------------------------------------------------------------------------

const boundedText = (value: unknown, maxBytes: number): boolean =>
  typeof value === "string" && value.trim().length > 0 && !/\p{Cs}/u.test(value) &&
  Buffer.byteLength(value, "utf8") <= maxBytes;
const reviewTitle = (value: unknown, maxBytes: number): boolean =>
  boundedText(value, maxBytes) && !/[\r\n\0]/.test(value as string);
const reviewTier = (value: unknown): boolean =>
  value === "LOW" || value === "MEDIUM" || value === "HIGH";
/** A challenge names the merge request it reverts. */
const mergeRequestName = (value: unknown): boolean =>
  typeof value === "string" && value.startsWith("merge-") && isReviewRequestName(value);
const challengeRequestName = (value: unknown): boolean =>
  typeof value === "string" && value.startsWith("challenge-") && isReviewRequestName(value);
const sortedUniqueActors = (value: unknown): boolean =>
  Array.isArray(value) && value.every(actor => isValidActor(actor)) &&
  value.every((actor, index) => index === 0 || (value[index - 1] as string) < (actor as string));

export interface ReviewInputLimits { readonly mailBodyBytes: number; readonly subjectBytes: number }

/** The attest.record caller grammar for the review kinds; `refresh` is never
 * a caller input. */
export function reviewInputProblem(value: unknown, limits: ReviewInputLimits): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "expected attestation object";
  const row = value as Record<string, unknown>;
  const text = Math.floor(limits.mailBodyBytes / 4);
  switch (row.kind) {
    case "merge.open":
      return object(row, ["kind", "tier", "title", "reason", "candidate", "base"]) && reviewTier(row.tier) &&
        reviewTitle(row.title, limits.subjectBytes) && boundedText(row.reason, text) &&
        isValidFullOid(row.candidate) && isValidFullOid(row.base)
        ? null : "invalid merge request";
    case "challenge.open":
      if (!(object(row, ["kind", "merge", "tier", "title", "reason"]) ||
          object(row, ["kind", "merge", "tier", "title", "reason", "candidate", "base"])))
        return "invalid challenge request";
      // Any review request name passes grammar; acceptance decides it is a merge.
      if (!isReviewRequestName(row.merge) || (row.tier !== "LOW" && row.tier !== "HIGH") ||
          !reviewTitle(row.title, limits.subjectBytes) || !boundedText(row.reason, text))
        return "invalid challenge request";
      return row.candidate === undefined ? null
        : isValidFullOid(row.candidate) && isValidFullOid(row.base) ? null : "invalid challenge candidate/base";
    case "review":
      return object(row, ["kind", "name", "body"]) && isReviewRequestName(row.name) && boundedText(row.body, text)
        ? null : "invalid review";
    case "vote":
      if (!(object(row, ["kind", "name", "verdict", "body"]) ||
          object(row, ["kind", "name", "verdict", "body", "approval"])))
        return "invalid vote";
      if (!isReviewRequestName(row.name) || (row.verdict !== "approve" && row.verdict !== "reject") ||
          !boundedText(row.body, text))
        return "invalid vote";
      return row.approval === undefined || isValidMessageId(row.approval) ? null : "invalid vote approval";
    case "cancel":
      return object(row, ["kind", "name", "reason"]) && isReviewRequestName(row.name) && boundedText(row.reason, text)
        ? null : "invalid cancel";
    default: return "unknown attestation kind";
  }
}

/** The frozen plan.fact grammar for review operations. */
export function reviewFactProblem(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "expected attestation object";
  const row = value as Record<string, unknown>;
  if (row.version !== 1) return "review fact must declare version 1";
  const request = typeof row.request === "string" && isValidOperationId(row.request);
  switch (row.kind) {
    case "merge.open":
      return object(row, ["kind", "version", "name", "title", "reason", "tier", "identity", "submitters"]) &&
        mergeRequestName(row.name) && reviewTier(row.tier) &&
        boundedText(row.title, Number.MAX_SAFE_INTEGER) && boundedText(row.reason, Number.MAX_SAFE_INTEGER) &&
        exactCandidateCheck(row.identity) === null && sortedUniqueActors(row.submitters)
        ? null : "invalid merge.open fact";
    case "challenge.open": {
      const targetOk = row.target !== null && typeof row.target === "object" && !Array.isArray(row.target) &&
        object(row.target as Record<string, unknown>, ["name", "request", "integration", "identity", "tier"]) &&
        isReviewRequestName((row.target as Record<string, unknown>).name) &&
        isValidOperationId((row.target as Record<string, unknown>).request) &&
        isValidOperationId((row.target as Record<string, unknown>).integration) &&
        exactCandidateCheck((row.target as Record<string, unknown>).identity) === null &&
        reviewTier((row.target as Record<string, unknown>).tier);
      return object(row, ["kind", "version", "name", "title", "reason", "tier", "identity", "submitters", "prepared", "target"]) &&
        challengeRequestName(row.name) &&
        (row.tier === "LOW" || row.tier === "HIGH") && typeof row.prepared === "boolean" &&
        boundedText(row.title, Number.MAX_SAFE_INTEGER) && boundedText(row.reason, Number.MAX_SAFE_INTEGER) &&
        exactCandidateCheck(row.identity) === null && sortedUniqueActors(row.submitters) && targetOk
        ? null : "invalid challenge.open fact";
    }
    case "review":
      return object(row, ["kind", "version", "request", "body"]) && request &&
        boundedText(row.body, Number.MAX_SAFE_INTEGER) ? null : "invalid review fact";
    case "vote":
      return object(row, ["kind", "version", "request", "verdict", "body", "approval"]) && request &&
        (row.verdict === "approve" || row.verdict === "reject") &&
        boundedText(row.body, Number.MAX_SAFE_INTEGER) &&
        (row.approval === null || isValidMessageId(row.approval)) ? null : "invalid vote fact";
    case "cancel":
      return object(row, ["kind", "version", "request", "reason"]) && request &&
        boundedText(row.reason, Number.MAX_SAFE_INTEGER) ? null : "invalid cancel fact";
    case "refresh":
      return object(row, ["kind", "version", "request", "main"]) && request &&
        (row.main === null || isValidFullOid(row.main)) ? null : "invalid refresh fact";
    default: return "unknown attestation kind";
  }
}


/** Current caller grammar plus the persisted payload of broker-derived refresh.
 * Derived keys remain forbidden on the public wire; fresh refresh is refused. */
export function attestationInputProblem(value: unknown, limits: ReviewInputLimits): string | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value) &&
      (value as { kind?: unknown }).kind === "refresh")
    return reviewFactProblem(value) === null ? null : "refresh facts are broker-derived";
  return reviewInputProblem(value, limits);
}
