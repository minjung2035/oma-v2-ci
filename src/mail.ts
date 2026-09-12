// MUST [MAIL-001..010]: acceptance orchestration; publication proof belongs to the materializer.
import { mkdirSync, existsSync, readFileSync, unlinkSync, renameSync, lstatSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Actor, Address, Json, MailInput, MessageId, MessagePlan, RequestKey, AuthContext, PreparedBatch, BoundaryEvidence, Receipt } from "../implementation/contracts.js";
import { Store, type DeliveryRow } from "./store.js";
import { StoreError } from "./domain/errors.js";
import { receiptOfOperation as receiptOf } from "./protocol/receipts.js";
export { receiptOfOperation as receiptOf } from "./protocol/receipts.js";
import { assertCurrentActor } from "./authority.js";
import { generateMessageId, generateOperationId, generateBatchId, parseMessageId } from "./ids.js";
import { mailObjectFileName, mailArchiveDisplayPath, contextRevisionDisplayPath } from "./domain/derived.js";
import { mailObjectPathAt, mailArchivePathAt, mailInboxPathAt } from "./storage/paths.js";
import { sha256Hex, requestHash, canonicalRequestParams } from "./hash.js";
import { fsyncDir, writeExclusiveFsyncedFile as writeFsynced } from "./storage/durable-fs.js";
import { publishImmutableFile } from "./storage/immutable-file.js";
import { publishBatchView } from "./storage/batch-view.js";
import { buildFrozenMessage } from "./mail/serialize.js";
import { defaultLogicalReplyTo, messagePlanFrom } from "./mail/facts.js";
import { actorAddress, listAddress, topicAddress, parseDisplayedAddress } from "./mail/addresses.js";
import type { ParsedEmlHeaders } from "./mail/headers.js";
import { MailMaterializer, operationMessage, type PublicationEvidence } from "./mail/materializer.js";
import { selectBatch } from "./mail/batch-policy.js";
export { fsyncDir, replaceDerivedFile as writeAtomic } from "./storage/durable-fs.js";
export { publishImmutableFile } from "./storage/immutable-file.js";
export { publishBatchView } from "./storage/batch-view.js";
export { buildEml } from "./mail/serialize.js";
export type { EmlParams } from "./mail/serialize.js";
export { parseEmlHeaders, rfc5322Date } from "./mail/headers.js";
export type { ParsedEmlHeaders } from "./mail/headers.js";
export { actorAddress, listAddress, topicAddress, displayAddress, defaultReplyTo } from "./mail/addresses.js";
export { defaultLogicalReplyTo } from "./mail/facts.js";

export interface RouteResult { recipients: Actor[]; displayTo: string[] }
export function expandAddresses(store: Store, to: readonly Address[], society: string): RouteResult {
  const agents = new Map(store.listAgents().map(agent => [agent.name, agent]));
  const recipients = new Set<string>(); const display = new Set<string>();
  for (const address of to) {
    if (address === "principal") {
      if (!agents.has("principal")) throw new StoreError("ADDRESS_NOT_FOUND", "principal identity not created");
      recipients.add("principal"); display.add(listAddress("principal", society)); continue;
    }
    if (address === "commons" || address === "residents") {
      for (const [name, agent] of agents) if (agent.role === "resident" && agent.desired !== "provisioning" && agent.desired !== "retired") recipients.add(name);
      display.add(listAddress(address, society)); continue;
    }
    if (address.startsWith("topic/")) {
      const topic = address.slice(6);
      for (const sub of store.subscribers(topic)) {
        const agent = agents.get(sub);
        if (agent && agent.role === "resident" && agent.desired !== "provisioning" && agent.desired !== "retired") recipients.add(sub);
      }
      display.add(topicAddress(topic, society)); continue;
    }
    const agent = agents.get(address);
    if (!agent) throw new StoreError("ADDRESS_NOT_FOUND", `unknown address "${address}"`);
    if (agent.desired === "provisioning") throw new StoreError("AGENT_NOT_READY", `${address} is provisioning`);
    if (agent.desired === "retired") throw new StoreError("AGENT_RETIRED", `${address} is retired`);
    recipients.add(address); display.add(actorAddress(address, society));
  }
  return { recipients: [...recipients].sort(), displayTo: [...display] };
}
function logicalReplyAddress(store: Store, value: string, society: string): Address | null {
  return parseDisplayedAddress(value, society, new Set(store.listAgents().map(agent => agent.name)));
}
export interface MailSociety { stateRoot: string; society: string }
export class MailModule {
  private readonly materializer: MailMaterializer;
  constructor(private readonly paths: MailSociety, private readonly store: Store, private readonly maxReplyReferences: number, private readonly batchMaxMessages = 24) {
    this.store.bindRepositoryIdentity({ society: paths.society });
    this.materializer = new MailMaterializer(store, paths.stateRoot, paths.society);
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
    if (input.replyToMessage) {
      const parsed = parseMessageId(input.replyToMessage);
      const operation = parsed && this.store.getOperationById(parsed.operationId);
      if (!operation) throw new StoreError("INVALID_REQUEST", `reply target ${input.replyToMessage} is not accepted`);
      const message = operationMessage(operation);
      if (message.id !== input.replyToMessage) throw new StoreError("INVALID_REQUEST", `reply target ${input.replyToMessage} unknown`);
      parent = this.materializer.headers(message);
    }
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
    const staging = join(this.paths.stateRoot, "staging", `send-${key}`); mkdirSync(staging, { recursive: true });
    const staged = join(staging, mailObjectFileName(messageId)); writeFsynced(staged, eml.text);
    try { publishImmutableFile(staged, this.objectPath(messageId), eml.sha256); }
    finally { rmSync(staged, { force: true }); fsyncDir(staging); }
    const txClaim = this.store.transaction(tx => {
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
    });
    if (txClaim === "retry") return receiptOf(this.store.getOperation(auth.actor, key)!);
    const result = { kind: operationKind, message: messageId, recipientCount: route.recipients.length, archivePath: this.archivePath(messageId) };
    let materializedAll = true;
    try { await this.materialize(opId); }
    catch (error) { if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error; materializedAll = false; }
    if (materializedAll) this.store.transaction(tx => tx.setOperationSucceeded(opId, JSON.stringify(result)));
    const finalOp = this.store.getOperation(auth.actor, key);
    if (!finalOp) throw new StoreError("STORE_CORRUPT", "accepted mail operation missing");
    return receiptOf(finalOp);
  }
  async freezeCreateInitial(auth: AuthContext, operationId: string, recipient: Actor, brief: string): Promise<MessagePlan> {
    const messageId = generateMessageId(operationId, 0);
    const eml = await buildFrozenMessage({ id: messageId, sender: auth.actor, society: this.paths.society,
      to: [recipient], kind: "message", contextRevision: null,
      replyHeaders: { replyTo: [auth.actor], inReplyTo: null, references: [] },
    }, { subject: "initial brief", body: brief });
    this.freezeObject(messageId, eml);
    return messagePlanFrom(eml, [recipient]);
  }
  publishCreateInitial(message: MessagePlan): void {
    const object = this.objectPath(message.id); const stat = lstatSync(object, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size !== message.bytes || sha256Hex(readFileSync(object)) !== message.sha256)
      throw new StoreError("STORE_CORRUPT", `create initial object mismatch: ${message.id}`);
  }
  freezeObject(messageId: MessageId, eml: { text: string; sha256?: string }): void {
    const stagingDir = join(this.paths.stateRoot, "staging", "mail-objects"); mkdirSync(stagingDir, { recursive: true });
    const staged = join(stagingDir, `${messageId}.${generateOperationId()}.tmp`);
    writeFsynced(staged, eml.text);
    try { publishImmutableFile(staged, this.objectPath(messageId), eml.sha256 ?? sha256Hex(eml.text)); }
    finally { rmSync(staged, { force: true }); fsyncDir(stagingDir); }
  }
  async publishGated(operationId: string, proof?: PublicationEvidence): Promise<void> {
    this.materializer.gated(operationId, proof);
  }
  async materialize(operationId: string): Promise<void> { this.materializer.ordinary(operationId); }
  private selectBatch(pending: DeliveryRow[]): DeliveryRow[] {
    return selectBatch(pending.map(value => ({ value, publicList: this.isPublicList(value) })), this.batchMaxMessages);
  }
  private isPublicList(delivery: DeliveryRow): boolean {
    const message = this.messagePlan(delivery);
    return message.kind === "message" && message.to.length > 0 && message.to.every(to => to === "commons" || to === "residents" || to.startsWith("topic/"));
  }
  private messagePlan(delivery: DeliveryRow): MessagePlan {
    const operation = this.store.getOperationById(delivery.operationId);
    if (!operation) throw new StoreError("STORE_CORRUPT", `missing operation ${delivery.operationId}`);
    const message = operationMessage(operation);
    if (message.id !== delivery.messageId || !message.recipients.includes(delivery.recipient))
      throw new StoreError("STORE_CORRUPT", `message plan mismatch for ${delivery.messageId}`);
    return message;
  }
  private noticeFor(agent: Actor, ids: readonly MessageId[]): string {
    const lines: string[] = [];
    for (const [index, id] of ids.slice(0, 6).entries()) {
      const delivery = this.store.getDelivery(id, agent);
      if (!delivery) throw new StoreError("STORE_CORRUPT", `missing delivery ${id}/${agent}`);
      const message = this.messagePlan(delivery); const headers = this.materializer.headers(message);
      const reply = headers.inReplyTo ?? headers.references.at(-1) ?? null;
      const context = message.contextRevision ? ` context=${contextRevisionDisplayPath(message.contextRevision)}${message.kind === "context" ? "/GOAL.md" : ""}` : "";
      lines.push(`${index + 1}. sender=${oneLine(headers.from)} subject=${oneLine(headers.subject)} kind=${message.kind} path=${mailArchiveDisplayPath(id)}${reply ? ` reply=${reply}` : ""}${context}`);
    }
    if (ids.length > 6) lines.push(`… +${ids.length - 6} more`);
    lines.push("전체 목록: /inbox.md"); return lines.join("\n");
  }
  private finishPrepared(batch: PreparedBatch): PreparedBatch {
    this.moveToCur(batch.agent, batch.messageIds); publishBatchView(this.paths.stateRoot, batch); return batch;
  }
  async prepare(auth: AuthContext): Promise<PreparedBatch | null> {
    const existing = this.store.preparedBatches(auth.actor);
    if (existing.length > 0) {
      const row = existing[0]!; const messageIds = parseJsonList(row.messageIdsJson, `batch ${row.id}`) as MessageId[];
      return this.finishPrepared(batchOf({ id: row.id, incarnation: row.incarnation, messageIds, sessionPath: row.sessionPath }, auth.actor, this.noticeFor(auth.actor, messageIds)));
    }
    const pending = this.selectBatch(this.store.pendingDeliveries(auth.actor)); if (pending.length === 0) return null;
    const batch = { id: generateBatchId(), agent: auth.actor, incarnation: auth.incarnation, messageIds: pending.map(delivery => delivery.messageId), sessionPath: null };
    const notice = this.noticeFor(auth.actor, batch.messageIds);
    try { this.store.transaction(tx => { tx.insertPreparedBatch(batch); tx.linkDeliveriesToBatch(batch.id, batch.messageIds); }); }
    catch (error) { if (error instanceof StoreError && error.code === "BATCH_CONFLICT") return null; throw error; }
    return this.finishPrepared(batchOf(batch, auth.actor, notice));
  }
  async complete(auth: AuthContext, evidence: BoundaryEvidence): Promise<void> {
    const batch = this.store.getBatch(evidence.batchId);
    if (!batch) throw new StoreError("BATCH_CONFLICT", `unknown batch ${evidence.batchId}`);
    if (batch.agent !== auth.actor || auth.incarnation !== evidence.incarnation || batch.incarnation !== evidence.incarnation)
      throw new StoreError("BATCH_CONFLICT", "batch ownership mismatch");
    throw new StoreError("SPIKE_UNRESOLVED", "S-03 trusted Pi session-boundary evidence is not implemented");
  }
  async reconcilePending(): Promise<{ examined: number; repaired: number; remaining: number }> {
    const ids = this.store.recoverableOperations(); let repaired = 0; let remaining = 0;
    for (const id of ids) {
      const operation = this.store.getOperationById(id); if (!operation) continue;
      if (operation.kind !== "mail.send" && operation.kind !== "agent.continue") { remaining++; continue; }
      const message = operation.plan.message;
      if (!existsSync(this.objectPath(message.id))) throw new StoreError("STORE_CORRUPT", `object missing for ${message.id}`);
      try {
        await this.materialize(id); const fresh = this.store.deliveriesForOperation(id); const archiveDone = existsSync(this.archivePath(message.id));
        const allDone = fresh.length === 0 ? archiveDone : fresh.every(delivery => delivery.materialized === 1) && archiveDone;
        if (allDone) {
          const result = { kind: operation.kind, message: message.id, recipientCount: fresh.length, archivePath: this.archivePath(message.id) };
          this.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify(result))); repaired++;
        } else remaining++;
      } catch (error) { if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error; remaining++; }
    }
    return { examined: ids.length, repaired, remaining };
  }
  moveToCur(agent: Actor, messageIds: readonly MessageId[]): number {
    let count = 0;
    for (const id of messageIds) {
      const from = this.inboxNewPath(agent, id); const to = this.inboxCurPath(agent, id); const delivery = this.store.getDelivery(id, agent);
      if (!delivery) throw new StoreError("STORE_CORRUPT", `missing delivery ${id}/${agent}`);
      const message = this.messagePlan(delivery); const object = this.objectPath(id);
      for (const path of [object, from, to]) {
        const stat = lstatSync(path, { throwIfNoEntry: false }); if (path !== object && !stat) continue;
        if (!stat?.isFile() || sha256Hex(readFileSync(path)) !== message.sha256) throw new StoreError("STORE_CORRUPT", `mail integrity mismatch: ${path}`);
      }
      if (existsSync(from)) {
        mkdirSync(dirname(to), { recursive: true }); if (existsSync(to)) unlinkSync(from); else renameSync(from, to); count++;
      } else if (!existsSync(to)) throw new StoreError("STORE_CORRUPT", `missing mailbox delivery ${id}/${agent}`);
      fsyncDir(dirname(from)); fsyncDir(dirname(to));
    }
    return count;
  }
}
function parseJsonList(json: string, what: string): string[] {
  try { const value = JSON.parse(json); if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("not a string list"); return value as string[]; }
  catch (error) { throw new StoreError("STORE_CORRUPT", `${what} has corrupt JSON: ${(error as Error).message}`); }
}
function oneLine(value: string | null): string { return (value ?? "").replace(/\s+/g, " ").trim(); }
export function batchOf(batch: { id: string; incarnation: number; messageIds: string[]; sessionPath: string | null }, agent: Actor, notice = batchNotice(batch.messageIds)): PreparedBatch {
  return { id: batch.id as PreparedBatch["id"], agent, incarnation: batch.incarnation, messageIds: batch.messageIds as PreparedBatch["messageIds"], sessionPath: batch.sessionPath, deliveryMode: "followUp", notice, indexPath: "/inbox.md" };
}
export function batchNotice(ids: readonly string[]): string {
  const lines = ids.slice(0, 6).map((id, index) => `${index + 1}. mail ${id}`); if (ids.length > 6) lines.push(`… +${ids.length - 6} more`);
  lines.push("전체 목록: /inbox.md"); return lines.join("\n");
}
