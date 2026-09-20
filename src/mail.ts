// MAIL-001..010: acceptance orchestration; publication and batch views have explicit owners.
import { ensureDirectory, removeOwnedFile } from "./storage/directory.js";
import { join } from "node:path";
import type { Actor, Address, Json, MailInput, MessageId, MessagePlan, RequestKey, AuthContext, PreparedBatch, BoundaryEvidence, Receipt } from "../implementation/contracts.js";
import { Store } from "./store.js";
import { StoreError } from "./domain/errors.js";
import { receiptOfOperation as receiptOf } from "./storage/receipt-projector.js";
export { receiptOfOperation as receiptOf } from "./storage/receipt-projector.js";
import { assertCurrentActor } from "./authority.js";
import { generateMessageId, generateOperationId, parseMessageId } from "./ids.js";
import { mailObjectPathAt, mailArchivePathAt, mailInboxPathAt } from "./storage/paths.js";
import { sha256Hex, requestHash, canonicalRequestParams } from "./hash.js";
import { fsyncDir, writeExclusiveFsyncedFile as writeFsynced } from "./storage/durable-fs.js";
import { publishImmutableFile, readImmutableBytes } from "./storage/immutable-file.js";
import { publishedArtifact, settleByAcceptance, type PreacceptArtifact, type PreacceptOwner } from "./storage/preaccept-artifact.js";
import { buildFrozenMessage } from "./mail/serialize.js";
import { defaultLogicalReplyTo, messagePlanFrom } from "./mail/facts.js";
import { expandAddresses, logicalReplyAddress } from "./mail/routing.js";
import type { ParsedEmlHeaders } from "./mail/headers.js";
import { MailMaterializer, operationMessage, type PublicationEvidence } from "./mail/materializer.js";
import { BatchCoordinator } from "./mail/batches.js";
import { reconcileOrdinaryMail, type RecoveryCounts } from "./mail/reconcile.js";
import type { BatchViewLimits } from "./protocol/batch-view.js";
export { expandAddresses } from "./mail/routing.js";
export type { RouteResult } from "./mail/routing.js";
export { batchOf, batchNotice } from "./mail/batches.js";
export { fsyncDir, replaceDerivedFile as writeAtomic } from "./storage/durable-fs.js";
export { publishImmutableFile } from "./storage/immutable-file.js";
export { PreacceptArtifact, publishedArtifact, settleByAcceptance } from "./storage/preaccept-artifact.js";
export type { PreacceptOwner } from "./storage/preaccept-artifact.js";
export { publishBatchView } from "./storage/batch-view.js";
export { buildEml } from "./mail/serialize.js";
export type { EmlParams } from "./mail/serialize.js";
export { parseEmlHeaders, rfc5322Date } from "./mail/headers.js";
export type { ParsedEmlHeaders } from "./mail/headers.js";
export { actorAddress, listAddress, topicAddress, displayAddress, defaultReplyTo } from "./mail/addresses.js";
export { defaultLogicalReplyTo } from "./mail/facts.js";

export interface MailSociety { stateRoot: string; society: string }
export class MailModule {
  private readonly materializer: MailMaterializer;
  private readonly batches: BatchCoordinator;
  constructor(private readonly paths: MailSociety, private readonly store: Store, private readonly maxReplyReferences: number,
    batchMaxMessages = 24, viewLimits?: BatchViewLimits) {
    this.store.bindRepositoryIdentity({ society: paths.society });
    this.materializer = new MailMaterializer(store, paths.stateRoot, paths.society);
    this.batches = new BatchCoordinator(store, paths.stateRoot, this.materializer, batchMaxMessages, viewLimits);
  }
  objectPath(id: MessageId): string { return mailObjectPathAt(this.paths.stateRoot, id); }
  archivePath(id: MessageId): string { return mailArchivePathAt(this.paths.stateRoot, id); }
  inboxNewPath(actor: Actor, id: MessageId): string { return mailInboxPathAt(this.paths.stateRoot, actor, id, "new"); }
  inboxCurPath(actor: Actor, id: MessageId): string { return mailInboxPathAt(this.paths.stateRoot, actor, id, "cur"); }
  async send(auth: AuthContext, key: RequestKey, input: MailInput, requestContext?: { kind: "mail.send" | "agent.continue"; params: Json }): Promise<Receipt> {
    const operationKind = requestContext?.kind ?? "mail.send";
    const requestParams = requestContext?.params ?? input as unknown as Json;
    const society = this.paths.society;
    const newHash = requestHash(operationKind, canonicalRequestParams(operationKind, requestParams));
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry") return receiptOf(this.store.getOperation(auth.actor, key)!);
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
    const opId = generateOperationId(); const messageId = generateMessageId(opId, 0);
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
    const artifact = this.freezeObject(messageId, eml);
    let txClaim: "inserted" | "retry";
    try { txClaim = this.store.transaction(tx => {
      assertCurrentActor(this.store, auth, "mail.send");
      const current = this.store.claimKey(auth.actor, key, newHash);
      if (current === "retry") return "retry" as const;
      if (current === "reused") throw new StoreError("REQUEST_KEY_REUSED", `request key ${key} already used with a different payload`);
      route.recipients = expandAddresses(this.store, logicalTo, society).recipients;
      const plan = { kind: operationKind, message: messagePlanFrom(eml, route.recipients) };
      const accepted = tx.acceptOperation({ id: opId, actor: auth.actor, requestKey: key, requestHash: newHash,
        kind: operationKind, payloadJson: JSON.stringify(requestParams), planJson: JSON.stringify(plan) });
      if (accepted === "inserted") tx.insertDeliveries(route.recipients.map(recipient => ({ messageId, recipient, operationId: opId })));
      return accepted;
    }); } catch (error) { this.settlePreaccept(opId, [artifact]); throw error; }
    if (txClaim === "retry") {
      this.settlePreaccept(opId, [artifact]);
      return receiptOf(this.store.getOperation(auth.actor, key)!);
    }
    artifact.retainForOperation();
    const result = { kind: operationKind, message: messageId, recipientCount: route.recipients.length, archivePath: this.archivePath(messageId) };
    let materializedAll = true;
    try { await this.materialize(opId); }
    catch (error) { if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error; materializedAll = false; }
    if (materializedAll) this.store.transaction(tx => tx.setOperationSucceeded(opId, JSON.stringify(result)));
    const finalOp = this.store.getOperation(auth.actor, key);
    if (!finalOp) throw new StoreError("STORE_CORRUPT", "accepted mail operation missing");
    return receiptOf(finalOp);
  }
  /** MAIL-005: a caller-selected operation is not yet evidence of message ownership.
   * Store decoding and accepted-byte validation retain their corruption semantics. */
  private replyHeaders(id: MessageId): ParsedEmlHeaders {
    const parsed = parseMessageId(id);
    const operation = parsed && this.store.getOperationById(parsed.operationId);
    if (!operation) throw new StoreError("INVALID_REQUEST", "reply target is not accepted");
    switch (operation.kind) {
      case "mail.send": case "agent.continue": case "git.submit": case "context.publish": break;
      case "agent.create":
        if (operation.plan.initialMessage !== null) break;
        throw new StoreError("INVALID_REQUEST", "reply target owns no separate message");
      default: throw new StoreError("INVALID_REQUEST", "reply target owns no message");
    }
    const message = operationMessage(operation);
    if (message.id !== id) throw new StoreError("INVALID_REQUEST", "reply target message is unknown");
    return this.materializer.headers(message);
  }
  async freezeCreateInitial(auth: AuthContext, operationId: string, recipient: Actor, brief: string): Promise<{ message: MessagePlan; artifact: PreacceptArtifact }> {
    const messageId = generateMessageId(operationId, 0);
    const eml = await buildFrozenMessage({ id: messageId, sender: auth.actor, society: this.paths.society,
      to: [recipient], kind: "message", contextRevision: null,
      replyHeaders: { replyTo: [auth.actor], inReplyTo: null, references: [] },
    }, { subject: "initial brief", body: brief });
    const artifact = this.freezeObject(messageId, eml);
    return { message: messagePlanFrom(eml, [recipient]), artifact };
  }
  publishCreateInitial(message: MessagePlan): void {
    readImmutableBytes(this.objectPath(message.id), message.sha256, message.bytes);
  }
  /** The published object is owned by nobody until the acceptance transaction
   * that names it commits. The caller settles the returned artifact on every
   * exit from that window. */
  freezeObject(messageId: MessageId, eml: { text: string; sha256?: string }): PreacceptArtifact {
    const stagingDir = join(this.paths.stateRoot, "staging", "mail-objects"); ensureDirectory(stagingDir);
    const staged = join(stagingDir, `${messageId}.${generateOperationId()}.tmp`);
    writeFsynced(staged, eml.text);
    const destination = this.objectPath(messageId);
    try { publishImmutableFile(staged, destination, eml.sha256 ?? sha256Hex(eml.text)); }
    finally { removeOwnedFile(staged); }
    return publishedArtifact(destination);
  }
  /** Settles pre-accept owners against this journal: the operation that would
   * name them either exists or nothing owns them. */
  settlePreaccept(operationId: string, owners: readonly (PreacceptOwner | null)[]): void {
    settleByAcceptance(owners, () => this.store.getOperationById(operationId) !== null);
  }
  async publishGated(operationId: string, proof?: PublicationEvidence): Promise<void> { this.materializer.gated(operationId, proof); }
  async materialize(operationId: string): Promise<void> { this.materializer.ordinary(operationId); }
  prepare(auth: AuthContext): Promise<PreparedBatch | null> { return this.batches.prepare(auth); }
  complete(auth: AuthContext, evidence: BoundaryEvidence): Promise<void> { return this.batches.complete(auth, evidence); }
  moveToCur(agent: Actor, ids: readonly MessageId[]): number { return this.batches.moveToCur(agent, ids); }
  reconcilePending(): Promise<RecoveryCounts> { return reconcileOrdinaryMail(this.store, this); }
}
