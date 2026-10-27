/** Pure Worker review status projection. Live authority, policy and ledger
 * observations belong to ReviewModule, which supplies the facts and omissions. */
import type { Oid } from "@oma/contracts/identity";
import type { ReviewFact } from "@oma/contracts/attestation";
import type { ReviewRequestStatus, ReviewStatusEntry } from "@oma/contracts/public-wire";
import type { ReviewState } from "@oma/domain/review-evaluation";
import { StoreError } from "@oma/domain/errors";

const PRINCIPAL = "principal";
export function workerReviewStatus(state: ReviewState,
    openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
    missing: readonly string[], main: { readonly oid: Oid | null; readonly observedAtMs: number },
    frameBytes: number, responseId: string): ReviewRequestStatus {
  const sent = state.entries.some(entry =>
    entry.messages.some(message => message.review?.role === "approval"));
  const latestPrincipal = [...state.entries].reverse()
    .find(entry => entry.fact.kind === "vote" && entry.actor === PRINCIPAL);
  const fixed = {
    name: state.name, kind: state.kind, tier: state.tier, title: openFact.title,
    reason: openFact.reason, requester: state.requester, identity: { ...state.identity },
    display: state.display, required: state.required,
    approvers: [...state.approvers], rejectors: [...state.rejectors],
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
  const detail = (entries: ReviewStatusEntry[], omitted: number): ReviewRequestStatus => ({ ...fixed,
    entries,
    missing: omitted === 0 ? [...missing] : [...missing, `${omitted} earlier ${omitted === 1 ? "entry" : "entries"} omitted for size`] });
  const bytesOf = (result: ReviewRequestStatus): number =>
    Buffer.byteLength(JSON.stringify({ v: 1, id: responseId, ok: true, result }));
  let answer = detail(projected, 0);
  if (bytesOf(answer) <= frameBytes) return answer;
  // Marginal accounting keeps the newest entries: the floor carries the
  // longest possible omission note, so per-entry costs are exact.
  const floor = detail([], projected.length);
  if (bytesOf(floor) > frameBytes)
    throw new StoreError("FRAME_TOO_LARGE", "one review status answer exceeds the response frame budget");
  let remaining = frameBytes - bytesOf(floor), kept = 0;
  for (let index = projected.length - 1; index >= 0; index--) {
    const cost = Buffer.byteLength(JSON.stringify(projected[index]!)) + (kept > 0 ? 1 : 0);
    if (cost > remaining) break;
    remaining -= cost; kept++;
  }
  answer = detail(projected.slice(projected.length - kept), projected.length - kept);
  // Verify the exact answer the wire carries, never the estimate.
  while (kept > 0 && bytesOf(answer) > frameBytes) {
    kept--;
    answer = detail(projected.slice(projected.length - kept), projected.length - kept);
  }
  return answer;
}
