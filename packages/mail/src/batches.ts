import { mailEntryPresent } from "./observations.js";

import type { Actor, AuthContext, BatchCompletionInput, MessageId, PreparedBatch } from "@oma/contracts";
import type { MailLedger, MailEffects } from "./ports.js";
import { type DeliveryRow } from "@oma/contracts/ledger";
import { StoreError } from "@oma/domain/errors";

import { mailAudienceDisplayPath, contextRevisionDisplayPath } from "@oma/domain/derived";
import { runnerReceiptPathAt } from "@oma/domain/paths";

import { batchReplyBytes, batchReplyNoticeBudget, encodeBatchView, MIN_BATCH_VIEW_FRAME_BYTES, type BatchViewLimits, type BatchReplyBudget } from "@oma/protocol/batch-view";
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
  /** BATCH-002: the batch's own metadata rows, never message bodies. DR6,
   * D01: a batch prepared before and not confirmed complete says so, so a
   * model that sees the same messages again does not drop unfinished work.
   * AUD-08: the frame is the delivery bound, so under a small frame the notice
   * elides item values with an explicit marker and counts items it cannot
   * name in `… +N more`; the manifest and /inbox.md stay complete. */
  private noticeFor(agent: Actor, ids: readonly MessageId[], again = false, budget?: number): string {
    const items: NoticeItem[] = [];
    for (const id of ids.slice(0, NOTICE_ITEM_LIMIT)) {
      const delivery = this.store.getDelivery(id, agent);
      if (!delivery) throw new StoreError("STORE_CORRUPT", `missing delivery ${id}/${agent}`);
      const message = this.messagePlan(delivery); const headers = this.materializer.headers(message);
      const reply = headers.inReplyTo ?? headers.references.at(-1) ?? null;
      items.push({ from: oneLine(headers.from), subject: oneLine(displaySubject(headers.subject)), kind: message.kind,
        path: mailAudienceDisplayPath(message), reply,
        context: message.contextRevision ? ` context=${contextRevisionDisplayPath(message.contextRevision)}${message.kind === "context" ? "/GOAL.md" : ""}` : "" });
    }
    const header = again ? [REDELIVERY_NOTICE] : [];
    if (budget === undefined)
      return [...header, ...items.map((item, index) => noticeItemLine(index + 1, item, item.subject)),
        ...(ids.length > items.length ? [`… +${ids.length - items.length} more`] : []), NOTICE_FOOTER].join("\n");
    return boundedNotice(header, items, ids.length, budget);
  }
  /** AUD-08: an existing prepared batch presented again -- DR6's first line
   * plus the same bounded rows, inside the same frame. */
  private revisited(prepared: PreparedBatch, reply?: BatchReplyBudget): PreparedBatch {
    const budget = batchReplyNoticeBudget(prepared, this.limits, reply) ?? undefined;
    if (reply && budget !== undefined && (reply.noticeBytes ?? 0) > budget)
      throw new StoreError("UNSUPPORTED_PROFILE", "frameBytes cannot carry this original prepared batch and its delivery reference");
    return { ...prepared, notice: this.noticeFor(prepared.agent, prepared.messageIds, true, budget) };
  }
  /** AUD-08: a frame must carry the whole six-field view, so a manifest that
   * cannot fit is paged down to the largest oldest-first prefix whose fresh
   * *and* redelivered notices both encode. A shorter prefix always fits when a
   * longer one does -- its envelope shrinks and its notice budget grows -- so
   * the search is a binary one over prefix length. Below the codec's floor no
   * prefix fits and prepare refuses the profile instead of half-serving
   * accepted mail. */
  private fitPrepared(batch: { id: string; agent: Actor; incarnation: number; messageIds: MessageId[]; sessionPath: string | null }, reply?: BatchReplyBudget): PreparedBatch | null {
    const fits = (candidate: PreparedBatch): boolean => {
      try { encodeBatchView(candidate, this.limits); return !reply || batchReplyBytes(candidate, reply.responseId) <= reply.frameBytes; }
      catch (error) {
        if (error instanceof StoreError && (error.code === "INVALID_REQUEST" || error.code === "LIMIT_EXCEEDED")) return false;
        throw error;
      }
    };
    let low = 0; let high = batch.messageIds.length; let best: PreparedBatch | null = null;
    while (low < high) {
      const end = Math.ceil((low + high) / 2);
      const messageIds = batch.messageIds.slice(0, end);
      const skeleton = { ...batch, messageIds };
      const budget = batchReplyNoticeBudget(batchOf(skeleton, batch.agent, ""), this.limits, reply) ?? undefined;
      if (reply && budget !== undefined && (reply.noticeBytes ?? 0) > budget) { high = end - 1; continue; }
      const fresh = batchOf(skeleton, batch.agent, this.noticeFor(batch.agent, messageIds, false, budget));
      const again = batchOf(skeleton, batch.agent, this.noticeFor(batch.agent, messageIds, true, budget));
      if (fits(fresh) && fits(again)) { best = fresh; low = end; } else high = end - 1;
    }
    return best;
  }
  /** The expected batch of a receipt comes from the ledger, never a caller,
   * as presented in delivery attempt `attempt` (DR9). */
  private snapshot(row: BatchRow, agent: Actor, attempt: number): PreparedBatch {
    const ids: unknown = JSON.parse(row.messageIdsJson);
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new StoreError("STORE_CORRUPT", "invalid decoded batch manifest");
    return batchOf({ id: row.id, incarnation: attempt, messageIds: ids as string[], sessionPath: row.sessionPath }, agent);
  }
  private finishPrepared(batch: PreparedBatch, reply?: BatchReplyBudget): PreparedBatch {
    // Check the same bytes the extension will consume before changing Maildir views.
    encodeBatchView(batch, this.limits);
    if (reply && batchReplyBytes(batch, reply.responseId) > reply.frameBytes)
      throw new StoreError("UNSUPPORTED_PROFILE", "frameBytes cannot carry the original prepared batch RPC result");
    this.moveToCur(batch.agent, batch.messageIds);
    this.effects.publishBatchView(batch, this.limits, (id) => {
      const delivery = this.store.getDelivery(id, batch.agent);
      if (delivery === null) return null;
      const message = this.messagePlan(delivery);
      return { review: message.review, displayPath: mailAudienceDisplayPath(message) };
    });
    return batch;
  }
  async prepare(auth: AuthContext, deferred?: ReadonlySet<string>, reply?: BatchReplyBudget): Promise<PreparedBatch | null> {
    // A closed society keeps queued mail, but starts no automatic model turn.
    if (!this.store.societyOpen()) return null;
    const existing = this.store.preparedBatches(auth.actor);
    if (existing.some(batch => batch.incarnation > auth.incarnation))
      throw new StoreError("BATCH_CONFLICT", "prepared batch belongs to a later run");
    // A fresh-work wake may leave an older waited batch prepared, but never
    // runs two deliveries concurrently. Its exact manifest remains untouched.
    const row = existing.find(batch => !deferred || this.snapshot(batch, auth.actor, auth.incarnation).messageIds.some(id => !deferred.has(id)));
    if (row) {
      // DR9: the batch is presented in this lease's attempt; its row, and so
      // the attempt it was first prepared in, stays as it was.
      return this.finishPrepared(this.revisited(this.snapshot(row, auth.actor, auth.incarnation), reply), reply);
    }
    const candidates = function* (owner: BatchCoordinator) {
      for (const value of owner.store.pendingDeliveryRows(auth.actor)) {
        if (deferred?.has(value.messageId)) continue;
        const message = owner.messagePlan(value);
        yield { value, publicList: message.kind === "message" && message.to.length > 0 &&
          message.to.every(to => to === "commons" || to === "residents" || to.startsWith("topic/")) };
      }
    };
    const pending = selectBatch(candidates(this), this.maximum);
    if (pending.length === 0) {
      const previous = existing[0];
      if (!previous) return null;
      return this.finishPrepared(this.revisited(this.snapshot(previous, auth.actor, auth.incarnation), reply), reply);
    }
    const prepared = this.fitPrepared({ id: this.effects.nextBatchId(), agent: auth.actor, incarnation: auth.incarnation,
      messageIds: pending.map(delivery => delivery.messageId), sessionPath: null }, reply);
    if (prepared === null)
      throw new StoreError("UNSUPPORTED_PROFILE",
        `limits.frameBytes cannot carry a prepared batch view (minimum ${MIN_BATCH_VIEW_FRAME_BYTES} bytes)`);
    try { this.store.transaction(tx => {
      tx.insertPreparedBatch({ id: prepared.id, agent: prepared.agent, incarnation: prepared.incarnation,
        messageIds: prepared.messageIds, sessionPath: prepared.sessionPath });
      tx.linkDeliveriesToBatch(prepared.id, prepared.messageIds);
    }); }
    catch (error) { if (error instanceof StoreError && error.code === "BATCH_CONFLICT") return null; throw error; }
    return this.finishPrepared(prepared, reply);
  }
  /** A live completion: the requester completes its own delivery attempt
   * (current authority), and the ledger records it against the batch's
   * attempts (DR9). */
  async complete(auth: AuthContext, evidence: BatchCompletionInput): Promise<void> {
    const batch = this.store.getBatch(evidence.batchId);
    if (!batch) throw new StoreError("BATCH_CONFLICT", `unknown batch ${evidence.batchId}`);
    if (batch.agent !== auth.actor || auth.incarnation !== evidence.incarnation || batch.incarnation > evidence.incarnation)
      throw new StoreError("BATCH_CONFLICT", "batch ownership mismatch");
    if (!this.limits || evidence.adapterRevision !== PI_ADAPTER_REVISION ||
        (evidence.receiptPath !== undefined && evidence.receiptPath !== runnerReceiptPathAt(this.stateRoot, auth.actor, batch.id)))
      throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", "batch completion does not identify the pinned trusted receipt");
    const prepared = this.snapshot(batch, auth.actor, evidence.incarnation);
    const receipt = this.effects.readReceipt(prepared, this.limits.frameBytes);
    if (evidence.sessionPath !== undefined && receipt.sessionPath !== evidence.sessionPath)
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
const NOTICE_ITEM_LIMIT = 6;
/** U+2026; the marker's own bytes count against the value's room, so an
 * elided notice never grows past the frame budget that allowed it. */
const NOTICE_ELISION = "…";
const NOTICE_FOOTER = "Full list: /inbox.md";
/** One notice row's display values, already one-lined like the plain rows. */
interface NoticeItem { readonly from: string; readonly subject: string; readonly kind: string;
  readonly path: string; readonly reply: string | null; readonly context: string }
function noticeItemLine(index: number, item: NoticeItem, subject: string): string {
  return `${index}. sender=${item.from} subject=${subject} kind=${item.kind} path=${item.path}` +
    (item.reply ? ` reply=${item.reply}` : "") + item.context;
}
/** JSON-escaped payload bytes of one string, the two quotes JSON.stringify
 * adds aside; additive over concatenation, so two lines differing only in one
 * value differ by exactly that value's escaped bytes. */
const escapedBytes = (value: string): number => Buffer.byteLength(JSON.stringify(value)) - 2;
function elideValue(value: string, maxBytes: number): string {
  const markerBytes = escapedBytes(NOTICE_ELISION);
  if (escapedBytes(value) <= maxBytes) return value;
  if (maxBytes < markerBytes) return "";
  let low = 0; let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (escapedBytes(value.slice(0, middle)) + markerBytes <= maxBytes) low = middle; else high = middle - 1;
  }
  // Never cut between the halves of a surrogate pair.
  if (low > 0 && low < value.length && /[\uD800-\uDBFF]/.test(value[low - 1]!) && /[\uDC00-\uDFFF]/.test(value[low]!)) low--;
  return `${value.slice(0, low)}${NOTICE_ELISION}`;
}
/** AUD-08/BATCH-002: fit the header, up to six item rows and the footer into
 * `budget` escaped bytes. The notice names as many items as fit at their
 * minimal form (subject elided) and spends what remains on their subjects in
 * item order; items it cannot name are counted in `… +N more`. Only complete
 * lines are emitted. Under the codec's frame floor even the remainder cannot
 * fit; the caller's view check then refuses the profile explicitly instead of
 * leaving accepted mail permanently pending. */
function boundedNotice(header: readonly string[], items: readonly NoticeItem[], total: number, budget: number): string {
  const cost = (line: string): number => escapedBytes(line) + 2;
  const baseCost = header.reduce((sum, line) => sum + cost(line), 0);
  for (let shown = items.length; shown >= 0; shown--) {
    const omitted = total - shown;
    const tail = omitted > 0 ? [`… +${omitted} more`, NOTICE_FOOTER] : [NOTICE_FOOTER];
    const minimal = items.slice(0, shown).map((item, index) => noticeItemLine(index + 1, item, NOTICE_ELISION));
    const totalCost = (rows: readonly string[]): number =>
      baseCost + [...tail, ...rows].reduce((sum, line) => sum + cost(line), 0);
    if (totalCost(minimal) > budget) continue;
    let room = budget - totalCost(minimal);
    const rows = minimal.map((line, index) => {
      const item = items[index]!;
      const full = noticeItemLine(index + 1, item, item.subject);
      const need = cost(full) - cost(line);
      if (need <= 0) return full;
      if (room <= 0) return line;
      const grow = Math.min(room, need);
      room -= grow;
      return noticeItemLine(index + 1, item, elideValue(item.subject, escapedBytes(NOTICE_ELISION) + grow));
    });
    return [...header, ...rows, ...tail].join("\n");
  }
  return [...header, NOTICE_FOOTER].join("\n");
}
/** DR6: true whether or not the earlier preparation ever reached the engine. */
export const REDELIVERY_NOTICE = "Redelivery: completion of this prepared batch was not confirmed. Use the saved session and recorded operation outcomes to continue unfinished work; do not repeat completed effects under new request keys.";
export function batchOf(batch: { id: string; incarnation: number; messageIds: string[]; sessionPath: string | null }, agent: Actor, notice = batchNotice(batch.messageIds)): PreparedBatch {
  return { id: batch.id, agent, incarnation: batch.incarnation, messageIds: batch.messageIds,
    sessionPath: batch.sessionPath, deliveryMode: "followUp", notice, indexPath: "/inbox.md" };
}
export function batchNotice(ids: readonly string[]): string {
  const lines = ids.slice(0, 6).map((id, index) => `${index + 1}. mail ${id}`);
  if (ids.length > 6) lines.push(`… +${ids.length - 6} more`);
  lines.push("Full list: /inbox.md"); return lines.join("\n");
}
