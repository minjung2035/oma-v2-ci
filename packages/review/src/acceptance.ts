import { encodeOperationPlan } from "@oma/protocol/operation-codec";
/** One review acceptance owner: recheck, recipients, intent+deliveries, settle.
 * It never observes Git or applies an integration inside the transaction. */
import type { Actor, AuthContext, Oid, OperationId, Receipt, RiskTier } from "@oma/contracts";
import type { ReviewFact } from "@oma/contracts/attestation";
import type { ReviewLedger } from "./ports.js";
import type { ReviewMail } from "./ports.js";
import { assertCurrentActor, capabilitiesOf } from "@oma/domain/authority";
import { StoreError, acceptedFailure, errorCodeOf } from "@oma/domain/errors";
import { publishedRefFor } from "@oma/domain/derived";
import { applyRequestKeyFor } from "@oma/domain/identifiers";
import { expandAddresses } from "@oma/mail/routing";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import type { MailPreacceptScope as PreacceptScope } from "@oma/mail/ports";
import { reviewState, sameReviewDecision, type ReviewState } from "@oma/domain/review-evaluation";
import type { IntegrationSnapshot } from "@oma/domain/integration-policy";
import { ReviewAuthorityReader } from "./authority.js";
import { isOpenFact, PRINCIPAL, type OpenRequest, type PreparedReview, type ReviewEffects } from "./types.js";
export class ReviewAcceptance {
  constructor(private readonly store: ReviewLedger, private readonly mail: Pick<ReviewMail, "materialize">,
    private readonly ledger: ReviewAuthorityReader, private readonly effects: Pick<ReviewEffects, "publishCandidateRef" | "main" | "submitters" | "cancelMerge">,
    private readonly society: string) {}
  /** The shared acceptance tail: T re-derivation, recipients, operation +
   * deliveries, settle, materialize, succeeded. `auth` is null for
   * broker-derived refresh facts (the requester may be stopped or retired).
   * The scope already owns `prepared.frozen`; its caller created it before the
   * first artifact existed. */
  async acceptPrepared(prepared: PreparedReview, auth: AuthContext | null, actor: Actor,
      key: string, hash: string, scope: PreacceptScope): Promise<Receipt> {
    let txClaim: "inserted" | "retry";
    try {
      // Freezing mail yields to other submissions. Re-observe provenance now,
      // outside T, with no await before acceptance; stale authors require fresh
      // messages, never an in-place rewrite of the frozen authority.
      if ((isOpenFact(prepared.fact) || prepared.fact.kind === "review.revise" || (prepared.fact.kind === "review.adopt" && prepared.fact.version === 3)) &&
          !(prepared.fact.kind === "challenge.open" && prepared.fact.prepared) &&
          this.store.claimKey(actor, key, hash) === "absent") {
        const { identity: { expectedBase, candidate }, submitters: frozenSubmitters } = prepared.fact;
        const submitters = this.effects.submitters(expectedBase, candidate);
        if (submitters.length !== frozenSubmitters.length ||
            submitters.some(actor => !frozenSubmitters.includes(actor)))
          throw new StoreError("BROKER_UNAVAILABLE", "candidate submitters changed; retry the same request key",
            { details: { reason: "busy" } });
      }
      if (prepared.fact.kind === "review.integration" && prepared.before !== null) {
        const current = this.effects.submitters(prepared.fact.source.expectedBase,prepared.fact.source.candidate);
        if (current.length !== prepared.before.sourceSubmitters.length || current.some(a => !prepared.before!.sourceSubmitters.includes(a)))
          throw new StoreError("INTEGRATION_CONDITIONS","source provenance changed during integration preparation");
      }
      // There is no await between this observation and acceptance. A CAS may
      // already have happened while its notices are still materializing (or
      // before a crash); a pending DB row alone cannot authorize cancellation.
      if (["cancel", "review.withdraw", "review.invalidate"].includes(prepared.fact.kind) && prepared.before?.integration?.state === "pending") {
        const main = this.effects.main();
        if (main.kind === "corrupt") throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
        if (main.kind === "present" && main.value === (prepared.before.integration?.identity ?? prepared.before.identity).candidate)
          throw new StoreError("REQUEST_CLOSED", "the request is already applied; use oma_challenge_open");
        if (main.kind !== "present" || main.value !== (prepared.before.integration?.identity ?? prepared.before.identity).expectedBase)
          throw new StoreError("REF_STATE_UNKNOWN", "the request's integration outcome is unknown");
      }
      txClaim = this.store.transaction(tx => {
        if (auth !== null) {
          const agent = assertCurrentActor(this.store, auth, "mail.send");
          if (prepared.fact.kind === "vote" && prepared.fact.version !== 1 &&
              (prepared.fact.qualification.specHash !== agent.specHash || prepared.fact.qualification.incarnation !== agent.incarnation))
            throw new StoreError("STALE_RUN", "review qualification changed before acceptance");
          if (["review.retry", "review.revise"].includes(prepared.fact.kind) && !(prepared.fact.kind === "review.retry" && prepared.fact.version === 3 && prepared.fact.host === true && auth.channel === "host" && agent.role === "principal") && !capabilitiesOf(agent).has("git.submit"))
            throw new StoreError("CAPABILITY_DENIED", "retry requires current submit authority");
          if (prepared.fact.kind === "review.invalidate" && (auth.channel !== "host" || agent.role !== "principal"))
            throw new StoreError("CAPABILITY_DENIED", "vote invalidation requires host authority");
          if (isOpenFact(prepared.fact) && !capabilitiesOf(agent).has("git.submit"))
            throw new StoreError("CAPABILITY_DENIED", "git.submit was revoked before acceptance",
              { details: { capability: "git.submit" } });
        } else if (this.store.getAgent(actor) === null)
          throw new StoreError("STORE_CORRUPT", "review refresh names a missing actor");
        const current = this.store.claimKey(actor, key, hash);
        if (current === "retry") return "retry" as const;
        if (current === "reused")
          throw new StoreError("REQUEST_KEY_REUSED", `request key ${key} already used with a different payload`);
        this.ledger.assertUnchanged(prepared);
        if (prepared.frozen.length !== prepared.emissions.length)
          throw new StoreError("STORE_CORRUPT", "review message plans differ from their emissions");
        const plans = prepared.frozen.map((frozen, index) => ({ ...frozen.message,
          recipients: [...expandAddresses(this.store, prepared.emissions[index]!.to, this.society).recipients].sort() }));
        const accepted = tx.acceptOperation({ id: prepared.id, actor, requestKey: key,
          requestHash: hash, kind: "attest.record", payloadJson: JSON.stringify(prepared.payload),
          planJson: encodeOperationPlan({ kind: "attest.record", fact: prepared.fact, messages: plans }) });
        if (accepted === "inserted")
          for (const plan of plans)
            tx.insertDeliveries(plan.recipients.map(recipient =>
              ({ messageId: plan.id, recipient, operationId: prepared.id })));
        return accepted;
      });
    } catch (error) { return scope.settleFailure(error); }
    // The committed control must reach the process owner even if releasing
    // preparation artifacts or materializing its notice subsequently fails.
    if (txClaim === "inserted" && (prepared.fact.kind === "cancel" || prepared.fact.kind === "review.withdraw" || prepared.fact.kind === "review.invalidate")) this.effects.cancelMerge?.(prepared.fact.request);
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
        this.store.observeFailure(error);
        console.error(JSON.stringify({ event: "review.challenge.publish", request: prepared.id,
          code: errorCodeOf(error) }));
      }
    }
    try {
      const accepted = this.store.retriedOperation(actor, key);
      if (accepted.kind !== "attest.record" || !("messages" in accepted.plan))
        throw new StoreError("STORE_CORRUPT", "accepted review owns no message list");
      const plans = accepted.plan.messages;
      let materializedAll = true;
      try { await this.mail.materialize(prepared.id); }
      catch (error) { if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error; materializedAll = false; }
      if (materializedAll)
        this.store.transaction(tx => tx.setOperationSucceeded(prepared.id, JSON.stringify({
          kind: "attest.record", request: prepared.name,
          messages: plans.map(message => message.id),
          recipientCount: plans.reduce((sum, message) => sum + message.recipients.length, 0) })));
      const finalOp = this.store.getOperation(actor, key);
      if (!finalOp) throw new StoreError("STORE_CORRUPT", "accepted review operation missing");
      return receiptOfOperation(finalOp);
    } catch (error) { throw acceptedFailure(error); }
  }

  /** §7: an accepted prepared challenge owns its published ref. Idempotent:
   * absent → CAS null→oid; already the same oid → done; another oid is a
   * corruption the accepted fact cannot own. */
  ensureChallengePublished(operationId: OperationId, actor: Actor,
      fact: Extract<ReviewFact, { kind: "challenge.open" }>): void {
    try {
      this.effects.publishCandidateRef(publishedRefFor(actor, operationId), fact.identity.candidate);
    } catch (error) {
      if (error instanceof StoreError && error.code === "PUBLISHED_REF_CONFLICT")
        throw new StoreError("STORE_CORRUPT", "the challenge's published ref holds another candidate");
      throw error;
    }
  }
  /** The sole acceptance owner also commits the one integration intent.
   * Git checks, diff creation, publication and application stay outside T. */
  acceptIntegration(open: OpenRequest, current: ReviewState, policy: IntegrationSnapshot,
    id: OperationId, hash: string, payload: { candidate: Oid; expected: Oid; tier: RiskTier },
    frozen: PreparedReview["frozen"], diff?: import("@oma/contracts/files").ReviewDiffArtifact): "created" | "skipped" | "drifted" {
    const applyKey = applyRequestKeyFor(open.operation.id, current.attemptNumber);
    // The last asynchronous freeze may have admitted a new authenticated
    // submitter. Recheck outside T immediately before its synchronous gate.
    this.ledger.assertApplicable(current.request);
    return this.store.transaction(tx => {
      const fresh = reviewState(this.ledger.inputFor(open));
      // An integration already at the apply key surfaces in fresh.integration;
      // skipping silently is the idempotent path.
      if (fresh.integration !== null) return "skipped" as const;
      // A fact accepted while the notice froze changes the document's
      // evidence: discard this build and re-prepare from what the ledger
      // shows now.
      if (!sameReviewDecision(current, fresh)) return "drifted" as const;
      if (this.store.recoverableOperations()
          .some(other => this.store.getOperationById(other)?.kind === "git.integrate")) return "skipped" as const;
      const recipients = [...expandAddresses(this.store, ["commons", PRINCIPAL], this.society).recipients].sort();
      const plans = frozen.map(part => ({ ...part.message, recipients }));
      const plan = { kind: "git.integrate" as const, repo: "project" as const, target: "refs/heads/main" as const,
        base: current.preparation?.fact.identity.expectedBase ?? current.identity.expectedBase, candidate: current.preparation?.fact.identity.candidate ?? current.identity.candidate,
        policyRevision: current.identity.policyRevision, checkProfileDigest: policy.checkProfileDigest,
        policyIdentity: policy.policyIdentity, noopRef: null,
        merge: { version: current.preparation === null ? 2 as const : 3 as const, revision: current.revision,
          ...(current.preparation === null ? {} : { preparation: current.preparation.operation }), attemptNumber: current.attemptNumber, request: current.request, name: current.name, tier: current.tier,
          notice: plans, ...(diff === undefined ? {} : { diff }) } };
      const accepted = tx.acceptOperation({ id, actor: current.requester, requestKey: applyKey,
        requestHash: hash, kind: "git.integrate", payloadJson: JSON.stringify(payload),
        planJson: encodeOperationPlan(plan) });
      if (accepted === "inserted")
        for (const plan of plans)
          tx.insertDeliveries(plan.recipients.map(recipient =>
            ({ operationId: id, messageId: plan.id, recipient })));
      return accepted === "inserted" ? "created" as const : "skipped" as const;
    });
  }
}
