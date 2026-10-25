/** Fresh caller intent: live authority/candidate observations, then frozen messages.
 * All acceptance-time rechecks belong to ReviewAcceptance/ReviewAuthorityReader. */
import type { AuthContext, Oid, OperationId, RiskTier } from "@oma/contracts";
import type { ReviewFact, ReviewInput } from "@oma/contracts/attestation";
import type { ReviewLedger } from "./ports.js";
import { assertCurrentActor, capabilitiesOf } from "@oma/domain/authority";
import { StoreError } from "@oma/domain/errors";
import { reviewRequestNameFor } from "@oma/domain/identifiers";
import { deterministicTier, type IntegrationSnapshot } from "@oma/domain/integration-policy";
import { maximumTier } from "@oma/domain/risk-tier";
import { protectedPathMatches, requireNoGitlinks } from "@oma/domain/git-facts";
import { type GitObservation } from "@oma/contracts/git";
import { reviewSubject, reviewThreadBody } from "@oma/mail/review-documents";
import { planEffects, reviewState, type ReviewEntry, type ReviewState, type ReviewStateInput } from "@oma/domain/review-evaluation";
import type { MailPreacceptScope as PreacceptScope } from "@oma/mail/ports";
import { ReviewAuthorityReader } from "./authority.js";
import { ReviewMessages } from "./messages.js";
import { isOpenFact, PRINCIPAL, type OpenRequest, type Emission, type PreparedReview, type ReviewBounds, type ReviewEffects } from "./types.js";
function observed<T>(observation: GitObservation<T>, description: string): T {
  if (observation.kind === "present") return observation.value;
  // AV-20261003-25: a candidate outside the observation grammar is refused at
  // candidate scope -- it is never durable-store corruption.
  if (observation.kind === "refused") throw new StoreError("INVALID_REQUEST", `${description}: ${observation.reason}`);
  throw new StoreError(observation.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN",
    `${description} is ${observation.kind}`);
}

const tierRank = (tier: RiskTier): number => tier === "HIGH" ? 2 : tier === "MEDIUM" ? 1 : 0;
export class ReviewPreparation {
  constructor(private readonly store: Pick<ReviewLedger, "getAgent" | "societyOpen" | "listAgents">,
    private readonly ledger: ReviewAuthorityReader, private readonly messages: ReviewMessages,
    private readonly effects: Pick<ReviewEffects, "verifyObjectFormat" | "published" | "main" |
      "ancestry" | "gitlinks" | "changedPaths" | "submitters" | "prepareRevert" | "nextOperationId">,
    private readonly bounds: ReviewBounds) {}
  async prepare(auth: AuthContext, input: ReviewInput, policy: IntegrationSnapshot,
      scope: PreacceptScope): Promise<PreparedReview> {
    switch (input.kind) {
      case "merge.open": return this.prepareOpen(auth, input, policy, scope);
      case "review": case "vote": return this.prepareEntry(auth, input, policy, scope);
      case "cancel": return this.prepareCancel(auth, input, scope);
      case "challenge.open": return this.prepareChallenge(auth, input, policy, scope);
    }
  }

  /** §7: a challenge names an applied merge.open; the caller may supply its own
   * revert candidate or leave the broker to prepare one on canonical main. */
  private async prepareChallenge(auth: AuthContext, input: Extract<ReviewInput, { kind: "challenge.open" }>,
      policy: IntegrationSnapshot, scope: PreacceptScope): Promise<PreparedReview> {
    const agent = assertCurrentActor(this.store, auth, "mail.send");
    if (agent.role !== "resident")
      throw new StoreError("CAPABILITY_DENIED", "only a Worker opens a challenge");
    if (!capabilitiesOf(agent).has("git.submit"))
      throw new StoreError("CAPABILITY_DENIED", "git.submit is required to open a challenge",
        { details: { capability: "git.submit" } });
    const targetOpen = this.ledger.requestByName(input.merge);
    if (targetOpen === null)
      throw new StoreError("INVALID_REQUEST", `unknown request ${input.merge}`);
    const targetPlan = targetOpen.operation.plan;
    if (!("messages" in targetPlan))
      throw new StoreError("STORE_CORRUPT", "target merge owns no message list");
    const targetFact = targetPlan.fact;
    if (targetFact.kind !== "merge.open")
      throw new StoreError("INVALID_REQUEST",
        "a challenge needs an applied merge; cancel a request that is not applied yet");
    const targetState = reviewState(this.ledger.inputFor(targetOpen));
    if (targetState.integration === null || targetState.integration.state !== "succeeded")
      throw new StoreError("INVALID_REQUEST",
        "a challenge needs an applied merge; cancel a request that is not applied yet");
    if (targetFact.tier === "HIGH" && input.tier !== "HIGH")
      throw new StoreError("INTEGRATION_CONDITIONS", "a HIGH merge can only be challenged at HIGH");
    for (const open of this.ledger.openRequests()) {
      const existing = open.operation.plan.fact;
      if (!isOpenFact(existing) || existing.kind !== "challenge.open" ||
          existing.target.request !== targetOpen.operation.id) continue;
      if (reviewState(this.ledger.inputFor(open)).integration?.state === "succeeded")
        throw new StoreError("REQUEST_EXISTS", "an applied challenge already covers this merge",
          { details: { name: existing.name } });
    }
    const id = this.effects.nextOperationId();
    const name = reviewRequestNameFor("challenge", id);
    let candidate: Oid, expectedBase: Oid, submitters: string[], prepared: boolean;
    if (input.candidate !== undefined) {
      // A caller-provided revert faces the same live checks as a merge.open
      // candidate except the tier floor: challenge tiers are LOW or HIGH by rule.
      candidate = input.candidate; expectedBase = input.base!;
      if (candidate === expectedBase)
        throw new StoreError("INVALID_REQUEST", "challenge candidate equals its base");
      this.observeCandidate(expectedBase, candidate, policy);
      submitters = [...this.effects.submitters(expectedBase, candidate)].sort();
      prepared = false;
    } else {
      // The broker reverts the applied merge on canonical main. Only the
      // commit object exists before acceptance; its refs/oma/published ref is
      // an effect of the accepted fact (acceptPrepared / advance repair).
      prepared = true;
      const main = observed(this.effects.main(), "canonical main");
      expectedBase = main;
      candidate = this.effects.prepareRevert({ mergeBase: targetFact.identity.candidate, main,
        base: targetFact.identity.expectedBase,
        message: `Revert ${targetFact.name}: ${targetFact.title}

Challenge ${name}` });
      // A main carrying gitlinks makes even the broker's own revert a candidate
      // the CAS cannot validate; refuse it the same way, naming the paths.
      requireNoGitlinks(observed(this.effects.gitlinks(candidate), "prepared revert gitlinks"));
      const changes = observed(this.effects.changedPaths(expectedBase, candidate), "revert changed paths");
      if (policy.protectedPaths.some(path => changes.some(change => protectedPathMatches(change.path, path))))
        throw new StoreError("PROTECTED_PATH", "the prepared revert touches a protected path");
      submitters = [];
    }
    const fact: ReviewFact = { kind: "challenge.open", version: 1, name, title: input.title,
      reason: input.reason, tier: input.tier,
      identity: { repo: "project", targetRef: "refs/heads/main", expectedBase, candidate,
        policyRevision: policy.policyRevision },
      submitters, prepared,
      target: { name: targetFact.name, request: targetOpen.operation.id,
        integration: targetState.integration.operation, identity: { ...targetFact.identity },
        tier: targetFact.tier } };
    const duplicate = this.ledger.duplicateChallenge(fact);
    if (duplicate !== null)
      throw new StoreError("REQUEST_EXISTS", "an applied or identical challenge already covers this merge",
        { details: { name: duplicate } });
    const entry: ReviewEntry = { sequence: 0, operation: id, actor: auth.actor, fact, messages: [] };
    const eligible = new Set(this.store.listAgents()
      .filter(a => a.role === "resident" && a.desired === "enabled").map(a => a.name));
    const after0 = reviewState({ open: entry, entries: [], integration: null,
      eligible, highPeerFloor: policy.tiered!.highPeerFloor });
    // Challenges always have a review thread — LOW challenges too (§7).
    const emissions: Emission[] = [{
      to: ["residents"], kind: "message",
      subject: reviewSubject(`[${name}] ${input.title} (rev 0)`, this.bounds.subjectBytes),
      body: reviewThreadBody(after0, fact, [], null, this.bounds.mailBodyBytes),
      replyHeaders: { replyTo: ["residents"], inReplyTo: null, references: [] },
      audience: "workers", review: { role: "thread", request: id, name, revision: 0 } }];
    const frozen = await this.messages.freeze(scope, id, auth.actor, emissions);
    return { id, fact, payload: input, emissions, frozen, before: null, after0, name };
  }

  private async prepareOpen(auth: AuthContext, input: Extract<ReviewInput, { kind: "merge.open" }>,
      policy: IntegrationSnapshot, scope: PreacceptScope): Promise<PreparedReview> {
    const agent = assertCurrentActor(this.store, auth, "mail.send");
    if (agent.role !== "resident")
      throw new StoreError("CAPABILITY_DENIED", "only a Worker opens a merge request");
    if (!capabilitiesOf(agent).has("git.submit"))
      throw new StoreError("CAPABILITY_DENIED", "git.submit is required to open a merge request",
        { details: { capability: "git.submit" } });
    if (input.candidate === input.base)
      throw new StoreError("INVALID_REQUEST", "merge candidate equals its base; submit a different candidate");
    const changes = this.observeCandidate(input.base, input.candidate, policy);
    const tiered = policy.tiered!;
    const floor = maximumTier(tiered.repositoryFloor, deterministicTier(tiered, changes).tier);
    if (tierRank(input.tier) < tierRank(floor))
      throw new StoreError("INTEGRATION_CONDITIONS", `tier must be at least ${floor} for this candidate`);
    const submitters = this.effects.submitters(input.base, input.candidate);
    const id = this.effects.nextOperationId();
    const name = reviewRequestNameFor("merge", id);
    const fact: ReviewFact = { kind: "merge.open", version: 1, name, title: input.title, reason: input.reason,
      tier: input.tier, identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: input.base,
        candidate: input.candidate, policyRevision: policy.policyRevision }, submitters: [...submitters].sort() };
    const duplicate = this.ledger.duplicateName(fact);
    if (duplicate !== null)
      throw new StoreError("REQUEST_EXISTS", "a non-terminal request already covers this change",
        { details: { name: duplicate } });
    const entry: ReviewEntry = { sequence: 0, operation: id, actor: auth.actor, fact, messages: [] };
    const eligible = new Set(this.store.listAgents()
      .filter(a => a.role === "resident" && a.desired === "enabled").map(a => a.name));
    const after0 = reviewState({ open: entry, entries: [], integration: null,
      eligible, highPeerFloor: tiered.highPeerFloor });
    const emissions: Emission[] = input.tier === "LOW" ? [] : [{
      to: ["residents"], kind: "message",
      subject: reviewSubject(`[${name}] ${input.title} (rev 0)`, this.bounds.subjectBytes),
      body: reviewThreadBody(after0, fact, [], null, this.bounds.mailBodyBytes),
      replyHeaders: { replyTo: ["residents"], inReplyTo: null, references: [] },
      audience: "workers", review: { role: "thread", request: id, name, revision: 0 } }];
    const frozen = await this.messages.freeze(scope, id, auth.actor, emissions);
    return { id, fact, payload: input, emissions, frozen, before: null, after0, name };
  }

  private async prepareEntry(auth: AuthContext, input: Extract<ReviewInput, { kind: "review" | "vote" }>,
      policy: IntegrationSnapshot, scope: PreacceptScope): Promise<PreparedReview> {
    const open = this.ledger.requestByName(input.name);
    if (open === null) throw new StoreError("INVALID_REQUEST", `unknown request ${input.name}`);
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    const inputFor = this.ledger.inputFor(open);
    const before = reviewState(inputFor);
    if (before.terminal !== null || before.integration !== null)
      throw new StoreError("REQUEST_CLOSED", `request ${input.name} is ${before.display}`,
        { details: { name: input.name, state: before.display } });
    const agent = assertCurrentActor(this.store, auth, "mail.send");
    const principal = agent.role === "principal";
    const low = openFact.kind === "merge.open" && openFact.tier === "LOW";
    if (input.kind === "review") {
      if (principal) throw new StoreError("CAPABILITY_DENIED", "the Principal may only vote on a review request");
      if (agent.role !== "resident") throw new StoreError("CAPABILITY_DENIED", "only a Worker records a review");
      if (low) throw new StoreError("INVALID_REQUEST", "LOW requests have no review thread; use oma_challenge after it is applied");
    } else {
      if (principal) {
        if (openFact.tier !== "HIGH")
          throw new StoreError("INVALID_REQUEST", "the Principal votes only on HIGH requests");
        if (input.approval === undefined || input.approval === null)
          throw new StoreError("INVALID_REQUEST", "a Principal vote names the approval it decides");
        if (!(before.approvalValid && before.approval !== null && before.approval.id === input.approval))
          throw new StoreError("APPROVAL_STALE", "the named approval is not the current valid one",
            { details: { current: before.approvalValid && before.approval !== null ? before.approval.id : null } });
        if (policy.tiered?.principalDelegated !== true)
          throw new StoreError("CAPABILITY_DENIED", "Human has not delegated Principal decisions");
      } else {
        if (agent.role !== "resident") throw new StoreError("CAPABILITY_DENIED", "only a Worker votes on a review request");
        if (input.approval !== undefined)
          throw new StoreError("INVALID_REQUEST", "a Worker vote does not name an approval");
        if (low) throw new StoreError("INVALID_REQUEST", "LOW has no prior review; use oma_challenge after it is applied");
        if (before.authors.includes(auth.actor))
          throw new StoreError("SELF_REVIEW", "the requester or a submitter cannot vote on their own change");
      }
    }
    const fact: ReviewFact = input.kind === "review"
      ? { kind: "review", version: 1, request: open.operation.id, body: input.body }
      : { kind: "vote", version: 1, request: open.operation.id, verdict: input.verdict, body: input.body,
          approval: principal ? input.approval! : null };
    return this.finishEntry(auth, input, open, openFact, inputFor, before, fact, scope);
  }

  private async prepareCancel(auth: AuthContext,
      input: Extract<ReviewInput, { kind: "cancel" }>, scope: PreacceptScope): Promise<PreparedReview> {
    const open = this.ledger.requestByName(input.name);
    if (open === null) throw new StoreError("INVALID_REQUEST", `unknown request ${input.name}`);
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    const inputFor = this.ledger.inputFor(open);
    const before = reviewState(inputFor);
    if (before.terminal !== null)
      throw new StoreError("REQUEST_CLOSED", `request ${input.name} is ${before.display}`,
        { details: { name: input.name, state: before.display } });
    const agent = assertCurrentActor(this.store, auth, "mail.send");
    if (agent.role === "principal")
      throw new StoreError("CAPABILITY_DENIED", "the Principal may only vote on a review request");
    if (auth.actor !== before.requester)
      throw new StoreError("CAPABILITY_DENIED", "only the requester cancels a request");
    if (before.integration !== null) {
      if (before.integration.state === "succeeded")
        throw new StoreError("REQUEST_CLOSED", `request ${input.name} is already applied; use oma_challenge`,
          { details: { name: input.name, state: "applied" } });
      if (before.integration.state === "unknown")
        throw new StoreError("REF_STATE_UNKNOWN", "the request's integration outcome is unknown");
      // Pending cancellation is rechecked against main immediately before T.
      // An accepted cancel wins the integration's synchronous pre-CAS gate.
    }
    const fact: ReviewFact = { kind: "cancel", version: 1, request: open.operation.id, reason: input.reason };
    return this.finishEntry(auth, input, open, openFact, inputFor, before, fact, scope);
  }

  /** Shared tail of review/vote/cancel: the new fact's state, its effects and
   * every frozen message. */
  private async finishEntry(auth: AuthContext, input: Extract<ReviewInput, { kind: "review" | "vote" | "cancel" }>,
      open: OpenRequest,
      openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
      inputFor: ReviewStateInput, before: ReviewState, fact: ReviewFact, scope: PreacceptScope): Promise<PreparedReview> {
    const id = this.effects.nextOperationId();
    const lastSequence = inputFor.entries.at(-1)?.sequence ?? inputFor.open.sequence;
    const newEntry: ReviewEntry = { sequence: lastSequence + 1, operation: id, actor: auth.actor, fact, messages: [] };
    const after0 = reviewState({ ...inputFor, entries: [...inputFor.entries, newEntry] });
    const effects = planEffects(before, after0);
    const decision = fact.kind === "vote" && auth.actor === PRINCIPAL && input.kind === "vote"
      ? { approval: input.approval!, verdict: fact.verdict, body: fact.body } : null;
    const emissions = this.messages.entryEmissions(id, open, openFact, inputFor, before, after0, newEntry, effects, decision);
    const frozen = await this.messages.freeze(scope, id, auth.actor, emissions);
    return { id, fact, payload: input, emissions, frozen, before, after0, name: before.name };
  }
  /** Caller candidates share exactly the same observation policy. Broker-built
   * reverts keep their distinct preparation and postaccept publication order. */
  private observeCandidate(base: Oid, candidate: Oid, policy: IntegrationSnapshot) {
    this.effects.verifyObjectFormat([base, candidate]);
    if (!observed(this.effects.published(), "candidate publication").includes(candidate))
      throw new StoreError("CANDIDATE_NOT_PUBLISHED", "candidate is not published");
    const main = observed(this.effects.main(), "canonical main");
    if (main !== base)
      throw new StoreError("STALE_BASE", "main differs from base; fetch the latest main and build a new candidate",
        { details: { actual: main } });
    if (!observed(this.effects.ancestry(base, candidate), "candidate ancestry"))
      throw new StoreError("NOT_DESCENDANT", "candidate does not descend from base");
    requireNoGitlinks(observed(this.effects.gitlinks(candidate), "candidate gitlinks"));
    const changes = observed(this.effects.changedPaths(base, candidate), "candidate changed paths");
    if (policy.protectedPaths.some(path => changes.some(change => protectedPathMatches(change.path, path))))
      throw new StoreError("PROTECTED_PATH", "candidate touches a protected path");
    return changes;
  }
}
