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
const natural = (v: unknown): boolean => Number.isSafeInteger(v) && Number(v) >= 0;
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
    case "review.withdraw": case "review.invalidate":
      return object(row, ["kind", "name", "vote", "reason"]) && isReviewRequestName(row.name) &&
        isValidOperationId(row.vote) && boundedText(row.reason, text) ? null : "invalid review withdrawal";
    case "review.revise":
      return object(row, ["kind", "name", "expectedRevision", "base", "candidate", "reason"]) && isReviewRequestName(row.name) && natural(row.expectedRevision) && isValidFullOid(row.base) && isValidFullOid(row.candidate) && boundedText(row.reason, text) ? null : "invalid revision";
    case "review.retry":
      return (object(row, ["kind", "name", "expectedAttempt", "reason"]) || object(row, ["kind", "name", "expectedAttempt", "expectedRevision", "reason"])) && (row.expectedRevision === undefined || natural(row.expectedRevision)) && isReviewRequestName(row.name) &&
        (row.expectedAttempt === null || isValidOperationId(row.expectedAttempt)) && boundedText(row.reason, text) ? null : "invalid retry";
    case "review.adopt":
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
  if (row.version !== 1 && row.version !== 2 && row.version !== 3) return "unsupported review fact version";
  const v2 = row.version !== 1, v3 = row.version === 3;
  const policy = (value: unknown): boolean => object(value, ["maxWorkers", "highPeerFloor", "authorSlots"]) &&
    Number.isSafeInteger(value.maxWorkers) && Number(value.maxWorkers) >= 1 &&
    Number.isSafeInteger(value.highPeerFloor) && Number(value.highPeerFloor) >= 1 &&
    Number.isSafeInteger(value.authorSlots) && Number(value.authorSlots) >= 0;
  const qualification = (value: unknown): boolean => object(value, ["role", "incarnation", "specHash", "capability"]) &&
    (value.role === "resident" || value.role === "principal") && Number.isSafeInteger(value.incarnation) && Number(value.incarnation) >= 0 &&
    typeof value.specHash === "string" && /^[a-f0-9]{64}$/.test(value.specHash) && value.capability === "mail.send";
  if (v2 && !["merge.open", "challenge.open", "vote", "review.withdraw", "review.invalidate", "review.adopt", "review.retry", "review.preparation-failed", "review.revise", "review.integration", "review.supersede", "review.included"].includes(String(row.kind)))
    return "unsupported version for review fact";
  if (v3 && !["merge.open","challenge.open","vote","review.revise","review.integration","review.supersede","review.included","review.preparation-failed","review.adopt","review.retry"].includes(String(row.kind))) return "unsupported v3 fact";
  const request = typeof row.request === "string" && isValidOperationId(row.request);
  switch (row.kind) {
    case "merge.open":
      return object(row, ["kind", "version", "name", "title", "reason", "tier", "identity", "submitters", ...(v2 ? ["reviewPolicy"] : [])]) &&
        mergeRequestName(row.name) && reviewTier(row.tier) &&
        boundedText(row.title, Number.MAX_SAFE_INTEGER) && boundedText(row.reason, Number.MAX_SAFE_INTEGER) &&
        exactCandidateCheck(row.identity) === null && sortedUniqueActors(row.submitters) && (!v2 || policy(row.reviewPolicy))
        ? null : "invalid merge.open fact";
    case "challenge.open": {
      const targetOk = row.target !== null && typeof row.target === "object" && !Array.isArray(row.target) &&
        object(row.target as Record<string, unknown>, ["name", "request", "integration", "identity", "tier"]) &&
        isReviewRequestName((row.target as Record<string, unknown>).name) &&
        isValidOperationId((row.target as Record<string, unknown>).request) &&
        isValidOperationId((row.target as Record<string, unknown>).integration) &&
        exactCandidateCheck((row.target as Record<string, unknown>).identity) === null &&
        reviewTier((row.target as Record<string, unknown>).tier);
      return object(row, ["kind", "version", "name", "title", "reason", "tier", "identity", "submitters", "prepared", "target", ...(v2 ? ["reviewPolicy"] : [])]) &&
        challengeRequestName(row.name) &&
        (row.tier === "LOW" || row.tier === "HIGH") && typeof row.prepared === "boolean" &&
        boundedText(row.title, Number.MAX_SAFE_INTEGER) && boundedText(row.reason, Number.MAX_SAFE_INTEGER) &&
        exactCandidateCheck(row.identity) === null && sortedUniqueActors(row.submitters) && (!v2 || policy(row.reviewPolicy)) && targetOk
        ? null : "invalid challenge.open fact";
    }
    case "review":
      return object(row, ["kind", "version", "request", "body"]) && request &&
        boundedText(row.body, Number.MAX_SAFE_INTEGER) ? null : "invalid review fact";
    case "vote":
      return object(row, ["kind", "version", "request", "verdict", "body", "approval", ...(v2 ? ["qualification"] : []), ...(v3 ? ["revision", "scope"] : [])]) && request && (!v3 || (natural(row.revision) && (row.scope === null || isValidOperationId(row.scope)))) && (!v2 || qualification(row.qualification)) &&
        (row.verdict === "approve" || row.verdict === "reject") &&
        boundedText(row.body, Number.MAX_SAFE_INTEGER) &&
        (row.approval === null || isValidMessageId(row.approval)) ? null : "invalid vote fact";
    case "cancel":
      return object(row, ["kind", "version", "request", "reason"]) && request &&
        boundedText(row.reason, Number.MAX_SAFE_INTEGER) ? null : "invalid cancel fact";
    case "review.withdraw": case "review.invalidate":
      return v2 && object(row, ["kind", "version", "request", "vote", "reason"]) && request &&
        isValidOperationId(row.vote) && boundedText(row.reason, Number.MAX_SAFE_INTEGER) ? null : "invalid revocation fact";
    case "review.adopt":
      return v2 && object(row, ["kind", "version", "request", "reviewPolicy", "reason", ...(v3 ? ["revision","attemptNumber","identity","submitters"] : [])]) && request && (!v3 || (natural(row.revision) && natural(row.attemptNumber) && exactCandidateCheck(row.identity) === null && sortedUniqueActors(row.submitters))) &&
        policy(row.reviewPolicy) && boundedText(row.reason, Number.MAX_SAFE_INTEGER) ? null : "invalid adoption fact";
    case "review.retry":
      return v2 && object(row, ["kind", "version", "request", "expectedAttempt", "attemptNumber", "reason", ...(v3 ? ["host"] : [])]) && request && (!v3 || typeof row.host === "boolean") &&
        (row.expectedAttempt === null || isValidOperationId(row.expectedAttempt)) && Number.isSafeInteger(row.attemptNumber) && Number(row.attemptNumber) >= 1 &&
        boundedText(row.reason, Number.MAX_SAFE_INTEGER) ? null : "invalid retry fact";
    case "review.preparation-failed":
      return v2 && object(row, ["kind", "version", "request", "attemptNumber", "reason", "code", ...(v3 ? ["main","revision","policyRevision"] : [])]) && request && (!v3 || ((row.main === null || isValidFullOid(row.main)) && natural(row.revision) && typeof row.policyRevision === "string" && row.policyRevision.length > 0)) &&
        Number.isSafeInteger(row.attemptNumber) && Number(row.attemptNumber) >= 0 && boundedText(row.reason, Number.MAX_SAFE_INTEGER) &&
        typeof row.code === "string" && /^[A-Z_]+$/.test(row.code) ? null : "invalid preparation failure";
    case "review.revise":
      return v3 && object(row, ["kind", "version", "request", "revision", "attemptNumber", "identity", "submitters", "tier", "reviewPolicy", "reason"]) && request && natural(row.revision) && Number(row.revision) > 0 && natural(row.attemptNumber) && exactCandidateCheck(row.identity) === null && sortedUniqueActors(row.submitters) && reviewTier(row.tier) && policy(row.reviewPolicy) && boundedText(row.reason, Number.MAX_SAFE_INTEGER) ? null : "invalid revision fact";
    case "review.integration": {
      const d = row.diff;
      return v3 && object(row, ["kind", "version", "request", "revision", "identity", "source", "sourceOperation", "preparedRef", "context", "tier", "checkProfileDigest", "policyIdentity", "reviewPolicy", "diff"]) && request && natural(row.revision) && exactCandidateCheck(row.identity) === null && exactCandidateCheck(row.source) === null && isValidOperationId(row.sourceOperation) && (row.preparedRef === null || (typeof row.preparedRef === "string" && /^refs\/oma\/prepared\/op-[a-f0-9-]{36}$/.test(row.preparedRef))) && typeof row.context === "boolean" && reviewTier(row.tier) && policy(row.reviewPolicy) && [row.checkProfileDigest,row.policyIdentity].every(v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)) && object(d,["version","base","candidate","reference","bytes","sha256"]) && d.version === 1 && isValidFullOid(d.base) && isValidFullOid(d.candidate) && natural(d.bytes) && typeof d.sha256 === "string" && /^[a-f0-9]{64}$/.test(d.sha256) && typeof d.reference === "string" && /^oma-result:[a-f0-9-]{36}:[a-f0-9]{64}$/.test(d.reference) ? null : "invalid integration preparation";
    }
    case "review.supersede":
      return v3 && object(row,["kind","version","request","attemptNumber","expectedAttempt","main","reason"]) && request && natural(row.attemptNumber) && (row.expectedAttempt === null || isValidOperationId(row.expectedAttempt)) && isValidFullOid(row.main) && boundedText(row.reason,Number.MAX_SAFE_INTEGER) ? null : "invalid supersession";
    case "review.included":
      return v3 && object(row,["kind","version","request","revision","candidate","main"]) && request && natural(row.revision) && isValidFullOid(row.candidate) && isValidFullOid(row.main) ? null : "invalid inclusion";
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
      ["refresh", "review.preparation-failed", "review.integration", "review.supersede", "review.included"].includes(String((value as { kind?: unknown }).kind)))
    return reviewFactProblem(value) === null ? null : "refresh facts are broker-derived";
  return reviewInputProblem(value, limits);
}
