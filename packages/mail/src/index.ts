import type { RecoveryCounts } from "@oma/contracts/runtime";
import type { MailNotificationDraft } from "@oma/contracts/values";
import { encodeOperationPlan } from "@oma/protocol/operation-codec";
// MAIL-001..010: acceptance orchestration; publication and batch views have explicit owners.
import { ownedMessages } from "@oma/domain/durable";

import type { Actor, Address, Json, MailInput, MessageId, MessagePlan, OperationId, RequestKey, AuthContext, PreparedBatch, BoundaryEvidence, Receipt } from "@oma/contracts";
import type { MailLedger, MailEffects, MailPreacceptScope } from "./ports.js";
import type { PreacceptArtifactOwner } from "@oma/contracts/files";
import { StoreError, acceptedFailure } from "@oma/domain/errors";
import { receiptOfOperation as receiptOf } from "@oma/protocol/receipt-projector";
import { assertCurrentActor } from "@oma/domain/authority";
import { messageIdForOperation as generateMessageId } from "@oma/domain/derived";

import { parseMessageId } from "@oma/domain/identifiers";
import { mailObjectPathAt, mailArchivePathAt, mailWorkersPathAt, mailInboxPathAt } from "@oma/domain/paths";
import { sha256Hex } from "@oma/domain/canonical-json";
import { requestHash, canonicalRequestParams } from "@oma/domain/request-identity";

import { buildFrozenMessage } from "./serialize.js";
import { defaultLogicalReplyTo, messagePlanFrom } from "./facts.js";
import { expandAddresses, logicalReplyAddress } from "./routing.js";
import type { ParsedEmlHeaders } from "./headers.js";
import { MailMaterializer, frozenMessageDisposition } from "./materializer.js";
import type { PublicationEvidence } from "@oma/contracts/publication";
import { BatchCoordinator } from "./batches.js";
import type { SettlementQuiescence } from "@oma/contracts/runtime";
import type { SettlementOutcome } from "@oma/domain/batch-settlement";
import { reconcileMailOperation, reconcileOrdinaryMail } from "./reconcile.js";
import type { BatchViewLimits } from "@oma/protocol/batch-view";
export { expandAddresses } from "./routing.js";
export type { RouteResult } from "./routing.js";
export { batchOf, batchNotice } from "./batches.js";
export { buildEml } from "./serialize.js";
export type { EmlParams } from "./serialize.js";
export { parseEmlHeaders, rfc5322Date } from "./headers.js";
export type { ParsedEmlHeaders } from "./headers.js";
export { listAddress, topicAddress, displayAddress, defaultReplyTo } from "./addresses.js";
export { defaultLogicalReplyTo } from "./facts.js";

/** One review-mail message ReviewModule freezes before acceptance (design
 * §3); the accepting operation fills `recipients` from a live expansion. */
export interface ReviewEmission {
  readonly to: readonly Address[];
  readonly kind: MessagePlan["kind"];
  readonly subject: string;
  readonly body: string;
  readonly replyHeaders: { replyTo: readonly Address[]; inReplyTo: string | null; references: readonly string[] };
  readonly approvalFor?: NonNullable<MessagePlan["approvalFor"]>;
  readonly audience?: "workers";
  readonly review: NonNullable<MessagePlan["review"]>;
}
export interface MailSociety { stateRoot: string; society: string }
export class MailModule {
  private readonly materializer: MailMaterializer;
  private readonly batches: BatchCoordinator;
  constructor(private readonly paths: MailSociety, private readonly store: MailLedger, private readonly maxReplyReferences: number, private readonly effects: MailEffects,
    batchMaxMessages = 24, viewLimits?: BatchViewLimits) {
    this.materializer = new MailMaterializer(store, paths.society, effects);
    this.batches = new BatchCoordinator(store, paths.stateRoot, this.materializer, effects, batchMaxMessages, viewLimits);
  }
  objectPath(id: MessageId): string { return mailObjectPathAt(this.paths.stateRoot, id); }
  /** The archive a message belongs to by audience: workers-only mail publishes
   * to S/mail/workers instead of the public archive. */
  archivePath(id: MessageId, audience?: "workers"): string {
    return audience === "workers" ? mailWorkersPathAt(this.paths.stateRoot, id)
      : mailArchivePathAt(this.paths.stateRoot, id);
  }
  inboxNewPath(actor: Actor, id: MessageId): string { return mailInboxPathAt(this.paths.stateRoot, actor, id, "new"); }
  inboxCurPath(actor: Actor, id: MessageId): string { return mailInboxPathAt(this.paths.stateRoot, actor, id, "cur"); }
  async send(auth: AuthContext, key: RequestKey, input: MailInput, requestContext?: { kind: "mail.send" | "agent.continue"; params: Json }): Promise<Receipt> {
    return this.sendOwned(auth, key, input, requestContext);
  }
  private async sendOwned(auth: AuthContext, key: RequestKey, input: MailInput,
    requestContext?: { kind: "mail.send" | "agent.continue"; params: Json }): Promise<Receipt> {
    const operationKind = requestContext?.kind ?? "mail.send";
    const requestParams = requestContext?.params ?? input as unknown as Json;
    const society = this.paths.society;
    const newHash = requestHash(operationKind, canonicalRequestParams(operationKind, requestParams));
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry") return receiptOf(this.store.retriedOperation(auth.actor, key));
    if (claim === "reused") throw new StoreError("REQUEST_KEY_REUSED", `request key ${key} already used with a different payload`);
    let parent: ParsedEmlHeaders | null = null;
    if (input.replyToMessage) parent = this.replyHeaders(input.replyToMessage);
    const targetAddresses: Address[] = [...input.to];
    if (targetAddresses.length === 0) {
      const inherited = parent ? parent.replyTo ?? (parent.from ? [parent.from] : []) : ["commons" as Address];
      const logical = inherited.map(value => logicalReplyAddress(this.store, value, society));
      if (logical.some(value => value === null)) throw new StoreError("INVALID_REQUEST", "reply target has no valid logical recipient");
      targetAddresses.push(...logical as Address[]);
    }
    const logicalTo = [...new Set(targetAddresses)].sort() as Address[];
    const route = expandAddresses(this.store, logicalTo, society);
    const opId = this.effects.nextOperationId(); const messageId = generateMessageId(opId, 0);
    let replyHeaders: { replyTo: Address[]; inReplyTo: string | null; references: string[] } = { replyTo: defaultLogicalReplyTo(auth.actor, logicalTo), inReplyTo: null, references: [] };
    if (parent) {
      const ancestry = [...parent.references];
      if (parent.inReplyTo && !ancestry.includes(parent.inReplyTo)) ancestry.push(parent.inReplyTo);
      if (!ancestry.includes(parent.messageId!)) ancestry.push(parent.messageId!);
      const references = ancestry.slice(-this.maxReplyReferences);
      if (ancestry.length > this.maxReplyReferences) references[0] = ancestry[0]!;
      replyHeaders = { replyTo: replyHeaders.replyTo, inReplyTo: parent.messageId, references };
    }
    const eml = await buildFrozenMessage({ id: messageId, sender: auth.actor, society, to: logicalTo,
      kind: input.kind, contextRevision: input.refs?.find(reference => reference.repo === "context")?.oid ?? null,
      replyHeaders, ...(input.approvalFor === undefined ? {} : { approvalFor: input.approvalFor }),
    }, { subject: input.subject, body: input.body });
    // The frozen object is owned by nobody until the plan that names it is
    // accepted; one settlement decides it and reports a refusal first.
    const scope: MailPreacceptScope = this.effects.newPreacceptScope();
    let txClaim: "inserted" | "retry";
    try {
      const artifact = this.freezeObject(messageId, eml);
      scope.register({ operationId: opId, resource: artifact.path, owner: artifact,
        observe: () => frozenMessageDisposition(this.store, opId, { id: messageId, sha256: eml.sha256 }) });
      txClaim = this.store.transaction(tx => {
        assertCurrentActor(this.store, auth, "mail.send");
        const current = this.store.claimKey(auth.actor, key, newHash);
        if (current === "retry") return "retry" as const;
        if (current === "reused") throw new StoreError("REQUEST_KEY_REUSED", `request key ${key} already used with a different payload`);
        route.recipients = expandAddresses(this.store, logicalTo, society).recipients;
        const plan = { kind: operationKind, message: messagePlanFrom(eml, route.recipients) };
        const accepted = tx.acceptOperation({ id: opId, actor: auth.actor, requestKey: key, requestHash: newHash,
          kind: operationKind, payloadJson: JSON.stringify(requestParams), planJson: encodeOperationPlan(plan) });
        if (accepted === "inserted") tx.insertDeliveries(route.recipients.map(recipient => ({ messageId, recipient, operationId: opId })));
        return accepted;
      });
    } catch (error) { scope.settleFailure(error); }
    scope.settle();
    if (txClaim === "retry") return receiptOf(this.store.retriedOperation(auth.actor, key));
    // From here the intent is accepted: a failure is reported as accepted, never as a refusal.
    try {
      const result = { kind: operationKind, message: messageId, recipientCount: route.recipients.length, archivePath: this.archivePath(messageId) };
      let materializedAll = true;
      try { await this.materialize(opId); }
      catch (error) { if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error; materializedAll = false; }
      if (materializedAll) this.store.transaction(tx => tx.setOperationSucceeded(opId, JSON.stringify(result)));
      const finalOp = this.store.getOperation(auth.actor, key);
      if (!finalOp) throw new StoreError("STORE_CORRUPT", "accepted mail operation missing");
      return receiptOf(finalOp);
    } catch (error) { throw acceptedFailure(error); }
  }
  /** MAIL-005: a caller-selected operation is not yet evidence of message ownership.
   * Store decoding and accepted-byte validation retain their corruption semantics. */
  private replyHeaders(id: MessageId): ParsedEmlHeaders {
    const parsed = parseMessageId(id);
    const operation = parsed && this.store.getOperationById(parsed.operationId);
    if (!operation) throw new StoreError("INVALID_REQUEST", "reply target is not accepted");
    const owned = ownedMessages(operation.plan);
    if (owned.length === 0) throw new StoreError("INVALID_REQUEST", "reply target owns no message");
    const message = owned.find(candidate => candidate.id === id);
    if (message === undefined) throw new StoreError("INVALID_REQUEST", "reply target message is unknown");
    return this.materializer.headers(message);
  }
  async freezeCreateInitial(auth: AuthContext, operationId: string, recipient: Actor, brief: string): Promise<{ message: MessagePlan; artifact: PreacceptArtifactOwner }> {
    const messageId = generateMessageId(operationId, 0);
    const eml = await buildFrozenMessage({ id: messageId, sender: auth.actor, society: this.paths.society,
      to: [recipient], kind: "message", contextRevision: null,
      replyHeaders: { replyTo: [auth.actor], inReplyTo: null, references: [] },
    }, { subject: "initial brief", body: brief });
    const artifact = this.freezeObject(messageId, eml);
    return { message: messagePlanFrom(eml, [recipient]), artifact };
  }
  /** Git supplies notification content; Mail owns logical/RFC facts and frozen bytes. */
  async freezeNotification(id: MessageId, sender: Actor, input: MailNotificationDraft): Promise<{ message: MessagePlan; artifact: PreacceptArtifactOwner }> {
    // Submit has always validated routing before MIME work. Context broadcasts
    // to the fixed residents list and snapshots its recipients only in T.
    if (input.kind === "result") this.recipients(input.to);
    const eml = await buildFrozenMessage({ id, sender, society: this.paths.society,
      to: [...input.to], kind: input.kind, contextRevision: input.contextRevision,
      replyHeaders: { replyTo: input.kind === "context" ? ["residents"] : defaultLogicalReplyTo(sender, input.to),
        inReplyTo: null, references: [] } }, { subject: input.subject, body: input.body });
    return { message: messagePlanFrom(eml, []), artifact: this.freezeObject(id, eml) };
  }
  recipients(to: readonly Address[]): Actor[] {
    return expandAddresses(this.store, to, this.paths.society).recipients;
  }
  frozenDisposition(id: OperationId, message: { readonly id: MessageId; readonly sha256: string }):
      "unaccepted-known" | "accepted-referenced" | "accepted-unreferenced" {
    return frozenMessageDisposition(this.store, id, message);
  }
  /** The frozen object is owned by nobody until the operation naming it is
   * accepted; the caller registers the artifact in its own PreacceptScope. */
  async freezeReviewMessage(operationId: OperationId, ordinal: number, sender: Actor,
      input: ReviewEmission): Promise<{ message: MessagePlan; artifact: PreacceptArtifactOwner }> {
    const messageId = generateMessageId(operationId, ordinal);
    const ancestry = [...input.replyHeaders.references];
    const references = ancestry.slice(-this.maxReplyReferences);
    if (ancestry.length > this.maxReplyReferences) references[0] = ancestry[0]!;
    const eml = await buildFrozenMessage({ id: messageId, sender, society: this.paths.society, to: [...input.to],
      kind: input.kind, contextRevision: null,
      replyHeaders: { replyTo: [...input.replyHeaders.replyTo], inReplyTo: input.replyHeaders.inReplyTo, references },
      ...(input.approvalFor === undefined ? {} : { approvalFor: input.approvalFor }) },
      { subject: input.subject, body: input.body });
    const artifact = this.freezeObject(messageId, eml);
    return { message: { ...messagePlanFrom(eml, []),
      ...(input.audience === undefined ? {} : { audience: input.audience }), review: input.review }, artifact };
  }
  publishCreateInitial(message: MessagePlan): void {
    this.effects.readMessage(message);
  }
  /** The published object is owned by nobody until the acceptance transaction
   * that names it commits. The caller settles the returned artifact on every
   * exit from that window. Until this returns, the object is this call's: a
   * failure after its own link removes exactly the inode it linked, and the
   * first failure stays first. */
  freezeObject(messageId: MessageId, eml: { text: string; sha256?: string }): PreacceptArtifactOwner {
    return this.effects.freezeMailObject(messageId, eml.text, eml.sha256 ?? sha256Hex(eml.text));
  }
  async publishGated(operationId: string, proof?: PublicationEvidence): Promise<void> { this.materializer.gated(operationId, proof); }
  async materialize(operationId: string): Promise<void> { this.materializer.ordinary(operationId); }
  prepare(auth: AuthContext): Promise<PreparedBatch | null> { return this.batches.prepare(auth); }
  complete(auth: AuthContext, evidence: BoundaryEvidence): Promise<void> { return this.batches.complete(auth, evidence); }
  settleFromReceipt(quiescence: SettlementQuiescence, batchId: string): SettlementOutcome { return this.batches.settleFromReceipt(quiescence, batchId); }
  moveToCur(agent: Actor, ids: readonly MessageId[]): number { return this.batches.moveToCur(agent, ids); }
  reconcilePending(): Promise<RecoveryCounts> { return reconcileOrdinaryMail(this.store, this, this.effects); }
  reconcileOperation(id: OperationId): Promise<void> { return reconcileMailOperation(this.store, this, id, this.effects); }
}
