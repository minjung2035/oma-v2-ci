/** mail-v1 review acceptance owner (design §3): merge/challenge request opens,
 * worker reviews and votes, the Principal's vote, and cancellation. Quorum and
 * status decisions are pure in domain/review-evaluation.js; this module owns
 * live Git observation, message freezing and the acceptance transaction.
 *
 * §5 lives here too: advance/advanceAll accept broker-derived refresh facts and
 * create the request's single integration; the actual application belongs to
 * IntegrationCoordinator.applyMerge behind the effects port. */
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
import { StoreError, acceptedFailure, errorCodeOf } from "./domain/errors.js";
import { NO_HOLD, observeStoreFailure, type ResourceGate } from "./domain/admission.js";
import { applyRequestKeyFor, refreshRequestKeyFor, reviewRequestNameFor } from "./domain/identifiers.js";
import { mergeDiffText } from "./git/canonical-command.js";
import { NOTICE_PART_OVERHEAD, OMISSION_MARKER, OMISSION_MARKER_COMPACT, approvalBodyText, boundVoteText, describeEntryText, threadHeadText } from "./mail/review-bounds.js";
import { publishedRefFor } from "./domain/derived.js";
import { expandAddresses } from "./mail/routing.js";
import { rfcMessageIdFor } from "./mail/addresses.js";
import { PreacceptScope, type PreacceptArtifact } from "./storage/preaccept-artifact.js";
import { frozenMessageDisposition } from "./mail/materializer.js";
import { receiptOfOperation } from "./storage/receipt-projector.js";
import { requestHash, sha256Hex } from "./hash.js";
import type { ReviewRequestStatus, ReviewRequestSummary, ReviewStatusEntry, ReviewStatusResult } from "../implementation/contracts/public-wire.js";
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
  /** §6: the canonical merge diff for the completion notice, as raw bytes;
   * one owner renders them for text consumers (never U+FFFD substitution).
   * Output bounded at maxBytes; LIMIT_EXCEEDED marks the request oversize. */
  mergeDiff(base: Oid, candidate: Oid, maxBytes: number): Buffer;
  /** §7: the broker's revert commit on canonical main — merge-tree against the
   * applied merge's candidate, commit-tree with the OMA identity. Throws
   * REVERT_CONFLICT (details.paths), INVALID_REQUEST when the merged change is
   * already absent, or a state error on unobservable Git. */
  prepareRevert(input: { readonly mergeBase: Oid; readonly main: Oid; readonly base: Oid;
    readonly message: string }): Oid;
  /** §7: publish the prepared revert under refs/oma/published/<actor>/<op> by
   * CAS null→oid, before the acceptance transaction. */
  publishCandidateRef(ref: string, candidate: Oid): void;

  /** §5.3: execute an accepted merge integration inside the held writer. */
  applyMerge(operation: OperationOf<"git.integrate">): Promise<void>;
  /** Cancellation serializes with integration CAS through the same writer. */
  withWriter<T>(work: () => Promise<T>): Promise<T>;
  /** AV-01: the resource admission fresh advance effects (a broker-derived
   * refresh or a new integration and its completion mail) must pass. Recovery
   * callers pass their own gate instead; absent either, no hold is taken
   * (caller-record admission already covers the caller's request). */
  admitResource?: ResourceGate;
}

export interface ReviewBounds {
  readonly mailBodyBytes: number; readonly subjectBytes: number;
  /** Completion notices larger than this are never created (the request waits). */
  readonly bundleBytes: number;
}

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
  /** The caller input, or the frozen fact itself for broker-derived refresh. */
  readonly payload: ReviewInput | ReviewFact;
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
  // AV-20261003-25: a candidate outside the observation grammar is refused at
  // candidate scope -- it is never durable-store corruption.
  if (observation.kind === "refused") throw new StoreError("INVALID_REQUEST", `${description}: ${observation.reason}`);
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
    let found: { sequence: number; operation: OperationOf<"attest.record"> } | null = null;
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
    const hash = requestHash("attest.record", copied);
    // The durable receipt lookup precedes every current-config judgment: a
    // fact already accepted keeps its meaning under changed bounds, grammar,
    // or review-mode policy (AV-03). Only a genuinely new intent pays for the
    // fresh checks below.
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    if (claim === "reused")
      throw new StoreError("REQUEST_KEY_REUSED", `request key ${key} already used with a different payload`);
    const problem = reviewInputProblem(copied, this.bounds);
    if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
    const value = copied as ReviewInput;
    // Cheap bound read for routing only; the fact freezes the current revision.
    const bound = this.effects.policy();
    if (bound?.tiered == null)
      throw new StoreError("UNSUPPORTED_PROFILE", "this society does not use mail-v1 review");
    // DR8: the fact names the host's current revision; facts must be the bound ones.
    const policy = this.effects.currentPolicy();
    const run = async () => this.accept(auth, key, value, hash, policy);
    // Cancel holds the writer so a pending integration cannot CAS past it.
    let receipt: Receipt;
    try { receipt = value.kind === "cancel" ? await this.effects.withWriter(run) : await run(); }
    catch (error) { observeStoreFailure(this.store, error); throw error; }
    // §5.4: an accepted open or vote may make the request ready; advance inside
    // its own try/catch so no application failure rewrites this receipt.
    if ((receipt.state === "succeeded" || receipt.state === "pending" || receipt.state === "unknown") &&
        (value.kind === "merge.open" || value.kind === "challenge.open" || value.kind === "vote")) {
      const requestId = (value.kind === "merge.open" || value.kind === "challenge.open")
        ? this.store.getOperation(auth.actor, key)?.id
        : this.requestByName(value.name)?.operation.id;
      if (requestId !== undefined)
        try { await this.advance(requestId); }
        catch (error) {
          // Confirmed corruption fences fresh acceptance at once; the receipt
          // still reports what its transaction committed (AV-09).
          observeStoreFailure(this.store, error);
          console.error(JSON.stringify({ event: "review.advance", request: requestId, code: errorCodeOf(error) }));
        }
    }
    return receipt;
  }

  private async accept(auth: AuthContext, key: string, input: ReviewInput,
      hash: string, policy: IntegrationSnapshot): Promise<Receipt> {
    // The scope owns every frozen artifact from the moment it exists; a
    // prepare failure mid-freeze settles the earlier ones exactly (AV-04).
    const scope = new PreacceptScope();
    let prepared: PreparedReview;
    try { prepared = await this.prepare(auth, input, policy, scope); }
    catch (error) { return scope.settleFailure(error); }
    return this.acceptPrepared(prepared, auth, auth.actor, key, hash, scope);
  }

  /** The shared acceptance tail: T re-derivation, recipients, operation +
   * deliveries, settle, materialize, succeeded. `auth` is null for
   * broker-derived refresh facts (the requester may be stopped or retired).
   * The scope already owns `prepared.frozen`; its caller created it before the
   * first artifact existed. */
  private async acceptPrepared(prepared: PreparedReview, auth: AuthContext | null, actor: Actor,
      key: string, hash: string, scope: PreacceptScope): Promise<Receipt> {
    let txClaim: "inserted" | "retry";
    try {
      txClaim = this.store.transaction(tx => {
        if (auth !== null) {
          const agent = assertCurrentActor(this.store, auth, "mail.send");
          if (isOpenFact(prepared.fact) && !capabilitiesOf(agent).has("git.submit"))
            throw new StoreError("CAPABILITY_DENIED", "git.submit was revoked before acceptance",
              { details: { capability: "git.submit" } });
        } else if (this.store.getAgent(actor) === null)
          throw new StoreError("STORE_CORRUPT", "review refresh names a missing actor");
        const current = this.store.claimKey(actor, key, hash);
        if (current === "retry") return "retry" as const;
        if (current === "reused")
          throw new StoreError("REQUEST_KEY_REUSED", `request key ${key} already used with a different payload`);
        this.assertUnchanged(prepared);
        const plans = prepared.frozen.map(frozen => frozen.message);
        for (const [index, emission] of prepared.emissions.entries())
          (plans[index] as { recipients: string[] }).recipients =
            [...expandAddresses(this.store, emission.to, this.society).recipients].sort();
        const accepted = tx.acceptOperation({ id: prepared.id, actor, requestKey: key,
          requestHash: hash, kind: "attest.record", payloadJson: JSON.stringify(prepared.payload),
          planJson: JSON.stringify({ kind: "attest.record", fact: prepared.fact, messages: plans }) });
        if (accepted === "inserted")
          for (const plan of plans)
            tx.insertDeliveries(plan.recipients.map(recipient =>
              ({ messageId: plan.id, recipient, operationId: prepared.id })));
        return accepted;
      });
    } catch (error) { return scope.settleFailure(error); }
    scope.settle();
    if (txClaim === "retry") return receiptOfOperation(this.store.retriedOperation(actor, key));
    // §7: the accepted prepared challenge's revert is published under the
    // challenger's refs/oma/published ref now (never before T). A failure here
    // must not rewrite the receipt: recovery republishes it from advanceAll.
    if (prepared.fact.kind === "challenge.open" && prepared.fact.prepared) {
      try { this.ensureChallengePublished(prepared.id, actor, prepared.fact); }
      catch (error) {
        // Confirmed corruption fences fresh acceptance immediately; the
        // receipt still reports the committed challenge (AV-09).
        observeStoreFailure(this.store, error);
        console.error(JSON.stringify({ event: "review.challenge.publish", request: prepared.id,
          code: errorCodeOf(error) }));
      }
    }
    try {
      let materializedAll = true;
      try { await this.mail.materialize(prepared.id); }
      catch (error) { if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error; materializedAll = false; }
      if (materializedAll)
        this.store.transaction(tx => tx.setOperationSucceeded(prepared.id, JSON.stringify({
          kind: "attest.record", request: prepared.name,
          messages: prepared.frozen.map(frozen => frozen.message.id),
          recipientCount: prepared.frozen.reduce((sum, frozen) => sum + frozen.message.recipients.length, 0) })));
      const finalOp = this.store.getOperation(actor, key);
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

  private async prepare(auth: AuthContext, input: ReviewInput, policy: IntegrationSnapshot,
      scope: PreacceptScope): Promise<PreparedReview> {
    switch (input.kind) {
      case "merge.open": return this.prepareOpen(auth, input, policy, scope);
      case "review": case "vote": return this.prepareEntry(auth, input, policy, scope);
      case "cancel": return this.prepareCancel(auth, input, scope);
      case "challenge.open": return this.prepareChallenge(auth, input, policy, scope);
    }
  }

  /** §7: an applied challenge of the same target is a hard duplicate; a live
   * challenge with the same revert identity is one too. */
  private duplicateChallenge(fact: Extract<ReviewFact, { kind: "challenge.open" }>): string | null {
    for (const open of this.openRequests()) {
      const existing = open.operation.plan.fact;
      if (!isOpenFact(existing) || existing.kind !== "challenge.open" ||
          existing.target.request !== fact.target.request) continue;
      const state = reviewState(this.inputFor(open));
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
    const targetOpen = this.requestByName(input.merge);
    if (targetOpen === null)
      throw new StoreError("INVALID_REQUEST", `unknown request ${input.merge}`);
    const targetPlan = targetOpen.operation.plan;
    if (!("messages" in targetPlan))
      throw new StoreError("STORE_CORRUPT", "target merge owns no message list");
    const targetFact = targetPlan.fact;
    if (targetFact.kind !== "merge.open")
      throw new StoreError("INVALID_REQUEST",
        "a challenge needs an applied merge; cancel a request that is not applied yet");
    const targetState = reviewState(this.inputFor(targetOpen));
    if (targetState.integration === null || targetState.integration.state !== "succeeded")
      throw new StoreError("INVALID_REQUEST",
        "a challenge needs an applied merge; cancel a request that is not applied yet");
    if (targetFact.tier === "HIGH" && input.tier !== "HIGH")
      throw new StoreError("INTEGRATION_CONDITIONS", "a HIGH merge can only be challenged at HIGH");
    for (const open of this.openRequests()) {
      const existing = open.operation.plan.fact;
      if (!isOpenFact(existing) || existing.kind !== "challenge.open" ||
          existing.target.request !== targetOpen.operation.id) continue;
      if (reviewState(this.inputFor(open)).integration?.state === "succeeded")
        throw new StoreError("REQUEST_EXISTS", "an applied challenge already covers this merge",
          { details: { name: existing.name } });
    }
    const id = generateOperationId();
    const name = reviewRequestNameFor("challenge", id);
    let candidate: Oid, expectedBase: Oid, submitters: string[], prepared: boolean;
    let refArtifact: { readonly ref: string; readonly candidate: Oid } | undefined;
    if (input.candidate !== undefined) {
      // A caller-provided revert faces the same live checks as a merge.open
      // candidate except the tier floor: challenge tiers are LOW or HIGH by rule.
      candidate = input.candidate; expectedBase = input.base!;
      if (candidate === expectedBase)
        throw new StoreError("INVALID_REQUEST", "challenge candidate equals its base");
      this.effects.verifyObjectFormat([expectedBase, candidate]);
      if (!observed(this.effects.published(), "candidate publication").includes(candidate))
        throw new StoreError("CANDIDATE_NOT_PUBLISHED", "candidate is not published");
      const main = observed(this.effects.main(), "canonical main");
      if (main !== expectedBase)
        throw new StoreError("STALE_BASE", "main differs from base; fetch the latest main and build a new candidate",
          { details: { actual: main } });
      if (!observed(this.effects.ancestry(expectedBase, candidate), "candidate ancestry"))
        throw new StoreError("NOT_DESCENDANT", "candidate does not descend from base");
      const changes = observed(this.effects.changedPaths(expectedBase, candidate), "candidate changed paths");
      if (policy.protectedPaths.some(path => changes.some(change => protectedPathMatches(change.path, path))))
        throw new StoreError("PROTECTED_PATH", "candidate touches a protected path");
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
    const duplicate = this.duplicateChallenge(fact);
    if (duplicate !== null)
      throw new StoreError("REQUEST_EXISTS", "an applied or identical challenge already covers this merge",
        { details: { name: duplicate } });
    const open = { sequence: 0, operation: { id, actor: auth.actor } as OperationOf<"attest.record"> };
    const entry: ReviewEntry = { sequence: 0, operation: id, actor: auth.actor, fact, messages: [] };
    const eligible = new Set(this.store.listAgents()
      .filter(a => a.role === "resident" && a.desired === "enabled").map(a => a.name));
    const after0 = reviewState({ open: entry, entries: [], integration: null,
      eligible, highPeerFloor: policy.tiered!.highPeerFloor });
    // Challenges always have a review thread — LOW challenges too (§7).
    const emissions: Emission[] = [{
      to: ["residents"], kind: "message",
      subject: this.cutSubject(`[${name}] ${input.title} (rev 0)`),
      body: this.threadBody(after0, fact, [], null),
      replyHeaders: { replyTo: ["residents"], inReplyTo: null, references: [] },
      audience: "workers", review: { role: "thread", request: id, name, revision: 0 } }];
    const frozen = await this.freeze(scope, id, auth.actor, emissions);
    return { id, fact, payload: input, emissions, frozen, before: null, after0, open, name };
  }

  /** §7: an accepted prepared challenge owns its published ref. Idempotent:
   * absent → CAS null→oid; already the same oid → done; another oid is a
   * corruption the accepted fact cannot own. */
  private ensureChallengePublished(operationId: OperationId, actor: Actor,
      fact: Extract<ReviewFact, { kind: "challenge.open" }>): void {
    try {
      this.effects.publishCandidateRef(publishedRefFor(actor, operationId), fact.identity.candidate);
    } catch (error) {
      if (error instanceof StoreError && error.code === "PUBLISHED_REF_CONFLICT")
        throw new StoreError("STORE_CORRUPT", "the challenge's published ref holds another candidate");
      throw error;
    }
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
    const frozen = await this.freeze(scope, id, auth.actor, emissions);
    return { id, fact, payload: input, emissions, frozen, before: null, after0, open, name };
  }

  private async prepareEntry(auth: AuthContext, input: Extract<ReviewInput, { kind: "review" | "vote" }>,
      policy: IntegrationSnapshot, scope: PreacceptScope): Promise<PreparedReview> {
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
    return this.finishEntry(auth, input, open, openFact, inputFor, before, fact, scope);
  }

  private async prepareCancel(auth: AuthContext,
      input: Extract<ReviewInput, { kind: "cancel" }>, scope: PreacceptScope): Promise<PreparedReview> {
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
    return this.finishEntry(auth, input, open, openFact, inputFor, before, fact, scope);
  }

  /** Shared tail of review/vote/cancel: the new fact's state, its effects and
   * every frozen message. */
  private async finishEntry(auth: AuthContext, input: Extract<ReviewInput, { kind: "review" | "vote" | "cancel" }>,
      open: { sequence: number; operation: OperationOf<"attest.record"> },
      openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
      inputFor: ReviewStateInput, before: ReviewState, fact: ReviewFact, scope: PreacceptScope): Promise<PreparedReview> {
    const id = generateOperationId();
    const lastSequence = inputFor.entries.at(-1)?.sequence ?? inputFor.open.sequence;
    const newEntry: ReviewEntry = { sequence: lastSequence + 1, operation: id, actor: auth.actor, fact, messages: [] };
    const after0 = reviewState({ ...inputFor, entries: [...inputFor.entries, newEntry] });
    const effects = planEffects(before, after0);
    const decision = fact.kind === "vote" && auth.actor === PRINCIPAL && input.kind === "vote"
      ? { approval: input.approval!, verdict: fact.verdict, body: fact.body } : null;
    const emissions = this.entryEmissions(id, open, openFact, inputFor, before, after0, newEntry, effects, decision);
    const frozen = await this.freeze(scope, id, auth.actor, emissions);
    return { id, fact, payload: input, emissions, frozen, before, after0, open, name: before.name };
  }

  /** The shared emissions for an entry fact: its thread revision (except LOW
   * merges, which have no thread) plus the planEffects Principal mail and an
   * optional Principal decision copy. */
  private entryEmissions(id: OperationId,
      open: { sequence: number; operation: OperationOf<"attest.record"> },
      openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
      inputFor: ReviewStateInput, before: ReviewState, after0: ReviewState, newEntry: ReviewEntry,
      effects: ReturnType<typeof planEffects>,
      decision: { approval: MessageId; verdict: "approve" | "reject"; body: string } | null): Emission[] {
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
      const body = this.approvalBody(approvalId, openFact, [...inputFor.entries, newEntry], inputFor.open.actor, effects.approve);
      // The floor model (mail/review-bounds.ts) covers this body for the
      // votes the configured floor binds; over it is a bounds bug, not a mail
      // the Principal cannot read (the notice-part assert has the same shape).
      if (Buffer.byteLength(body, "utf8") > this.bounds.mailBodyBytes)
        throw new StoreError("INTERNAL_ERROR", "an approval request exceeds the mail body bound");
      emissions.push({
        to: [PRINCIPAL], kind: "approval_required",
        subject: this.cutSubject(`[${before.name}] HIGH approval requested: ${openFact.title}`),
        body,
        approvalFor: openFact.identity,
        replyHeaders: { replyTo: [PRINCIPAL], inReplyTo: null, references: [] },
        review: { role: "approval", request: open.operation.id, name: before.name, votes: [...effects.approve] } });
    }
    if (decision !== null)
      emissions.push({
        to: [PRINCIPAL], kind: "result", subject: this.cutSubject(`[${before.name}] decision recorded`),
        body: `Principal ${decision.verdict} on approval ${decision.approval} for ${before.name}:\n${decision.body}`,
        replyHeaders: { replyTo: [PRINCIPAL], inReplyTo: rfcMessageIdFor(decision.approval, this.society),
          references: this.referencesTo(inputFor, decision.approval) },
        review: { role: "decision", request: open.operation.id, name: before.name, approval: decision.approval } });
    return emissions;
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

  /** The complete thread text (design §3); over the mail bound it keeps the
   * newest entries and names the revision that still carried the rest. */
  private threadBody(state: ReviewState, openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
      entries: readonly ReviewEntry[], previousThreadId: MessageId | null): string {
    const head = threadHeadText(openFact, state.requester, state.display);
    const lines = entries.map((entry, index) => describeEntryText(index + 1, entry));
    const full = head + lines.join("\n");
    if (Buffer.byteLength(full, "utf8") <= this.bounds.mailBodyBytes) return full;
    // Every omitted entry names the revision that first carried it: the thread
    // revision its own operation owns, which always held it in full. That
    // per-entry anchor list is itself O(history); when it outgrows the bound
    // the compact form keeps one pointer to the ledger that carries every
    // omitted entry in full, so a long thread still leaves room to record a
    // vote or cancel (AV-12).
    const anchor = (index: number): string => {
      const message = entries[index]!.messages.find(candidate =>
        candidate.review?.role === "thread" && candidate.review.request === state.request);
      return `[${index + 1}] ${message?.id ?? previousThreadId ?? "(unknown)"}`;
    };
    const build = (omitted: number, anchored: boolean): string =>
      `${head}${OMISSION_MARKER}` +
      (anchored ? `:\n${entries.slice(0, omitted).map((_, index) => anchor(index)).join("\n")}\n`
        : OMISSION_MARKER_COMPACT) +
      lines.slice(omitted).join("\n");
    let omitted = 0;
    while (omitted < lines.length && Buffer.byteLength(build(omitted, true), "utf8") > this.bounds.mailBodyBytes)
      omitted++;
    if (omitted === lines.length) {
      // The anchor list alone outgrew the bound: fall back to the compact
      // pointer and keep as many newest entries as fit.
      omitted = 0;
      while (omitted < lines.length && Buffer.byteLength(build(omitted, false), "utf8") > this.bounds.mailBodyBytes)
        omitted++;
      // Head plus the newest entry must always fit the bound; a body/reason
      // bound is a quarter of it and the newest entry is never dropped.
      // Anything else is a bounds configuration bug, not a message we may send.
      if (omitted === lines.length)
        throw new StoreError("INTERNAL_ERROR", "mail bounds cannot hold a thread revision");
      return build(omitted, false);
    }
    return build(omitted, true);
  }

  private approvalBody(approvalId: MessageId, openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
      entries: readonly ReviewEntry[], requester: Actor, votes: readonly OperationId[]): string {
    return approvalBodyText(approvalId, openFact, requester,
      votes.map(voteId => boundVoteText(voteId, entries.find(candidate => candidate.operation === voteId))));
  }

  /** Freeze every emission's EML in plan order; ordinals name the messages.
   * Each artifact registers with `scope` the moment it exists, so a later
   * freeze failure still settles the earlier ones exactly (AV-04). */
  private async freeze(scope: PreacceptScope, id: OperationId, sender: Actor, emissions: readonly Emission[]):
      Promise<{ message: MessagePlan; artifact: PreacceptArtifact }[]> {
    const frozen: { message: MessagePlan; artifact: PreacceptArtifact }[] = [];
    for (const [ordinal, emission] of emissions.entries()) {
      const item = await this.mail.freezeReviewMessage(id, ordinal, sender, emission);
      scope.register({ operationId: id, resource: item.artifact.path, owner: item.artifact,
        observe: () => frozenMessageDisposition(this.store, id,
          { id: item.message.id, sha256: item.message.sha256 }) });
      frozen.push(item);
    }
    return frozen;
  }

  /* ---- §5 application ---- */

  /** Requests whose completion notice once exceeded the document bound; the
   * sweep never recomputes their diff (step 7 status explains). */
  private readonly oversize = new Set<OperationId>();

  /** Advance one request toward application. Runs under the Git writer; a busy
   * writer surfaces BROKER_UNAVAILABLE to the caller, which skips it. The
   * optional gate admits the fresh effects an advance may produce (AV-01). */
  async advance(requestId: OperationId, admit?: ResourceGate): Promise<void> {
    await this.effects.withWriter(async () => {
      const open = this.openRequests().find(candidate => candidate.operation.id === requestId);
      if (open !== undefined) await this.advanceRequest(open, admit);
    });
  }
  /** Every open request, in attestation sequence order. A single request's
   * refusal must not starve the others; corruption always propagates. */
  async advanceAll(admit?: ResourceGate): Promise<void> {
    await this.effects.withWriter(async () => {
      for (const open of this.openRequests()) {
        try { await this.advanceRequest(open, admit); }
        catch (error) {
          if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error;
          console.error(JSON.stringify({ event: "review.advance", request: open.operation.id,
            code: errorCodeOf(error) }));
        }
      }
    });
  }

  /** The resource gate fresh advance effects pass through: an explicit caller
   * gate (recovery), else the module's admission port, else no hold (a
   * caller-driven record already holds its own admission). */
  private advanceGate(admit?: ResourceGate): ResourceGate {
    return admit ?? this.effects.admitResource ?? (() => NO_HOLD);
  }

  private async advanceRequest(open: { sequence: number; operation: OperationOf<"attest.record"> },
      admit?: ResourceGate): Promise<void> {
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    // §7: a prepared challenge's published ref is an effect of the accepted
    // fact; a crash after T is repaired here, at every sweep. This is
    // settlement of accepted work, not fresh acceptance, so it precedes the
    // admission hold below.
    if (openFact.kind === "challenge.open" && openFact.prepared)
      this.ensureChallengePublished(open.operation.id, open.operation.actor, openFact);
    let state = reviewState(this.inputFor(open));
    const gate = this.advanceGate(admit);
    // 1. A broker-derived refresh fact: main moved (request goes stale), or a
    // sent approval drifted invalid through reviewer eligibility alone. A
    // refresh is a new durable intent + mail; it passes resource admission.
    if (state.terminal === null && state.integration === null) {
      const main = this.effects.main();
      if (main.kind === "corrupt")
        throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
      if (main.kind === "present" && main.value !== state.identity.expectedBase) {
        const release = gate("admit");
        try { await this.acceptRefresh(open, state, main.value); } finally { release(); }
        state = reviewState(this.inputFor(open));
      } else if (state.approval !== null && !state.approvalValid) {
        const release = gate("admit");
        try { await this.acceptRefresh(open, state, null); } finally { release(); }
        state = reviewState(this.inputFor(open));
      }
    }
    // 2. A ready request whose base is still main gets its one integration.
    if (!state.ready) return;
    const main = this.effects.main();
    if (main.kind === "corrupt")
      throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
    if (main.kind !== "present" || main.value !== state.identity.expectedBase) return;
    if (this.oversize.has(state.request)) return;
    if (this.store.recoverableOperations()
        .some(id => this.store.getOperationById(id)?.kind === "git.integrate")) return;
    let policy: IntegrationSnapshot;
    try { policy = this.effects.currentPolicy(); }
    catch (error) {
      if (error instanceof StoreError && error.code === "BROKER_UNAVAILABLE") return;
      throw error;
    }
    if (policy.policyRevision !== state.identity.policyRevision) return;
    const release = gate("admit");
    try { await this.createIntegration(open, policy); } finally { release(); }
  }

  /** The refresh fact is accepted through the same machinery as caller facts:
   * one scope, T re-derivation, deliveries, materialize, result — only the
   * actor assertion differs (the requester's agent row must exist, nothing more). */
  private async acceptRefresh(open: { sequence: number; operation: OperationOf<"attest.record"> },
      before: ReviewState, main: Oid | null): Promise<void> {
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    const inputFor = this.inputFor(open);
    const requester = open.operation.actor;
    const fact: ReviewFact = { kind: "refresh", version: 1, request: open.operation.id, main };
    const count = inputFor.entries.filter(entry => entry.fact.kind === "refresh").length;
    const id = generateOperationId();
    const lastSequence = inputFor.entries.at(-1)?.sequence ?? inputFor.open.sequence;
    const newEntry: ReviewEntry = { sequence: lastSequence + 1, operation: id, actor: requester, fact, messages: [] };
    const after0 = reviewState({ ...inputFor, entries: [...inputFor.entries, newEntry] });
    const effects = planEffects(before, after0);
    const emissions = this.entryEmissions(id, open, openFact, inputFor, before, after0, newEntry, effects, null);
    const scope = new PreacceptScope();
    let frozen: { message: MessagePlan; artifact: PreacceptArtifact }[];
    try { frozen = await this.freeze(scope, id, requester, emissions); }
    catch (error) { return scope.settleFailure(error); }
    await this.acceptPrepared({ id, fact, payload: fact, emissions, frozen, before, after0, open,
      name: before.name }, null, requester,
      refreshRequestKeyFor(open.operation.id, count), requestHash("attest.record", fact), scope);
  }

  /** §5.3's synchronous pre-CAS gate: the request must still be ready with its
   * own integration out of the picture. A cancel cancels; anything else that
   * would apply an unready request is a conditions refusal. */
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

  /** Create the request's single integration and apply it, still inside the
   * writer. The notice parts are frozen before T; recipients are resolved in T.
   *
   * AV-06: the notice is evidence of the review state it names. A vote or
   * review accepted while its parts freeze changes that state, so the
   * acceptance transaction compares the decision it sees to the one the
   * document was built from and the build retries a bounded number of times;
   * a request that stays live long enough loses to BROKER_UNAVAILABLE and the
   * next sweep tries again. */
  private async createIntegration(open: { sequence: number; operation: OperationOf<"attest.record"> },
      policy: IntegrationSnapshot): Promise<void> {
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    const applyKey = applyRequestKeyFor(open.operation.id);
    for (let attempt = 0; ; attempt++) {
      const current = reviewState(this.inputFor(open));
      if (current.integration !== null || !current.ready) return;
      const id = generateOperationId();
      let diff: string;
      try {
        diff = mergeDiffText(this.effects.mergeDiff(current.identity.expectedBase, current.identity.candidate,
          this.bounds.bundleBytes + 1));
      } catch (error) {
        if (error instanceof StoreError && error.code === "LIMIT_EXCEEDED") { this.markOversize(current, null); return; }
        throw error;
      }
      const document = this.noticeDocument(id, current, openFact, diff);
      const bytes = Buffer.byteLength(document, "utf8");
      if (bytes > this.bounds.bundleBytes) { this.markOversize(current, bytes); return; }
      const digest = sha256Hex(document);
      const chunks = this.splitNotice(document);
      const emissions: Emission[] = chunks.map((chunk, index) => ({
        to: ["commons", PRINCIPAL], kind: "result",
        subject: this.cutSubject(`[${current.name}] applied: ${openFact.title} (part ${index + 1}/${chunks.length})`),
        body: `Part ${index + 1}/${chunks.length} of the ${current.name} completion notice ` +
          `(document ${bytes} bytes, sha256 ${digest}); concatenate the parts after this line in order.
` +
          chunk,
        replyHeaders: { replyTo: [], inReplyTo: null, references: [] },
        review: { role: "notice", request: current.request, name: current.name,
          part: index + 1, parts: chunks.length, sha256: digest, bytes } }));
      // The splitter's envelope reserve must actually hold: an emitted part
      // over the mail bound is a bounds bug, not a caller fault (AV-07).
      for (const emission of emissions)
        if (Buffer.byteLength(emission.body, "utf8") > this.bounds.mailBodyBytes)
          throw new StoreError("INTERNAL_ERROR", "a notice part exceeds the mail body bound");
      const payload = { candidate: current.identity.candidate, expected: current.identity.expectedBase, tier: current.tier };
      const hash = requestHash("git.integrate", payload);
      const scope: PreacceptScope = new PreacceptScope();
      let created: "created" | "skipped" | "drifted";
      try {
        const frozen = await this.freeze(scope, id, current.requester, emissions);
        created = this.store.transaction(tx => {
          const fresh = reviewState(this.inputFor(open));
          // An integration already at the apply key surfaces in fresh.integration;
          // skipping silently is the idempotent path.
          if (fresh.integration !== null) return "skipped" as const;
          // A fact accepted while the notice froze changes the document's
          // evidence: discard this build and re-prepare from what the ledger
          // shows now.
          if (!this.sameDecision(current, fresh)) return "drifted" as const;
          if (this.store.recoverableOperations()
              .some(other => this.store.getOperationById(other)?.kind === "git.integrate")) return "skipped" as const;
          const recipients = [...expandAddresses(this.store, ["commons", PRINCIPAL], this.society).recipients].sort();
          const plans = frozen.map(part => part.message);
          for (const plan of plans) (plan as { recipients: string[] }).recipients = recipients;
          const plan = { kind: "git.integrate" as const, repo: "project" as const, target: "refs/heads/main" as const,
            base: current.identity.expectedBase, candidate: current.identity.candidate,
            policyRevision: current.identity.policyRevision, checkProfileDigest: policy.checkProfileDigest,
            merge: { version: 1 as const, request: current.request, name: current.name, tier: current.tier,
              notice: plans } };
          const accepted = tx.acceptOperation({ id, actor: current.requester, requestKey: applyKey,
            requestHash: hash, kind: "git.integrate", payloadJson: JSON.stringify(payload),
            planJson: JSON.stringify(plan) });
          if (accepted === "inserted")
            for (const plan of plans)
              tx.insertDeliveries(plan.recipients.map(recipient =>
                ({ operationId: id, messageId: plan.id, recipient })));
          return accepted === "inserted" ? "created" as const : "skipped" as const;
        });
      } catch (error) { return scope.settleFailure(error); }
      scope.settle();
      if (created === "skipped") return;
      if (created === "drifted") {
        if (attempt >= 2)
          throw new StoreError("BROKER_UNAVAILABLE",
            "review state kept changing while the completion notice was prepared",
            { details: { reason: "busy" } });
        continue;
      }
      const operation = this.store.getOperation(current.requester, applyKey);
      if (operation === null || operation.kind !== "git.integrate")
        throw new StoreError("STORE_CORRUPT", "accepted merge integration missing");
      await this.effects.applyMerge(operation);
      return;
    }
  }

  private markOversize(state: ReviewState, bytes: number | null): void {
    this.oversize.add(state.request);
    console.error(JSON.stringify({ event: "review.notice.oversize", request: state.request,
      name: state.name, bytes }));
  }

  /** §6: the completion notice document, then the bounded part bodies. */
  private noticeDocument(integrationId: OperationId, state: ReviewState,
      openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>, diff: string): string {
    const entries = state.entries.map((entry, index) => describeEntryText(index + 1, entry));
    const lowMerge = openFact.kind === "merge.open" && openFact.tier === "LOW";
    const principal = state.principal !== null && state.principal.fact.kind === "vote"
      ? `${state.principal.fact.body} (approval ${state.principal.fact.approval})` : "none";
    return `OMA ${openFact.kind === "merge.open" ? "merge" : "revert"} applied: ${state.name} — ${openFact.title}` +
      `\nIntegration operation: ${integrationId}   Tier: ${state.tier}   Requester: ${state.requester}` +
      `\nPrevious main: ${state.identity.expectedBase}\nNew main: ${state.identity.candidate}` +
      (openFact.kind === "challenge.open"
        ? `\nReverts merge ${openFact.target.name} (integration ${openFact.target.integration})` : "") +
      `\n\nReason:\n${openFact.reason}\n\nReviews and votes:\n` +
      `${lowMerge ? "none — LOW is applied without prior review" : entries.join("\n")}` +
      `\n\nPrincipal: ${principal}\n\n` +
      `Diff (git diff --binary --full-index --no-ext-diff --no-textconv --no-color ` +
      `${state.identity.expectedBase} ${state.identity.candidate}):\n` +
      diff;
  }

  /* ---- §8 status read model ---- */

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
  status(auth: AuthContext, name: string | undefined, frameBytes: number, responseId: string):
      ReviewStatusResult {
    const main = this.mainObservation();
    if (auth.role === "principal") return this.principalStatus(name);
    if (name !== undefined) return this.workerStatus(name, main, frameBytes, responseId);
    const opens = [...this.openRequests()].reverse();   // newest first
    const requests: ReviewRequestSummary[] = [];
    const summaryOf = (open: { sequence: number; operation: OperationOf<"attest.record"> },
        state: ReviewState): ReviewRequestSummary => {
      const plan = open.operation.plan;
      if (!("messages" in plan) || !isOpenFact(plan.fact))
        throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
      return { name: state.name, kind: state.kind, tier: state.tier, title: plan.fact.title,
        requester: state.requester, display: state.display };
    };
    for (const [index, open] of opens.entries()) {
      const state = reviewState(this.inputFor(open));
      const candidate = { requests: [...requests, summaryOf(open, state)],
        omitted: opens.length - (index + 1), main };
      if (Buffer.byteLength(JSON.stringify({ v: 1, id: responseId, ok: true, result: candidate })) > frameBytes)
        break;
      requests.push(summaryOf(open, state));
    }
    // The omitted count widened since the last probe; shrink until it fits.
    let result = { requests, omitted: opens.length - requests.length, main };
    while (requests.length > 0 &&
        Buffer.byteLength(JSON.stringify({ v: 1, id: responseId, ok: true, result })) > frameBytes) {
      requests.pop();
      result = { requests, omitted: opens.length - requests.length, main };
    }
    return result;
  }

  /** AV-20261003-24: the detail answer is bounded like the list answer. The
   * newest entries are kept; earlier entries that no longer fit are reported
   * in `missing`, never dropped silently. `entries` is the only unbounded
   * field — every other field is fixed or quota-bounded. */
  private workerStatus(name: string, main: { oid: Oid | null; observedAtMs: number },
      frameBytes: number, responseId: string): ReviewStatusResult {
    const open = this.requestByName(name);
    if (open === null) throw new StoreError("INVALID_REQUEST", `unknown request ${name}`);
    const inputFor = this.inputFor(open);
    const state = reviewState(inputFor);
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    const missing = [...state.missing];
    if (state.ready) {
      try {
        const current = this.effects.currentPolicy();
        if (current.policyRevision !== state.identity.policyRevision)
          missing.push(`the host policy revision changed (now ${current.policyRevision}); open a new request`);
      } catch { missing.push("the host policy cannot be read now"); }
    }
    if (this.oversize.has(state.request))
      missing.push("the completion notice exceeds the document bound; split the change");
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
      missing: omitted === 0 ? missing : [...missing, `${omitted} earlier ${omitted === 1 ? "entry" : "entries"} omitted for size`] });
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

  /** The Principal sees a request only when an approval mail reached it or the
   * request applied; an unseen name and a hidden one get the same refusal. */
  private principalStatus(name: string | undefined): ReviewStatusResult {
    const refuse = (): never => {
      throw new StoreError("CAPABILITY_DENIED",
        name === undefined ? "no request is visible to the Principal"
          : `no request ${name} is visible to the Principal`);
    };
    if (name === undefined) return refuse();
    const open = this.openRequests().find(candidate => {
      const plan = candidate.operation.plan;
      return "messages" in plan && isOpenFact(plan.fact) && plan.fact.name === name;
    });
    if (open === undefined) return refuse();
    const state = reviewState(this.inputFor(open));
    const visible = state.integration?.state === "succeeded" || state.entries.some(entry =>
      entry.messages.some(message => message.review?.role === "approval" &&
        message.recipients.includes(PRINCIPAL)));
    if (!visible) return refuse();
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    return {
      name: state.name, kind: state.kind, tier: state.tier, title: openFact.title,
      identity: { ...state.identity },
      approval: state.approval !== null && state.approvalValid ? state.approval.id : null,
      display: state.display,
      ...(openFact.kind === "challenge.open" ? { target: { name: openFact.target.name,
        integration: openFact.target.integration, identity: { ...openFact.target.identity } } } : {}),
    };
  }

  /** Split the document into part chunks of at most mailBodyBytes −
   * NOTICE_PART_OVERHEAD, cutting at a line end inside the window when one
   * exists, else on a UTF-8 code point boundary; concatenating the chunks
   * restores the document. The per-part envelope reserve lives with the other
   * mail-bound constants (mail/review-bounds.ts): the configuration floor and
   * this split budget are measured from the same constant (AV-07). */
  private splitNotice(document: string): string[] {
    const bytes = Buffer.from(document, "utf8");
    const budget = this.bounds.mailBodyBytes - NOTICE_PART_OVERHEAD;
    if (budget <= 0) throw new StoreError("INTERNAL_ERROR", "mail body bound cannot hold a notice part");
    const chunks: Buffer[] = [];
    let at = 0;
    while (at < bytes.length) {
      if (bytes.length - at <= budget) { chunks.push(bytes.subarray(at)); break; }
      const lastBreak = bytes.lastIndexOf(0x0a, at + budget);
      let cut: number;
      if (lastBreak >= at) cut = lastBreak + 1 - at;
      else {
        cut = budget;
        while (cut > 0 && (bytes[at + cut]! & 0b1100_0000) === 0b1000_0000) cut--;
        if (cut === 0) throw new StoreError("INTERNAL_ERROR", "mail bound splits a UTF-8 sequence");
      }
      chunks.push(bytes.subarray(at, at + cut));
      at += cut;
    }
    return chunks.map(chunk => chunk.toString("utf8"));
  }
}
