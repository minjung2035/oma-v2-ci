/** CTX-001..006: immutable context intent, then canonical ref, snapshot,
 * current pointer, notification and terminal settlement. Recovery never prepares
 * a new candidate. The Git facade serializes this coordinator with main writers.
 */
import type { AuthContext, ContextEntry, Oid, Receipt, PublicMethods, Address } from "../../implementation/contracts.js";
import { Store, reused } from "../store.js";
import type { OperationOf } from "../storage/operation-codec.js";
import type { PlanFor } from "../durable.js";
import { assertCurrentActor, capabilitiesOf } from "../authority.js";
import { StoreError, ERROR_METADATA, classifyError, type EffectKnowledge } from "../domain/errors.js";
import { requestHash } from "../hash.js";
import { generateOperationId, generateMessageId, isValidRequestKey, isValidFullOid } from "../ids.js";
import { mailObjectRelativePath, contextRevisionDisplayPath } from "../domain/derived.js";
import { contextStagingPathAt } from "../storage/paths.js";
import { prepareContextStream } from "../storage/context-stream.js";
import { decodeMutationPayload } from "../protocol/request-codec.js";
import { receiptOfOperation } from "../protocol/receipts.js";
import { MailModule, buildEml, actorAddress, listAddress, expandAddresses } from "../mail.js";
import { ContextPublicationObserver, type ContextPublicationEvidence } from "./context-publication.js";
import type { RefAfterCas } from "./observe.js";

export type ContextInput = PublicMethods["context.publish"]["params"];
export interface ContextEffects {
  /** null is observed absence only; unknown/corrupt observations throw. */
  current(): Oid | null;
  prepareCandidate(tree: string, entries: ContextEntry[], expected: Oid | null): Oid | Promise<Oid>;
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
    const code = error instanceof StoreError ? error.code : "INTERNAL_ERROR";
    const category = ERROR_METADATA[code].category;
    const policy = classifyError({ code, phase: recovering ? "recovering" : "accepted", effectKnowledge: knowledge,
      observationKind: code === "STREAM_INVALID" || category === "integrity" ? "corrupt" :
        category === "transient" || category === "ambiguous" || category === "internal" ? "unavailable" : "rejected" });
    if (policy.terminal === "failed") this.store.transaction(tx => tx.setOperationFailed(id, policy.code));
    else if (policy.terminal === "unknown") this.unknown(id);
    throw new StoreError(policy.code, error instanceof StoreError ? error.message : "context effect or observation failed");
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
    for (const entry of request.entries) Object.freeze(entry);
    Object.freeze(request.entries); Object.freeze(request.content); Object.freeze(request);
    const hash = requestHash("context.publish", request);
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOperation(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    this.requireWriterSlot();
    if (this.effects.current() !== request.expected) throw new StoreError("CONTEXT_CONFLICT", "context base changed");
    const id = generateOperationId(); const messageId = generateMessageId(id, 0);
    const tree = await prepareContextStream(this.paths.stateRoot, id, request.entries, request.content, bytes);
    assertCurrentActor(this.store, auth, "context.publish");
    const candidate = await this.effects.prepareCandidate(tree, request.entries, request.expected);
    if (!isValidFullOid(candidate)) throw new StoreError("STORE_CORRUPT", "context preparation returned an invalid candidate identity");
    assertCurrentActor(this.store, auth, "context.publish");
    if (this.effects.current() !== request.expected) throw new StoreError("CONTEXT_CONFLICT", "context base changed during preparation");
    const address = listAddress("residents", this.paths.society);
    const eml = await buildEml({ from: actorAddress(auth.actor, this.paths.society), to: [address], replyTo: [address],
      subject: "Shared context updated", kind: "context", contextRevision: candidate, inReplyTo: null, references: [],
      messageId: `${messageId}@${this.paths.society}.oma.invalid`,
      body: `Revision: ${candidate}\n${contextRevisionDisplayPath(candidate)}/GOAL.md\n참고: /world/context/current\n` });
    this.mail.freezeObject(messageId, eml);
    // Canonical observation is outside T. There is no await before the pure
    // current-authority/recipient snapshot and acceptance below.
    if (this.effects.current() !== request.expected) throw new StoreError("CONTEXT_CONFLICT", "context base changed before acceptance");
    const accepted = this.store.transaction(tx => {
      assertCurrentActor(this.store, auth, "context.publish");
      const current = this.store.claimKey(auth.actor, key, hash);
      if (current === "retry") return "retry" as const;
      if (current === "reused") throw reused(auth.actor, key);
      this.requireWriterSlot();
      const recipients = expandAddresses(this.store, ["residents"], this.paths.society).recipients;
      const plan: PlanFor<"context.publish"> = { kind: "context.publish", base: request.expected, candidate,
        target: "refs/heads/main", entries: request.entries.map(entry => ({ ...entry })),
        stagingPath: contextStagingPathAt(this.paths.stateRoot, id),
        message: { id: messageId, objectPath: mailObjectRelativePath(messageId), sha256: eml.sha256, bytes: eml.bytes,
          dateMs: eml.dateMs, to: ["residents"] as Address[], recipients, kind: "context", contextRevision: candidate,
          replyHeaders: { replyTo: ["residents"], inReplyTo: null, references: [] } } };
      const result = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash,
        kind: "context.publish", payloadJson: JSON.stringify(request), planJson: JSON.stringify(plan) });
      if (result !== "retry") tx.insertDeliveries(recipients.map(recipient => ({ messageId, recipient, operationId: id })));
      return result;
    });
    // Preparation artifacts are retained: connection close cannot remove intent.
    if (accepted === "retry") return receiptOfOperation(this.store.getOperation(auth.actor, key)!);
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
      const main = this.effects.current();
      if (main === operation.plan.candidate) {
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
      const after = this.effects.compareAndSwap(operation.plan.base, operation.plan.candidate);
      if (after.kind !== "candidate") { this.unknown(operation.id); return; }
      knowledge = "applied";
      await this.materializeAndSettle(operation);
    } catch (error) { this.rejectAccepted(operation.id, error, true, knowledge); }
  }
}
