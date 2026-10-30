/** Writer-serialized progression and repair of accepted review facts.
 * Recovery is not caller replay. Fresh refresh/integration intents use one acceptance owner. */
import type { MessagePlan, Oid, OperationId } from "@oma/contracts";
import type { ReviewFact } from "@oma/contracts/attestation";
import type { ReviewLedger } from "./ports.js";
import { StoreError, errorCodeOf } from "@oma/domain/errors";
import { applyRequestKeyFor, refreshRequestKeyFor } from "@oma/domain/identifiers";
import { requestHash } from "@oma/domain/request-identity";
import { sha256Hex } from "@oma/domain/canonical-json";
import { deterministicTier } from "@oma/domain/integration-policy";
import { maximumTier } from "@oma/domain/risk-tier";
import { observed, protectedPathMatches, requireNoGitlinks } from "@oma/domain/git-facts";
import { mergeDiffText } from "@oma/domain/git-facts";
import { reviewNoticeDocument, reviewSubject, splitReviewNotice } from "@oma/mail/review-documents";
import type { IntegrationSnapshot } from "@oma/domain/integration-policy";
import { planEffects, reviewState, type ReviewState, type ReviewEntry } from "@oma/domain/review-evaluation";
import type { MailPreacceptScope as PreacceptScope } from "@oma/mail/ports";
import type { PreacceptArtifactOwner } from "@oma/contracts/files";
import { ReviewAuthorityReader } from "./authority.js";
import { ReviewMessages } from "./messages.js";
import { ReviewAcceptance } from "./acceptance.js";
import { PRINCIPAL, isOpenFact, type OpenRequest, type ReviewEffects, type ReviewBounds, type Emission } from "./types.js";
export class ReviewAdvancement {
  /** An oversized immutable request is not rebuilt by every sweep. */
  readonly preparing = new Set<OperationId>();
  constructor(private readonly store: Pick<ReviewLedger, "recoverableOperations" | "getOperationById" | "getOperation">,
    private readonly ledger: ReviewAuthorityReader, private readonly messages: ReviewMessages,
    private readonly acceptance: ReviewAcceptance, private readonly effects: ReviewEffects,
    private readonly bounds: ReviewBounds) {}
  /** Advance one request toward application. Runs under the Git writer; a busy
   * writer surfaces BROKER_UNAVAILABLE to the caller, which skips it. */
  async advance(requestId: OperationId): Promise<void> {
    await this.effects.withWriter(async () => {
      const open = this.ledger.openRequests().find(candidate => candidate.operation.id === requestId);
      if (open !== undefined) await this.advanceRequest(open);
    });
  }

  /** Every open request, in attestation sequence order. A single request's
   * refusal must not starve the others; corruption always propagates. */
  async advanceAll(): Promise<void> {
    await this.effects.withWriter(async () => {
      let main: ReturnType<ReviewEffects["main"]> | undefined;
      for (const { open, input } of this.ledger.projection()) {
        try {
          const state = reviewState(input);
          this.repairChallenge(open);
          if (state.terminal !== null || state.included !== null || (state.integration !== null &&
              !(state.integration.state === "failed"))) continue;
          const refresh = (state.approval !== null && !state.approvalValid) || planEffects(state,state).approve !== null;
          if (!state.proposalReady && !refresh && state.preparation === null) {
            main ??= this.effects.main();
            if (main.kind !== "present" || main.value === state.sourceIdentity.expectedBase) continue;
            const fact = open.operation.plan.fact;
            const modern = fact.version === 3 || state.revision > 0 || state.entries.some(e => e.fact.kind === "review.adopt");
            if (modern && !observed(this.effects.ancestry(state.sourceIdentity.candidate,main.value),"proposal inclusion")) continue;
          }
          if (state.preparationFailure !== null && state.preparation === null) {
            main ??= this.effects.main();
            if (state.preparationFailure.main === undefined || main.kind !== "present" || state.preparationFailure.main === main.value) continue;
          }
          if (state.integration === null && !state.ready && !refresh && state.preparation !== null) {
            main ??= this.effects.main();
            if (main.kind === "present" && main.value === state.preparation.fact.identity.expectedBase) continue;
          }
          try { await this.advanceRequest(open, false); } finally { main = undefined; }
        }
        catch (error) {
          if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error;
          console.error(JSON.stringify({ event: "review.advance", request: open.operation.id,
            code: errorCodeOf(error) }));
        }
      }
    });
  }

  private repairChallenge(open: OpenRequest): void {
    const fact = open.operation.plan.fact;
    if (fact.kind === "challenge.open" && fact.prepared)
      this.acceptance.ensureChallengePublished(open.operation.id, open.operation.actor, fact);
  }

  private async advanceRequest(open: OpenRequest, execute = true): Promise<void> {
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    // §7: a prepared challenge's published ref is an effect of the accepted
    // fact; a crash after T is repaired here, at every sweep.
    this.repairChallenge(open);
    let state = reviewState(this.ledger.inputFor(open));
    const modern = openFact.version === 3 || state.revision > 0 || state.entries.some(e => e.fact.kind === "review.adopt");
    if (modern) { await this.advanceModern(open, state, execute); return; }
    // 1. A broker-derived refresh fact: main moved (request goes stale), or a
    // sent approval drifted invalid through reviewer/active-author state. A
    // refresh is a new durable intent + mail, accepted by the ledger owner.
    if (state.terminal === null && state.integration === null) {
      const main = this.effects.main();
      if (main.kind === "corrupt")
        throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
      if (main.kind === "present" && main.value !== state.identity.expectedBase) {
        await this.acceptRefresh(open, state, main.value);
        state = reviewState(this.ledger.inputFor(open));
      } else if ((state.approval !== null && !state.approvalValid) || planEffects(state, state).approve !== null) {
        await this.acceptRefresh(open, state, null);
        state = reviewState(this.ledger.inputFor(open));
      }
    }
    // 2. A ready request whose base is still main gets its one integration.
    if (!state.ready) return;
    const main = this.effects.main();
    if (main.kind === "corrupt")
      throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
    if (main.kind !== "present" || main.value !== state.identity.expectedBase) return;
    if (this.store.recoverableOperations()
        .some(id => this.store.getOperationById(id)?.kind === "git.integrate")) return;
    let policy: IntegrationSnapshot;
    try { policy = this.effects.currentPolicy(); }
    catch (error) {
      if (error instanceof StoreError && error.code === "BROKER_UNAVAILABLE") return;
      throw error;
    }
    if (policy.policyRevision !== state.identity.policyRevision) return;
    this.preparing.add(open.operation.id);
    try { await this.createIntegration(open, policy, execute); }
    finally { this.preparing.delete(open.operation.id); }
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
    const count = inputFor.entries.filter(entry => ["refresh", "review.preparation-failed", "review.integration", "review.supersede", "review.included"].includes(entry.fact.kind)).length;
    const id = this.effects.nextOperationId();
    const lastSequence = inputFor.entries.at(-1)?.sequence ?? inputFor.open.sequence;
    const newEntry: ReviewEntry = { sequence: lastSequence + 1, operation: id, actor: requester, fact, messages: [] };
    const after0 = reviewState({ ...inputFor, entries: [...inputFor.entries, newEntry] });
    const effects = planEffects(before, after0);
    const emissions = this.messages.entryEmissions(id, open, openFact, inputFor, before, after0, newEntry, effects, null);
    const scope = this.effects.newPreacceptScope();
    let frozen: { message: MessagePlan; artifact: PreacceptArtifactOwner }[];
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
      policy: IntegrationSnapshot, execute: boolean): Promise<void> {
    const openPlan = open.operation.plan;
    if (!("messages" in openPlan)) throw new StoreError("STORE_CORRUPT", "review open owns no message list");
    const openFact = openPlan.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT", "request names a non-open fact");
    const applyKey = applyRequestKeyFor(open.operation.id, reviewState(this.ledger.inputFor(open)).attemptNumber);
    for (let attempt = 0; ; attempt++) {
      const current = reviewState(this.ledger.inputFor(open));
      if (current.integration !== null || !current.ready) return;
      const identity = current.preparation?.fact.identity ?? current.identity;
      const id = this.effects.nextOperationId();
      const scope: PreacceptScope = this.effects.newPreacceptScope();
      let attachment: import("@oma/contracts/files").ReviewDiffArtifact | undefined;
      let document: string;
      try {
        let diff: string;
        if (this.effects.prepareDiff !== undefined) {
          const prepared = await this.effects.prepareDiff(id, identity.expectedBase, identity.candidate, owner => {
            scope.register({ operationId: id, resource: owner.path, owner, observe: () => {
              const accepted = this.store.getOperationById(id);
              if (accepted === null) return "unaccepted-known";
              return accepted.kind === "git.integrate" && accepted.plan.merge !== undefined && accepted.plan.merge.version !== 1 &&
                accepted.plan.merge.diff?.reference === attachment?.reference ? "accepted-referenced" : "accepted-unreferenced";
            } });
          });
          attachment = prepared.diff;
          diff = mergeDiffText(prepared.preview) + (attachment.bytes > prepared.preview.length ? "\n[preview only]" : "") +
            `\nExact diff attachment: ${JSON.stringify({ request: current.request, revision: current.revision, attempt: id, ...attachment })}\n` +
            `Read the stored full patch: oma_review_diff({"name":"${current.name}","view":"applied"}); continue using next as cursor.\n`;
        } else diff = mergeDiffText(this.effects.mergeDiff(identity.expectedBase, identity.candidate, this.bounds.bundleBytes + 1));
        document = reviewNoticeDocument(id, { ...current, identity }, openFact, diff);
        if (Buffer.byteLength(document) > this.bounds.bundleBytes && attachment !== undefined)
          document = `${current.name} applied, revision ${current.revision}, attempt ${id}, number ${current.attemptNumber}.\nExact diff attachment: ${JSON.stringify(attachment)}\nRead oma_review_diff({"name":"${current.name}","view":"applied"}), then cursor=next.\n`;
        if (Buffer.byteLength(document) > this.bounds.bundleBytes) throw new StoreError("LIMIT_EXCEEDED", "completion notice metadata exceeds document bound");
      } catch (error) {
        try { scope.settleFailure(error); } catch (failure) {
          if (errorCodeOf(failure) === "STORE_CORRUPT") throw failure;
          await this.preparationFailed(open, current, errorCodeOf(failure), failure instanceof Error ? failure.message : "diff preparation failed"); return;
        }
      }
      const bytes = Buffer.byteLength(document, "utf8");
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
      const payload = { candidate: identity.candidate, expected: identity.expectedBase, tier: current.tier };
      const hash = requestHash("git.integrate", payload);
      let created: "created" | "skipped" | "drifted";
      try {
        const frozen = await this.messages.freeze(scope, id, current.requester, emissions);
        created = this.acceptance.acceptIntegration(open, current, policy, id, hash, payload, frozen, attachment);
      } catch (error) {
        try { scope.settleFailure(error); } catch (failure) {
          if (errorCodeOf(failure) === "STORE_CORRUPT" || this.store.getOperation(current.requester, applyKey) !== null) throw failure;
          await this.preparationFailed(open, current, errorCodeOf(failure), failure instanceof Error ? failure.message : "notice preparation failed"); return;
        }
      }
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
      // Recovery owns physical execution when advancement is sweep-driven.
      if (execute) await this.effects.applyMerge(operation);
      return;
    }
  }

  private async brokerFact(open: OpenRequest, before: ReviewState, fact: ReviewFact,
      scope = this.effects.newPreacceptScope(), id = this.effects.nextOperationId()): Promise<void> {
    const input = this.ledger.inputFor(open), openFact = input.open.fact;
    if (!isOpenFact(openFact)) throw new StoreError("STORE_CORRUPT","missing open");
    const sequence = (input.entries.at(-1)?.sequence ?? input.open.sequence) + 1;
    const entry: ReviewEntry = {sequence,operation:id,actor:before.requester,fact,messages:[]};
    const after0 = reviewState({...input,...(fact.kind === "review.supersede" ? {integration:null} : {}),entries:[...input.entries,entry]});
    const emissions = this.messages.entryEmissions(id,open,openFact,input,before,after0,entry,planEffects(before,after0),null);
    let frozen;
    try { frozen = await this.messages.freeze(scope,id,before.requester,emissions); }
    catch(error) { return scope.settleFailure(error); }
    const count = input.entries.filter(e => ["refresh","review.preparation-failed","review.integration","review.supersede","review.included"].includes(e.fact.kind)).length;
    await this.acceptance.acceptPrepared({id,fact,payload:fact,emissions,frozen,before,after0,name:before.name},null,before.requester,
      refreshRequestKeyFor(before.request,count),requestHash("attest.record",fact),scope);
  }

  private async advanceModern(open: OpenRequest, initial: ReviewState, execute: boolean): Promise<void> {
    let state = initial;
    if (state.terminal !== null || state.included !== null) return;
    const main = observed(this.effects.main(),"current integration main");
    if (state.integration !== null) {
      if (state.integration.state !== "failed" || (state.integration.errorCode !== "STALE_BASE" && state.integration.identity?.expectedBase === main)) return;
      await this.brokerFact(open,state,{kind:"review.supersede",version:3,request:state.request,
        expectedAttempt:state.integration.operation,attemptNumber:state.attemptNumber+1,main,reason:"a settled attempt on the previous main was superseded before a new CAS"});
      state = reviewState(this.ledger.inputFor(open));
    }
    if (this.store.recoverableOperations().some(id => this.store.getOperationById(id)?.kind === "git.integrate")) return;
    if (state.preparation && state.preparation.fact.identity.expectedBase !== main) {
      await this.brokerFact(open,state,{kind:"review.supersede",version:3,request:state.request,
        expectedAttempt:null,attemptNumber:state.attemptNumber+1,main,reason:"prepared integration context was superseded by main"});
      state = reviewState(this.ledger.inputFor(open));
    }
    if ((state.approval !== null && !state.approvalValid) || planEffects(state,state).approve !== null) {
      await this.acceptRefresh(open,state,null); state = reviewState(this.ledger.inputFor(open));
    }
    if (state.preparationFailure?.main !== undefined && state.preparationFailure.main !== main) {
      await this.brokerFact(open,state,{kind:"review.supersede",version:3,request:state.request,expectedAttempt:null,
        attemptNumber:state.attemptNumber+1,main,reason:"main changed since the failed preparation"});
      state = reviewState(this.ledger.inputFor(open));
    }
    if (observed(this.effects.ancestry(state.sourceIdentity.candidate,main),"proposal inclusion")) {
      await this.brokerFact(open,state,{kind:"review.included",version:3,request:state.request,revision:state.revision,
        candidate:state.sourceIdentity.candidate,main}); return;
    }
    if (!state.proposalReady || state.preparationFailure !== null) return;
    const policy = this.effects.currentPolicy();
    if (policy.policyRevision !== state.sourceIdentity.policyRevision) return;
    if (!observed(this.effects.ancestry(state.sourceIdentity.expectedBase,main),"proposal base in main")) {
      await this.preparationFailed(open,state,"STALE_BASE","main was rewritten; requester must explicitly revise the proposal base"); return;
    }
    this.preparing.add(state.request);
    try {
      if (state.preparation === null && this.effects.prepareIntegration && this.effects.prepareDiff) {
        const id = this.effects.nextOperationId(), scope = this.effects.newPreacceptScope();
        const own = (owner: PreacceptArtifactOwner) => scope.register({operationId:id,resource:owner.path,owner,
          observe:() => { const accepted = this.store.getOperationById(id); return accepted === null ? "unaccepted-known" :
            accepted.kind === "attest.record" && accepted.plan.fact.kind === "review.integration" ? "accepted-referenced" : "accepted-unreferenced"; }});
        try {
          const prepared = await this.effects.prepareIntegration(id,state.sourceIdentity.expectedBase,state.sourceIdentity.candidate,main,own);
          requireNoGitlinks(observed(this.effects.gitlinks(prepared.candidate),"integration gitlinks"));
          const changes = observed(this.effects.changedPaths(main,prepared.candidate),"actual integration paths");
          if (policy.protectedPaths.some(path => changes.some(change => protectedPathMatches(change.path,path))))
            throw new StoreError("PROTECTED_PATH","actual integration touches a protected path");
          const minimum = maximumTier(policy.tiered!.repositoryFloor,deterministicTier(policy.tiered!,changes).tier);
          const context = !prepared.reusable || maximumTier(state.tier,minimum) !== state.tier;
          const tier = context ? maximumTier("MEDIUM",maximumTier(state.tier,minimum)) : state.tier;
          const {diff} = await this.effects.prepareDiff(id,main,prepared.candidate,own);
          const original = this.ledger.inputFor(open).open.fact;
          const revision = [...state.entries].reverse().find(e => e.fact.kind === "review.revise" || e.fact.kind === "review.adopt");
          const reviewPolicy = revision && (revision.fact.kind === "review.revise" || revision.fact.kind === "review.adopt") ? revision.fact.reviewPolicy
            : isOpenFact(original) && original.version !== 1 ? original.reviewPolicy
            : {maxWorkers:policy.maxWorkers,highPeerFloor:policy.tiered!.highPeerFloor,authorSlots:state.authors.length};
          await this.brokerFact(open,state,{kind:"review.integration",version:3,request:state.request,revision:state.revision,
            identity:{repo:"project",targetRef:"refs/heads/main",expectedBase:main,candidate:prepared.candidate,policyRevision:policy.policyRevision},
            source:state.sourceIdentity,sourceOperation:state.revisionSource,preparedRef:prepared.preparedRef,context,tier,checkProfileDigest:policy.checkProfileDigest,
            policyIdentity:policy.policyIdentity,reviewPolicy,diff},scope,id);
          state = reviewState(this.ledger.inputFor(open));
        } catch(error) {
          try { scope.settleFailure(error); } catch(failure) {
            if (errorCodeOf(failure) === "STORE_CORRUPT" || this.store.getOperationById(id) !== null) throw failure;
            await this.preparationFailed(open,state,errorCodeOf(failure),failure instanceof Error ? failure.message : "integration preparation failed"); return;
          }
        }
      }
      if (state.ready) await this.createIntegration(open,policy,execute);
    } finally { this.preparing.delete(state.request); }
  }

  private async preparationFailed(open: OpenRequest, before: ReviewState, code: string, reason: string): Promise<void> {
    const input = this.ledger.inputFor(open);
    if (input.integration !== null) return;
    const observedMain = this.effects.main();
    const fact: ReviewFact = { kind: "review.preparation-failed", version: 3, main: observedMain.kind === "present" ? observedMain.value : null, revision: before.revision, policyRevision: before.sourceIdentity.policyRevision, request: before.request,
      attemptNumber: before.attemptNumber, code, reason: reason.slice(0, 1024) };
    const id = this.effects.nextOperationId(), sequence = (input.entries.at(-1)?.sequence ?? input.open.sequence) + 1;
    const entry: ReviewEntry = { sequence, operation: id, actor: before.requester, fact, messages: [] };
    const after0 = reviewState({ ...input, entries: [...input.entries, entry] });
    const ordinal = input.entries.filter(entry => ["refresh", "review.preparation-failed", "review.integration", "review.supersede", "review.included"].includes(entry.fact.kind)).length;
    await this.acceptance.acceptPrepared({ id, fact, payload: fact, emissions: [], frozen: [], before, after0, name: before.name },
      null, before.requester, refreshRequestKeyFor(before.request, ordinal), requestHash("attest.record", fact), this.effects.newPreacceptScope());
  }
}
