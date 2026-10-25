import type { SubmissionPublication } from "./ports.js";
import { encodeOperationPlan } from "@oma/protocol/operation-codec";
/** GIT-006..009: spooling and EML freezing precede T-intent; all publication
 * follows durable acceptance. Recovery consumes that exact intent, never HEAD.
 */
import type { Actor, Address, AuthContext, BlobDescriptor, Oid, Receipt } from "@oma/contracts";
import type { GitLedger, GitMessaging } from "./ports.js";
import { reused } from "@oma/domain/request-identity";
import type { OperationOf } from "@oma/protocol/operation-codec";
import type { PlanFor } from "@oma/domain/durable";
import { assertCurrentActor, capabilitiesOf } from "@oma/domain/authority";
import { StoreError, AcceptedFailure, acceptedFailure, type EffectKnowledge, acceptedFailurePolicy, failureMessage } from "@oma/domain/errors";
import { requestHash, canonicalRequestParams } from "@oma/domain/request-identity";
import { generateOperationId } from "@oma/native/identity";
import { messageIdForOperation as generateMessageId } from "@oma/domain/derived";
import { isValidRequestKey } from "@oma/domain/identifiers";
import { publishedRefFor } from "@oma/domain/derived";
import { prepareSubmitSpool, requireFrozenBundle, withFrozenBundle, type FrozenBundle } from "@oma/storage/submit-spool";
import { PreacceptScope, type PreacceptRegistration } from "@oma/storage/preaccept-artifact";
import { decodeMutationPayload } from "@oma/protocol/request-codec";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { submitResult } from "@oma/protocol/operation-results";
import type { GitObservation } from "@oma/contracts/git";

export interface SubmitInput {
  candidate: Oid; exportRef: string; prerequisites: Oid[]; to: string[];
  subject: string; body: string; paths: string[]; bundle?: BlobDescriptor;
}
export interface SubmitEffects {
  verifyObjectFormat(oids: readonly string[]): void;
  canonicalHas(candidate: Oid): boolean;
  quarantineImport(fd: number, candidate: Oid, exportRef: string, prerequisites: readonly Oid[], authorize: () => void): void | Promise<void>;
  publishRef(ref: string, candidate: Oid): void;
  observeRef(ref: string): GitObservation<string>;
}

export class SubmitCoordinator {
  private readonly active = new Map<string, Promise<void>>();
  constructor(private readonly paths: { stateRoot: string; society: string }, private readonly store: GitLedger,
    private readonly mail: GitMessaging, private readonly effects: SubmitEffects, private readonly publication: SubmissionPublication) {}
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
    if (!this.store.societyOpen()) throw new StoreError("AGENT_NOT_READY", "society execution is closed");
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
    const failure = acceptedFailurePolicy(error, recovering ? "recovering" : "accepted", knowledge);
    if (failure.terminal === "failed") this.store.transaction(tx => tx.setOperationFailed(id, failure.code));
    if (failure.terminal === "unknown") this.store.transaction(tx => tx.setOperationUnknown(id));
    throw new AcceptedFailure(failure.code, failureMessage(error) ?? "submit effect or observation failed", knowledge);
  }
  /** The spool belongs to the operation only if its accepted plan names this
   * exact bundle, or names none when none was spooled. */
  private bundleDisposition(id: string, bundle: FrozenBundle | null): ReturnType<PreacceptRegistration["observe"]> {
    const operation = this.store.getOperationById(id);
    if (operation === null) return "unaccepted-known";
    const named = operation.kind === "git.submit" ? operation.plan.bundle : undefined;
    return named !== undefined && (named === null ? bundle === null
      : bundle !== null && named.path === bundle.path && named.sha256 === bundle.sha256) ? "accepted-referenced" : "accepted-unreferenced";
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
    if (claim === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    if (claim === "reused") throw reused(auth.actor, key);
    this.effects.verifyObjectFormat([request.candidate, ...request.prerequisites]);
    const id = generateOperationId(); const messageId = generateMessageId(id, 0);
    const spool = await prepareSubmitSpool(this.paths.stateRoot, id, request.bundle, bytes);
    // The spool and the frozen result mail are owned by nobody until the plan
    // that names them is accepted; one settlement decides both, and a refusal
    // stays the first error reported.
    const scope: PreacceptScope = new PreacceptScope();
    let claimResult: "inserted" | "retry";
    try {
      scope.register({ operationId: id, resource: spool.bundle?.path ?? `${id}:no-bundle`, owner: spool,
        observe: () => this.bundleDisposition(id, spool.bundle) });
      const logicalTo = [...new Set(request.to.length ? request.to : ["commons"])].sort() as Address[];
      const publishedRef = publishedRefFor(auth.actor, id);
      const frozen = await this.resultMessage(auth.actor, request, logicalTo, publishedRef, messageId);
      const { message, artifact } = frozen;
      scope.register({ operationId: id, resource: artifact.path, owner: artifact,
        observe: () => this.mail.frozenDisposition(id, message) });
      claimResult = this.store.transaction(tx => {
        assertCurrentActor(this.store, auth, "git.submit");
        const current = this.store.claimKey(auth.actor, key, hash);
        if (current === "retry") return "retry" as const;
        if (current === "reused") throw reused(auth.actor, key);
        const recipients = this.mail.recipients(logicalTo);
        const plan: PlanFor<"git.submit"> = { kind: "git.submit", candidate: request.candidate, exportRef: request.exportRef,
          prerequisites: [...request.prerequisites], bundle: spool.bundle === null ? null : { ...spool.bundle }, publishedRef, message: { ...message, recipients } };
        const result = tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash,
          kind: "git.submit", payloadJson: JSON.stringify(request), planJson: encodeOperationPlan(plan) });
        if (result !== "retry") tx.insertDeliveries(recipients.map(recipient => ({ messageId, recipient, operationId: id })));
        return result;
      });
    } catch (error) { scope.settleFailure(error); }
    scope.settle();
    if (claimResult === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    // The submission is accepted: a failure from here is reported as accepted.
    try {
      await this.exclusive(id, () => this.executeAccepted(this.operation(id), auth));
      return receiptOfOperation(this.operation(id));
    } catch (error) { throw acceptedFailure(error); }
  }
  private resultMessage(actor: Actor, input: SubmitInput, logicalTo: readonly Address[], publishedRef: string, messageId: string) {
    const body = `${input.body}\n\nPublished: ${publishedRef}\nCommit: ${input.candidate}\n${input.paths.length ? `Paths: ${input.paths.join(", ")}\n` : ""}git fetch origin ${publishedRef}; git show FETCH_HEAD\n`;
    return this.mail.freezeNotification(messageId, actor, { to: logicalTo,
      subject: input.subject, kind: "result", contextRevision: null, body });
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
        await withFrozenBundle(plan.bundle, fd => this.effects.quarantineImport(fd, plan.candidate, plan.exportRef, plan.prerequisites, () => this.publicationAuthority(operation.actor, auth)));
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
          await withFrozenBundle(plan.bundle, fd => this.effects.quarantineImport(fd, plan.candidate, plan.exportRef, plan.prerequisites, () => this.publicationAuthority(operation.actor)));
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
