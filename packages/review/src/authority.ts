/** Validated review reads and acceptance re-derivation. No writes or Git I/O. */
import type { ReviewFact } from "@oma/contracts/attestation";
import type { Actor, OperationId, RequestKey } from "@oma/contracts";
import type { AgentRow } from "@oma/contracts/ledger";
import type { DecodedOperation } from "@oma/protocol/operation-codec";
import { StoreError } from "@oma/domain/errors";
import { applyRequestKeyFor } from "@oma/domain/identifiers";
import { reviewState, sameReviewDecision, type ReviewEntry, type ReviewStateInput, type ReviewState } from "@oma/domain/review-evaluation";
import { isOpenFact, type OpenRequest, type PreparedReview } from "./types.js";
export interface ReviewAuthorityLedger {
  attestationFacts(): readonly OpenRequest[];
  getOperation(actor: Actor, key: RequestKey): DecodedOperation | null;
  listAgents(): readonly { readonly name: Actor; readonly role: AgentRow["role"]; readonly desired: AgentRow["desired"] }[];
}
export class ReviewAuthorityReader {
  constructor(private readonly store: ReviewAuthorityLedger,
    private readonly highPeerFloor: number) {}
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

  private eligible(): ReadonlySet<string> {
    return new Set(this.store.listAgents().filter(agent => agent.role === "resident" && agent.desired === "enabled").map(agent => agent.name));
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
    const applied = this.store.getOperation(open.operation.actor, applyRequestKeyFor(open.operation.id));
    return { open: openEntry, entries,
      integration: applied === null ? null
        : { operation: applied.id, state: applied.state,
            errorCode: applied.state === "failed" ? applied.errorCode : null },
      eligible,
      highPeerFloor: this.highPeerFloor };
  }

  /** Last synchronous policy gate before CAS. The pending integration itself
   * is excluded; a cancel still cancels and every other unreadiness refuses. */
  assertApplicable(requestId: OperationId): void {
    const open = this.openRequests().find(candidate => candidate.operation.id === requestId);
    if (open === undefined) throw new StoreError("STORE_CORRUPT", "merge plan names a missing review request");
    const state = reviewState({ ...this.inputFor(open), integration: null });
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
      case "review": case "vote": case "cancel": case "refresh": return f.request === request;
      case "challenge.open": return f.target?.request === request;
      default: return false;
    }
  }

  /** The ledger view inside T must yield the decision the frozen messages were
   * built from; drift is a refusal to retry under the same key. */
  assertUnchanged(prepared: PreparedReview): void {
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
    const last = prepared.after0.entries.at(-1);
    if (last === undefined) throw new StoreError("STORE_CORRUPT", "review decision lost its new entry");
    const freshBefore = reviewState(fresh);
    // A concurrently-accepted entry makes the frozen sequence stale: that is a
    // changed review state, not corruption.
    let freshAfter: ReviewState;
    try { freshAfter = reviewState({ ...fresh, entries: [...fresh.entries, last] }); }
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
      if (!isOpenFact(existing)) continue;
      if (existing.kind !== fact.kind || existing.identity.candidate !== fact.identity.candidate ||
        existing.identity.expectedBase !== fact.identity.expectedBase || existing.tier !== fact.tier ||
        existing.identity.policyRevision !== fact.identity.policyRevision) continue;
      const state = reviewState(input);
      if (state.terminal === null && state.integration === null) return existing.name;
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
      if (state.terminal === null && state.integration === null &&
          existing.identity.expectedBase === fact.identity.expectedBase &&
          existing.identity.candidate === fact.identity.candidate &&
          existing.identity.policyRevision === fact.identity.policyRevision &&
          existing.tier === fact.tier) return existing.name;
    }
    return null;
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
        targetState.integration.operation !== fact.target.integration) throw drift();
    const duplicate = this.duplicateChallenge(fact);
    if (duplicate !== null)
      throw new StoreError("REQUEST_EXISTS", "an applied or identical challenge already covers this merge",
        { details: { name: duplicate } });
  }
}
