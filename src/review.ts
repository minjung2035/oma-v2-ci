/** Public review use case. Preparation, acceptance, advancement and reads have separate owners.
 * The existing ReviewModule API, durable facts and writer authority are unchanged. */
import type { AuthContext, OperationId, Receipt } from "../implementation/contracts.js";
import type { ReviewInput } from "../implementation/contracts/attestation.js";
import type { Store } from "./store.js";
import type { MailModule } from "./mail.js";
import { assertActorIdentity } from "./authority.js";
import { reviewInputProblem } from "./domain/attestation.js";
import { snapshotJson } from "./domain/canonical-json.js";
import { StoreError, errorCodeOf } from "./domain/errors.js";
import { observeStoreFailure, type ResourceGate } from "./domain/admission.js";
import { receiptOfOperation } from "./storage/receipt-projector.js";
import { requestHash } from "./hash.js";
import { PreacceptScope } from "./storage/preaccept-artifact.js";
import type { IntegrationSnapshot } from "./git/integration-policy.js";
import { ReviewAuthorityReader } from "./review/authority.js";
import { ReviewMessages } from "./review/messages.js";
import { ReviewPreparation } from "./review/preparation.js";
import { ReviewAcceptance } from "./review/acceptance.js";
import { ReviewAdvancement } from "./review/advancement.js";
import { ReviewStatus } from "./review/status.js";
import type { PreparedReview, ReviewBounds, ReviewEffects } from "./review/types.js";
export type { ReviewBounds, ReviewEffects } from "./review/types.js";
export class ReviewModule {
  private readonly ledger: ReviewAuthorityReader;
  private readonly preparation: ReviewPreparation;
  private readonly acceptance: ReviewAcceptance;
  private readonly advancement: ReviewAdvancement;
  private readonly statusView: ReviewStatus;
  constructor(private readonly store: Store, mail: MailModule,
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
        : this.ledger.requestByName(value.name)?.operation.id;
      if (requestId !== undefined)
        try { await this.advancement.advance(requestId); }
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
    try { prepared = await this.preparation.prepare(auth, input, policy, scope); }
    catch (error) { return scope.settleFailure(error); }
    return this.acceptance.acceptPrepared(prepared, auth, auth.actor, key, hash, scope);
  }
  advance(requestId: OperationId, admit?: ResourceGate): Promise<void> { return this.advancement.advance(requestId, admit); }
  advanceAll(admit?: ResourceGate): Promise<void> { return this.advancement.advanceAll(admit); }
  assertApplicable(requestId: OperationId): void { this.ledger.assertApplicable(requestId); }
  status(...args: Parameters<ReviewStatus["status"]>): ReturnType<ReviewStatus["status"]> { return this.statusView.status(...args); }
}
