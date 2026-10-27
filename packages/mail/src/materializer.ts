import { mailEntryPresent } from "./observations.js";
import type { PublicationEvidence } from "@oma/contracts/publication";

import { readableBody } from "./display.js";
import { sha256Hex } from "@oma/domain/canonical-json";
import type { Address, MessagePlan } from "@oma/contracts";
import type { MailLedger, MailOperationReader, MailEffects } from "./ports.js";
import { type DeliveryRow } from "@oma/contracts/ledger";
import { type DecodedOperation as OperationRow } from "@oma/protocol/operation-codec";
import { ownedMessages } from "@oma/domain/durable";
import { StoreError } from "@oma/domain/errors";

import { parseDisplayedAddress } from "./addresses.js";
import { decodeSubject, parseEmlHeaders, type ParsedEmlHeaders } from "./headers.js";

/** Pre-accept ownership of a frozen message object follows the accepted plan,
 * not row existence: only a plan naming this id and sha256 owns it. A linked
 * create, another message or another kind owns none of it. */
export function frozenMessageDisposition(store: MailOperationReader, operationId: string,
  message: { readonly id: string; readonly sha256: string }): "unaccepted-known" | "accepted-referenced" | "accepted-unreferenced" {
  const operation = store.getOperationById(operationId);
  if (operation === null) return "unaccepted-known";
  const named = ownedMessages(operation.plan);
  return named.some(candidate => candidate.id === message.id && candidate.sha256 === message.sha256)
    ? "accepted-referenced" : "accepted-unreferenced";
}
export function operationMessage(operation: OperationRow, messageId?: string): MessagePlan {
  const owned = ownedMessages(operation.plan);
  const message = messageId === undefined
    ? (owned.length === 1 ? owned[0]! : null)
    : owned.find(candidate => candidate.id === messageId) ?? null;
  if (message !== null) return message;
  throw new StoreError("STORE_CORRUPT", operation.kind === "agent.create"
    ? "linked create owns no separate initial message" : `operation ${operation.kind} owns no message`);
}

/** Adds physical source/header/hash proof and the sole archive/inbox effect loop
 * to the Store's validated rows. Missing rows are not an empty fanout success.
 */
export class MailMaterializer {
  constructor(private readonly store: MailLedger, private readonly society: string, private readonly effects: MailEffects) {}
  headers(message: MessagePlan): ParsedEmlHeaders { return this.checked(message).headers; }
  private checked(message: MessagePlan): { headers: ParsedEmlHeaders; bytes: Buffer } {
    const bytes = this.effects.readMessage(message);
    let headers: ParsedEmlHeaders;
    try { headers = parseEmlHeaders(bytes, { maxHeaderBytes: message.bytes }); }
    catch { throw new StoreError("STORE_CORRUPT", `unsupported or corrupt accepted mail headers: ${message.id}`); }
    if (headers.messageId?.split("@", 1)[0] !== message.id || headers.omaKind !== message.kind)
      throw new StoreError("STORE_CORRUPT", `mail header mismatch: ${message.id}`);
    const actorNames = new Set(this.store.listAgents().map(agent => agent.name));
    const logicalAddresses = (values: string[] | null): Address[] | null => {
      if (!values) return null;
      const logical = values.map(value => parseDisplayedAddress(value, this.society, actorNames));
      return logical.some(value => value === null) ? null : logical as Address[];
    };
    const sameAddresses = (left: readonly Address[], right: readonly Address[]): boolean => {
      if (left.length !== right.length) return false;
      const a = [...left].sort(); const b = [...right].sort();
      return a.every((value, index) => value === b[index]);
    };
    const actualTo = logicalAddresses(headers.to);
    const actualReplyTo = logicalAddresses(headers.replyTo ?? []);
    if (!actualTo || !actualReplyTo || !sameAddresses(actualTo, message.to) || !sameAddresses(actualReplyTo, message.replyHeaders.replyTo) ||
        headers.inReplyTo !== message.replyHeaders.inReplyTo || headers.references.length !== message.replyHeaders.references.length ||
        headers.references.some((value, index) => value !== message.replyHeaders.references[index]) ||
        headers.dateMs === null || headers.dateMs !== Math.floor(message.dateMs / 1000) * 1000)
      throw new StoreError("STORE_CORRUPT", `mail frozen metadata mismatch: ${message.id}`);
    if (headers.omaContext !== message.contextRevision) throw new StoreError("STORE_CORRUPT", `mail context metadata mismatch: ${message.id}`);
    const expected = message.approvalFor ?? null; const actual = headers.approvalFor;
    if (expected) {
      if (!actual || actual.repo !== expected.repo || actual.targetRef !== expected.targetRef || actual.expectedBase !== expected.expectedBase ||
          actual.candidate !== expected.candidate || actual.policyRevision !== expected.policyRevision)
        throw new StoreError("STORE_CORRUPT", `mail approval metadata mismatch: ${message.id}`);
    } else if (actual) throw new StoreError("STORE_CORRUPT", `unexpected mail approval metadata: ${message.id}`);
    return { headers, bytes };
  }
  private requiredOperation(id: string): OperationRow {
    const operation = this.store.getOperationById(id);
    if (!operation) throw new StoreError("REQUEST_NOT_FOUND", `no operation ${id}`);
    if (operation.state === "failed") throw new StoreError("STORE_CORRUPT", "failed intent cannot authorize new mail publication");
    return operation;
  }
  ordinary(id: string): void {
    const operation = this.requiredOperation(id);
    if (operation.kind !== "attest.record" && operation.kind !== "mail.send" && operation.kind !== "agent.continue")
      throw new StoreError("INVALID_REQUEST", `operation ${operation.kind} uses gated publication`);
    this.publish(operation);
  }
  gated(id: string, proof: PublicationEvidence | undefined): void {
    const operation = this.requiredOperation(id);
    switch (operation.kind) {
      case "git.integrate": this.effects.publication.consumeIntegration(proof, operation); break;
      case "git.submit": this.effects.publication.consumeSubmission(proof, operation); break;
      case "context.publish": this.effects.publication.consumeContext(proof, operation); break;
      case "agent.create": this.effects.publication.consumeCreation(proof, operation); break;
      default: throw new StoreError("INVALID_REQUEST", "ordinary mail cannot use a parent-effect publication gate");
    }
    this.publish(operation);
  }
  private publish(operation: OperationRow): void {
    const messages = ownedMessages(operation.plan);
    // A review operation may legitimately own no mail; nothing publishes then.
    if (messages.length === 0) return;
    const deliveries = this.store.deliveriesForOperation(operation.id);
    const ownedIds = new Set(messages.map(message => message.id));
    if (deliveries.some(delivery => !ownedIds.has(delivery.messageId)))
      throw new StoreError("STORE_CORRUPT", `delivery snapshot mismatch for ${operation.id}`);
    for (const message of messages) {
      const owned = deliveries.filter(delivery => delivery.messageId === message.id);
      const expected = new Set(message.recipients);
      const actual = new Set<string>();
      for (const delivery of owned) {
        if (delivery.operationId !== operation.id ||
          !expected.has(delivery.recipient) || actual.has(delivery.recipient))
          throw new StoreError("STORE_CORRUPT", `delivery snapshot mismatch for ${operation.id}`);
        actual.add(delivery.recipient);
      }
      if (expected.size !== message.recipients.length || actual.size !== expected.size)
        throw new StoreError("STORE_CORRUPT", `delivery snapshot mismatch for ${operation.id}`);
      const { headers, bytes } = this.checked(message);
      if (operation.kind === "context.publish" && operation.plan.goalMail) {
        const goal = operation.plan.entries.find(entry => entry.path === "GOAL.md")!;
        const body = Buffer.from(readableBody(bytes.toString("utf8")));
        if (body.length !== goal.bytes || sha256Hex(body) !== goal.sha256 || decodeSubject(headers.subject) !== operation.plan.goalMail.subject)
          throw new StoreError("STORE_CORRUPT", "GOAL mail differs from the accepted document or subject");
      }
      this.effects.publishMailArchive(message);
      for (const delivery of owned) {
        this.publishDelivery(message, delivery);
        this.store.transaction(tx => tx.markMaterialized(delivery.messageId, delivery.recipient));
      }
    }
  }
  private publishDelivery(message: MessagePlan, delivery: DeliveryRow): void {
    const inbox = this.effects.openInbox(delivery.recipient);

    try {
      let arrivedNew = false;
      if (mailEntryPresent(inbox.observeInboxMessage("cur", message))) {
        inbox.publishInboxMessage("cur", message);
        if (mailEntryPresent(inbox.observeInboxMessage("new", message))) {
          inbox.publishInboxMessage("new", message); arrivedNew = true;
        }
      } else { inbox.publishInboxMessage("new", message); arrivedNew = true; }
      // This is the same pinned inbox that owns the delivery directories.
      // Its full arrival record and parent are durable before materialized.
      if (arrivedNew) inbox.appendMailArrival(message.id);
    } finally { inbox.close(); }
  }
  
}
