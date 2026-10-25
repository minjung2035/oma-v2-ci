/** MAIL-001..005 / DB-009: one frozen source for EML and MessagePlan facts.
 * Recipients are intentionally separate: membership is frozen by the accepting
 * transaction, not by the pre-render snapshot or a display mailbox address.
 */
import type { Actor, Address, MessageId, Oid } from "@oma/contracts/identity";
import type { ExactCandidateIdentity, MailInput } from "@oma/contracts/values";
import type { MessagePlan } from "@oma/contracts/durable";
import { isValidActor, isValidMessageId, isValidFullOid, isValidSocietyName } from "@oma/domain/identifiers";
import { exactCandidateCheck, headerMessageIdCheck, isLogicalAddress, isMailKind } from "@oma/domain/mail-values";
import { mailObjectRelativePath } from "@oma/domain/derived";
import { StoreError } from "@oma/domain/errors";

export interface FrozenMessageFacts {
  readonly id: MessageId;
  readonly society: string;
  readonly sender: Actor;
  readonly dateMs: number;
  readonly to: readonly Address[];
  readonly kind: MailInput["kind"];
  readonly contextRevision: Oid | null;
  readonly replyHeaders: {
    readonly replyTo: readonly Address[];
    readonly inReplyTo: string | null;
    readonly references: readonly string[];
  };
  readonly approvalFor?: Readonly<ExactCandidateIdentity>;
}
export type MessageFactsInput = Omit<FrozenMessageFacts, "dateMs"> & { readonly dateMs?: number };
export interface RenderedMessage {
  readonly text: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly dateMs: number;
  readonly facts: FrozenMessageFacts;
}

export function freezeMessageDate(explicit?: number): number {
  const dateMs = explicit ?? Math.floor(Date.now() / 1000) * 1000;
  if (!Number.isSafeInteger(dateMs) || dateMs < 0 || !Number.isFinite(new Date(dateMs).getTime()))
    throw new StoreError("INVALID_REQUEST", "mail date must be a representable non-negative safe integer");
  return dateMs;
}

export function freezeMessageFacts(input: MessageFactsInput): FrozenMessageFacts {
  if (Object.keys(input).some(key => !["id", "society", "sender", "dateMs", "to", "kind", "contextRevision", "replyHeaders", "approvalFor"].includes(key)))
    throw new StoreError("INVALID_REQUEST", "unknown frozen message fact");
  if (!isValidMessageId(input.id) || !isValidActor(input.sender) || !isValidSocietyName(input.society) || !isMailKind(input.kind))
    throw new StoreError("INVALID_REQUEST", "invalid frozen message identity/kind");
  if (!Array.isArray(input.to) || input.to.some(value => !isLogicalAddress(value)))
    throw new StoreError("INVALID_REQUEST", "message To must contain logical addresses");
  const reply = input.replyHeaders;
  if (!reply || Object.keys(reply).some(key => !["replyTo", "inReplyTo", "references"].includes(key)) ||
    !Array.isArray(reply.replyTo) || reply.replyTo.some(value => !isLogicalAddress(value)) ||
    (reply.inReplyTo !== null && headerMessageIdCheck(reply.inReplyTo) !== null) ||
    !Array.isArray(reply.references) || reply.references.some(value => headerMessageIdCheck(value) !== null))
    throw new StoreError("INVALID_REQUEST", "invalid ordered reply facts");
  if (input.contextRevision !== null && !isValidFullOid(input.contextRevision))
    throw new StoreError("INVALID_REQUEST", "invalid context revision fact");
  if (input.approvalFor !== undefined && exactCandidateCheck(input.approvalFor) !== null)
    throw new StoreError("INVALID_REQUEST", "invalid approval tuple fact");
  if ((input.kind === "approval_required") !== (input.approvalFor !== undefined) ||
    (input.kind === "approval_required" && !input.to.includes("principal")))
    throw new StoreError("INVALID_REQUEST", "approval-required facts need the exact tuple and explicit principal recipient");
  const facts: FrozenMessageFacts = {
    id: input.id, society: input.society, sender: input.sender, dateMs: freezeMessageDate(input.dateMs),
    to: Object.freeze([...input.to]), kind: input.kind, contextRevision: input.contextRevision,
    replyHeaders: Object.freeze({ replyTo: Object.freeze([...reply.replyTo]), inReplyTo: reply.inReplyTo,
      references: Object.freeze([...reply.references]) }),
    ...(input.approvalFor === undefined ? {} : { approvalFor: Object.freeze({ ...input.approvalFor }) }),
  };
  return Object.freeze(facts);
}

/** One selection policy; logical/RFC adapters supply their own list grammar. */
export function selectReplyTargets<T extends string>(from: T, to: readonly T[], isList: (value: T) => boolean): T[] {
  const lists = to.filter(isList);
  return [...new Set(lists.length ? lists : [from])];
}
export function defaultLogicalReplyTo(from: Address, to: readonly Address[]): Address[] {
  return selectReplyTargets(from, to,
    address => address === "commons" || address === "residents" || address.startsWith("topic/"));
}

/** Metadata comes from the actual emission; no clock, routing or ID generation.
 * The accepting owner supplies its current unique recipient snapshot separately.
 */
export function messagePlanFrom(message: RenderedMessage, recipients: readonly Actor[]): MessagePlan {
  if (!Number.isSafeInteger(message.bytes) || message.bytes < 1 || !/^[0-9a-f]{64}$/.test(message.sha256) ||
    message.dateMs !== message.facts.dateMs)
    throw new StoreError("INTERNAL_ERROR", "invalid emitted message metadata");
  if (recipients.some(recipient => !isValidActor(recipient)) || new Set(recipients).size !== recipients.length)
    throw new StoreError("INTERNAL_ERROR", "invalid accepting recipient snapshot");
  const facts = message.facts;
  return {
    id: facts.id, objectPath: mailObjectRelativePath(facts.id), bytes: message.bytes, sha256: message.sha256,
    dateMs: message.dateMs, to: [...facts.to], recipients: [...recipients], kind: facts.kind,
    contextRevision: facts.contextRevision,
    replyHeaders: { replyTo: [...facts.replyHeaders.replyTo], inReplyTo: facts.replyHeaders.inReplyTo,
      references: [...facts.replyHeaders.references] },
    ...(facts.approvalFor === undefined ? {} : { approvalFor: { ...facts.approvalFor } }),
  };
}
