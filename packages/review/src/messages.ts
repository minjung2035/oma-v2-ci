/** Review document construction and preaccept artifact registration. No acceptance. */
import type { Actor, MessageId, MessagePlan, OperationId } from "@oma/contracts";
import type { ReviewFact } from "@oma/contracts/attestation";
import type { ReviewLedger } from "./ports.js";
import type { ReviewMail } from "./ports.js";
import { StoreError } from "@oma/domain/errors";
import { messageIdForOperation as generateMessageId } from "@oma/domain/derived";
import { reviewSubject, reviewThreadBody, reviewApprovalBody } from "@oma/mail/review-documents";
import { rfcMessageIdFor } from "@oma/mail/addresses";
import { frozenMessageDisposition } from "@oma/mail/materializer";
import type { MailPreacceptScope as PreacceptScope } from "@oma/mail/ports";
import type { PreacceptArtifactOwner } from "@oma/contracts/files";
import { planEffects, type ReviewEntry, type ReviewState, type ReviewStateInput } from "@oma/domain/review-evaluation";
import { PRINCIPAL, type OpenRequest, type Emission, type ReviewBounds } from "./types.js";
export class ReviewMessages {
  constructor(private readonly store: Pick<ReviewLedger, "getOperationById">,
    private readonly mail: Pick<ReviewMail, "freezeReviewMessage">,
    private readonly bounds: ReviewBounds, private readonly society: string) {}
  /** The shared emissions for an entry fact: its thread revision (except LOW
   * merges, which have no thread) plus the planEffects Principal mail and an
   * optional Principal decision copy. */
  entryEmissions(id: OperationId,
      open: OpenRequest,
      openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
      inputFor: ReviewStateInput, before: ReviewState, after0: ReviewState, newEntry: ReviewEntry,
      effects: ReturnType<typeof planEffects>,
      decision: { approval: MessageId; verdict: "approve" | "reject"; body: string } | null): Emission[] {
    const hasThread = !(openFact.kind === "merge.open" && openFact.tier === "LOW");
    const priorThread = this.lastThreadMessage(inputFor);
    const revision = this.threadRevisionCount(inputFor);
    const emissions: Emission[] = [];
    if (hasThread) emissions.push({
      to: ["residents"], kind: "message",
      subject: reviewSubject(`[${before.name}] ${openFact.title} (rev ${revision})`, this.bounds.subjectBytes),
      body: reviewThreadBody(after0, openFact, [...inputFor.entries, newEntry], priorThread?.id ?? null, this.bounds.mailBodyBytes),
      replyHeaders: { replyTo: ["residents"],
        inReplyTo: priorThread === null ? null : rfcMessageIdFor(priorThread.id, this.society),
        references: priorThread === null ? []
          : [...priorThread.replyHeaders.references, rfcMessageIdFor(priorThread.id, this.society)] },
      audience: "workers", review: { role: "thread", request: open.operation.id, name: before.name, revision } });
    if (effects.withdraw !== null) emissions.push({
      to: [PRINCIPAL], kind: "message", subject: reviewSubject(`[${before.name}] approval withdrawn`, this.bounds.subjectBytes),
      body: `Approval ${effects.withdraw.id} for ${before.name} is withdrawn: ${effects.withdraw.reason}.\n` +
        `The request remains open; Workers may vote again.`,
      replyHeaders: { replyTo: [PRINCIPAL], inReplyTo: rfcMessageIdFor(effects.withdraw.id, this.society),
        references: this.referencesTo(inputFor, effects.withdraw.id) },
      review: { role: "withdrawn", request: open.operation.id, name: before.name, approval: effects.withdraw.id } });
    if (effects.approve !== null) {
      const approvalId = generateMessageId(id, emissions.length);
      const body = reviewApprovalBody(approvalId, openFact, [...inputFor.entries, newEntry], inputFor.open.actor, effects.approve);
      // The floor model (mail/review-bounds.ts) covers this body for the
      // votes the configured floor binds; over it is a bounds bug, not a mail
      // the Principal cannot read (the notice-part assert has the same shape).
      if (Buffer.byteLength(body, "utf8") > this.bounds.mailBodyBytes)
        throw new StoreError("INTERNAL_ERROR", "an approval request exceeds the mail body bound");
      emissions.push({
        to: [PRINCIPAL], kind: "approval_required",
        subject: reviewSubject(`[${before.name}] HIGH approval requested: ${openFact.title}`, this.bounds.subjectBytes),
        body,
        approvalFor: openFact.identity,
        replyHeaders: { replyTo: [PRINCIPAL], inReplyTo: null, references: [] },
        review: { role: "approval", request: open.operation.id, name: before.name, votes: [...effects.approve] } });
    }
    if (decision !== null)
      emissions.push({
        to: [PRINCIPAL], kind: "result", subject: reviewSubject(`[${before.name}] decision recorded`, this.bounds.subjectBytes),
        body: `Principal ${decision.verdict} on approval ${decision.approval} for ${before.name}:\n${decision.body}`,
        replyHeaders: { replyTo: [PRINCIPAL], inReplyTo: rfcMessageIdFor(decision.approval, this.society),
          references: this.referencesTo(inputFor, decision.approval) },
        review: { role: "decision", request: open.operation.id, name: before.name, approval: decision.approval } });
    return emissions;
  }

  private referencesTo(input: ReviewStateInput, messageId: MessageId): string[] {
    for (const message of this.allMessages(input))
      if (message.id === messageId)
        return [...message.replyHeaders.references, rfcMessageIdFor(messageId, this.society)];
    return [rfcMessageIdFor(messageId, this.society)];
  }

  private allMessages(input: ReviewStateInput): readonly MessagePlan[] {
    return [input.open, ...input.entries].flatMap(entry => entry.messages);
  }

  private lastThreadMessage(input: ReviewStateInput): MessagePlan | null {
    let last: MessagePlan | null = null;
    for (const message of this.allMessages(input))
      if (message.review?.role === "thread" && message.review.request === input.open.operation) last = message;
    return last;
  }

  private threadRevisionCount(input: ReviewStateInput): number {
    return this.allMessages(input)
      .filter(message => message.review?.role === "thread" && message.review.request === input.open.operation)
      .length;
  }

  /** Freeze every emission's EML in plan order; ordinals name the messages.
   * Each artifact registers with `scope` the moment it exists, so a later
   * freeze failure still settles the earlier ones exactly (AV-04). */
  async freeze(scope: PreacceptScope, id: OperationId, sender: Actor, emissions: readonly Emission[]):
      Promise<{ message: MessagePlan; artifact: PreacceptArtifactOwner }[]> {
    const frozen: { message: MessagePlan; artifact: PreacceptArtifactOwner }[] = [];
    for (const [ordinal, emission] of emissions.entries()) {
      const item = await this.mail.freezeReviewMessage(id, ordinal, sender, emission);
      scope.register({ operationId: id, resource: item.artifact.path, owner: item.artifact,
        observe: () => frozenMessageDisposition(this.store, id,
          { id: item.message.id, sha256: item.message.sha256 }) });
      frozen.push(item);
    }
    return frozen;
  }
}
