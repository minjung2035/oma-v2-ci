// MAIL-001..010: acceptance orchestration; publication and batch views have explicit owners.
import { ownedMessages } from "./durable.js";
import type { LegacyAttestationInput } from "../implementation/contracts/attestation.js";
import { canonicalJson } from "./domain/canonical-json.js";
import { ensureDirectory, removeOwnedFile } from "./storage/directory.js";
import { join } from "node:path";
import type { Actor, Address, Json, MailInput, MessageId, MessagePlan, RequestKey, AuthContext, PreparedBatch, BoundaryEvidence, Receipt } from "../implementation/contracts.js";
import { Store } from "./store.js";
import { StoreError, acceptedFailure } from "./domain/errors.js";
import { receiptOfOperation as receiptOf } from "./storage/receipt-projector.js";
export { receiptOfOperation as receiptOf } from "./storage/receipt-projector.js";
import { assertCurrentActor } from "./authority.js";
import { generateMessageId, generateOperationId, parseMessageId } from "./ids.js";
import { mailObjectPathAt, mailArchivePathAt, mailWorkersPathAt, mailInboxPathAt } from "./storage/paths.js";
import { sha256Hex, requestHash, canonicalRequestParams } from "./hash.js";
import { fsyncDir, writeExclusiveFsyncedFile as writeFsynced } from "./storage/durable-fs.js";
import { publishImmutableFile, readImmutableBytes } from "./storage/immutable-file.js";
import { PreacceptArtifact, PreacceptScope, type PublishedIdentity } from "./storage/preaccept-artifact.js";
import { buildFrozenMessage } from "./mail/serialize.js";
import { defaultLogicalReplyTo, messagePlanFrom } from "./mail/facts.js";
import { expandAddresses, logicalReplyAddress } from "./mail/routing.js";
import type { ParsedEmlHeaders } from "./mail/headers.js";
import { MailMaterializer, frozenMessageDisposition, type PublicationEvidence } from "./mail/materializer.js";
import { BatchCoordinator, type SettlementOutcome, type SettlementQuiescence } from "./mail/batches.js";
import { reconcileOrdinaryMail, type RecoveryCounts } from "./mail/reconcile.js";
import type { BatchViewLimits } from "./protocol/batch-view.js";
export { expandAddresses } from "./mail/routing.js";
export type { RouteResult } from "./mail/routing.js";
export { batchOf, batchNotice } from "./mail/batches.js";
export { fsyncDir, replaceDerivedFile as writeAtomic } from "./storage/durable-fs.js";
export { publishImmutableFile } from "./storage/immutable-file.js";
export { PreacceptArtifact, publishedArtifact } from "./storage/preaccept-artifact.js";
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
  recordAttestation(auth: AuthContext, key: RequestKey, fact: LegacyAttestationInput, observeAuthority: () => void,
    accept: () => void): Promise<Receipt> {
    return this.sendOwned(auth, key, { to: ["commons"], kind: "result", subject: `Attestation: ${fact.kind}`,
      body: canonicalJson(fact) }, { kind: "attest.record", params: fact, fact, observeAuthority, accept });
  }
  private async sendOwned(auth: AuthContext, key: RequestKey, input: MailInput,
    requestContext?: { kind: "mail.send" | "agent.continue"; params: Json } |
      { kind: "attest.record"; params: LegacyAttestationInput; fact: LegacyAttestationInput; observeAuthority: () => void; accept: () => void }): Promise<Receipt> {
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
    // The frozen object is owned by nobody until the plan that names it is
    // accepted; one settlement decides it and reports a refusal first.
    const scope: PreacceptScope = new PreacceptScope();
    let txClaim: "inserted" | "retry";
    try {
      const artifact = this.freezeObject(messageId, eml);
      scope.register({ operationId: opId, resource: artifact.path, owner: artifact,
        observe: () => frozenMessageDisposition(this.store, opId, { id: messageId, sha256: eml.sha256 }) });
      if (requestContext?.kind === "attest.record") requestContext.observeAuthority();
      txClaim = this.store.transaction(tx => {
        assertCurrentActor(this.store, auth, "mail.send");
        const current = this.store.claimKey(auth.actor, key, newHash);
        if (current === "retry") return "retry" as const;
        if (current === "reused") throw new StoreError("REQUEST_KEY_REUSED", `request key ${key} already used with a different payload`);
        route.recipients = expandAddresses(this.store, logicalTo, society).recipients;
        if (requestContext?.kind === "attest.record") requestContext.accept();
        const plan = { kind: operationKind, message: messagePlanFrom(eml, route.recipients),
          ...(requestContext?.kind === "attest.record" ? { fact: requestContext.fact } : {}) };
        const accepted = tx.acceptOperation({ id: opId, actor: auth.actor, requestKey: key, requestHash: newHash,
          kind: operationKind, payloadJson: JSON.stringify(requestParams), planJson: JSON.stringify(plan) });
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
  async freezeIntegration(auth: AuthContext, operationId: string, body: string): Promise<{ message: MessagePlan; artifact: PreacceptArtifact }> {
    const messageId = generateMessageId(operationId, 0);
    const eml = await buildFrozenMessage({ id: messageId, sender: auth.actor, society: this.paths.society,
      to: ["commons"], kind: "result", contextRevision: null,
      replyHeaders: { replyTo: ["commons"], inReplyTo: null, references: [] },
    }, { subject: "Canonical integration", body });
    const artifact = this.freezeObject(messageId, eml);
    // Acceptance refreshes recipients synchronously after all preparation.
    return { message: messagePlanFrom(eml, []), artifact };
  }
  integrationRecipients(): string[] { return expandAddresses(this.store, ["commons"], this.paths.society).recipients; }
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
   * exit from that window. Until this returns, the object is this call's: a
   * failure after its own link removes exactly the inode it linked, and the
   * first failure stays first. */
  freezeObject(messageId: MessageId, eml: { text: string; sha256?: string }): PreacceptArtifact {
    const stagingDir = join(this.paths.stateRoot, "staging", "mail-objects"); ensureDirectory(stagingDir);
    const staged = join(stagingDir, `${messageId}.${generateOperationId()}.tmp`);
    writeFsynced(staged, eml.text);
    const destination = this.objectPath(messageId);
    let linked: PublishedIdentity | null = null;
    const failures: unknown[] = [];
    try { publishImmutableFile(staged, destination, eml.sha256 ?? sha256Hex(eml.text), undefined, identity => { linked = identity; }); }
    catch (error) { failures.push(error); }
    try { removeOwnedFile(staged); } catch (error) { failures.push(error); }
    // An existing destination this call did not link is not its object.
    const artifact = new PreacceptArtifact(destination, linked, linked === null);
    if (failures.length === 0) return artifact;
    try { artifact.discardUnaccepted(); } catch (error) { failures.push(error); }
    throw failures.length > 1 ? new AggregateError(failures, "mail object freeze and owned cleanup failed") : failures[0];
  }
  async publishGated(operationId: string, proof?: PublicationEvidence): Promise<void> { this.materializer.gated(operationId, proof); }
  async materialize(operationId: string): Promise<void> { this.materializer.ordinary(operationId); }
  prepare(auth: AuthContext): Promise<PreparedBatch | null> { return this.batches.prepare(auth); }
  complete(auth: AuthContext, evidence: BoundaryEvidence): Promise<void> { return this.batches.complete(auth, evidence); }
  settleFromReceipt(quiescence: SettlementQuiescence, batchId: string): SettlementOutcome { return this.batches.settleFromReceipt(quiescence, batchId); }
  moveToCur(agent: Actor, ids: readonly MessageId[]): number { return this.batches.moveToCur(agent, ids); }
  reconcilePending(): Promise<RecoveryCounts> { return reconcileOrdinaryMail(this.store, this); }
}
