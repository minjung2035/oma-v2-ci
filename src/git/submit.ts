/** GIT-006..009: spooling and EML freezing precede T-intent; all publication
 * follows durable acceptance. Recovery consumes that exact intent, never HEAD.
 */
import type { Actor, Address, AuthContext, BlobDescriptor, Oid, Receipt, MessagePlan } from "../../implementation/contracts.js";
import { Store, reused } from "../store.js";
import type { OperationOf } from "../storage/operation-codec.js";
import type { PlanFor } from "../durable.js";
import { MailModule, buildEml, expandAddresses, defaultReplyTo, defaultLogicalReplyTo, actorAddress } from "../mail.js";
import { assertCurrentActor, capabilitiesOf } from "../authority.js";
import { StoreError, ERROR_METADATA, classifyError, type EffectKnowledge } from "../domain/errors.js";
import { requestHash, canonicalRequestParams } from "../hash.js";
import { generateOperationId, generateMessageId, isValidRequestKey } from "../ids.js";
import { publishedRefFor, mailObjectRelativePath } from "../domain/derived.js";
import { prepareSubmitSpool, requireFrozenBundle, type PreparedSubmitSpool } from "../storage/submit-spool.js";
import { decodeMutationPayload } from "../protocol/request-codec.js";
import { receiptOfOperation } from "../storage/receipt-projector.js";
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
  quarantineImport(path: string, candidate: Oid, exportRef: string, prerequisites: readonly Oid[]): void | Promise<void>;
  publishRef(ref: string, candidate: Oid): void;
  observeRef(ref: string): GitObservation<string>;
}

export class SubmitCoordinator {
  private readonly active = new Map<string, Promise<void>>();
  constructor(private readonly paths: { stateRoot: string; society: string }, private readonly store: Store,
    private readonly mail: MailModule, private readonly effects: SubmitEffects, private readonly publication: GitPublicationObserver) {}
  private operation(id: string): OperationOf<"git.submit"> {
    const row = this.store.getOperationById(id);
    if (!row || row.kind !== "git.submit") throw new StoreError("STORE_CORRUPT", "accepted submit operation is unavailable");
    return row;
  }
  private exclusive(id: string, work: () => Promise<void>): Promise<void> {
    const current = this.active.get(id); if (current) return current;
    const task = Promise.resolve().then(work).finally(() => { if (this.active.get(id) === task) this.active.delete(id); });
    this.active.set(id, task); return task;
  }
  private publicationAuthority(actorName: string, auth?: AuthContext): void {
    const current = this.store.getAgent(actorName);
    if (current?.desired === "stopped" || current?.desired === "retired")
      throw new StoreError("CANCELLED_BEFORE_COMMIT", "stop or retire intent precedes submit publication");
    if (auth) { assertCurrentActor(this.store, auth, "git.submit"); return; }
    // Recovery settles accepted intent with CURRENT durable authority, never a
    // fabricated live lease or a worker's old capabilities snapshot.
    if (!current || current.desired !== "enabled" || !capabilitiesOf(current).has("git.submit"))
      throw new StoreError("CAPABILITY_DENIED", "current submit recovery authority is unavailable");
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
    try { accepted = this.store.getOperationById(operationId) !== null; } catch { /* DB uncertainty cannot authorize deletion. */ }
    if (accepted === false) spool.discardUnaccepted(); else spool.retainForOperation();
  }
  async submit(auth: AuthContext, key: string, input: SubmitInput, bytes: AsyncIterable<Uint8Array>): Promise<Receipt> {
    assertCurrentActor(this.store, auth, "git.submit");
    if (!isValidRequestKey(key)) throw new StoreError("INVALID_REQUEST", "invalid submit request key");
    let request: SubmitInput;
    try { request = decodeMutationPayload("git.submit", input); }
    catch { throw new StoreError("INVALID_REQUEST", "invalid submit caller payload"); }
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
        const message: MessagePlan = { id: messageId, objectPath: mailObjectRelativePath(messageId), sha256: eml.sha256, bytes: eml.bytes,
          dateMs: eml.dateMs, to: logicalTo, recipients, kind: "result", contextRevision: null,
          replyHeaders: { replyTo: defaultLogicalReplyTo(auth.actor, logicalTo), inReplyTo: null, references: [] } };
        const plan: PlanFor<"git.submit"> = { kind: "git.submit", candidate: request.candidate, exportRef: request.exportRef,
          prerequisites: [...request.prerequisites], bundle: spool.bundle === null ? null : { ...spool.bundle }, publishedRef, message };
        const result = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash,
          kind: "git.submit", payloadJson: JSON.stringify(request), planJson: JSON.stringify(plan) });
        if (result !== "retry") tx.insertDeliveries(recipients.map(recipient => ({ messageId, recipient, operationId: id })));
        return result;
      });
      if (claimResult === "retry") { this.cleanPreaccept(spool, id); return receiptOfOperation(this.store.getOperation(auth.actor, key)!); }
      committed = true; spool.retainForOperation();
      await this.exclusive(id, () => this.executeAccepted(this.operation(id), auth));
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
      kind: "result", contextRevision: null, inReplyTo: null, references: [], messageId: `${messageId}@${this.paths.society}.oma.invalid`, body });
  }
  private async publishMailAndSettle(operation: OperationOf<"git.submit">): Promise<void> {
    const proof = this.publication.submission(operation);
    await this.mail.publishGated(operation.id, proof);
    this.store.transaction(tx => tx.setOperationSucceeded(operation.id, JSON.stringify(submitResult(operation.plan))));
  }
  private async executeAccepted(operation: OperationOf<"git.submit">, auth: AuthContext): Promise<void> {
    if (operation.state !== "pending" && operation.state !== "unknown") return;
    const plan = operation.plan; let knowledge: EffectKnowledge = "none";
    try {
      if (plan.bundle) {
        requireFrozenBundle(plan.bundle);
        await this.effects.quarantineImport(plan.bundle.path, plan.candidate, plan.exportRef, plan.prerequisites);
        requireFrozenBundle(plan.bundle); // asynchronous preparation did not authorize replacing the accepted input
      } else if (!this.effects.canonicalHas(plan.candidate)) throw new StoreError("PREREQUISITE_MISSING", "no bundle and candidate unknown to the broker");
      this.publicationAuthority(operation.actor, auth);
      // Final live-authority check -> fixed published-ref CAS contains NO await.
      knowledge = "possible"; this.effects.publishRef(plan.publishedRef, plan.candidate); knowledge = "applied";
      await this.publishMailAndSettle(operation);
    } catch (error) { this.rejectAccepted(operation.id, error, false, knowledge); }
  }
  reconcile(operation: OperationOf<"git.submit">): Promise<void> {
    return this.exclusive(operation.id, () => this.reconcileAccepted(this.operation(operation.id)));
  }
  private async reconcileAccepted(operation: OperationOf<"git.submit">): Promise<void> {
    if (operation.state !== "pending" && operation.state !== "unknown") return;
    const plan = operation.plan; let knowledge: EffectKnowledge = "possible";
    try {
      const current = this.effects.observeRef(plan.publishedRef);
      if (current.kind === "present") {
        if (current.value !== plan.candidate) { this.store.transaction(tx => tx.setOperationUnknown(operation.id)); return; }
      } else if (current.kind === "absent") {
        if (plan.bundle) {
          requireFrozenBundle(plan.bundle);
          await this.effects.quarantineImport(plan.bundle.path, plan.candidate, plan.exportRef, plan.prerequisites);
          requireFrozenBundle(plan.bundle);
        } else if (!this.effects.canonicalHas(plan.candidate)) throw new StoreError("REF_STATE_UNKNOWN", "accepted candidate is unavailable in canonical objects");
        const fresh = this.effects.observeRef(plan.publishedRef);
        if (fresh.kind === "present" && fresh.value === plan.candidate) { /* settle an already proven effect without new authority */ }
        else if (fresh.kind === "absent") { this.publicationAuthority(operation.actor); this.effects.publishRef(plan.publishedRef, plan.candidate); }
        else throw new StoreError(fresh.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", "publication changed during preparation");
      } else throw new StoreError(current.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", "published ref observation is unavailable");
      knowledge = "applied"; await this.publishMailAndSettle(operation);
    } catch (error) { this.rejectAccepted(operation.id, error, true, knowledge); }
  }
}
