/** Pure Worker review status projection. Live authority, policy and ledger
 * observations belong to ReviewModule, which supplies the facts and omissions. */
import type { Oid } from "@oma/contracts/identity";
import type { ReviewFact } from "@oma/contracts/attestation";
import type { ReviewRequestStatus, ReviewStatusEntry, ReviewReviewer } from "@oma/contracts/public-wire";
import type { ReviewState } from "@oma/domain/review-evaluation";
import { StoreError } from "@oma/domain/errors";

const PRINCIPAL = "principal";
export function integrationStatus(state: ReviewState, main: { oid: Oid | null }, blocked = false, live?: string) {
  const applied = state.integration?.state === "succeeded" ||
    ((state.integration?.state === "pending" || state.integration?.state === "unknown") && main.oid === (state.integration.diff?.candidate ?? state.identity.candidate));
  const integrationPhase = state.included !== null && state.integration === null ? "already-included" : applied ? "applied" : main.oid === null ? "unknown" : blocked ? "blocked" : live ??
    (["peer-needed", "principal-pending"].includes(state.display) ? "review-needed" : state.display);
  const requiresRevision = state.preparationFailure?.code === "REVERT_CONFLICT";
  const closed = state.included !== null || state.terminal !== null;
  const retryable = main.oid !== null && !applied && !closed && !blocked && !requiresRevision && (state.preparationFailure !== null || state.integration?.state === "failed");
  return { revision: state.revision, scope: state.scope, proposal: state.sourceIdentity,
    ...(state.preparation ? {contextDiff:state.preparation.fact.diff} : {}), attemptNumber: state.attemptNumber, ...(state.integration?.diff === undefined ? {} : { diff: state.integration.diff }),
    integrationPhase, notice: applied ? state.integration?.state === "succeeded" ? "delivered" as const : "pending" as const : "none" as const,
    retryable, nextAction: applied || closed ? "none" : requiresRevision ? "requester-revise" : main.oid === null ? "observe-main" : state.integration?.state === "unknown" || state.integration?.state === "pending" ? "observe-existing-attempt"
      : blocked ? "resolve-current-conditions" : retryable ? "requester-retry" : state.ready ? "await-integration" : "review" };
}
export function reviewDisplay(state: ReviewState, main: { oid: Oid | null }, blocked = false, live?: string): string {
  const phase = integrationStatus(state, main, blocked, live).integrationPhase;
  return phase === "review-needed" ? state.display : phase;
}
export function workerReviewStatus(state: ReviewState,
    openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
    missing: readonly string[], main: { readonly oid: Oid | null; readonly observedAtMs: number },
    frameBytes: number, responseId: string, reviewers: readonly ReviewReviewer[], blocked = false, live?: string): ReviewRequestStatus {
  const sent = state.approvalSent;
  const latestPrincipal = [...state.entries].reverse()
    .find(entry => entry.fact.kind === "vote" && entry.actor === PRINCIPAL);
  const fixed = {
    name: state.name, kind: state.kind, tier: state.tier, title: openFact.title,
    reason: openFact.reason, requester: state.requester, identity: { ...state.identity },
    ...integrationStatus(state, main, blocked, live),
    display: reviewDisplay(state, main, blocked, live), required: state.required,
    normalRequired: state.normalRequired, maxWorkers: state.maxWorkers,
    capacityFallback: state.capacityFallback, principalRequired: state.principalRequired,
    approvers: [...state.approvers], rejectors: [...state.rejectors],
    observedAtMs: main.observedAtMs, remainingApprovals: Math.max(0, state.required - state.approvers.length),
    acceptingWorkerVotes: !(state.kind === "merge" && state.tier === "LOW") && state.terminal === null && state.included === null && state.integration === null,
    principal: { approval: state.approval?.id ?? null, sent,
      // The latest Principal vote on this request — still shown after its
      // approval lapsed (a reject's own op withdraws it).
      decision: latestPrincipal !== undefined && latestPrincipal.fact.kind === "vote"
        ? latestPrincipal.fact.verdict : null,
      decisionApproval: latestPrincipal !== undefined && latestPrincipal.fact.kind === "vote"
        ? latestPrincipal.fact.approval : null },
    integration: state.integration === null ? null
      : { operation: state.integration.operation, state: state.integration.state,
          error: state.integration.errorCode },
    main,
    ...(openFact.kind === "challenge.open" ? { target: { name: openFact.target.name,
      integration: openFact.target.integration, identity: { ...openFact.target.identity } } } : {}),
  };
  const projected: ReviewStatusEntry[] = state.entries.map((entry, index) => ({
    index: index + 1, sequence: entry.sequence, actor: entry.actor,
    kind: entry.fact.kind as ReviewStatusEntry["kind"],
    ...(entry.fact.kind === "vote" ? { verdict: entry.fact.verdict } : {}) }));
  const detail = (entries: ReviewStatusEntry[], omitted: number, items: ReviewReviewer[], next: string | null): ReviewRequestStatus => ({
    ...fixed, entries, reviewers: { items, next },
    missing: omitted === 0 ? [...missing] : [...missing, `${omitted} earlier ${omitted === 1 ? "entry" : "entries"} omitted for size`] });
  const bytesOf = (result: ReviewRequestStatus): number =>
    Buffer.byteLength(JSON.stringify({ v: 1, id: responseId, ok: true, result }));
  const full = detail(projected, 0, [...reviewers], null);
  if (bytesOf(full) <= frameBytes) return full;
  const available = frameBytes - bytesOf(detail([], projected.length, [], null));
  const cursorCost = (row: ReviewReviewer, hasMore: boolean): number =>
    hasMore ? Buffer.byteLength(JSON.stringify(row.name)) - 4 : 0;
  const entryMinimum = projected.length ? Buffer.byteLength(JSON.stringify(projected.at(-1))) : 0;
  const firstReviewer = reviewers.length
    ? Buffer.byteLength(JSON.stringify(reviewers[0])) + cursorCost(reviewers[0]!, reviewers.length > 1) : 0;
  if (available < firstReviewer + entryMinimum)
    throw new StoreError("FRAME_TOO_LARGE", "review metadata and one observation row exceed the response frame budget");
  // Reserve a usable page for reviewers and at least the latest ledger entry.
  const reviewerBudget = Math.min(available - entryMinimum,
    projected.length ? Math.max(firstReviewer, Math.floor(available / 2)) : available);
  const items: ReviewReviewer[] = [];
  let rowBytes = 0, used = 0;
  for (let index = 0; index < reviewers.length; index++) {
    const row = reviewers[index]!;
    const cost = Buffer.byteLength(JSON.stringify(row)) + (items.length ? 1 : 0);
    const candidateBytes = rowBytes + cost + cursorCost(row, index + 1 < reviewers.length);
    if (candidateBytes > reviewerBudget) break;
    rowBytes += cost; used = candidateBytes; items.push(row);
  }
  const next = items.length < reviewers.length ? items.at(-1)!.name : null;
  let kept = 0;
  for (let index = projected.length - 1; index >= 0; index--) {
    const cost = Buffer.byteLength(JSON.stringify(projected[index])) + (kept ? 1 : 0);
    if (used + cost > available) break;
    used += cost; kept++;
  }
  const answer = detail(projected.slice(projected.length - kept), projected.length - kept, items, next);
  if (bytesOf(answer) > frameBytes) throw new StoreError("FRAME_TOO_LARGE", "review observation exceeds its response frame");
  return answer;
}
