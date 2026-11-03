/** Read-only review projection; observing it grants no authority. */
import type { AuthContext, Oid, OperationId, MessageId } from "@oma/contracts";
import type { ReviewRequestSummary, ReviewStatusResult, ReviewStatusQuery, ReviewRequestList, ReviewPrincipalStatus } from "@oma/contracts/public-wire";
import { StoreError, errorCodeOf } from "@oma/domain/errors";
import { reviewState, type ReviewStateInput, type ReviewState } from "@oma/domain/review-evaluation";
import { workerReviewStatus, integrationStatus, reviewDisplay } from "./status-projection.js";
import { ReviewAuthorityReader } from "./authority.js";
import { PRINCIPAL, isOpenFact, type OpenRequest, type ReviewEffects } from "./types.js";
export type ReviewRecordObservation = { readonly societyBirth?: string; readonly targets?: readonly import("@oma/domain/collaboration-targets").CollaborationTarget[] } & (
  | { readonly role: "resident"; readonly request: OperationId; readonly name: string; readonly state: ReviewState;
      readonly status: ReturnType<typeof workerReviewStatus>; readonly input: ReviewStateInput; readonly attempts?: readonly import("./authority.js").ReviewIntegrationRecord[]; readonly main: { readonly oid: Oid | null; readonly observedAtMs: number } }
  | { readonly role: "principal"; readonly request: OperationId; readonly name: string; readonly revision: number;
      readonly status: ReviewPrincipalStatus; readonly ownVote: null | { readonly operation: OperationId; readonly approval: MessageId | null;
        readonly revision: number | null; readonly scope: OperationId | null } });
export class ReviewStatus {
  constructor(private readonly ledger: ReviewAuthorityReader,
    private readonly effects: Pick<ReviewEffects, "main" | "currentPolicy" | "executionPhase">,
    private readonly approvalPublished: (id: MessageId) => boolean) {}
  /** The main observation shared by every status answer: present → oid,
   * anything unobservable → null, corrupt → STORE_CORRUPT. */
  private mainObservation(): { oid: Oid | null; observedAtMs: number } {
    const main = this.effects.main();
    if (main.kind === "corrupt")
      throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
    return { oid: main.kind === "present" ? main.value : null, observedAtMs: Date.now() };
  }

  /** A pure read over the review ledger: Workers get the full detail or the
   * bounded list; the Principal gets the minimal view of a request it can see. */
  status(auth: AuthContext, query: ReviewStatusQuery, frameBytes: number, responseId: string): ReviewStatusResult {
    const main = this.mainObservation();
    if (auth.role === "principal") {
      if (query.reviewerAfter !== undefined) throw new StoreError("CAPABILITY_DENIED", "reviewer observations belong to Workers");
      return this.principalStatus(query.name, main);
    }
    if (query.name !== undefined) return this.workerStatus(query.name, main, frameBytes, responseId, query.reviewerAfter);
    const opens = this.ledger.projection().reverse().filter(({ open }) => open.operation.plan.fact.kind === `${query.kind}.open`);
    let start = 0;
    if (query.after !== undefined) {
      const cursor = opens.findIndex(({ open }) => isOpenFact(open.operation.plan.fact) && open.operation.plan.fact.name === query.after);
      if (cursor < 0) throw new StoreError("INVALID_REQUEST", "unknown review list cursor");
      start = cursor + 1;
    }
    const requests: ReviewRequestSummary[] = [];
    const summaryOf = (open: OpenRequest,
        state: ReviewState): ReviewRequestSummary => {
      const plan = open.operation.plan;
      if (!("messages" in plan) || !isOpenFact(plan.fact))
        throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
      return { name: state.name, kind: state.kind, tier: state.tier, title: plan.fact.title,
        requester: state.requester, display: reviewDisplay(state, main, this.blockingConditions(open, state).length > 0, this.effects.executionPhase?.(state.request)) };
    };
    const result: ReviewRequestList = { requests, omitted: opens.length - start, next: null, main };
    const baseBytes = Buffer.byteLength(JSON.stringify({ v: 1, id: responseId, ok: true, result }));
    if (baseBytes > frameBytes) throw new StoreError("FRAME_TOO_LARGE", "review list metadata exceeds the response frame");
    const initialOmittedBytes = String(result.omitted).length;
    let rowBytes = 0;
    for (let index = start; index < opens.length; index++) {
      const { open, input } = opens[index]!;
      const row = summaryOf(open, reviewState(input));
      const cost = Buffer.byteLength(JSON.stringify(row)) + (requests.length ? 1 : 0);
      const omitted = opens.length - index - 1;
      const next = omitted > 0 ? row.name : null;
      const cursorBytes = next === null ? 0 : Buffer.byteLength(JSON.stringify(next)) - 4;
      if (baseBytes + rowBytes + cost + cursorBytes + String(omitted).length - initialOmittedBytes > frameBytes) {
        if (requests.length === 0) throw new StoreError("FRAME_TOO_LARGE", "one review list row exceeds the response frame");
        break;
      }
      requests.push(row); rowBytes += cost;
      result.omitted = omitted;
      result.next = next;
    }
    return result;
  }

  /** Both reviewer and ledger observations are bounded and explicitly paged. */
  private workerStatus(name: string, main: { oid: Oid | null; observedAtMs: number },
      frameBytes: number, responseId: string, reviewerAfter?: string): ReviewStatusResult {
    const open = this.ledger.requestByName(name);
    if (open === null) throw new StoreError("INVALID_REQUEST", `unknown request ${name}`);
    const inputFor = this.ledger.inputFor(open);
    const state = reviewState(inputFor);
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    const conditions = this.blockingConditions(open, state);
    const missing = [...state.missing, ...conditions], blocked = conditions.length > 0;
    const reviewers = this.ledger.reviewers(state).filter(row => reviewerAfter === undefined || row.name > reviewerAfter);
    return workerReviewStatus(state, openFact, missing, main, frameBytes, responseId, reviewers, blocked, this.effects.executionPhase?.(state.request));
  }

  private blockingConditions(open: OpenRequest, state: ReviewState): string[] {
    if (state.terminal !== null || state.integration?.state === "succeeded") return [];
    const conditions = this.ledger.executionConditions(open, state);
    try { const current = this.effects.currentPolicy(); if (current.policyRevision !== state.identity.policyRevision) conditions.push(`the host policy revision changed (now ${current.policyRevision}); preserve the original scope; a distinct current-policy proposal requires fresh review`); }
    catch (error) {
      if (errorCodeOf(error) === "STORE_CORRUPT") throw error; // Reach the original admission fence, not a merely blocked display.
      conditions.push("host policy cannot be read now");
    }
    return conditions;
  }

  /** One role-scoped observation pass; no effect authority or read-to-ACK. The
   * Principal branch never returns raw entries, messages, authors or reviewers. */
  records(auth: AuthContext): readonly ReviewRecordObservation[] {
    const main = this.mainObservation(), result: ReviewRecordObservation[] = [];
    for (const { open, input } of this.ledger.projection()) {
      const state = reviewState(input);
      if (auth.role === "resident") {
        const fact = input.open.fact;
        if (!isOpenFact(fact)) throw new StoreError("STORE_CORRUPT", "review record names a non-open fact");
        const conditions = this.blockingConditions(open, state);
        result.push({ role: "resident", request: state.request, name: state.name, state, input, main, attempts: this.ledger.integrationRecords(open, input),
          status: workerReviewStatus(state, fact, [...state.missing, ...conditions], main, Number.MAX_SAFE_INTEGER,
            "records", this.ledger.reviewers(state), conditions.length > 0, this.effects.executionPhase?.(state.request)) });
      }
      else {
        const status = this.principalProjection(open, input, state, main);
        if (status === null) continue;
        const vote = state.principal;
        result.push({ role: "principal", request: state.request, name: state.name, revision: state.revision, status,
          ownVote: vote?.fact.kind === "vote" ? { operation: vote.operation, approval: vote.fact.approval,
            revision: vote.fact.version === 3 ? vote.fact.revision : null, scope: vote.fact.version === 3 ? vote.fact.scope : null } : null });
      }
    }
    return result;
  }

  /** The Principal sees a request only when an approval mail reached it or the
   * request applied; guessed names and invisible names have the same refusal. */
  private principalStatus(name: string | undefined, main: { oid: Oid | null; observedAtMs: number }): ReviewStatusResult {
    const refuse = (): never => { throw new StoreError("CAPABILITY_DENIED",
      name === undefined ? "no request is visible to the Principal" : `no request ${name} is visible to the Principal`); };
    if (name === undefined) return refuse();
    const open = this.ledger.openRequests().find(candidate => {
      const plan = candidate.operation.plan;
      return "messages" in plan && isOpenFact(plan.fact) && plan.fact.name === name;
    });
    if (open === undefined) return refuse();
    const input = this.ledger.inputFor(open), state = reviewState(input);
    return this.principalProjection(open, input, state, main) ?? refuse();
  }
  private principalProjection(open: OpenRequest, input: ReviewStateInput, state: ReviewState,
      main: { oid: Oid | null; observedAtMs: number }): ReviewPrincipalStatus | null {
    const visible = integrationStatus(state, main).integrationPhase === "applied" ||
      input.open.messages.some(message => message.review?.role === "approval" && message.recipients.includes(PRINCIPAL) && this.approvalPublished(message.id)) ||
      state.entries.some(entry => entry.messages.some(message => message.review?.role === "approval" &&
        message.recipients.includes(PRINCIPAL) && this.approvalPublished(message.id)));
    if (!visible) return null;
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    const blocked = this.blockingConditions(open, state).length > 0;
    return {
      name: state.name, kind: state.kind, tier: state.tier, title: openFact.title,
      observedAtMs: main.observedAtMs, identity: { ...state.identity }, ...integrationStatus(state, main, blocked, this.effects.executionPhase?.(state.request)),
      approval: state.approval !== null && state.approvalValid && this.approvalPublished(state.approval.id) ? state.approval.id : null,
      display: reviewDisplay(state, main, blocked, this.effects.executionPhase?.(state.request)),
      ...(openFact.kind === "challenge.open" ? { target: { name: openFact.target.name,
        integration: openFact.target.integration, identity: { ...openFact.target.identity } } } : {}),
    };
  }
}
