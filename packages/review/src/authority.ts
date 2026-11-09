/** Validated review reads and acceptance re-derivation. No writes or Git I/O. */
import type { ReviewFact } from "@oma/contracts/attestation";
import type { Actor, OperationId, RequestKey } from "@oma/contracts";
import type { AgentRow } from "@oma/contracts/ledger";
import type { ReviewReviewer } from "@oma/contracts/public-wire";
import { capabilitiesOf } from "@oma/domain/authority";
import type { DecodedOperation } from "@oma/protocol/operation-codec";
import { StoreError } from "@oma/domain/errors";
import { applyRequestKeyFor } from "@oma/domain/identifiers";
import { reviewState, sameReviewDecision, type ReviewEntry, type ReviewStateInput, type ReviewState } from "@oma/domain/review-evaluation";
import { isOpenFact, type OpenRequest, type PreparedReview } from "./types.js";
export interface ReviewAuthorityLedger {
  attestationFacts(): readonly OpenRequest[];
  getOperation(actor: Actor, key: RequestKey): DecodedOperation | null;
  listAgents(): readonly Pick<AgentRow, "name" | "role" | "desired" | "specJson">[];
}
export interface ReviewIntegrationRecord {
  readonly attemptNumber: number;
  readonly revision: number;
  readonly integration: NonNullable<ReviewStateInput["integration"]>;
}
export class ReviewAuthorityReader {
  constructor(private readonly store: ReviewAuthorityLedger,
    private readonly highPeerFloor: number, private readonly maxWorkers: number,
    private readonly provenance?: (base: string, candidate: string) => readonly string[]) {}
  /** Live open requests in attestation sequence order. */
  openRequests(): OpenRequest[] {
    return this.store.attestationFacts().filter(entry =>
      "messages" in entry.operation.plan && isOpenFact(entry.operation.plan.fact));
  }

  requestByName(name: string): OpenRequest | null {
    let found: OpenRequest | null = null;
    for (const open of this.openRequests()) {
      const fact = open.operation.plan.fact;
      if (!isOpenFact(fact) || fact.name !== name) continue;
      // A name is the unique handle of exactly one immutable request; two
      // accepted opens claiming it is ledger corruption, not a tie to break.
      if (found !== null) throw new StoreError("STORE_CORRUPT", "two review requests claim the same name");
      found = open;
    }
    return found;
  }

  inputFor(open: OpenRequest): ReviewStateInput {
    return this.inputFrom(open, this.store.attestationFacts(), this.eligible());
  }

  /** One synchronous projection for list/sweep/duplicate discovery. Never
   * retain it across an await as acceptance or CAS authority. Each fact is
   * decoded once and assigned to its request once, including challenge links. */
  projection(): { open: OpenRequest; input: ReviewStateInput }[] {
    const facts = this.store.attestationFacts(), eligible = this.eligible();
    const entries = new Map<OperationId, OpenRequest[]>();
    for (const entry of facts) {
      const fact = entry.operation.plan.fact;
      const request = fact.kind === "challenge.open" ? fact.target.request
        : "request" in fact ? fact.request : undefined;
      if (request === undefined) continue;
      const list = entries.get(request) ?? [];
      list.push(entry);
      entries.set(request, list);
    }
    return facts.filter(entry => isOpenFact(entry.operation.plan.fact)).map(open =>
      ({ open, input: this.inputFrom(open, entries.get(open.operation.id) ?? [], eligible) }));
  }

  private eligible(agents = this.store.listAgents()): ReadonlySet<string> {
    return new Set(agents.filter(agent => agent.role === "resident" && agent.desired === "enabled").map(agent => agent.name));
  }

  /** Explanatory facts share the live eligibility and frozen authors used by
   * the evaluator. Capability observations never reinterpret accepted votes. */
  reviewers(state: ReviewState): ReviewReviewer[] {
    const agents = this.store.listAgents(), eligible = this.eligible(agents);
    const byName = new Map(agents.map(agent => [agent.name, agent]));
    const names = new Set([...agents.filter(agent => agent.role === "resident").map(agent => agent.name), ...state.authors]);
    names.delete("principal");
    return [...names].sort().map(name => {
      const agent = byName.get(name), exclusions: ReviewReviewer["exclusions"] = [];
      if (state.authors.includes(name)) exclusions.push("author");
      if (agent === undefined) exclusions.push("missing-agent");
      else {
        if (!eligible.has(name)) exclusions.push("not-enabled");
        if (!capabilitiesOf(agent).has("mail.send")) exclusions.push("missing-mail-send");
      }
      const vote = state.latestVotes.get(name);
      return { name, desired: agent?.desired ?? null, exclusions,
        latestVote: vote?.fact.kind === "vote" ? vote.fact.verdict : null };
    });
  }

  /** Exact historical apply keys belong to this request's original owner. No
   * roster scan, new attempt, receipt settlement or execution is performed. */
  integrationRecords(open: OpenRequest, input: ReviewStateInput): readonly ReviewIntegrationRecord[] {
    const attempts = new Set([0]);
    for (const entry of input.entries) if ((entry.fact.kind === "review.retry" || entry.fact.kind === "review.revise" ||
        entry.fact.kind === "review.supersede" || entry.fact.kind === "review.adopt") && "attemptNumber" in entry.fact)
      attempts.add(entry.fact.attemptNumber);
    return [...attempts].sort((a, b) => a - b).flatMap(attempt => {
      const record = this.integrationRecord(open, attempt);
      return record === null ? [] : [record];
    });
  }
  private integrationRecord(open: OpenRequest, attempt: number): ReviewIntegrationRecord | null {
    const applied = this.store.getOperation(open.operation.actor, applyRequestKeyFor(open.operation.id, attempt));
    if (applied === null) return null;
    if (applied.kind !== "git.integrate" || applied.plan.merge?.request !== open.operation.id ||
        (applied.plan.merge.version === 1 ? attempt !== 0 : applied.plan.merge.attemptNumber !== attempt))
      throw new StoreError("STORE_CORRUPT", "review attempt differs from its exact original integration");
    const merge = applied.plan.merge;
    return { attemptNumber: attempt, revision: merge.version === 1 ? 0 : merge.revision,
      integration: { operation: applied.id, state: applied.state,
        identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: applied.plan.base,
          candidate: applied.plan.candidate, policyRevision: applied.plan.policyRevision },
        ...(merge.version !== 1 && merge.diff !== undefined ? { diff: merge.diff } : {}),
        errorCode: applied.state === "failed" ? applied.errorCode : null } };
  }

  private inputFrom(open: OpenRequest, facts: readonly OpenRequest[], eligible: ReadonlySet<string>): ReviewStateInput {
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openEntry: ReviewEntry = { sequence: open.sequence, operation: open.operation.id,
      actor: open.operation.actor, fact: openPlan.fact, messages: openPlan.messages };
    const entries: ReviewEntry[] = facts
      .filter(candidate => candidate.sequence > open.sequence && candidate.operation.id !== open.operation.id &&
        "messages" in candidate.operation.plan && this.factNames(candidate.operation.plan.fact, open.operation.id))
      .map(candidate => {
        const plan = candidate.operation.plan;
        if (!("messages" in plan)) throw new StoreError("STORE_CORRUPT", "review fact owns no message list");
        return { sequence: candidate.sequence, operation: candidate.operation.id,
          actor: candidate.operation.actor, fact: plan.fact, messages: plan.messages };
      });
    const attemptNumber = entries.reduce((n, entry) => ["review.retry", "review.revise", "review.supersede", "review.adopt"].includes(entry.fact.kind) && "attemptNumber" in entry.fact ? entry.fact.attemptNumber : n, 0);
    const applied = this.integrationRecord(open, attemptNumber);
    return { open: openEntry, entries, integration: applied?.integration ?? null, eligible,
      highPeerFloor: this.highPeerFloor, maxWorkers: this.maxWorkers };
  }

  executionConditions(open: OpenRequest, state: ReviewState): string[] {
    try { this.assertExecutable(open, state.entries); }
    catch (error) {
      if (error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE") return [error.message];
      throw error;
    }
    const requester = this.store.listAgents().find(agent => agent.name === state.requester);
    if (!requester || requester.desired !== "enabled") return ["requester execution is stopped, retired or unavailable"];
    return capabilitiesOf(requester).has("git.submit") ? [] : ["requester lacks current git.submit authority"];
  }

  /** Historical scope remains data. No current plan, policy, revise, or adoption
   * observation can make an old request executable by this release. */
  assertExecutable(open: OpenRequest, entries?: readonly ReviewEntry[]): void {
    const fact = open.operation.plan.fact;
    if (!isOpenFact(fact) || fact.version !== 3 || (entries ?? this.inputFor(open).entries).some(entry => entry.fact.kind === "review.adopt"))
      throw new StoreError("UNSUPPORTED_PROFILE", "original review scope is unsupported for current execution; preserve its facts, bytes and unresolved work for the original release/owner to diagnose or drain; no automatic adoption");
  }

  /** Last synchronous policy gate before CAS. The pending integration itself
   * is excluded; a cancel still cancels and every other unreadiness refuses. */
  assertApplicable(requestId: OperationId): void {
    const open = this.openRequests().find(candidate => candidate.operation.id === requestId);
    if (open === undefined) throw new StoreError("STORE_CORRUPT", "merge plan names a missing review request");
    const input = this.inputFor(open), fact = input.open.fact;
    this.assertExecutable(open, input.entries);
    const state = reviewState({ ...input, integration: null });
    if (isOpenFact(fact) && !(fact.kind === "challenge.open" && fact.prepared) && this.provenance !== undefined) {
      const current = this.provenance(state.sourceIdentity.expectedBase, state.sourceIdentity.candidate);
      if (current.length !== state.sourceSubmitters.length || current.some(actor => !state.sourceSubmitters.includes(actor)))
        throw new StoreError("INTEGRATION_CONDITIONS", "authenticated submitter provenance changed; fresh review authority is required");
    }
    if (state.terminal === "cancelled")
      throw new StoreError("CANCELLED_BEFORE_COMMIT", "the request was cancelled before main CAS");
    if (!state.ready)
      throw new StoreError("INTEGRATION_CONDITIONS",
        `request ${state.name} is not ready to apply (${state.display})`);
  }

  private factNames(fact: unknown, request: OperationId): boolean {
    if (fact === null || typeof fact !== "object") return false;
    const f = fact as { kind?: string; request?: unknown; target?: { request?: unknown } };
    switch (f.kind) {
      case "review": case "vote": case "cancel": case "refresh":
      case "review.withdraw": case "review.invalidate": case "review.adopt":
      case "review.revise": case "review.integration": case "review.supersede": case "review.included":
    case "review.retry": case "review.preparation-failed": return f.request === request;
      case "challenge.open": return f.target?.request === request;
      default: return false;
    }
  }

  /** The ledger view inside T must yield the decision the frozen messages were
   * built from; drift is a refusal to retry under the same key. */
  assertUnchanged(prepared: PreparedReview): void {
    if (isOpenFact(prepared.fact)) {
      // Mail freezing yields: an author may release or acquire an active slot.
      // Re-derive the opening decision before accepting its frozen approval.
      const fact = prepared.fact;
      if (fact.version !== 3) throw new StoreError("UNSUPPORTED_PROFILE", "fresh review acceptance requires the current original scope; no legacy open factory");
      const authors = new Set([prepared.after0.requester, ...fact.submitters]);
      const currentFact = { ...fact, reviewPolicy: { ...fact.reviewPolicy,
        authorSlots: [...this.eligible()].filter(actor => authors.has(actor)).length } };
      const fresh = reviewState({
        open: { sequence: 0, operation: prepared.id, actor: prepared.after0.requester,
          fact: currentFact, messages: [] },
        entries: [], integration: null, eligible: this.eligible(),
        highPeerFloor: this.highPeerFloor, maxWorkers: this.maxWorkers,
      });
      if (!sameReviewDecision(prepared.after0, fresh))
        throw new StoreError("BROKER_UNAVAILABLE", "review state changed; retry the same request key",
          { details: { reason: "busy" } });
    }
    if (prepared.fact.kind === "merge.open") {
      const duplicate = this.duplicateName(prepared.fact);
      if (duplicate !== null)
        throw new StoreError("REQUEST_EXISTS", "a non-terminal request already covers this change",
          { details: { name: duplicate } });
      return;
    }
    if (prepared.fact.kind === "challenge.open") {
      this.assertChallengeUnchanged(prepared.fact);
      return;
    }
    const open = this.requestByName(prepared.name);
    if (open === null) throw new StoreError("STORE_CORRUPT", "accepted review request is missing");
    if (prepared.before === null) throw new StoreError("STORE_CORRUPT", "review decision lost its before state");
    const fresh = this.inputFor(open);
    this.assertExecutable(open, fresh.entries);
    const last = prepared.after0.entries.at(-1);
    if (last === undefined) throw new StoreError("STORE_CORRUPT", "review decision lost its new entry");
    const freshBefore = reviewState(fresh);
    // A concurrently-accepted entry makes the frozen sequence stale: that is a
    // changed review state, not corruption.
    let freshAfter: ReviewState;
    try { freshAfter = reviewState({ ...fresh, ...(["review.retry", "review.revise", "review.supersede"].includes(last.fact.kind) ? { integration: null } : {}), entries: [...fresh.entries, last] }); }
    catch (error) {
      if (error instanceof StoreError && error.code === "STORE_CORRUPT")
        throw new StoreError("BROKER_UNAVAILABLE", "review state changed; retry the same request key",
          { details: { reason: "busy" } });
      throw error;
    }
    if (!sameReviewDecision(prepared.before, freshBefore) || !sameReviewDecision(prepared.after0, freshAfter))
      throw new StoreError("BROKER_UNAVAILABLE", "review state changed; retry the same request key",
        { details: { reason: "busy" } });
  }

  duplicateName(fact: Extract<ReviewFact, { kind: "merge.open" }>): string | null {
    for (const { open, input } of this.projection()) {
      const existing = open.operation.plan.fact;
      if (!isOpenFact(existing) || existing.kind !== fact.kind) continue;
      const state = reviewState(input);
      if (state.terminal === null && state.included === null && state.integration === null &&
          this.sameProposal(fact, existing, input, state)) return existing.name;
    }
    return null;
  }

  /** §7: an applied challenge of the same target is a hard duplicate; a live
   * challenge with the same revert identity is one too. */
  duplicateChallenge(fact: Extract<ReviewFact, { kind: "challenge.open" }>): string | null {
    for (const { open, input } of this.projection()) {
      const existing = open.operation.plan.fact;
      if (!isOpenFact(existing) || existing.kind !== "challenge.open" ||
          existing.target.request !== fact.target.request) continue;
      const state = reviewState(input);
      if (state.integration?.state === "succeeded") return existing.name;
      if (state.terminal === null && state.included === null && state.integration === null &&
          this.sameProposal(fact, existing, input, state)) return existing.name;
    }
    return null;
  }

  /** Revisions replace the live proposal. Prepared integration scope may use
   * another candidate/tier, so compare source facts rather than the CAS view. */
  private sameProposal(fact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
      original: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
      input: ReviewStateInput, state: ReviewState): boolean {
    let tier = original.tier;
    for (const entry of input.entries) if (entry.fact.kind === "review.revise") tier = entry.fact.tier;
    return state.sourceIdentity.expectedBase === fact.identity.expectedBase &&
      state.sourceIdentity.candidate === fact.identity.candidate &&
      state.sourceIdentity.policyRevision === fact.identity.policyRevision && tier === fact.tier;
  }

  /** T-side re-derivation for a challenge open: the target merge must still be
   * applied (same integration), and no other challenge may have slipped in. */
  private assertChallengeUnchanged(fact: Extract<ReviewFact, { kind: "challenge.open" }>): void {
    const drift = () => new StoreError("BROKER_UNAVAILABLE",
      "review state changed; retry the same request key", { details: { reason: "busy" } });
    const target = this.requestByName(fact.target.name);
    const targetPlan = target === null ? null : target.operation.plan;
    const targetFact = targetPlan !== null && "messages" in targetPlan ? targetPlan.fact : null;
    if (targetFact === null || targetFact.kind !== "merge.open") throw drift();
    const targetState = reviewState(this.inputFor(target!));
    if (targetState.integration?.state !== "succeeded" ||
        targetState.integration.operation !== fact.target.integration || targetState.tier !== fact.target.tier ||
        (targetState.tier === "HIGH" && fact.tier !== "HIGH")) throw drift();
    const duplicate = this.duplicateChallenge(fact);
    if (duplicate !== null)
      throw new StoreError("REQUEST_EXISTS", "an applied or identical challenge already covers this merge",
        { details: { name: duplicate } });
  }
}
