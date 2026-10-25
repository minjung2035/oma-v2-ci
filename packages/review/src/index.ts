/** Public review use case. Preparation, acceptance, advancement and reads have separate owners.
 * Validated facts and current writer authority retain their durable meaning. */
import type { AuthContext, OperationId, Receipt } from "@oma/contracts";
import type { ReviewInput } from "@oma/contracts/attestation";
import type { ReviewLedger } from "./ports.js";
import type { ReviewMail } from "./ports.js";
import { assertActorIdentity } from "@oma/domain/authority";
import { reviewInputProblem } from "@oma/domain/attestation";
import { snapshotJson } from "@oma/domain/canonical-json";
import { StoreError, errorCodeOf } from "@oma/domain/errors";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { requestHash } from "@oma/domain/request-identity";
import type { MailPreacceptScope as PreacceptScope } from "@oma/mail/ports";
import type { IntegrationSnapshot } from "@oma/domain/integration-policy";
import { ReviewAuthorityReader } from "./authority.js";
import { ReviewMessages } from "./messages.js";
import { ReviewPreparation } from "./preparation.js";
import { ReviewAcceptance } from "./acceptance.js";
import { ReviewAdvancement } from "./advancement.js";
import { ReviewStatus } from "./status.js";
import type { PreparedReview, ReviewBounds, ReviewEffects } from "./types.js";
export type { ReviewBounds, ReviewEffects } from "./types.js";
export class ReviewModule {
  private readonly ledger: ReviewAuthorityReader;
  private readonly preparation: ReviewPreparation;
  private readonly acceptance: ReviewAcceptance;
  private readonly advancement: ReviewAdvancement;
  private readonly statusView: ReviewStatus;
  constructor(private readonly store: ReviewLedger, mail: ReviewMail,
    private readonly effects: ReviewEffects, private readonly bounds: ReviewBounds, society: string, authority?: ReviewAuthorityReader) {
    this.ledger = authority ?? new ReviewAuthorityReader(store, effects.policy()?.tiered?.highPeerFloor ?? 1);
    const messages = new ReviewMessages(store, mail, bounds, society);
    this.preparation = new ReviewPreparation(store, this.ledger, messages, effects, bounds);
    this.acceptance = new ReviewAcceptance(store, mail, this.ledger, effects, society);
    this.advancement = new ReviewAdvancement(store, this.ledger, messages, this.acceptance, effects, bounds);
    this.statusView = new ReviewStatus(this.ledger, effects, this.advancement.oversize);
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
    // Cancel acceptance and the final CAS gate are synchronous. Checks may be
    // awaiting external work, so their execution lock must not exclude cancel.
    let receipt: Receipt;
    try { receipt = await run(); }
    catch (error) { this.store.observeFailure(error); throw error; }
    // §5.4: an accepted open or vote may make the request ready; advance inside
    // its own try/catch so no application failure rewrites this receipt.
    if ((receipt.state === "succeeded" || receipt.state === "pending" || receipt.state === "unknown") &&
        (value.kind === "merge.open" || value.kind === "challenge.open" || value.kind === "vote")) {
      const requestId = (value.kind === "merge.open" || value.kind === "challenge.open")
        ? this.store.getOperation(auth.actor, key)?.id
        : this.ledger.requestByName(value.name)?.operation.id;
      if (requestId !== undefined)
        try { await this.advancement.advance(requestId); }
        catch (error) {
          // Confirmed corruption fences fresh acceptance at once; the receipt
          // still reports what its transaction committed (AV-09).
          this.store.observeFailure(error);
          console.error(JSON.stringify({ event: "review.advance", request: requestId, code: errorCodeOf(error) }));
        }
    }
    return receipt;
  }

  private async accept(auth: AuthContext, key: string, input: ReviewInput,
      hash: string, policy: IntegrationSnapshot): Promise<Receipt> {
    // The scope owns every frozen artifact from the moment it exists; a
    // prepare failure mid-freeze settles the earlier ones exactly (AV-04).
    const scope: PreacceptScope = this.effects.newPreacceptScope();
    let prepared: PreparedReview;
    try { prepared = await this.preparation.prepare(auth, input, policy, scope); }
    catch (error) { return scope.settleFailure(error); }
    return this.acceptance.acceptPrepared(prepared, auth, auth.actor, key, hash, scope);
  }
  advance(requestId: OperationId): Promise<void> { return this.advancement.advance(requestId); }
  advanceAll(): Promise<void> { return this.advancement.advanceAll(); }
  assertApplicable(requestId: OperationId): void { this.ledger.assertApplicable(requestId); }
  status(...args: Parameters<ReviewStatus["status"]>): ReturnType<ReviewStatus["status"]> { return this.statusView.status(...args); }
}
