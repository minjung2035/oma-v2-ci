/** GIT-006..009: spooling and EML freezing precede T-intent; all publication
 * follows durable acceptance. Recovery consumes that exact intent, never HEAD.
 */
import type { Actor, Address, AuthContext, BlobDescriptor, Oid, Receipt, MessagePlan } from "../../implementation/contracts.js";
import { Store, reused } from "../store.js";
import type { OperationOf } from "../storage/operation-codec.js";
import type { PlanFor } from "../durable.js";
import { MailModule, buildEml, expandAddresses, defaultReplyTo, defaultLogicalReplyTo, actorAddress } from "../mail.js";
import { assertCurrentActor } from "../authority.js";
import { StoreError, ERROR_METADATA, classifyError, type EffectKnowledge } from "../domain/errors.js";
import { requestHash, canonicalRequestParams } from "../hash.js";
import { generateOperationId, generateMessageId } from "../ids.js";
import { publishedRefFor, mailObjectRelativePath } from "../domain/derived.js";
import { prepareSubmitSpool, requireFrozenBundle, type PreparedSubmitSpool } from "../storage/submit-spool.js";
import { receiptOfOperation } from "../protocol/receipts.js";
import { submitResult } from "../protocol/operation-results.js";
import { GitPublicationObserver } from "./publication.js";
import type { GitObservation } from "./observe.js";

export interface SubmitInput {
  candidate: Oid; exportRef: string; prerequisites: Oid[]; to: string[];
  subject: string; body: string; paths: string[]; bundle?: BlobDescriptor;
}
export interface SubmitEffects {
  verifyObjectFormat(oids: readonly string[]): void;
  canonicalHas(candidate: Oid): boolean;
  quarantineImport(path: string, candidate: Oid, exportRef: string, prerequisites: readonly Oid[]): void;
  publishRef(ref: string, candidate: Oid): void;
  observeRef(ref: string): GitObservation<string>;
}

export class SubmitCoordinator {
  constructor(
    private readonly paths: { stateRoot: string; society: string }, private readonly store: Store,
    private readonly mail: MailModule, private readonly effects: SubmitEffects,
    private readonly publication: GitPublicationObserver,
  ) {}
  private operation(id: string): OperationOf<"git.submit"> {
    const row = this.store.getOperationById(id);
    if (!row || row.kind !== "git.submit") throw new StoreError("STORE_CORRUPT", "accepted submit operation is unavailable");
    return row;
  }
  private rejectAccepted(id: string, error: unknown, recovering: boolean, knowledge: EffectKnowledge): never {
    const code = error instanceof StoreError ? error.code : "INTERNAL_ERROR";
    const category = ERROR_METADATA[code].category;
    const failure = classifyError({ code, phase: recovering ? "recovering" : "accepted", effectKnowledge: knowledge,
      observationKind: category === "integrity" || code === "STREAM_INVALID" ? "corrupt" :
        category === "transient" || category === "ambiguous" || category === "internal" ? "unavailable" : "rejected" });
    if (failure.terminal === "failed") this.store.transaction(tx => tx.setOperationFailed(id, failure.code));
    if (failure.terminal === "unknown") this.store.transaction(tx => tx.setOperationUnknown(id));
    throw new StoreError(failure.code, error instanceof StoreError ? error.message : "submit effect or observation failed");
  }
  private cleanPreaccept(spool: PreparedSubmitSpool, operationId: string): void {
    let accepted: boolean | null = null;
    try { accepted = this.store.getOperationById(operationId) !== null; }
    catch { /* DB uncertainty cannot authorize deletion of workflow evidence. */ }
    if (accepted === false) spool.discardUnaccepted();
    else spool.retainForOperation();
  }

  async submit(auth: AuthContext, key: string, input: SubmitInput, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    assertCurrentActor(this.store, auth, "git.submit");
    // Copy before the first await. Later caller mutation cannot change accepted
    // identity, MIME bytes, export ref, descriptor or the source of recovery.
    const request: SubmitInput = { ...input, prerequisites: [...input.prerequisites], to: [...input.to], paths: [...input.paths],
      ...(input.bundle === undefined ? {} : { bundle: { ...input.bundle } }) };
    Object.freeze(request.prerequisites); Object.freeze(request.to); Object.freeze(request.paths);
    if (request.bundle) Object.freeze(request.bundle);
    Object.freeze(request);
    const hash = requestHash("git.submit", canonicalRequestParams("git.submit", request));
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOperation(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    this.effects.verifyObjectFormat([request.candidate, ...request.prerequisites]);
    const id = generateOperationId(); const messageId = generateMessageId(id, 0);
    const spool = await prepareSubmitSpool(this.paths.stateRoot, id, request.bundle, bytes);
    let committed = false;
    try {
      const logicalTo = [...new Set(request.to.length ? request.to : ["commons"])].sort() as Address[];
      const display = expandAddresses(this.store, logicalTo, this.paths.society).displayTo;
      const publishedRef = publishedRefFor(auth.actor, id);
      const eml = await this.resultEml(auth.actor, request, display, publishedRef, messageId);
      this.mail.freezeObject(messageId, eml);
      const claimResult = this.store.transaction(tx => {
        assertCurrentActor(this.store, auth, "git.submit");
        const current = this.store.claimKey(auth.actor, key, hash);
        if (current === "retry") return "retry" as const;
        if (current === "reused") throw reused(auth.actor, key);
        const recipients = expandAddresses(this.store, logicalTo, this.paths.society).recipients;
        const message: MessagePlan = { id: messageId, objectPath: mailObjectRelativePath(messageId),
          sha256: eml.sha256, bytes: eml.bytes, dateMs: eml.dateMs, to: logicalTo, recipients,
          kind: "result", contextRevision: null,
          replyHeaders: { replyTo: defaultLogicalReplyTo(auth.actor, logicalTo), inReplyTo: null, references: [] } };
        const plan: PlanFor<"git.submit"> = { kind: "git.submit", candidate: request.candidate,
          exportRef: request.exportRef, prerequisites: [...request.prerequisites],
          bundle: spool.bundle === null ? null : { ...spool.bundle }, publishedRef, message };
        const result = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash,
          kind: "git.submit", payloadJson: JSON.stringify(request), planJson: JSON.stringify(plan) });
        if (result !== "retry") tx.insertDeliveries(recipients.map(recipient => ({ messageId, recipient, operationId: id })));
        return result;
      });
      if (claimResult === "retry") {
        this.cleanPreaccept(spool, id);
        return receiptOfOperation(this.store.getOperation(auth.actor, key)!);
      }
      committed = true; spool.retainForOperation();
      const operation = this.operation(id);
      await this.executeAccepted(operation);
      return receiptOfOperation(this.operation(id));
    } catch (error) {
      if (!committed) {
        try { this.cleanPreaccept(spool, id); }
        catch (cleanup) { throw new AggregateError([error, cleanup], "submit admission and owned cleanup failed"); }
      }
      throw error;
    }
  }

  private async resultEml(actor: Actor, input: SubmitInput, displayTo: string[], publishedRef: string, messageId: string) {
    const body = `${input.body}\n\n게시됨: ${publishedRef}\nCommit: ${input.candidate}\n${input.paths.length ? `경로: ${input.paths.join(", ")}\n` : ""}git fetch origin ${publishedRef}; git show FETCH_HEAD\n`;
    return buildEml({ from: actorAddress(actor, this.paths.society), to: displayTo,
      replyTo: defaultReplyTo(actorAddress(actor, this.paths.society), displayTo), subject: input.subject,
      kind: "result", contextRevision: null, inReplyTo: null, references: [],
      messageId: `${messageId}@${this.paths.society}.oma.invalid`, body });
  }
  private async publishMailAndSettle(operation: OperationOf<"git.submit">): Promise<void> {
    const proof = this.publication.submission(operation);
    await this.mail.publishGated(operation.id, proof);
    const result = JSON.stringify(submitResult(operation.plan));
    this.store.transaction(tx => tx.setOperationSucceeded(operation.id, result));
  }
  private async executeAccepted(operation: OperationOf<"git.submit">): Promise<void> {
    const plan = operation.plan; let knowledge: EffectKnowledge = "none";
    try {
      if (plan.bundle) {
        requireFrozenBundle(plan.bundle);
        this.effects.quarantineImport(plan.bundle.path, plan.candidate, plan.exportRef, plan.prerequisites);
      } else if (!this.effects.canonicalHas(plan.candidate)) {
        throw new StoreError("PREREQUISITE_MISSING", "no bundle and candidate unknown to the broker");
      }
      knowledge = "possible";
      this.effects.publishRef(plan.publishedRef, plan.candidate);
      knowledge = "applied";
      await this.publishMailAndSettle(operation);
    } catch (error) { this.rejectAccepted(operation.id, error, false, knowledge); }
  }

  async reconcile(operation: OperationOf<"git.submit">): Promise<void> {
    if (operation.state !== "pending" && operation.state !== "unknown") return;
    const plan = operation.plan;
    let knowledge: EffectKnowledge = "possible";
    try {
      const current = this.effects.observeRef(plan.publishedRef);
      if (current.kind === "present") {
        if (current.value !== plan.candidate) {
          this.store.transaction(tx => tx.setOperationUnknown(operation.id)); return;
        }
      } else if (current.kind === "absent") {
        if (plan.bundle) {
          requireFrozenBundle(plan.bundle);
          this.effects.quarantineImport(plan.bundle.path, plan.candidate, plan.exportRef, plan.prerequisites);
        } else if (!this.effects.canonicalHas(plan.candidate)) {
          throw new StoreError("REF_STATE_UNKNOWN", "accepted candidate is unavailable in canonical objects");
        }
        this.effects.publishRef(plan.publishedRef, plan.candidate);
      } else {
        throw new StoreError(current.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", "published ref observation is unavailable");
      }
      knowledge = "applied";
      await this.publishMailAndSettle(operation);
    } catch (error) { this.rejectAccepted(operation.id, error, true, knowledge); }
  }
}
