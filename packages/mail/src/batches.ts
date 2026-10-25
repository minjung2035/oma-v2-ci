import { mailEntryPresent } from "./observations.js";

import type { Actor, AuthContext, BoundaryEvidence, MessageId, PreparedBatch } from "@oma/contracts";
import type { MailLedger, MailEffects } from "./ports.js";
import { type DeliveryRow } from "@oma/contracts/ledger";
import { StoreError } from "@oma/domain/errors";

import { mailAudienceDisplayPath, contextRevisionDisplayPath } from "@oma/domain/derived";
import { runnerReceiptPathAt } from "@oma/domain/paths";

import { encodeBatchView, type BatchViewLimits } from "@oma/protocol/batch-view";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";

import type { CheckedReceipt } from "@oma/contracts/runtime";
import type { BatchRow } from "@oma/contracts/ledger";
import { MailMaterializer, operationMessage } from "./materializer.js";
import { selectBatch } from "./batch-policy.js";
import { displaySubject } from "./headers.js";

import type { SettlementQuiescence } from "@oma/contracts/runtime";
import type { SettlementOutcome } from "@oma/domain/batch-settlement";

export class BatchCoordinator {
  constructor(private readonly store: MailLedger, private readonly stateRoot: string,
    private readonly materializer: MailMaterializer, private readonly effects: MailEffects, private readonly maximum: number,
    private readonly limits: BatchViewLimits | undefined) {}
  private messagePlan(delivery: DeliveryRow) {
    const operation = this.store.getOperationById(delivery.operationId);
    if (!operation) throw new StoreError("STORE_CORRUPT", `missing operation ${delivery.operationId}`);
    const message = operationMessage(operation, delivery.messageId);
    if (message.id !== delivery.messageId || !message.recipients.includes(delivery.recipient))
      throw new StoreError("STORE_CORRUPT", `message plan mismatch for ${delivery.messageId}`);
    return message;
  }
  private noticeFor(agent: Actor, ids: readonly MessageId[], again = false): string {
    // DR6, D01: a batch prepared before and not confirmed complete says so,
    // so a model that sees the same messages again does not drop unfinished work.
    const lines: string[] = again ? [REDELIVERY_NOTICE] : [];
    for (const [index, id] of ids.slice(0, 6).entries()) {
      const delivery = this.store.getDelivery(id, agent);
      if (!delivery) throw new StoreError("STORE_CORRUPT", `missing delivery ${id}/${agent}`);
      const message = this.messagePlan(delivery); const headers = this.materializer.headers(message);
      const reply = headers.inReplyTo ?? headers.references.at(-1) ?? null;
      const context = message.contextRevision ? ` context=${contextRevisionDisplayPath(message.contextRevision)}${message.kind === "context" ? "/GOAL.md" : ""}` : "";
      lines.push(`${index + 1}. sender=${oneLine(headers.from)} subject=${oneLine(displaySubject(headers.subject))} kind=${message.kind} path=${mailAudienceDisplayPath(message)}${reply ? ` reply=${reply}` : ""}${context}`);
    }
    if (ids.length > 6) lines.push(`… +${ids.length - 6} more`);
    lines.push("Full list: /inbox.md"); return lines.join("\n");
  }
  /** The expected batch of a receipt comes from the ledger, never a caller,
   * as presented in delivery attempt `attempt` (DR9). */
  private snapshot(row: BatchRow, agent: Actor, attempt: number): PreparedBatch {
    const ids: unknown = JSON.parse(row.messageIdsJson);
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new StoreError("STORE_CORRUPT", "invalid decoded batch manifest");
    return batchOf({ id: row.id, incarnation: attempt, messageIds: ids as string[], sessionPath: row.sessionPath }, agent);
  }
  private finishPrepared(batch: PreparedBatch): PreparedBatch {
    // Check the same bytes the extension will consume before changing Maildir views.
    encodeBatchView(batch, this.limits);
    this.moveToCur(batch.agent, batch.messageIds);
    this.effects.publishBatchView(batch, this.limits, (id) => {
      const delivery = this.store.getDelivery(id, batch.agent);
      if (delivery === null) return null;
      const message = this.messagePlan(delivery);
      return { review: message.review, displayPath: mailAudienceDisplayPath(message) };
    });
    return batch;
  }
  async prepare(auth: AuthContext): Promise<PreparedBatch | null> {
    // A closed society keeps queued mail, but starts no automatic model turn.
    if (!this.store.societyOpen()) return null;
    const existing = this.store.preparedBatches(auth.actor);
    if (existing.length > 0) {
      const row = existing[0]!;
      // DR9: the batch is presented in this lease's attempt; its row, and so
      // the attempt it was first prepared in, stays as it was.
      if (row.incarnation > auth.incarnation) throw new StoreError("BATCH_CONFLICT", "prepared batch belongs to a later run");
      const prepared = this.snapshot(row, auth.actor, auth.incarnation);
      return this.finishPrepared({ ...prepared, notice: this.noticeFor(auth.actor, prepared.messageIds, true) });
    }
    const candidates = function* (owner: BatchCoordinator) {
      for (const value of owner.store.pendingDeliveryRows(auth.actor)) {
        const message = owner.messagePlan(value);
        yield { value, publicList: message.kind === "message" && message.to.length > 0 &&
          message.to.every(to => to === "commons" || to === "residents" || to.startsWith("topic/")) };
      }
    };
    const pending = selectBatch(candidates(this), this.maximum);
    if (pending.length === 0) return null;
    const batch = { id: this.effects.nextBatchId(), agent: auth.actor, incarnation: auth.incarnation,
      messageIds: pending.map(delivery => delivery.messageId), sessionPath: null };
    const prepared = batchOf(batch, auth.actor, this.noticeFor(auth.actor, batch.messageIds));
    encodeBatchView(prepared, this.limits);
    try { this.store.transaction(tx => { tx.insertPreparedBatch(batch); tx.linkDeliveriesToBatch(batch.id, batch.messageIds); }); }
    catch (error) { if (error instanceof StoreError && error.code === "BATCH_CONFLICT") return null; throw error; }
    return this.finishPrepared(prepared);
  }
  /** A live completion: the requester completes its own delivery attempt
   * (current authority), and the ledger records it against the batch's
   * attempts (DR9). */
  async complete(auth: AuthContext, evidence: BoundaryEvidence): Promise<void> {
    const batch = this.store.getBatch(evidence.batchId);
    if (!batch) throw new StoreError("BATCH_CONFLICT", `unknown batch ${evidence.batchId}`);
    if (batch.agent !== auth.actor || auth.incarnation !== evidence.incarnation || batch.incarnation > evidence.incarnation)
      throw new StoreError("BATCH_CONFLICT", "batch ownership mismatch");
    if (!this.limits || evidence.adapterRevision !== PI_ADAPTER_REVISION ||
        evidence.receiptPath !== runnerReceiptPathAt(this.stateRoot, auth.actor, batch.id))
      throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", "batch completion does not identify the pinned trusted receipt");
    const prepared = this.snapshot(batch, auth.actor, evidence.incarnation);
    const receipt = this.effects.readReceipt(prepared, this.limits.frameBytes);
    if (receipt.sessionPath !== evidence.sessionPath)
      throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", "receipt and completion session paths differ");
    this.store.transaction(tx => tx.completeBatch(batch.id, prepared.messageIds, auth.actor, receipt.incarnation, receipt.sessionPath));
  }
  /** D01/BATCH-004: broker-owned settlement of one prepared batch from its own
   * exact receipt, before rollover. No RPC reaches this: it prepares no batch,
   * starts no engine and grants no lease. A completed batch keeps its first
   * terminal fact; anything but a verified receipt settles nothing. The ledger
   * transition re-checks batch, actor, incarnation, manifest and state. */
  settleFromReceipt(quiescence: SettlementQuiescence, batchId: string): SettlementOutcome {
    if (!this.limits) throw new StoreError("UNSUPPORTED_PROFILE", "receipt settlement requires the configured frame limit");
    const row = this.store.getBatch(batchId);
    if (!row) throw new StoreError("BATCH_CONFLICT", `unknown batch ${batchId}`);
    // The authority is exactly the run now ending: the agent's current lease.
    if (row.agent !== quiescence.actor || row.incarnation > quiescence.incarnation ||
        this.store.getAgent(quiescence.actor)?.incarnation !== quiescence.incarnation)
      throw new StoreError("BATCH_CONFLICT", "settlement authority is not this batch's actor and its ending run");
    if (row.state === "completed") return { kind: "completed" };
    // DR9: every attempt from the batch's first to the run now ending is the
    // batch's; a receipt of any of them is its evidence.
    const snapshot = this.snapshot(row, quiescence.actor, quiescence.incarnation);
    const decision = this.effects.receiptDecision(snapshot, this.limits.frameBytes,
      { first: row.incarnation, last: quiescence.incarnation });
    switch (decision.action) {
      case "present": return { kind: "present" };
      case "hold": return { kind: "hold", error: decision.error };
      case "settle": {
        quiescence.confirm();
        const receipt = decision.receipt;
        this.store.transaction(tx => tx.completeBatch(row.id, snapshot.messageIds, quiescence.actor, receipt.incarnation, receipt.sessionPath));
        return { kind: "settled", receipt };
      }
    }
  }
  moveToCur(agent: Actor, ids: readonly MessageId[]): number {
    let count = 0;
    for (const id of ids) {
      const delivery = this.store.getDelivery(id, agent);
      if (!delivery) throw new StoreError("STORE_CORRUPT", `missing delivery ${id}/${agent}`);
      const message = this.messagePlan(delivery);
      this.effects.readMessage(message);

      const inbox = this.effects.openInbox(agent);
      try {
        const fresh = mailEntryPresent(inbox.observeInboxMessage("new", message));
        const current = mailEntryPresent(inbox.observeInboxMessage("cur", message));
        if (fresh) {
          if (current) inbox.removeNew(id); else inbox.moveNewToCur(id);
          count++;
        } else if (!current) throw new StoreError("STORE_CORRUPT", `missing mailbox delivery ${id}/${agent}`);
        inbox.flushCur(); inbox.flushNew();
      } finally { inbox.close(); }
    }
    return count;
  }
}
function oneLine(value: string | null): string { return (value ?? "").replace(/\s+/g, " ").trim(); }
/** DR6: true whether or not the earlier preparation ever reached the engine. */
export const REDELIVERY_NOTICE = "Redelivery: this batch was prepared before, but its completion was not confirmed, so it is delivered again. You may have received it already. If this session has work on this batch, continue whatever is unfinished.";
export function batchOf(batch: { id: string; incarnation: number; messageIds: string[]; sessionPath: string | null }, agent: Actor, notice = batchNotice(batch.messageIds)): PreparedBatch {
  return { id: batch.id, agent, incarnation: batch.incarnation, messageIds: batch.messageIds,
    sessionPath: batch.sessionPath, deliveryMode: "followUp", notice, indexPath: "/inbox.md" };
}
export function batchNotice(ids: readonly string[]): string {
  const lines = ids.slice(0, 6).map((id, index) => `${index + 1}. mail ${id}`);
  if (ids.length > 6) lines.push(`… +${ids.length - 6} more`);
  lines.push("Full list: /inbox.md"); return lines.join("\n");
}
