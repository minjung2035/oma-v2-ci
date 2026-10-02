/** mail-v1 review acceptance owner (design §3): merge/challenge request opens,
 * worker reviews and votes, the Principal's vote, and cancellation. Quorum and
 * status decisions are pure in domain/review-evaluation.js; this module owns
 * live Git observation, message freezing and the acceptance transaction.
 *
 * No review fact creates or runs an integration here; a request reaches
 * `ready` and waits for the integration owner (advance is a later step). */
import type {
  Actor, Address, AuthContext, MessageId, Oid, OperationId, Receipt,
  ExactCandidateIdentity, MessagePlan, RiskTier,
} from "../implementation/contracts.js";
import type { ReviewFact, ReviewInput } from "../implementation/contracts/attestation.js";
import type { OperationOf } from "./storage/operation-codec.js";
import { Store } from "./store.js";
import type { MailModule } from "./mail.js";
import { assertActorIdentity, assertCurrentActor, capabilitiesOf } from "./authority.js";
import { reviewInputProblem } from "./domain/attestation.js";
import { canonicalJson, snapshotJson } from "./domain/canonical-json.js";
import { StoreError, acceptedFailure } from "./domain/errors.js";
import { applyRequestKeyFor, reviewRequestNameFor } from "./domain/identifiers.js";
import { expandAddresses } from "./mail/routing.js";
import { rfcMessageIdFor } from "./mail/addresses.js";
import { PreacceptScope, type PreacceptArtifact } from "./storage/preaccept-artifact.js";
import { frozenMessageDisposition } from "./mail/materializer.js";
import { receiptOfOperation } from "./storage/receipt-projector.js";
import { requestHash } from "./hash.js";
import { generateMessageId, generateOperationId } from "./ids.js";
import { deterministicTier, type IntegrationSnapshot } from "./git/integration-policy.js";
import { maximumTier } from "./domain/tier-evaluation.js";
import { protectedPathMatches, type ChangedPath, type GitObservation } from "./git/observe.js";
import { planEffects, reviewState, type ReviewEntry, type ReviewState, type ReviewStateInput } from "./domain/review-evaluation.js";

/** Synchronous host/Git observations and writer serialization the module
 * needs. Each member mirrors an IntegrationCoordinator effect; policy reads
 * run outside the acceptance transaction only (M-004). */
export interface ReviewEffects {
  /** The policy the broker bound at start; null when the society has none. */
  policy(): IntegrationSnapshot | null;
  /** The host's current policy: BROKER_UNAVAILABLE when unreadable,
   * POLICY_CHANGED when its facts differ. Outside T only. */
  currentPolicy(): IntegrationSnapshot;
  verifyObjectFormat(oids: readonly Oid[]): void;
  main(): GitObservation<Oid>;
  published(): GitObservation<readonly Oid[]>;
  ancestry(base: Oid, candidate: Oid): GitObservation<boolean>;
  changedPaths(base: Oid, candidate: Oid): GitObservation<readonly ChangedPath[]>;
  submitters(base: Oid, candidate: Oid): readonly string[];
  /** Cancellation serializes with integration CAS through the same writer. */
  withWriter<T>(work: () => Promise<T>): Promise<T>;
}

export interface ReviewBounds { readonly mailBodyBytes: number; readonly subjectBytes: number }

/** One outgoing review message plus the logical addresses whose live
 * expansion fills `plan.recipients` inside the acceptance transaction. */
interface Emission {
  readonly to: readonly Address[];
  readonly kind: MessagePlan["kind"];
  readonly subject: string;
  readonly body: string;
  readonly replyHeaders: { replyTo: readonly Address[]; inReplyTo: string | null; references: readonly string[] };
  readonly approvalFor?: ExactCandidateIdentity;
  readonly audience?: "workers";
  readonly review: NonNullable<MessagePlan["review"]>;
}

interface PreparedReview {
  readonly id: OperationId;
  readonly fact: ReviewFact;
  readonly payload: ReviewInput;
  readonly emissions: readonly Emission[];
  readonly frozen: readonly { readonly message: MessagePlan; readonly artifact: PreacceptArtifact }[];
  /** The state before and after the new fact without its own messages; null
   * for merge.open, whose concurrent check is the duplicate scan only. */
  readonly before: ReviewState | null;
  readonly after0: ReviewState;
  /** The request's open operation (this operation itself for an open). */
  readonly open: { readonly sequence: number; readonly operation: OperationOf<"attest.record"> };
  readonly name: string;
}

const PRINCIPAL: Actor = "principal";

function observed<T>(observation: GitObservation<T>, description: string): T {
  if (observation.kind === "present") return observation.value;
  throw new StoreError(observation.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN",
    `${description} is ${observation.kind}`);
}
const tierRank = (tier: RiskTier): number => tier === "HIGH" ? 2 : tier === "MEDIUM" ? 1 : 0;
const isOpenFact = (fact: unknown): fact is Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }> =>
  fact !== null && typeof fact === "object" &&
  ((fact as { kind?: string }).kind === "merge.open" || (fact as { kind?: string }).kind === "challenge.open");

export class ReviewModule {
  constructor(private readonly store: Store, private readonly mail: MailModule,
    private readonly effects: ReviewEffects, private readonly bounds: ReviewBounds,
    private readonly society: string) {}

  /** Live open requests in attestation sequence order. */
  private openRequests(): { sequence: number; operation: OperationOf<"attest.record"> }[] {
    return this.store.attestations.all().filter(entry =>
      "messages" in entry.operation.plan && isOpenFact(entry.operation.plan.fact));
  }
  private requestByName(name: string): { sequence: number; operation: OperationOf<"attest.record"> } | null {
    for (const open of this.openRequests()) {
      const fact = open.operation.plan.fact;
      if (isOpenFact(fact) && fact.name === name) return open;
    }
    return null;
  }
  private inputFor(open: { sequence: number; operation: OperationOf<"attest.record"> }): ReviewStateInput {
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openEntry: ReviewEntry = { sequence: open.sequence, operation: open.operation.id,
      actor: open.operation.actor, fact: openPlan.fact, messages: openPlan.messages };
    const entries: ReviewEntry[] = this.store.attestations.all()
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
      eligible: new Set(this.store.listAgents()
        .filter(agent => agent.role === "resident" && agent.desired === "enabled").map(agent => agent.name)),
      highPeerFloor: this.effects.policy()?.tiered?.highPeerFloor ?? 1 };
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

  async record(auth: AuthContext, key: string, input: ReviewInput): Promise<Receipt> {
    assertActorIdentity(this.store, auth);
    const copied = snapshotJson(input);
    const problem = reviewInputProblem(copied, this.bounds);
    if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
    const value = copied as ReviewInput;
    // Cheap bound read for routing only; the fact freezes the current revision.
    const bound = this.effects.policy();
    if (bound?.tiered?.review !== "mail-v1")
      throw new StoreError("UNSUPPORTED_PROFILE", "this society does not use mail-v1 review");
    const hash = requestHash("attest.record", copied);
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    if (claim === "reused")
      throw new StoreError("REQUEST_KEY_REUSED", `request key ${key} already used with a different payload`);
    // DR8: the fact names the host's current revision; facts must be the bound ones.
    const policy = this.effects.currentPolicy();
    const run = async () => this.accept(auth, key, value, hash, policy);
    // Cancel holds the writer so a pending integration cannot CAS past it.
    return value.kind === "cancel" ? this.effects.withWriter(run) : run();
  }

  private async accept(auth: AuthContext, key: string, input: ReviewInput,
      hash: string, policy: IntegrationSnapshot): Promise<Receipt> {
    const prepared = await this.prepare(auth, input, policy);
    const scope: PreacceptScope = new PreacceptScope();
    let txClaim: "inserted" | "retry";
    try {
      for (const frozen of prepared.frozen)
        scope.register({ operationId: prepared.id, resource: frozen.artifact.path, owner: frozen.artifact,
          observe: () => frozenMessageDisposition(this.store, prepared.id,
            { id: frozen.message.id, sha256: frozen.message.sha256 }) });
      txClaim = this.store.transaction(tx => {
        const agent = assertCurrentActor(this.store, auth, "mail.send");
        if (input.kind === "merge.open" && !capabilitiesOf(agent).has("git.submit"))
          throw new StoreError("CAPABILITY_DENIED", "git.submit was revoked before acceptance",
            { details: { capability: "git.submit" } });
        const current = this.store.claimKey(auth.actor, key, hash);
        if (current === "retry") return "retry" as const;
        if (current === "reused")
          throw new StoreError("REQUEST_KEY_REUSED", `request key ${key} already used with a different payload`);
        this.assertUnchanged(prepared);
        const plans = prepared.frozen.map(frozen => frozen.message);
        for (const [index, emission] of prepared.emissions.entries())
          (plans[index] as { recipients: string[] }).recipients =
            [...expandAddresses(this.store, emission.to, this.society).recipients].sort();
        const accepted = tx.acceptOperation({ id: prepared.id, actor: auth.actor, requestKey: key,
          requestHash: hash, kind: "attest.record", payloadJson: JSON.stringify(prepared.payload),
          planJson: JSON.stringify({ kind: "attest.record", fact: prepared.fact, messages: plans }) });
        if (accepted === "inserted")
          for (const plan of plans)
            tx.insertDeliveries(plan.recipients.map(recipient =>
              ({ messageId: plan.id, recipient, operationId: prepared.id })));
        return accepted;
      });
    } catch (error) { scope.settleFailure(error); }
    scope.settle();
    if (txClaim === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    try {
      let materializedAll = true;
      try { await this.mail.materialize(prepared.id); }
      catch (error) { if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error; materializedAll = false; }
      if (materializedAll)
        this.store.transaction(tx => tx.setOperationSucceeded(prepared.id, JSON.stringify({
          kind: "attest.record", request: prepared.name,
          messages: prepared.frozen.map(frozen => frozen.message.id),
          recipientCount: prepared.frozen.reduce((sum, frozen) => sum + frozen.message.recipients.length, 0) })));
      const finalOp = this.store.getOperation(auth.actor, key);
      if (!finalOp) throw new StoreError("STORE_CORRUPT", "accepted review operation missing");
      return receiptOfOperation(finalOp);
    } catch (error) { throw acceptedFailure(error); }
  }

  /** The ledger view inside T must yield the decision the frozen messages were
   * built from; drift is a refusal to retry under the same key. */
  private assertUnchanged(prepared: PreparedReview): void {
    if (prepared.fact.kind === "merge.open") {
      const duplicate = this.duplicateName(prepared.fact);
      if (duplicate !== null)
        throw new StoreError("REQUEST_EXISTS", "a non-terminal request already covers this change",
          { details: { name: duplicate } });
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
    if (!this.sameDecision(prepared.before, freshBefore) || !this.sameDecision(prepared.after0, freshAfter))
      throw new StoreError("BROKER_UNAVAILABLE", "review state changed; retry the same request key",
        { details: { reason: "busy" } });
  }
  /** The decision-determining projection of a state; `missing` text and the
   * latest-votes map derive from the same fields, so they carry no signal. */
  private sameDecision(left: ReviewState, right: ReviewState): boolean {
    const project = (s: ReviewState) => ({
      name: s.name, kind: s.kind, tier: s.tier, identity: s.identity, requester: s.requester,
      authors: s.authors, required: s.required, approvers: s.approvers, rejectors: s.rejectors,
      bundle: s.bundle, approval: s.approval, approvalValid: s.approvalValid,
      principal: s.principal?.operation ?? null, terminal: s.terminal, integration: s.integration,
      ready: s.ready, display: s.display,
      entries: s.entries.map(entry => ({ sequence: entry.sequence, operation: entry.operation,
        actor: entry.actor, fact: entry.fact,
        messages: entry.messages.map(message => ({ id: message.id, review: message.review })) })) });
    return canonicalJson(project(left)) === canonicalJson(project(right));
  }

  private duplicateName(fact: Extract<ReviewFact, { kind: "merge.open" }>): string | null {
    for (const open of this.openRequests()) {
      const existing = open.operation.plan.fact;
      if (!isOpenFact(existing)) continue;
      if (existing.kind !== fact.kind || existing.identity.candidate !== fact.identity.candidate ||
        existing.identity.expectedBase !== fact.identity.expectedBase || existing.tier !== fact.tier ||
        existing.identity.policyRevision !== fact.identity.policyRevision) continue;
      const state = reviewState(this.inputFor(open));
      if (state.terminal === null && state.integration === null) return existing.name;
    }
    return null;
  }

  private async prepare(auth: AuthContext, input: ReviewInput, policy: IntegrationSnapshot): Promise<PreparedReview> {
    switch (input.kind) {
      case "merge.open": return this.prepareOpen(auth, input, policy);
      case "review": case "vote": return this.prepareEntry(auth, input, policy);
      case "cancel": return this.prepareCancel(auth, input);
      case "challenge.open":
        throw new StoreError("UNSUPPORTED_PROFILE", "oma_challenge is not yet available");
    }
  }

  private async prepareOpen(auth: AuthContext, input: Extract<ReviewInput, { kind: "merge.open" }>,
      policy: IntegrationSnapshot): Promise<PreparedReview> {
    const agent = assertCurrentActor(this.store, auth, "mail.send");
    if (agent.role !== "resident")
      throw new StoreError("CAPABILITY_DENIED", "only a Worker opens a merge request");
    if (!capabilitiesOf(agent).has("git.submit"))
      throw new StoreError("CAPABILITY_DENIED", "git.submit is required to open a merge request",
        { details: { capability: "git.submit" } });
    if (input.candidate === input.base)
      throw new StoreError("INVALID_REQUEST", "merge candidate equals its base; submit a different candidate");
    this.effects.verifyObjectFormat([input.base, input.candidate]);
    if (!observed(this.effects.published(), "candidate publication").includes(input.candidate))
      throw new StoreError("CANDIDATE_NOT_PUBLISHED", "candidate is not published");
    const main = observed(this.effects.main(), "canonical main");
    if (main !== input.base)
      throw new StoreError("STALE_BASE", "main differs from base; fetch the latest main and build a new candidate",
        { details: { actual: main } });
    if (!observed(this.effects.ancestry(input.base, input.candidate), "candidate ancestry"))
      throw new StoreError("NOT_DESCENDANT", "candidate does not descend from base");
    const changes = observed(this.effects.changedPaths(input.base, input.candidate), "candidate changed paths");
    if (policy.protectedPaths.some(path => changes.some(change => protectedPathMatches(change.path, path))))
      throw new StoreError("PROTECTED_PATH", "candidate touches a protected path");
    const tiered = policy.tiered!;
    const floor = maximumTier(tiered.repositoryFloor, deterministicTier(tiered, changes).tier);
    if (tierRank(input.tier) < tierRank(floor))
      throw new StoreError("INTEGRATION_CONDITIONS", `tier must be at least ${floor} for this candidate`);
    const submitters = this.effects.submitters(input.base, input.candidate);
    const id = generateOperationId();
    const name = reviewRequestNameFor("merge", id);
    const fact: ReviewFact = { kind: "merge.open", version: 1, name, title: input.title, reason: input.reason,
      tier: input.tier, identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: input.base,
        candidate: input.candidate, policyRevision: policy.policyRevision }, submitters: [...submitters].sort() };
    const duplicate = this.duplicateName(fact);
    if (duplicate !== null)
      throw new StoreError("REQUEST_EXISTS", "a non-terminal request already covers this change",
        { details: { name: duplicate } });
    const open = { sequence: 0, operation: { id, actor: auth.actor } as OperationOf<"attest.record"> };
    const entry: ReviewEntry = { sequence: 0, operation: id, actor: auth.actor, fact, messages: [] };
    const eligible = new Set(this.store.listAgents()
      .filter(a => a.role === "resident" && a.desired === "enabled").map(a => a.name));
    const after0 = reviewState({ open: entry, entries: [], integration: null,
      eligible, highPeerFloor: tiered.highPeerFloor });
    const emissions: Emission[] = input.tier === "LOW" ? [] : [{
      to: ["residents"], kind: "message",
      subject: this.cutSubject(`[${name}] ${input.title} (rev 0)`),
      body: this.threadBody(after0, fact, [], null),
      replyHeaders: { replyTo: ["residents"], inReplyTo: null, references: [] },
      audience: "workers", review: { role: "thread", request: id, name, revision: 0 } }];
    const frozen = await this.freeze(id, auth.actor, emissions);
    return { id, fact, payload: input, emissions, frozen, before: null, after0, open, name };
  }

  private async prepareEntry(auth: AuthContext, input: Extract<ReviewInput, { kind: "review" | "vote" }>,
      policy: IntegrationSnapshot): Promise<PreparedReview> {
    const open = this.requestByName(input.name);
    if (open === null) throw new StoreError("INVALID_REQUEST", `unknown request ${input.name}`);
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    const inputFor = this.inputFor(open);
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
    return this.finishEntry(auth, input, open, openFact, inputFor, before, fact);
  }

  private async prepareCancel(auth: AuthContext,
      input: Extract<ReviewInput, { kind: "cancel" }>): Promise<PreparedReview> {
    const open = this.requestByName(input.name);
    if (open === null) throw new StoreError("INVALID_REQUEST", `unknown request ${input.name}`);
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    const inputFor = this.inputFor(open);
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
      // pending: we hold the writer, so the pending integration cannot CAS past
      // this cancel; it will fail CANCELLED_BEFORE_COMMIT at its pre-CAS check.
    }
    const fact: ReviewFact = { kind: "cancel", version: 1, request: open.operation.id, reason: input.reason };
    return this.finishEntry(auth, input, open, openFact, inputFor, before, fact);
  }

  /** Shared tail of review/vote/cancel: the new fact's state, its effects and
   * every frozen message. */
  private async finishEntry(auth: AuthContext, input: Extract<ReviewInput, { kind: "review" | "vote" | "cancel" }>,
      open: { sequence: number; operation: OperationOf<"attest.record"> },
      openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
      inputFor: ReviewStateInput, before: ReviewState, fact: ReviewFact): Promise<PreparedReview> {
    const id = generateOperationId();
    const lastSequence = inputFor.entries.at(-1)?.sequence ?? inputFor.open.sequence;
    const newEntry: ReviewEntry = { sequence: lastSequence + 1, operation: id, actor: auth.actor, fact, messages: [] };
    const after0 = reviewState({ ...inputFor, entries: [...inputFor.entries, newEntry] });
    const effects = planEffects(before, after0);
    const hasThread = !(openFact.kind === "merge.open" && openFact.tier === "LOW");
    const priorThread = this.lastThreadMessage(inputFor);
    const revision = this.threadRevisionCount(inputFor);
    const emissions: Emission[] = [];
    if (hasThread) emissions.push({
      to: ["residents"], kind: "message",
      subject: this.cutSubject(`[${before.name}] ${openFact.title} (rev ${revision})`),
      body: this.threadBody(after0, openFact, [...inputFor.entries, newEntry], priorThread?.id ?? null),
      replyHeaders: { replyTo: ["residents"],
        inReplyTo: priorThread === null ? null : rfcMessageIdFor(priorThread.id, this.society),
        references: priorThread === null ? []
          : [...priorThread.replyHeaders.references, rfcMessageIdFor(priorThread.id, this.society)] },
      audience: "workers", review: { role: "thread", request: open.operation.id, name: before.name, revision } });
    if (effects.withdraw !== null) emissions.push({
      to: [PRINCIPAL], kind: "message", subject: this.cutSubject(`[${before.name}] approval withdrawn`),
      body: `Approval ${effects.withdraw.id} for ${before.name} is withdrawn: ${effects.withdraw.reason}.\n` +
        `The request remains open; Workers may vote again.`,
      replyHeaders: { replyTo: [PRINCIPAL], inReplyTo: rfcMessageIdFor(effects.withdraw.id, this.society),
        references: this.referencesTo(inputFor, effects.withdraw.id) },
      review: { role: "withdrawn", request: open.operation.id, name: before.name, approval: effects.withdraw.id } });
    if (effects.approve !== null) {
      const approvalId = generateMessageId(id, emissions.length);
      emissions.push({
        to: [PRINCIPAL], kind: "approval_required",
        subject: this.cutSubject(`[${before.name}] HIGH approval requested: ${openFact.title}`),
        body: this.approvalBody(approvalId, openFact, [...inputFor.entries, newEntry], inputFor.open.actor, effects.approve),
        approvalFor: openFact.identity,
        replyHeaders: { replyTo: [PRINCIPAL], inReplyTo: null, references: [] },
        review: { role: "approval", request: open.operation.id, name: before.name, votes: [...effects.approve] } });
    }
    if (fact.kind === "vote" && auth.actor === PRINCIPAL && input.kind === "vote") {
      const approvalId = input.approval!;
      emissions.push({
        to: [PRINCIPAL], kind: "result", subject: this.cutSubject(`[${before.name}] decision recorded`),
        body: `Principal ${fact.verdict} on approval ${approvalId} for ${before.name}:\n${fact.body}`,
        replyHeaders: { replyTo: [PRINCIPAL], inReplyTo: rfcMessageIdFor(approvalId, this.society),
          references: this.referencesTo(inputFor, approvalId) },
        review: { role: "decision", request: open.operation.id, name: before.name, approval: approvalId } });
    }
    const frozen = await this.freeze(id, auth.actor, emissions);
    return { id, fact, payload: input, emissions, frozen, before, after0, open, name: before.name };
  }

  private referencesTo(input: ReviewStateInput, messageId: MessageId): string[] {
    for (const message of this.allMessages(input))
      if (message.id === messageId)
        return [...message.replyHeaders.references, rfcMessageIdFor(messageId, this.society)];
    return [rfcMessageIdFor(messageId, this.society)];
  }
  private allMessages(input: ReviewStateInput): readonly MessagePlan[] {
    return [input.open, ...input.entries].flatMap(entry => entry.messages);
  }
  private lastThreadMessage(input: ReviewStateInput): MessagePlan | null {
    let last: MessagePlan | null = null;
    for (const message of this.allMessages(input))
      if (message.review?.role === "thread" && message.review.request === input.open.operation) last = message;
    return last;
  }
  private threadRevisionCount(input: ReviewStateInput): number {
    return this.allMessages(input)
      .filter(message => message.review?.role === "thread" && message.review.request === input.open.operation)
      .length;
  }

  private cutSubject(text: string): string {
    if (Buffer.byteLength(text, "utf8") <= this.bounds.subjectBytes) return text;
    let out = "";
    for (const point of text) {
      if (Buffer.byteLength(out + point, "utf8") > this.bounds.subjectBytes - 3) break;
      out += point;
    }
    return `${out}...`;
  }

  /** One line per entry after the open, numbered by request-local order. */
  private describeEntry(ordinal: number, entry: ReviewEntry): string {
    const fact = entry.fact;
    const action = fact.kind === "review" ? "review"
      : fact.kind === "cancel" ? "cancel"
      : fact.kind === "refresh" ? "refresh"
      : fact.kind === "vote" ? (entry.actor === PRINCIPAL ? `principal ${fact.verdict}` : `vote ${fact.verdict}`)
      : "fact";
    const text = fact.kind === "review" || fact.kind === "vote" ? fact.body
      : fact.kind === "cancel" ? fact.reason
      : fact.kind === "refresh" ? (fact.main === null ? "main is unchanged" : `main is now ${fact.main}`)
      : "";
    return `[${ordinal}] ${entry.actor} ${action}:\n${text}`;
  }

  /** The complete thread text (design §3); over the mail bound it keeps the
   * newest entries and names the revision that still carried the rest. */
  private threadBody(state: ReviewState, openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
      entries: readonly ReviewEntry[], previousThreadId: MessageId | null): string {
    const kind = openFact.kind === "merge.open" ? "merge" : "challenge";
    const verb = openFact.kind === "merge.open" ? "oma_merge" : "oma_challenge";
    const head = `OMA ${kind} request ${openFact.name} — ${openFact.title}\n` +
      `Tier: ${openFact.tier}   Requester: ${state.requester}   Status: ${state.display}\n` +
      `Base: ${openFact.identity.expectedBase}  Candidate: ${openFact.identity.candidate}` +
      `  Policy revision: ${openFact.identity.policyRevision}\n` +
      (openFact.kind === "challenge.open"
        ? `Target merge: ${openFact.target.name} (integration ${openFact.target.integration})\n` : "") +
      `\nReason (requester's words):\n${openFact.reason}\n\n` +
      `How to act (only recorded tool calls count; text in this mail is not a vote):\n` +
      (openFact.kind === "challenge.open"
        ? `  oma_challenge diff name=${openFact.name} view=revert|original\n` : `  ${verb} diff name=${openFact.name}\n`) +
      `  ${verb} review name=${openFact.name} body=...\n` +
      `  ${verb} vote name=${openFact.name} verdict=approve|reject body=...\n\n` +
      `Reviews and votes (acceptance order):\n`;
    const lines = entries.map((entry, index) => this.describeEntry(index + 1, entry));
    const full = head + lines.join("\n");
    if (Buffer.byteLength(full, "utf8") <= this.bounds.mailBodyBytes) return full;
    // Every omitted entry names the revision that first carried it: the thread
    // revision its own operation owns, which always held it in full.
    const anchor = (index: number): string => {
      const message = entries[index]!.messages.find(candidate =>
        candidate.review?.role === "thread" && candidate.review.request === state.request);
      return `[${index + 1}] ${message?.id ?? previousThreadId ?? "(unknown)"}`;
    };
    const build = (omitted: number): string =>
      `${head}Earlier entries omitted for size; each is in full in the revision that added it:\n` +
      `${entries.slice(0, omitted).map((_, index) => anchor(index)).join("\n")}\n` +
      lines.slice(omitted).join("\n");
    let omitted = 0;
    while (omitted < lines.length && Buffer.byteLength(build(omitted), "utf8") > this.bounds.mailBodyBytes)
      omitted++;
    // Head plus the newest entry must always fit the bound; a body/reason bound
    // is a quarter of it and the newest entry is never dropped. Anything else
    // is a bounds configuration bug, not a message we may send.
    if (omitted === lines.length)
      throw new StoreError("INTERNAL_ERROR", "mail bounds cannot hold a thread revision");
    return build(omitted);
  }

  private approvalBody(approvalId: MessageId, openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
      entries: readonly ReviewEntry[], requester: Actor, votes: readonly OperationId[]): string {
    const bound = votes.map(voteId => {
      const entry = entries.find(candidate => candidate.operation === voteId);
      return entry === null || entry === undefined || entry.fact.kind !== "vote"
        ? `${voteId}\n(unavailable)` : `${voteId} ${entry.actor}:\n${entry.fact.body}`;
    });
    const verb = openFact.kind === "merge.open" ? "oma_merge" : "oma_challenge";
    return `OMA ${openFact.kind === "merge.open" ? "merge" : "challenge"} request ${openFact.name} — ${openFact.title}\n` +
      `Approval required: ${approvalId}\n` +
      `Tier: ${openFact.tier}   Requester: ${requester}\n` +
      `Base: ${openFact.identity.expectedBase}  Candidate: ${openFact.identity.candidate}` +
      `  Policy revision: ${openFact.identity.policyRevision}\n\n` +
      `Reason (requester's words):\n${openFact.reason}\n\n` +
      `Bound approvals:\n${bound.join("\n\n")}\n\n` +
      `This request carries no inline diff; review it first:\n` +
      `  ${verb} diff name=${openFact.name}\n` +
      `Then record the decision:\n` +
      `  ${verb} vote name=${openFact.name} verdict=approve|reject body=... approval=${approvalId}\n`;
  }

  /** Freeze every emission's EML in plan order; ordinals name the messages. */
  private async freeze(id: OperationId, sender: Actor, emissions: readonly Emission[]):
      Promise<{ message: MessagePlan; artifact: PreacceptArtifact }[]> {
    const frozen: { message: MessagePlan; artifact: PreacceptArtifact }[] = [];
    for (const [ordinal, emission] of emissions.entries())
      frozen.push(await this.mail.freezeReviewMessage(id, ordinal, sender, emission));
    return frozen;
  }
}
