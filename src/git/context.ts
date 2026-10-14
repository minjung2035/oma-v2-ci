/** CTX-001..006: immutable context intent, then canonical ref, snapshot,
 * current pointer, notification and terminal settlement. Recovery never prepares
 * a new candidate. The Git facade serializes this coordinator with main writers.
 */
import type { AuthContext, ContextEntry, Oid, Receipt, PublicMethods, Address } from "../../implementation/contracts.js";
import { Store, reused } from "../store.js";
import type { OperationOf } from "../storage/operation-codec.js";
import type { PlanFor } from "../durable.js";
import { assertCurrentActor, capabilitiesOf } from "../authority.js";
import { StoreError, AcceptedFailure, type EffectKnowledge, acceptedFailurePolicy, failureMessage } from "../domain/errors.js";
import { requestHash } from "../hash.js";
import { generateOperationId, generateMessageId, isValidRequestKey, isValidFullOid } from "../ids.js";
import { mailObjectRelativePath, contextRevisionDisplayPath, contextNoopRefFor } from "../domain/derived.js";
import { contextStagingPathAt } from "../storage/paths.js";
import { readContextEntry } from "../storage/context-files.js";
import { prepareContextStream } from "../storage/context-stream.js";
import { decodeMutationPayload } from "../protocol/request-codec.js";
import { receiptOfOperation } from "../storage/receipt-projector.js";
import { PreacceptScope, type PreacceptRegistration } from "../storage/preaccept-artifact.js";
import { MailModule, buildEml, actorAddress, listAddress, expandAddresses } from "../mail.js";
import { frozenMessageDisposition } from "../mail/materializer.js";
import { ContextPublicationObserver, type ContextPublicationEvidence } from "./context-publication.js";
import type { RefAfterCas } from "./observe.js";

export type ContextInput = PublicMethods["context.publish"]["params"];
export interface ContextEffects {
  /** null is observed absence only; unknown/corrupt observations throw. */
  current(): Oid | null;
  /** Read-only repository fact. null when no repository exists yet, so a first
   * publication is never rejected for a format it cannot have observed. */
  observedObjectFormat(): "sha1" | "sha256" | null;
  prepareCandidate(tree: string, entries: ContextEntry[], expected: Oid | null): Oid | Promise<Oid>;
  /** Explicit GOAL intent may change no other shared document. */
  assertGoalOnly(candidate: Oid, expected: Oid | null): void;
  /** False while a native preparation that used this tree is not proven quiescent. */
  preparationQuiescent(tree: string): boolean;
  ensureCandidate(operation: OperationOf<"context.publish">): void;
  compareAndSwap(base: Oid | null, candidate: Oid): RefAfterCas;
  publishSnapshot(operation: OperationOf<"context.publish">, evidence: ContextPublicationEvidence): void;
}

export class ContextCoordinator {
  constructor(private readonly paths: { stateRoot: string; society: string }, private readonly store: Store,
    private readonly mail: MailModule, private readonly effects: ContextEffects,
    private readonly publication: ContextPublicationObserver) {}

  private operation(id: string): OperationOf<"context.publish"> {
    const operation = this.store.getOperationById(id);
    if (!operation || operation.kind !== "context.publish") throw new StoreError("STORE_CORRUPT", "accepted context operation is missing");
    return operation;
  }
  private receipt(id: string): Receipt { return receiptOfOperation(this.operation(id)); }
  /** Pre-accept ownership follows the accepted plan, not mere row existence. */
  private preacceptDisposition(id: string, names: (plan: OperationOf<"context.publish">["plan"]) => boolean):
    ReturnType<PreacceptRegistration["observe"]> {
    const operation = this.store.getOperationById(id);
    if (operation === null) return "unaccepted-known";
    return operation.kind === "context.publish" && names(operation.plan) ? "accepted-referenced" : "accepted-unreferenced";
  }
  private unknown(id: string): void { this.store.transaction(tx => tx.setOperationUnknown(id)); }
  private requireWriterSlot(exceptId?: string): void {
    for (const id of this.store.recoverableOperations()) {
      if (id === exceptId) continue;
      const operation = this.store.getOperationById(id);
      if (!operation) throw new StoreError("STORE_CORRUPT", "context recovery barrier lost an operation");
      if (operation.kind === "context.publish")
        throw new StoreError("REF_STATE_UNKNOWN", "an unfinished context publication blocks another context writer");
    }
  }
  private requireRecoveryAuthority(actor: string): void {
    const row = this.store.getAgent(actor);
    if (row?.desired === "stopped" || row?.desired === "retired")
      throw new StoreError("CANCELLED_BEFORE_COMMIT", "stopped actor cannot advance context during recovery");
    if (!row || row.desired !== "enabled" || !capabilitiesOf(row).has("context.publish"))
      throw new StoreError("CAPABILITY_DENIED", "current context publication authority is unavailable");
  }
  private rejectAccepted(id: string, error: unknown, recovering: boolean, knowledge: EffectKnowledge): never {
    const policy = acceptedFailurePolicy(error, recovering ? "recovering" : "accepted", knowledge);
    if (policy.terminal === "failed") this.store.transaction(tx => tx.setOperationFailed(id, policy.code));
    else if (policy.terminal === "unknown") this.unknown(id);
    throw new AcceptedFailure(policy.code, failureMessage(error) ?? "context effect or observation failed", knowledge);
  }
  private async materializeAndSettle(operation: OperationOf<"context.publish">): Promise<void> {
    this.effects.publishSnapshot(operation, this.publication.observe(operation));
    await this.mail.publishGated(operation.id, this.publication.observe(operation));
    const plan = operation.plan;
    const result = { kind: "context.publish" as const, previous: plan.base, revision: plan.candidate,
      message: plan.message.id, recipientCount: plan.message.recipients.length };
    this.store.transaction(tx => tx.setOperationSucceeded(operation.id, JSON.stringify(result)));
  }

  async publish(auth: AuthContext, key: string, input: ContextInput, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    assertCurrentActor(this.store, auth, "context.publish");
    if (!isValidRequestKey(key)) throw new StoreError("INVALID_REQUEST", "invalid context request key");
    let request: ContextInput;
    try { request = decodeMutationPayload("context.publish", input); }
    catch { throw new StoreError("INVALID_REQUEST", "invalid context caller payload"); }
    if (request.content.mediaType !== "application/vnd.oma.context-v1") throw new StoreError("INVALID_REQUEST", "invalid context media type");
    if (request.goalMail && (auth.actor !== "principal" || auth.role !== "principal"))
      throw new StoreError("CAPABILITY_DENIED", "only the Principal can publish an explicit GOAL mail");
    if (request.goalMail) Object.freeze(request.goalMail);
    for (const entry of request.entries) Object.freeze(entry);
    Object.freeze(request.entries); Object.freeze(request.content); Object.freeze(request);
    const hash = requestHash("context.publish", request);
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    if (claim === "reused") throw reused(auth.actor, key);
    this.requireWriterSlot();
    // ID-003: a wire OID must match this repository's object format before any
    // base comparison, so a wrong-format locator is an input error rather than a
    // conflict. No repository yet means there is no observed format to compare.
    const format = this.effects.observedObjectFormat();
    if (format !== null && request.expected !== null &&
      (!isValidFullOid(request.expected) || request.expected.length !== (format === "sha1" ? 40 : 64)))
      throw new StoreError("INVALID_OID", "context base has the wrong repository object format");
    // Physical order: prepare the candidate first (its manifest and content
    // validation own INVALID_REQUEST/STREAM_INVALID), then re-check the base and
    // the current authority before acceptance. Malformed input is therefore not
    // reported as a base conflict.
    const id = generateOperationId(); const messageId = generateMessageId(id, 0);
    const stagingPath = contextStagingPathAt(this.paths.stateRoot, id);
    // Everything acquired before acceptance is registered with the operation
    // that would name it, and one settlement decides all of it: a certainly
    // unaccepted, quiescent resource is removed; one the accepted plan names, or
    // whose acceptance cannot be observed, is retained for recovery.
    const scope: PreacceptScope = new PreacceptScope();
    let accepted: "inserted" | "retry";
    try {
      const tree = await prepareContextStream(this.paths.stateRoot, id, request.entries, request.content, bytes, undefined);
      scope.register({ operationId: id, resource: stagingPath, owner: tree,
        quiescent: () => this.effects.preparationQuiescent(tree.path),
        observe: () => this.preacceptDisposition(id, plan => plan.stagingPath === stagingPath) });
      assertCurrentActor(this.store, auth, "context.publish");
      { const actual = this.effects.current(); if (actual !== request.expected) throw new StoreError("CONTEXT_CONFLICT", "context base changed", { details: { actual } }); }
      const candidate = await this.effects.prepareCandidate(tree.path, request.entries, request.expected);
      if (!isValidFullOid(candidate)) throw new StoreError("STORE_CORRUPT", "context preparation returned an invalid candidate identity");
      if (request.goalMail) this.effects.assertGoalOnly(candidate, request.expected);
      assertCurrentActor(this.store, auth, "context.publish");
      { const actual = this.effects.current(); if (actual !== request.expected) throw new StoreError("CONTEXT_CONFLICT", "context base changed during preparation", { details: { actual } }); }
      const address = listAddress("residents", this.paths.society);
      const eml = await buildEml({ from: actorAddress(auth.actor, this.paths.society), to: [address], replyTo: [address],
        subject: request.goalMail?.subject ?? "Shared context updated", kind: "context", contextRevision: candidate, inReplyTo: null, references: [],
        messageId: `${messageId}@${this.paths.society}.oma.invalid`,
        body: request.goalMail ? readContextEntry(tree.path, request.entries.find(entry => entry.path === "GOAL.md")!).toString("utf8")
          : `Revision: ${candidate}\n${contextRevisionDisplayPath(candidate)}/GOAL.md\nReference: /world/context/current\n` });
      const artifact = this.mail.freezeObject(messageId, eml);
      scope.register({ operationId: id, resource: artifact.path, owner: artifact,
        observe: () => frozenMessageDisposition(this.store, id, { id: messageId, sha256: eml.sha256 }) });
      // Canonical observation is outside T. There is no await before the pure
      // current-authority/recipient snapshot and acceptance below.
      { const actual = this.effects.current(); if (actual !== request.expected) throw new StoreError("CONTEXT_CONFLICT", "context base changed before acceptance", { details: { actual } }); }
      accepted = this.store.transaction(tx => {
        assertCurrentActor(this.store, auth, "context.publish");
        const current = this.store.claimKey(auth.actor, key, hash);
        if (current === "retry") return "retry" as const;
        if (current === "reused") throw reused(auth.actor, key);
        this.requireWriterSlot();
        const recipients = expandAddresses(this.store, ["residents"], this.paths.society).recipients;
        const plan: PlanFor<"context.publish"> = { kind: "context.publish", base: request.expected, candidate,
          noopRef: candidate === request.expected ? contextNoopRefFor(id) : null,
          ...(request.goalMail ? { goalMail: { ...request.goalMail } } : {}),
          target: "refs/heads/main", entries: request.entries.map(entry => ({ ...entry })), stagingPath,
          message: { id: messageId, objectPath: mailObjectRelativePath(messageId), sha256: eml.sha256, bytes: eml.bytes,
            dateMs: eml.dateMs, to: ["residents"] as Address[], recipients, kind: "context", contextRevision: candidate,
            replyHeaders: { replyTo: ["residents"], inReplyTo: null, references: [] } } };
        const result = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash,
          kind: "context.publish", payloadJson: JSON.stringify(request), planJson: JSON.stringify(plan) });
        if (result !== "retry") tx.insertDeliveries(recipients.map(recipient => ({ messageId, recipient, operationId: id })));
        return result;
      });
    } catch (error) { scope.settleFailure(error); }
    // Connection close cannot remove accepted intent: the plan names the tree and
    // object, so they are retained. A same-key loser's plan names nothing of ours.
    scope.settle();
    if (accepted === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    const operation = this.operation(id);
    let knowledge: EffectKnowledge = "none";
    try {
      this.requireWriterSlot(id);
      this.effects.ensureCandidate(operation);
      assertCurrentActor(this.store, auth, "context.publish");
      if (this.effects.current() !== operation.plan.base) { this.unknown(id); return this.receipt(id); }
      if (operation.plan.base !== operation.plan.candidate) {
        knowledge = "possible";
        const after = this.effects.compareAndSwap(operation.plan.base, operation.plan.candidate);
        if (after.kind !== "candidate") { this.unknown(id); return this.receipt(id); }
      } else {
        knowledge = "possible";
        if (!this.publication.authorizeNoop(operation)) { this.unknown(id); return this.receipt(id); }
      }
      knowledge = "applied";
      await this.materializeAndSettle(operation);
      return this.receipt(id);
    } catch (error) { this.rejectAccepted(id, error, false, knowledge); }
  }

  async reconcile(operation: OperationOf<"context.publish">): Promise<void> {
    if (operation.state !== "pending" && operation.state !== "unknown") return;
    let knowledge: EffectKnowledge = "possible";
    try {
      const noOp = operation.plan.base === operation.plan.candidate;
      if (noOp && this.publication.hasNoopWitness(operation)) {
        knowledge = "applied";
        this.effects.ensureCandidate(operation);
        await this.materializeAndSettle(operation); return;
      }
      const main = this.effects.current();
      if (!noOp && main === operation.plan.candidate) {
        knowledge = "applied";
        this.effects.ensureCandidate(operation);
        await this.materializeAndSettle(operation); return;
      }
      if (main !== operation.plan.base) { this.unknown(operation.id); return; }
      knowledge = "none";
      this.requireWriterSlot(operation.id);
      this.requireRecoveryAuthority(operation.actor);
      this.effects.ensureCandidate(operation);
      this.requireRecoveryAuthority(operation.actor);
      if (this.effects.current() !== operation.plan.base) { this.unknown(operation.id); return; }
      knowledge = "possible";
      if (noOp) {
        if (!this.publication.authorizeNoop(operation)) { this.unknown(operation.id); return; }
      } else {
        const after = this.effects.compareAndSwap(operation.plan.base, operation.plan.candidate);
        if (after.kind !== "candidate") { this.unknown(operation.id); return; }
      }
      knowledge = "applied";
      await this.materializeAndSettle(operation);
    } catch (error) { this.rejectAccepted(operation.id, error, true, knowledge); }
  }
}
