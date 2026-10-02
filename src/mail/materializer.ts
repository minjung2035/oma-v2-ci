import { lstatSync } from "node:fs";
import { readableBody } from "./display.js";
import { sha256Hex } from "../domain/canonical-json.js";
import type { Address, MessagePlan } from "../../implementation/contracts.js";
import { Store, type DeliveryRow, type OperationRow } from "../store.js";
import { ownedMessage } from "../durable.js";
import { StoreError } from "../domain/errors.js";
import { mailObjectPathAt, mailArchivePathAt, mailInboxPathAt } from "../storage/paths.js";
import { publishImmutableFile, readImmutableBytes } from "../storage/immutable-file.js";
import { parseDisplayedAddress } from "./addresses.js";
import { decodeSubject, parseEmlHeaders, type ParsedEmlHeaders } from "./headers.js";
import { consumeIntegrationPublication, type IntegrationPublicationEvidence } from "../git/integration-publication.js";
import { consumeSubmissionPublication, type SubmissionPublicationEvidence } from "../git/publication.js";
import { consumeContextPublication, type ContextPublicationEvidence } from "../git/context-publication.js";
import { consumeCreationPublication, type CreationPublicationEvidence } from "../lifecycle/create-publication.js";

export type PublicationEvidence = IntegrationPublicationEvidence | SubmissionPublicationEvidence | ContextPublicationEvidence | CreationPublicationEvidence;
/** The message an accepted plan names, or null for a plan that names none. */
export function namedMessage(operation: OperationRow): MessagePlan | null {
  return ownedMessage(operation.plan);
}
/** Pre-accept ownership of a frozen message object follows the accepted plan,
 * not row existence: only a plan naming this id and sha256 owns it. A linked
 * create, another message or another kind owns none of it. */
export function frozenMessageDisposition(store: Pick<Store, "getOperationById">, operationId: string,
  message: { readonly id: string; readonly sha256: string }): "unaccepted-known" | "accepted-referenced" | "accepted-unreferenced" {
  const operation = store.getOperationById(operationId);
  if (operation === null) return "unaccepted-known";
  const named = namedMessage(operation);
  return named !== null && named.id === message.id && named.sha256 === message.sha256 ? "accepted-referenced" : "accepted-unreferenced";
}
export function operationMessage(operation: OperationRow): MessagePlan {
  const message = namedMessage(operation);
  if (message !== null) return message;
  throw new StoreError("STORE_CORRUPT", operation.kind === "agent.create"
    ? "linked create owns no separate initial message" : `operation ${operation.kind} owns no message`);
}

/** Adds physical source/header/hash proof and the sole archive/inbox effect loop
 * to the Store's validated rows. Missing rows are not an empty fanout success.
 */
export class MailMaterializer {
  constructor(private readonly store: Store, private readonly stateRoot: string, private readonly society: string) {}
  headers(message: MessagePlan): ParsedEmlHeaders { return this.checked(message).headers; }
  private checked(message: MessagePlan): { headers: ParsedEmlHeaders; bytes: Buffer } {
    const path = mailObjectPathAt(this.stateRoot, message.id);
    const bytes = readImmutableBytes(path, message.sha256, message.bytes);
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
      case "git.integrate": consumeIntegrationPublication(proof, operation); break;
      case "git.submit": consumeSubmissionPublication(proof, operation); break;
      case "context.publish": consumeContextPublication(proof, operation); break;
      case "agent.create": consumeCreationPublication(proof, operation); break;
      default: throw new StoreError("INVALID_REQUEST", "ordinary mail cannot use a parent-effect publication gate");
    }
    this.publish(operation);
  }
  private publish(operation: OperationRow): void {
    const message = operationMessage(operation);
    const deliveries = this.store.deliveriesForOperation(operation.id);
    const expected = new Set(message.recipients);
    const actual = new Set<string>();
    for (const delivery of deliveries) {
      if (delivery.operationId !== operation.id || delivery.messageId !== message.id ||
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
    publishImmutableFile(mailObjectPathAt(this.stateRoot, message.id), mailArchivePathAt(this.stateRoot, message.id), message.sha256);
    for (const delivery of deliveries) {
      this.publishDelivery(message, delivery);
      this.store.transaction(tx => tx.markMaterialized(delivery.messageId, delivery.recipient));
    }
  }
  private publishDelivery(message: MessagePlan, delivery: DeliveryRow): void {
    const object = mailObjectPathAt(this.stateRoot, message.id);
    const current = mailInboxPathAt(this.stateRoot, delivery.recipient, message.id, "cur");
    const fresh = mailInboxPathAt(this.stateRoot, delivery.recipient, message.id, "new");
    if (lstatSync(current, { throwIfNoEntry: false })) {
      publishImmutableFile(object, current, message.sha256);
      if (lstatSync(fresh, { throwIfNoEntry: false })) publishImmutableFile(object, fresh, message.sha256);
    } else publishImmutableFile(object, fresh, message.sha256);
  }
}
