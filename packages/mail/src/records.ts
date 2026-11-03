/** MCS-R01..003: read-only source observations for collaboration projections.
 * These are internal facts, not the model-facing JSON schema or a new receipt.
 * No read marks presentation/ACK, publishes a gated message, or changes routing. */
import type { Actor, Address, MessageId, OperationId, MessagePlan } from "@oma/contracts";
import { parseMessageId } from "@oma/domain/identifiers";
import { actorAddress } from "@oma/domain/actor-address";
import { sha256Hex } from "@oma/domain/canonical-json";
import { decodeUtf8 } from "@oma/domain/utf8";
import { StoreError } from "@oma/domain/errors";
import { decodedMailBody } from "./display.js";
import { decodeSubject } from "./headers.js";
import { rfcMessageIdFor } from "./addresses.js";
import type { MailMaterializer } from "./materializer.js";
import { ownedMessages } from "@oma/domain/durable";
import type { MailLedger } from "./ports.js";

type RecordReview<T> = T extends { votes: OperationId[] }
  ? Readonly<Omit<T, "votes">> & { readonly votes: readonly OperationId[] } : Readonly<T>;

export interface MailRecordFacts {
  readonly message: MessageId;
  readonly operation: OperationId;
  readonly sender: Actor;
  readonly rfcMessageId: string;
  readonly subject: string;
  readonly to: readonly Address[];
  readonly audience: "public" | "workers";
  readonly source: "actor" | "broker";
  readonly attachments: readonly Readonly<{ oid: string; objectFormat: "sha1" | "sha256"; publishedRef: string;
    repository: "project"; availability: "published"; sourcePublication?: OperationId | null; reachableFrom?: string; sourcePublicationOrdinal?: number; observedAtMs?: number; publishedTreeScope: "entire-committed-tree" }>[];
  readonly replyHeaders: Readonly<{ replyTo: readonly Address[]; inReplyTo: string | null; references: readonly string[] }>;
  readonly contextRevision: MessagePlan["contextRevision"];
  readonly review?: RecordReview<NonNullable<MessagePlan["review"]>>;
  readonly approvalFor?: Readonly<NonNullable<MessagePlan["approvalFor"]>>;
  /** The Principal projection deliberately has no Worker recipient roster. */
  readonly recipients?: readonly Actor[];
  readonly body: string;
  readonly bodyBytes: number;
  readonly bodySha256: string;
}
export type MailRecordObservation =
  | { readonly state: "published"; readonly record: MailRecordFacts }
  | { readonly state: "archive-absent"; readonly message: MessageId; readonly operation: OperationId };

type RecordLedger = Pick<MailLedger, "getAgent" | "getOperationById">;
export class MailRecordReader {
  constructor(private readonly store: RecordLedger, private readonly society: string,
    private readonly materializer: Pick<MailMaterializer, "published">) {}

  /** `actor` is host-owned projection scope, not a model-supplied identity or
   * capability. The caller must also contain ordinary file access to its root. */
  read(actor: Actor, id: MessageId): MailRecordObservation {
    const reader = this.store.getAgent(actor);
    if (reader === null) throw new StoreError("ADDRESS_NOT_FOUND", "mail record reader does not exist");
    const parsed = parseMessageId(id);
    if (parsed === null) throw new StoreError("INVALID_REQUEST", "mail record requires a storage message identity");
    const operation = this.store.getOperationById(parsed.operationId);
    if (operation === null) throw new StoreError("REQUEST_NOT_FOUND", "mail record is not accepted");
    const message = ownedMessages(operation.plan).find(candidate => candidate.id === id);
    if (message === undefined) throw new StoreError("REQUEST_NOT_FOUND", "accepted operation does not own this mail record");
    if (reader.role === "principal" && message.audience === "workers")
      throw new StoreError("CAPABILITY_DENIED", "workers-only mail is outside the Principal record scope");
    const published = this.materializer.published(message);
    if (published === null) return Object.freeze({ state: "archive-absent", message: id, operation: operation.id });
    const { headers, bytes } = published;
    // Sender identity comes from the accepted operation. Even hash-valid mail
    // cannot assert a different sender or an RFC identity in another Society.
    const rfcMessageId = rfcMessageIdFor(id, this.society);
    if (headers.from !== actorAddress(operation.actor, this.society) || headers.messageId !== rfcMessageId)
      throw new StoreError("STORE_CORRUPT", "mail record sender or Society differs from its accepted operation");
    let body: string; let subject: string;
    try { body = decodedMailBody(decodeUtf8(bytes)); subject = decodeSubject(headers.subject); }
    catch (cause) { throw new StoreError("STORE_CORRUPT", "accepted mail cannot be projected as exact UTF-8 text", { cause }); }
    const record: MailRecordFacts = Object.freeze({
      message: id, operation: operation.id, sender: operation.actor, rfcMessageId, subject,
      to: Object.freeze([...message.to]), audience: message.audience ?? "public",
      source: message.review !== undefined || operation.kind === "git.integrate" ||
        (operation.kind === "context.publish" && operation.plan.goalMail !== undefined) ? "broker" : "actor",
      attachments: operation.kind === "git.submit" ? Object.freeze([Object.freeze({ oid: operation.plan.candidate,
        objectFormat: operation.plan.candidate.length === 40 ? "sha1" as const : "sha256" as const,
        publishedRef: operation.plan.publishedRef, repository: "project" as const, availability: "published" as const,
        publishedTreeScope: "entire-committed-tree" as const })]) : operation.kind === "mail.send" && operation.plan.attachments !== undefined
          ? Object.freeze(operation.plan.attachments.sources.map(source => Object.freeze({ oid: source.commit,
            objectFormat: source.objectFormat, publishedRef: source.publishedRef,
            repository: "project" as const, availability: "published" as const, publishedTreeScope: "entire-committed-tree" as const,
            sourcePublication: source.publication, ...(source.reachableFrom === undefined ? {} : { reachableFrom: source.reachableFrom }), ...(source.publicationOrdinal === undefined ? {} : { sourcePublicationOrdinal: source.publicationOrdinal }), observedAtMs: operation.plan.attachments!.observedAtMs }))) : Object.freeze([]),
      replyHeaders: Object.freeze({ replyTo: Object.freeze([...message.replyHeaders.replyTo]),
        inReplyTo: message.replyHeaders.inReplyTo, references: Object.freeze([...message.replyHeaders.references]) }),
      contextRevision: message.contextRevision,
      ...(message.review === undefined ? {} : { review: Object.freeze({ ...message.review,
        ...(message.review.role === "approval" ? { votes: Object.freeze([...message.review.votes]) } : {}) }) }),
      ...(message.approvalFor === undefined ? {} : { approvalFor: Object.freeze({ ...message.approvalFor }) }),
      ...(reader.role === "principal" ? {} : { recipients: Object.freeze([...message.recipients]) }),
      body, bodyBytes: Buffer.byteLength(body, "utf8"), bodySha256: sha256Hex(body),
    });
    return Object.freeze({ state: "published", record });
  }
}
