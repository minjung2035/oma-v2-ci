// MUST [MAIL-001..010]: EML encoding, recipient expansion, materialization and batch handoff.
// Pinned nodemailer serialization remains unchanged; CR/LF is rejected before encoding.
import { mkdirSync, existsSync, readFileSync, unlinkSync, renameSync, lstatSync, rmSync } from "node:fs";
import { createTransport } from "nodemailer";
import { encodeWord } from "nodemailer/lib/mime-funcs";
import { join, dirname } from "node:path";
import type { Actor, Address, Json, MailInput, MessageId, MessagePlan, Oid, RequestKey, AuthContext, PreparedBatch, BoundaryEvidence, Receipt } from "../implementation/contracts.js";
import { Store, type DeliveryRow, type OperationRow } from "./store.js";
import { StoreError } from "./domain/errors.js";
import { receiptOfOperation as receiptOf } from "./protocol/receipts.js";
export { receiptOfOperation as receiptOf } from "./protocol/receipts.js";
import { assertCurrentActor } from "./authority.js";
import { generateMessageId, generateOperationId, generateBatchId, parseMessageId, isValidTopicName } from "./ids.js";
import { mailObjectFileName, mailObjectRelativePath, mailArchiveDisplayPath, contextRevisionDisplayPath } from "./domain/derived.js";
import { mailObjectPathAt, mailArchivePathAt, mailInboxPathAt, runnerViewPathAt, batchViewPathAt } from "./storage/paths.js";
import { sha256Hex, requestHash, canonicalRequestParams } from "./hash.js";
import { exactCandidateCheck } from "./validate.js";
import { fsyncDir, replaceDerivedFile as writeAtomic, writeExclusiveFsyncedFile as writeFsynced } from "./storage/durable-fs.js";
import { publishImmutableFile } from "./storage/immutable-file.js";
export { fsyncDir, replaceDerivedFile as writeAtomic } from "./storage/durable-fs.js";
export { publishImmutableFile } from "./storage/immutable-file.js";

export interface EmlParams {
  from: string; to: string[]; replyTo: string[]; subject: string; kind: MailInput["kind"];
  contextRevision: Oid | null; inReplyTo: MessageId | null; references: MessageId[];
  messageId: string; body: string; dateMs?: number; approvalFor?: MailInput["approvalFor"];
}
function assertNoCrlf(value: string, what: string): void {
  if (/[\r\n]/.test(value)) throw new StoreError("INVALID_REQUEST", `${what} contains CR/LF`);
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function rfc5322Date(ms: number): string {
  const d = new Date(ms); const pad = (n: number) => String(n).padStart(2, "0");
  return `${DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]!} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}
export async function buildEml(p: EmlParams): Promise<{ text: string; bytes: number; sha256: string; dateMs: number }> {
  if (p.approvalFor) { const error = exactCandidateCheck(p.approvalFor); if (error) throw new StoreError("INVALID_REQUEST", error); }
  assertNoCrlf(p.subject, "subject");
  for (const header of [p.from, ...p.to, ...p.replyTo, p.messageId, ...(p.inReplyTo ? [p.inReplyTo] : []), ...p.references]) assertNoCrlf(header, "header");
  const dateMs = p.dateMs ?? Math.floor(Date.now() / 1000) * 1000;
  if (!Number.isSafeInteger(dateMs) || dateMs < 0) throw new StoreError("INVALID_REQUEST", "dateMs must be a non-negative safe integer");
  const transporter = createTransport({ streamTransport: true, buffer: true, newline: "\r\n" });
  const info = await transporter.sendMail({
    from: p.from, to: p.to.join(", "), replyTo: p.replyTo.length > 0 ? p.replyTo.join(", ") : undefined,
    subject: p.subject, text: p.body, messageId: `<${p.messageId}>`,
    ...(p.inReplyTo ? { inReplyTo: `<${p.inReplyTo}>` } : {}),
    ...(p.references.length > 0 ? { references: p.references.map(reference => `<${reference}>`) } : {}),
    date: new Date(dateMs), headers: {
      "X-OMA-Kind": p.kind, ...(p.contextRevision ? { "X-OMA-Context": p.contextRevision } : {}),
      ...(p.approvalFor ? {
        "X-OMA-Approval-Repo": p.approvalFor.repo, "X-OMA-Approval-Target": p.approvalFor.targetRef,
        "X-OMA-Approval-Base": p.approvalFor.expectedBase, "X-OMA-Approval-Candidate": p.approvalFor.candidate,
        "X-OMA-Approval-Policy": encodeWord(p.approvalFor.policyRevision, "B"),
      } : {}),
    },
  });
  const raw = (info as unknown as { message: Buffer }).message;
  // Never rewrite complete serialized bytes: matching sequences may belong to the body.
  const text = raw.toString("utf8");
  return { text, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256Hex(text), dateMs };
}
export function actorAddress(actor: Actor, society: string): string { return `${actor}@${society}.oma.invalid`; }
export function listAddress(logical: "commons" | "residents" | "principal", society: string): string { return `${logical}@${society}.oma.invalid`; }
export function topicAddress(topic: string, society: string): string { return `topic-${topic}@${society}.oma.invalid`; }
export function displayAddress(address: Address, society: string): string {
  if (address === "principal" || address === "commons" || address === "residents") return listAddress(address, society);
  return address.startsWith("topic/") ? topicAddress(address.slice(6), society) : actorAddress(address, society);
}
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
export function defaultReplyTo(from: string, to: readonly string[]): string[] {
  const lists = to.filter(address => /^(commons|residents|topic-[a-z][a-z0-9-]*)@/.test(address));
  return [...new Set(lists.length ? lists : [from])];
}
export function defaultLogicalReplyTo(from: Address, to: readonly Address[]): Address[] {
  const lists = to.filter(address => address === "commons" || address === "residents" || address.startsWith("topic/"));
  return [...new Set(lists.length ? lists : [from])];
}
export function publishBatchView(stateRoot: string, batch: PreparedBatch): void {
  const runView = runnerViewPathAt(stateRoot, batch.agent);
  writeAtomic(batchViewPathAt(stateRoot, batch.agent, batch.id), JSON.stringify({ id: batch.id, agent: batch.agent, incarnation: batch.incarnation, deliveryMode: batch.deliveryMode, notice: batch.notice, messageIds: batch.messageIds }));
  const lines = [`# inbox — ${batch.agent}`, "", `안내 batch ${batch.id} (incarnation ${batch.incarnation})`, "", ...batch.messageIds.map((id, index) => `${index + 1}. ${id}\t${mailArchiveDisplayPath(id)}`), "", "읽기: cat <위 archive path>"];
  writeAtomic(join(runView, "inbox.md"), `${lines.join("\n")}\n`, 0o444);
}
export interface ParsedEmlHeaders {
  from: string | null; to: string[] | null; subject: string | null; dateMs: number | null;
  messageId: MessageId | null; inReplyTo: MessageId | null; references: MessageId[];
  replyTo: string[] | null; omaKind: string | null; omaContext: string | null;
  approvalFor: { repo: string | null; targetRef: string | null; expectedBase: string | null; candidate: string | null; policyRevision: string | null } | null;
}
function decodeUtf8Base64Words(value: string): string {
  const unfolded = value.replace(/\n/g, " "); const pattern = /=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi;
  let output = ""; let last = 0; let previousEncoded = false;
  for (const match of unfolded.matchAll(pattern)) {
    const index = match.index ?? 0; const gap = unfolded.slice(last, index);
    if (!(previousEncoded && /^\s*$/.test(gap))) output += gap;
    output += Buffer.from(match[1]!, "base64").toString("utf8"); last = index + match[0].length; previousEncoded = true;
  }
  return output + unfolded.slice(last);
}
export function parseEmlHeaders(text: string): ParsedEmlHeaders {
  const headers: Record<string, string> = {}; let current: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, ""); if (line === "") break;
    if (/^[ \t]/.test(line) && current) { headers[current] = `${headers[current]}\n${line.trim()}`; continue; }
    const index = line.indexOf(":"); if (index < 0) break;
    const name = line.slice(0, index).trim().toLowerCase(); if (!name) break;
    headers[name] = line.slice(index + 1).trim(); current = name;
  }
  const mid = (header: string | undefined): MessageId | null => {
    if (!header) return null; const match = /<([^>]+)>/.exec(header); return match ? match[1] as MessageId : null;
  };
  const references = (header: string | undefined): MessageId[] => {
    if (!header) return []; const out: MessageId[] = [];
    for (const match of header.matchAll(/<([^>]+)>/g)) out.push(match[1] as MessageId);
    return out;
  };
  const addresses = (header: string | undefined): string[] | null => header ? header.split(",").map(value => value.replace(/\n/g, " ").trim()).filter(Boolean) : null;
  const parsedDate = headers.date ? Date.parse(headers.date.replace(/\n/g, " ")) : Number.NaN;
  const approval = {
    repo: headers["x-oma-approval-repo"] ?? null, targetRef: headers["x-oma-approval-target"] ?? null,
    expectedBase: headers["x-oma-approval-base"] ?? null, candidate: headers["x-oma-approval-candidate"] ?? null,
    policyRevision: headers["x-oma-approval-policy"] ? decodeUtf8Base64Words(headers["x-oma-approval-policy"]) : null,
  };
  return { from: headers.from ?? null, to: addresses(headers.to), subject: headers.subject ?? null, dateMs: Number.isFinite(parsedDate) ? parsedDate : null,
    messageId: mid(headers["message-id"]), inReplyTo: mid(headers["in-reply-to"]), references: references(headers.references),
    replyTo: addresses(headers["reply-to"]), omaKind: headers["x-oma-kind"] ?? null, omaContext: headers["x-oma-context"] ?? null,
    approvalFor: Object.values(approval).some(value => value !== null) ? approval : null };
}
function logicalReplyAddress(store: Store, value: string, society: string): Address | null {
  const raw = value.trim().replace(/^<|>$/g, "");
  if (raw === "commons" || raw === "residents" || raw === "principal") return raw;
  if (raw.startsWith("topic/") && isValidTopicName(raw.slice(6))) return raw;
  if (store.getAgent(raw)) return raw;
  const suffix = `@${society}.oma.invalid`; if (!raw.endsWith(suffix)) return null;
  const local = raw.slice(0, -suffix.length);
  if (local === "commons" || local === "residents" || local === "principal") return local;
  if (local.startsWith("topic-") && isValidTopicName(local.slice(6))) return `topic/${local.slice(6)}`;
  return store.getAgent(local) ? local : null;
}
export interface MailSociety { stateRoot: string; society: string }
export class MailModule {
  constructor(private readonly paths: MailSociety, private readonly store: Store, private readonly maxReplyReferences: number, private readonly batchMaxMessages = 24) {
    this.store.bindRepositoryIdentity({ society: paths.society });
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
      const message = this.operationMessage(operation);
      if (message.id !== input.replyToMessage) throw new StoreError("INVALID_REQUEST", `reply target ${input.replyToMessage} unknown`);
      parent = this.messageHeaders(message);
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
    let replyHeaders: { replyTo: Address[]; inReplyTo: MessageId | null; references: MessageId[] } = { replyTo: defaultLogicalReplyTo(auth.actor, logicalTo), inReplyTo: null, references: [] };
    if (parent) {
      const ancestry = [...parent.references];
      if (parent.inReplyTo && !ancestry.includes(parent.inReplyTo)) ancestry.push(parent.inReplyTo);
      if (!ancestry.includes(parent.messageId!)) ancestry.push(parent.messageId!);
      const references = ancestry.slice(-this.maxReplyReferences);
      if (ancestry.length > this.maxReplyReferences) references[0] = ancestry[0]!;
      replyHeaders = { replyTo: replyHeaders.replyTo, inReplyTo: parent.messageId, references };
    }
    const eml = await buildEml({ from: actorAddress(auth.actor, society), to: route.displayTo,
      replyTo: replyHeaders.replyTo.map(address => displayAddress(address, society)), subject: input.subject, kind: input.kind,
      approvalFor: input.approvalFor, contextRevision: input.refs?.find(reference => reference.repo === "context")?.oid ?? null,
      inReplyTo: replyHeaders.inReplyTo, references: replyHeaders.references, messageId: `${messageId}@${society}.oma.invalid`, body: input.body });
    const staging = join(this.paths.stateRoot, "staging", `send-${key}`); mkdirSync(staging, { recursive: true });
    const staged = join(staging, mailObjectFileName(messageId)); writeFsynced(staged, eml.text);
    try { publishImmutableFile(staged, this.objectPath(messageId)); }
    finally { rmSync(staged, { force: true }); fsyncDir(staging); }
    const plan = { kind: operationKind, message: {
      id: messageId, objectPath: mailObjectRelativePath(messageId), sha256: eml.sha256, bytes: eml.bytes, dateMs: eml.dateMs,
      to: [...logicalTo], recipients: route.recipients, kind: input.kind,
      ...(input.approvalFor ? { approvalFor: input.approvalFor } : {}),
      contextRevision: input.refs?.find(reference => reference.repo === "context")?.oid ?? null, replyHeaders,
    } };
    const claimOut = { txClaim: "inserted" as "inserted" | "retry" };
    this.store.transaction(() => {
      assertCurrentActor(this.store, auth, "mail.send");
      claimOut.txClaim = this.store.claimOperation({ id: opId, actor: auth.actor, requestKey: key, requestHash: newHash, kind: operationKind, payloadJson: JSON.stringify(requestParams), planJson: JSON.stringify(plan) });
      if (claimOut.txClaim === "retry") return;
      route.recipients = expandAddresses(this.store, logicalTo, society).recipients;
      plan.message.recipients = route.recipients;
      this.store.updateOperationPlanJson(opId, JSON.stringify(plan));
      this.store.insertDeliveries(route.recipients.map(recipient => ({ messageId, recipient, operationId: opId })));
    });
    if (claimOut.txClaim === "retry") return receiptOf(this.store.getOperation(auth.actor, key)!);
    const result = { kind: operationKind, message: messageId, recipientCount: route.recipients.length, archivePath: this.archivePath(messageId) };
    let materializedAll = true;
    try { await this.materialize(opId); }
    catch (error) { if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error; materializedAll = false; }
    if (materializedAll) this.store.transaction(() => this.store.setOperationSucceeded(opId, JSON.stringify(result)));
    const finalOp = this.store.getOperation(auth.actor, key);
    if (!finalOp) throw new StoreError("STORE_CORRUPT", "accepted mail operation missing");
    return receiptOf(finalOp);
  }
  async freezeCreateInitial(auth: AuthContext, operationId: string, recipient: Actor, brief: string): Promise<MessagePlan> {
    const messageId = generateMessageId(operationId, 0);
    const eml = await buildEml({ from: actorAddress(auth.actor, this.paths.society), to: [actorAddress(recipient, this.paths.society)],
      replyTo: [actorAddress(auth.actor, this.paths.society)], subject: "initial brief", kind: "message", contextRevision: null,
      inReplyTo: null, references: [], messageId: `${messageId}@${this.paths.society}.oma.invalid`, body: brief });
    this.freezeObject(messageId, eml);
    return { id: messageId, objectPath: mailObjectRelativePath(messageId), sha256: eml.sha256, bytes: eml.bytes, dateMs: eml.dateMs,
      to: [recipient], recipients: [recipient], kind: "message", contextRevision: null,
      replyHeaders: { replyTo: [auth.actor], inReplyTo: null, references: [] } };
  }
  publishCreateInitial(message: MessagePlan): void {
    const object = this.objectPath(message.id); const stat = lstatSync(object, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size !== message.bytes || sha256Hex(readFileSync(object)) !== message.sha256) throw new StoreError("STORE_CORRUPT", `create initial object mismatch: ${message.id}`);
  }
  freezeObject(messageId: MessageId, eml: { text: string; sha256?: string }): void {
    const stagingDir = join(this.paths.stateRoot, "staging", "mail-objects"); mkdirSync(stagingDir, { recursive: true });
    const staged = join(stagingDir, `${messageId}.${generateOperationId()}.tmp`);
    writeFsynced(staged, eml.text);
    try { publishImmutableFile(staged, this.objectPath(messageId), eml.sha256 ?? sha256Hex(eml.text)); }
    finally { rmSync(staged, { force: true }); fsyncDir(stagingDir); }
  }
  /** The Store already proved message ordinal/path/recipient and operation relations. */
  private operationMessage(operation: OperationRow): MessagePlan {
    switch (operation.kind) {
      case "mail.send": case "agent.continue": case "git.submit": case "context.publish": return operation.plan.message;
      case "agent.create":
        if (operation.plan.initialMessage !== null) return operation.plan.initialMessage;
        throw new StoreError("STORE_CORRUPT", "linked create owns no separate initial message");
      default: throw new StoreError("STORE_CORRUPT", `operation ${operation.kind} owns no message`);
    }
  }
  private messageHeaders(message: MessagePlan): ParsedEmlHeaders {
    const path = this.objectPath(message.id); const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size !== message.bytes) throw new StoreError("STORE_CORRUPT", `mail object size/type mismatch: ${message.id}`);
    const bytes = readFileSync(path);
    if (sha256Hex(bytes) !== message.sha256) throw new StoreError("STORE_CORRUPT", `mail object hash mismatch: ${message.id}`);
    const headers = parseEmlHeaders(bytes.toString("utf8"));
    if (headers.messageId?.split("@", 1)[0] !== message.id || headers.omaKind !== message.kind) throw new StoreError("STORE_CORRUPT", `mail header mismatch: ${message.id}`);
    const logicalAddresses = (values: string[] | null): Address[] | null => {
      if (!values) return null; const logical = values.map(value => logicalReplyAddress(this.store, value, this.paths.society));
      return logical.some(value => value === null) ? null : logical as Address[];
    };
    const sameAddresses = (left: readonly Address[], right: readonly Address[]): boolean => {
      if (left.length !== right.length) return false; const a = [...left].sort(); const b = [...right].sort();
      return a.every((value, index) => value === b[index]);
    };
    const actualTo = logicalAddresses(headers.to); const actualReplyTo = logicalAddresses(headers.replyTo ?? []);
    if (!actualTo || !actualReplyTo || !sameAddresses(actualTo, message.to) || !sameAddresses(actualReplyTo, message.replyHeaders.replyTo) || headers.inReplyTo !== message.replyHeaders.inReplyTo || headers.references.length !== message.replyHeaders.references.length || headers.references.some((value, index) => value !== message.replyHeaders.references[index]) || headers.dateMs === null || headers.dateMs !== Math.floor(message.dateMs / 1000) * 1000) throw new StoreError("STORE_CORRUPT", `mail frozen metadata mismatch: ${message.id}`);
    if (headers.omaContext !== message.contextRevision) throw new StoreError("STORE_CORRUPT", `mail context metadata mismatch: ${message.id}`);
    const expected = message.approvalFor ?? null; const actual = headers.approvalFor;
    if (expected) {
      if (!actual || actual.repo !== expected.repo || actual.targetRef !== expected.targetRef || actual.expectedBase !== expected.expectedBase || actual.candidate !== expected.candidate || actual.policyRevision !== expected.policyRevision) throw new StoreError("STORE_CORRUPT", `mail approval metadata mismatch: ${message.id}`);
    } else if (actual) throw new StoreError("STORE_CORRUPT", `unexpected mail approval metadata: ${message.id}`);
    return headers;
  }
  private publishDelivery(message: MessagePlan, delivery: DeliveryRow): void {
    if (delivery.messageId !== message.id || !message.recipients.includes(delivery.recipient)) throw new StoreError("STORE_CORRUPT", `delivery message mismatch for ${delivery.operationId}`);
    const current = this.inboxCurPath(delivery.recipient, message.id); const fresh = this.inboxNewPath(delivery.recipient, message.id); const object = this.objectPath(message.id);
    if (lstatSync(current, { throwIfNoEntry: false })) {
      publishImmutableFile(object, current, message.sha256);
      if (lstatSync(fresh, { throwIfNoEntry: false })) publishImmutableFile(object, fresh, message.sha256);
    } else publishImmutableFile(object, fresh, message.sha256);
  }
  private operationDeliveries(operationId: string, message: MessagePlan): DeliveryRow[] {
    const deliveries = this.store.deliveriesForOperation(operationId); const actual = new Set<string>();
    for (const delivery of deliveries) {
      if (delivery.operationId !== operationId || delivery.messageId !== message.id || !message.recipients.includes(delivery.recipient) || actual.has(delivery.recipient)) throw new StoreError("STORE_CORRUPT", `delivery snapshot mismatch for ${operationId}`);
      actual.add(delivery.recipient);
    }
    if (actual.size !== message.recipients.length || message.recipients.some(recipient => !actual.has(recipient))) throw new StoreError("STORE_CORRUPT", `delivery snapshot mismatch for ${operationId}`);
    return deliveries;
  }
  async publishGated(operationId: string): Promise<void> {
    const operation = this.store.getOperationById(operationId);
    if (!operation) throw new StoreError("REQUEST_NOT_FOUND", `no operation ${operationId}`);
    const message = this.operationMessage(operation); const deliveries = this.operationDeliveries(operationId, message);
    this.messageHeaders(message); publishImmutableFile(this.objectPath(message.id), this.archivePath(message.id), message.sha256);
    for (const delivery of deliveries) { this.publishDelivery(message, delivery); this.store.transaction(() => this.store.markMaterialized(delivery.messageId, delivery.recipient)); }
  }
  async materialize(operationId: string): Promise<void> {
    const operation = this.store.getOperationById(operationId);
    if (!operation) throw new StoreError("REQUEST_NOT_FOUND", `no operation ${operationId}`);
    if (operation.kind !== "mail.send" && operation.kind !== "agent.continue") throw new StoreError("INVALID_REQUEST", `operation ${operation.kind} uses gated publication`);
    const message = operation.plan.message; const deliveries = this.operationDeliveries(operationId, message);
    this.messageHeaders(message); publishImmutableFile(this.objectPath(message.id), this.archivePath(message.id), message.sha256);
    for (const delivery of deliveries) { this.publishDelivery(message, delivery); this.store.transaction(() => this.store.markMaterialized(delivery.messageId, delivery.recipient)); }
  }
  private selectBatch(pending: DeliveryRow[]): DeliveryRow[] {
    if (pending.length === 0) return [];
    const direct: DeliveryRow[] = []; const publicList: DeliveryRow[] = [];
    for (const delivery of pending) (this.isPublicList(delivery) ? publicList : direct).push(delivery);
    if (direct.length === 0 || publicList.length === 0) return pending.slice(0, this.batchMaxMessages);
    if (this.batchMaxMessages < 2) throw new StoreError("UNSUPPORTED_PROFILE", "batchMaxMessages must be at least 2 when both batch classes are pending");
    const out: DeliveryRow[] = [direct[0]!, publicList[0]!]; let di = 1; let pi = 1; let takeDirect = true;
    while (out.length < this.batchMaxMessages && (di < direct.length || pi < publicList.length)) {
      if (takeDirect && di < direct.length) out.push(direct[di++]!);
      else if (!takeDirect && pi < publicList.length) out.push(publicList[pi++]!);
      else if (di < direct.length) out.push(direct[di++]!); else if (pi < publicList.length) out.push(publicList[pi++]!);
      takeDirect = !takeDirect;
    }
    return out;
  }
  private isPublicList(delivery: DeliveryRow): boolean {
    const message = this.messagePlan(delivery);
    return message.kind === "message" && message.to.length > 0 && message.to.every(to => to === "commons" || to === "residents" || to.startsWith("topic/"));
  }
  private messagePlan(delivery: DeliveryRow): MessagePlan {
    const operation = this.store.getOperationById(delivery.operationId);
    if (!operation) throw new StoreError("STORE_CORRUPT", `missing operation ${delivery.operationId}`);
    const message = this.operationMessage(operation);
    if (message.id !== delivery.messageId || !message.recipients.includes(delivery.recipient)) throw new StoreError("STORE_CORRUPT", `message plan mismatch for ${delivery.messageId}`);
    return message;
  }
  private noticeFor(agent: Actor, ids: readonly MessageId[]): string {
    const lines: string[] = [];
    for (const [index, id] of ids.slice(0, 6).entries()) {
      const delivery = this.store.getDelivery(id, agent);
      if (!delivery) throw new StoreError("STORE_CORRUPT", `missing delivery ${id}/${agent}`);
      const message = this.messagePlan(delivery); const headers = this.messageHeaders(message);
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
    try { this.store.transaction(() => { this.store.insertPreparedBatch(batch); this.store.linkDeliveriesToBatch(batch.id, batch.messageIds); }); }
    catch (error) { if (error instanceof StoreError && error.code === "BATCH_CONFLICT") return null; throw error; }
    return this.finishPrepared(batchOf(batch, auth.actor, notice));
  }
  async complete(auth: AuthContext, evidence: BoundaryEvidence): Promise<void> {
    const batch = this.store.getBatch(evidence.batchId);
    if (!batch) throw new StoreError("BATCH_CONFLICT", `unknown batch ${evidence.batchId}`);
    if (batch.agent !== auth.actor || auth.incarnation !== evidence.incarnation || batch.incarnation !== evidence.incarnation) throw new StoreError("BATCH_CONFLICT", "batch ownership mismatch");
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
          this.store.transaction(() => this.store.setOperationSucceeded(id, JSON.stringify(result))); repaired++;
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
