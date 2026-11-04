/** Public review use case. Preparation, acceptance, advancement and reads have separate owners.
 * Validated facts and current writer authority retain their durable meaning. */
import type { AuthContext, OperationId, Receipt } from "@oma/contracts";
import type { ReviewInput } from "@oma/contracts/attestation";
import type { ReviewStatusQuery, ReviewStatusResult } from "@oma/contracts/public-wire";
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
import { canonicalCollaborationJson, encodeCollaborationTarget, decodeCollaborationTarget, type CollaborationTarget } from "@oma/domain/collaboration-targets";
import { collaborationReviewTargets, collaborationProposalMetadata } from "@oma/domain/collaboration-review";
import type { InvocationResolution } from "@oma/contracts/public-wire";
import { decodeInvocationResolution } from "@oma/protocol/invocation-resolution";
import { reviewState, type ReviewStateInput } from "@oma/domain/review-evaluation";
export type { ReviewRecordObservation } from "./status.js";
function idPublished(store: Pick<ReviewLedger, "getDelivery">, input: ReviewStateInput): boolean {
  // Materialization is an accepted delivery fact, not a new read-to-ACK signal.
  const approval = reviewState(input).approval;
  return approval !== null && [input.open, ...input.entries].some(entry => entry.messages.some(message =>
    message.id === approval.id && message.review?.role === "approval" && message.recipients.includes("principal") &&
    store.getDelivery(message.id, "principal")?.materialized === 1));
}
export class ReviewModule {
  private readonly ledger: ReviewAuthorityReader;
  private readonly preparation: ReviewPreparation;
  private readonly acceptance: ReviewAcceptance;
  private readonly advancement: ReviewAdvancement;
  private readonly statusView: ReviewStatus;
  constructor(private readonly store: ReviewLedger, mail: ReviewMail,
    private readonly effects: ReviewEffects, private readonly bounds: ReviewBounds, society: string, authority?: ReviewAuthorityReader) {
    const policy = effects.policy();
    this.ledger = authority ?? new ReviewAuthorityReader(store, policy?.tiered?.highPeerFloor ?? 1, policy?.maxWorkers ?? 1);
    const messages = new ReviewMessages(store, mail, bounds, society);
    this.preparation = new ReviewPreparation(store, this.ledger, messages, effects, bounds);
    this.acceptance = new ReviewAcceptance(store, mail, this.ledger, effects, society);
    this.advancement = new ReviewAdvancement(store, this.ledger, messages, this.acceptance, effects, bounds);
    this.statusView = new ReviewStatus(this.ledger, { ...effects, executionPhase: request => effects.executionPhase?.(request) ?? (this.advancement.preparing.has(request) ? "preparing" : undefined) }, id => this.store.getDelivery(id, "principal")?.materialized === 1);
  }

  async record(auth: AuthContext, key: string, input: ReviewInput, beforeAccept?: () => undefined): Promise<Receipt> {
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
    if ("name" in value) {
      const open = this.ledger.requestByName(value.name);
      if (open !== null) this.ledger.assertExecutable(open);
    }
    // Cheap bound read for routing only; the fact freezes the current revision.
    const bound = this.effects.policy();
    if (bound?.tiered == null)
      throw new StoreError("UNSUPPORTED_PROFILE", "this society does not use mail-v1 review");
    // DR8: the fact names the host's current revision; facts must be the bound ones.
    const policy = this.effects.currentPolicy();
    const run = async () => this.accept(auth, key, value, hash, policy, beforeAccept);
    // Cancel acceptance and the final CAS gate are synchronous. Checks may be
    // awaiting external work, so their execution lock must not exclude cancel.
    let receipt: Receipt;
    try { receipt = await run(); }
    catch (error) { this.store.observeFailure(error); throw error; }
    // §5.4: an accepted open or vote may make the request ready; advance inside
    // its own try/catch so no application failure rewrites this receipt.
    if ((receipt.state === "succeeded" || receipt.state === "pending" || receipt.state === "unknown") &&
        (value.kind === "merge.open" || value.kind === "challenge.open" || value.kind === "vote" || value.kind === "review.retry" || value.kind === "review.revise")) {
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
      hash: string, policy: IntegrationSnapshot, beforeAccept?: () => undefined): Promise<Receipt> {
    // The scope owns every frozen artifact from the moment it exists; a
    // prepare failure mid-freeze settles the earlier ones exactly (AV-04).
    if (beforeAccept !== undefined && beforeAccept() !== undefined)
      throw new StoreError("INTERNAL_ERROR", "review acceptance guard must be synchronous");
    const scope: PreacceptScope = this.effects.newPreacceptScope();
    let prepared: PreparedReview;
    try { prepared = await this.preparation.prepare(auth, input, policy, scope); }
    catch (error) { return scope.settleFailure(error); }
    return this.acceptance.acceptPrepared(prepared, auth, auth.actor, key, hash, scope, beforeAccept);
  }
  advance(requestId: OperationId): Promise<void> { return this.advancement.advance(requestId); }
  advanceAll(): Promise<void> { return this.advancement.advanceAll(); }
  assertApplicable(requestId: OperationId): void { this.ledger.assertApplicable(requestId); }
  observeRecords(auth: AuthContext, societyBirth?: string): readonly import("./status.js").ReviewRecordObservation[] {
    assertActorIdentity(this.store, auth);
    const records = this.statusView.records(auth);
    if (societyBirth === undefined) return records;
    return records.map(record => {
      const open = this.ledger.requestByName(record.name);
      if (!open) throw new StoreError("STORE_CORRUPT", "review observation lost its original request");
      const input = record.role === "resident" ? record.input : this.ledger.inputFor(open);
      return { ...record, societyBirth, targets: this.targets(input, auth, societyBirth) };
    });
  }
  private targets(input: ReviewStateInput, auth: AuthContext, societyBirth: string, appliedManifestSha256?: string): readonly CollaborationTarget[] {
    const integration = input.integration;
    let failedIntegration: Receipt | undefined;
    if (integration?.state === "failed") {
      const operation = this.store.getOperationById(integration.operation);
      if (operation?.kind !== "git.integrate" || operation.state !== "failed")
        throw new StoreError("STORE_CORRUPT", "failed review attempt has no matching original operation");
      failedIntegration = receiptOfOperation(operation);
    }
    return collaborationReviewTargets(input, { actor: auth.actor, role: auth.role, societyBirth,
      approvalPublished: idPublished(this.store, input), ...(appliedManifestSha256 === undefined ? {} : { appliedManifestSha256 }), ...(failedIntegration === undefined ? {} : { failedIntegration }) });
  }
  targetSource(auth: AuthContext, request: OperationId): ReviewStateInput {
    assertActorIdentity(this.store, auth);
    if (auth.role !== "resident") throw new StoreError("CAPABILITY_DENIED", "proposal sources belong to Workers");
    const open = this.ledger.openRequests().find(entry => entry.operation.id === request);
    if (!open) throw new StoreError("INVALID_REQUEST", "unknown original proposal");
    return this.ledger.inputFor(open);
  }
  proposalMetadata(auth: AuthContext, request: OperationId): ReturnType<typeof collaborationProposalMetadata> {
    return collaborationProposalMetadata(this.targetSource(auth, request));
  }
  existingResolution(auth: AuthContext, target: CollaborationTarget, societyBirth: string): InvocationResolution {
    if (target.kind !== "proposal" || target.settledFailure !== null)
      throw new StoreError("INVALID_REQUEST", "existing resolution needs an exact unchanged proposal");
    this.exactTargetGuard(auth, target, societyBirth)();
    const operation = this.store.getOperationById(target.request);
    if (!operation || operation.actor !== auth.actor || operation.kind !== "attest.record")
      throw new StoreError("STORE_CORRUPT", "existing proposal lost its original accepted operation");
    const decoded = decodeInvocationResolution({ kind: "existing", target, requestKey: operation.requestKey,
      receipt: receiptOfOperation(operation), observedAtMs: Date.now() });
    if (!decoded.ok) throw new StoreError("STORE_CORRUPT", decoded.reason);
    return decoded.value;
  }
  /** Snapshot/permission checks happen outside T. The returned guard only reads
   * synchronous canonical ledger facts, and runs again at actual acceptance. */
  exactTargetGuard(auth: AuthContext, expected: CollaborationTarget, societyBirth: string, appliedManifestSha256?: string): () => undefined {
    assertActorIdentity(this.store, auth);
    const encoded = encodeCollaborationTarget(expected), target = decodeCollaborationTarget(encoded.bytes, encoded.name);
    if (target.societyBirth !== societyBirth) throw new StoreError("CAPABILITY_DENIED", "exact target belongs to another Society birth");
    if (auth.role === "principal") this.statusView.status(auth, { name: target.requestName }, Number.MAX_SAFE_INTEGER, "exact-target");
    if (target.kind === "review") {
      const policy = this.effects.currentPolicy();
      if (policy.policyRevision !== target.policyRevision)
        throw new StoreError("POLICY_CHANGED", "exact review target uses an older policy; inspect current status");
    }
    const check = (): undefined => {
      assertActorIdentity(this.store, auth);
      const open = this.ledger.requestByName(target.requestName);
      if (open?.operation.id !== target.request) throw new StoreError("INVALID_REQUEST", "STALE_TARGET: original request relationship changed");
      const targets = this.targets(this.ledger.inputFor(open), auth, societyBirth, appliedManifestSha256);
      if (!targets.some(current => canonicalCollaborationJson(current) === canonicalCollaborationJson(target)))
        throw new StoreError("APPROVAL_STALE", "STALE_TARGET: revision, scope, policy, attempt or own record changed; inspect current status");
      return undefined;
    };
    check();
    return check;
  }
  status(auth: AuthContext, query: ReviewStatusQuery, frameBytes: number, responseId: string): ReviewStatusResult {
    return this.statusView.status(auth, query, frameBytes, responseId);
  }
}
