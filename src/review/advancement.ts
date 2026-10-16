/** Writer-serialized progression and repair of accepted review facts.
 * Recovery is not caller replay. Fresh refresh/integration intents use one acceptance owner. */
import type { MessagePlan, Oid, OperationId } from "../../implementation/contracts.js";
import type { ReviewFact } from "../../implementation/contracts/attestation.js";
import type { StoreQueries } from "../storage/store-access.js";
import { StoreError, errorCodeOf } from "../domain/errors.js";
import { NO_HOLD, type ResourceGate } from "../domain/admission.js";
import { applyRequestKeyFor, refreshRequestKeyFor } from "../domain/identifiers.js";
import { generateOperationId } from "../ids.js";
import { requestHash, sha256Hex } from "../hash.js";
import { mergeDiffText } from "../git/canonical-command.js";
import { reviewNoticeDocument, reviewSubject, splitReviewNotice } from "../mail/review-documents.js";
import type { IntegrationSnapshot } from "../git/integration-policy.js";
import { planEffects, reviewState, type ReviewState, type ReviewEntry } from "../domain/review-evaluation.js";
import { PreacceptScope, type PreacceptArtifact } from "../storage/preaccept-artifact.js";
import { ReviewAuthorityReader } from "./authority.js";
import { ReviewMessages } from "./messages.js";
import { ReviewAcceptance } from "./acceptance.js";
import { PRINCIPAL, isOpenFact, type OpenRequest, type ReviewEffects, type ReviewBounds, type Emission } from "./types.js";
export class ReviewAdvancement {
  /** An oversized immutable request is not rebuilt by every sweep. */
  readonly oversize = new Set<OperationId>();
  constructor(private readonly store: Pick<StoreQueries, "recoverableOperations" | "getOperationById" | "getOperation">,
    private readonly ledger: ReviewAuthorityReader, private readonly messages: ReviewMessages,
    private readonly acceptance: ReviewAcceptance, private readonly effects: ReviewEffects,
    private readonly bounds: ReviewBounds) {}
  /** Advance one request toward application. Runs under the Git writer; a busy
   * writer surfaces BROKER_UNAVAILABLE to the caller, which skips it. The
   * optional gate admits the fresh effects an advance may produce (AV-01). */
  async advance(requestId: OperationId, admit?: ResourceGate): Promise<void> {
    await this.effects.withWriter(async () => {
      const open = this.ledger.openRequests().find(candidate => candidate.operation.id === requestId);
      if (open !== undefined) await this.advanceRequest(open, admit);
    });
  }

  /** Every open request, in attestation sequence order. A single request's
   * refusal must not starve the others; corruption always propagates. */
  async advanceAll(admit?: ResourceGate): Promise<void> {
    await this.effects.withWriter(async () => {
      let main: ReturnType<ReviewEffects["main"]> | undefined;
      for (const { open, input } of this.ledger.projection()) {
        try {
          const state = reviewState(input);
          // Terminal history cannot become live again. Its accepted challenge
          // publication still needs repair, but no fresh ledger scan per row.
          if (state.terminal !== null || state.integration !== null) this.repairChallenge(open);
          else {
            main ??= this.effects.main();
            if (main.kind === "corrupt") throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
            const stale = main.kind === "present" && main.value !== state.identity.expectedBase;
            if (!state.ready && !stale && (state.approval === null || state.approvalValid)) this.repairChallenge(open);
            else {
              // Only discovery is shared. Re-read live authority inside the
              // request, then discard the main observation after every await.
              try { await this.advanceRequest(open, admit); } finally { main = undefined; }
            }
          }
        }
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

  private repairChallenge(open: OpenRequest): void {
    const fact = open.operation.plan.fact;
    if (fact.kind === "challenge.open" && fact.prepared)
      this.acceptance.ensureChallengePublished(open.operation.id, open.operation.actor, fact);
  }

  private async advanceRequest(open: OpenRequest,
      admit?: ResourceGate): Promise<void> {
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    // §7: a prepared challenge's published ref is an effect of the accepted
    // fact; a crash after T is repaired here, at every sweep. This is
    // settlement of accepted work, not fresh acceptance, so it precedes the
    // admission hold below.
    this.repairChallenge(open);
    let state = reviewState(this.ledger.inputFor(open));
    const gate = this.advanceGate(admit);
    // 1. A broker-derived refresh fact: main moved (request goes stale), or a
    // sent approval drifted invalid through reviewer eligibility alone. A
    // refresh is a new durable intent + mail; it passes resource admission.
    if (state.terminal === null && state.integration === null) {
      const main = this.effects.main();
      if (main.kind === "corrupt")
        throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
      if (main.kind === "present" && main.value !== state.identity.expectedBase) {
        const release = await gate("admit");
        try { await this.acceptRefresh(open, state, main.value); } finally { release(); }
        state = reviewState(this.ledger.inputFor(open));
      } else if (state.approval !== null && !state.approvalValid) {
        const release = await gate("admit");
        try { await this.acceptRefresh(open, state, null); } finally { release(); }
        state = reviewState(this.ledger.inputFor(open));
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
    const release = await gate("admit");
    try { await this.createIntegration(open, policy); } finally { release(); }
  }

  /** The refresh fact is accepted through the same machinery as caller facts:
   * one scope, T re-derivation, deliveries, materialize, result — only the
   * actor assertion differs (the requester's agent row must exist, nothing more). */
  private async acceptRefresh(open: OpenRequest,
      before: ReviewState, main: Oid | null): Promise<void> {
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    const inputFor = this.ledger.inputFor(open);
    const requester = open.operation.actor;
    const fact: ReviewFact = { kind: "refresh", version: 1, request: open.operation.id, main };
    const count = inputFor.entries.filter(entry => entry.fact.kind === "refresh").length;
    const id = generateOperationId();
    const lastSequence = inputFor.entries.at(-1)?.sequence ?? inputFor.open.sequence;
    const newEntry: ReviewEntry = { sequence: lastSequence + 1, operation: id, actor: requester, fact, messages: [] };
    const after0 = reviewState({ ...inputFor, entries: [...inputFor.entries, newEntry] });
    const effects = planEffects(before, after0);
    const emissions = this.messages.entryEmissions(id, open, openFact, inputFor, before, after0, newEntry, effects, null);
    const scope = new PreacceptScope();
    let frozen: { message: MessagePlan; artifact: PreacceptArtifact }[];
    try { frozen = await this.messages.freeze(scope, id, requester, emissions); }
    catch (error) { return scope.settleFailure(error); }
    await this.acceptance.acceptPrepared({ id, fact, payload: fact, emissions, frozen, before, after0,
      name: before.name }, null, requester,
      refreshRequestKeyFor(open.operation.id, count), requestHash("attest.record", fact), scope);
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
  private async createIntegration(open: OpenRequest,
      policy: IntegrationSnapshot): Promise<void> {
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    const applyKey = applyRequestKeyFor(open.operation.id);
    for (let attempt = 0; ; attempt++) {
      const current = reviewState(this.ledger.inputFor(open));
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
      const document = reviewNoticeDocument(id, current, openFact, diff);
      const bytes = Buffer.byteLength(document, "utf8");
      if (bytes > this.bounds.bundleBytes) { this.markOversize(current, bytes); return; }
      const digest = sha256Hex(document);
      const chunks = splitReviewNotice(document, this.bounds.mailBodyBytes);
      const emissions: Emission[] = chunks.map((chunk, index) => ({
        to: ["commons", PRINCIPAL], kind: "result",
        subject: reviewSubject(`[${current.name}] applied: ${openFact.title} (part ${index + 1}/${chunks.length})`, this.bounds.subjectBytes),
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
        const frozen = await this.messages.freeze(scope, id, current.requester, emissions);
        created = this.acceptance.acceptIntegration(open, current, policy, id, hash, payload, frozen);
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
}
