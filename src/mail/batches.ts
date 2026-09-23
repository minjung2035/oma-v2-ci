import { unlinkSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { Actor, AuthContext, BoundaryEvidence, MessageId, PreparedBatch } from "../../implementation/contracts.js";
import { Store, type DeliveryRow } from "../store.js";
import { StoreError } from "../domain/errors.js";
import { generateBatchId } from "../ids.js";
import { mailArchiveDisplayPath, contextRevisionDisplayPath } from "../domain/derived.js";
import { mailObjectPathAt, mailInboxPathAt, runnerReceiptPathAt } from "../storage/paths.js";
import { ensureDurableDirectory, fsyncDir } from "../storage/durable-fs.js";
import { observeImmutableFile, readImmutableBytes } from "../storage/immutable-file.js";
import { publishBatchView } from "../storage/batch-view.js";
import { encodeBatchView, type BatchViewLimits } from "../protocol/batch-view.js";
import {
  PI_ADAPTER_REVISION, observeDeliveryReceipt, readDeliveryReceipt, type CheckedReceipt, type ReceiptObservation,
} from "../storage/delivery-receipt.js";
import type { BatchRow } from "../storage/rows.js";
import { MailMaterializer, operationMessage } from "./materializer.js";
import { selectBatch } from "./batch-policy.js";

/** D01/BATCH-004: what a broker-owned settlement must hold. The next run of
 * `actor` has begun only after its previous invocation's cgroup was proven
 * empty or removed (or this broker's startup quiesced every unit before
 * admitting runs), and no endpoint of that next run exists yet, so nothing at
 * `incarnation` can still act. `confirm` re-checks this immediately before the
 * ledger transition; it is not a flag that stays true. */
export interface SettlementQuiescence {
  readonly actor: Actor;
  readonly incarnation: number;
  confirm(): void;
}
export type SettlementOutcome =
  | { readonly kind: "settled"; readonly receipt: CheckedReceipt }
  | { readonly kind: "completed" }
  | Exclude<ReceiptObservation, { readonly kind: "verified" }>;

export class BatchCoordinator {
  constructor(private readonly store: Store, private readonly stateRoot: string,
    private readonly materializer: MailMaterializer, private readonly maximum: number,
    private readonly limits: BatchViewLimits | undefined) {}
  private messagePlan(delivery: DeliveryRow) {
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
  /** The expected batch of a receipt comes from the ledger, never a caller. */
  private snapshot(row: BatchRow, agent: Actor): PreparedBatch {
    const ids: unknown = JSON.parse(row.messageIdsJson);
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new StoreError("STORE_CORRUPT", "invalid decoded batch manifest");
    return batchOf({ id: row.id, incarnation: row.incarnation, messageIds: ids as string[], sessionPath: row.sessionPath }, agent);
  }
  private finishPrepared(batch: PreparedBatch): PreparedBatch {
    // Check the same bytes the extension will consume before changing Maildir views.
    encodeBatchView(batch, this.limits);
    this.moveToCur(batch.agent, batch.messageIds);
    publishBatchView(this.stateRoot, batch, this.limits);
    return batch;
  }
  async prepare(auth: AuthContext): Promise<PreparedBatch | null> {
    const existing = this.store.preparedBatches(auth.actor);
    if (existing.length > 0) {
      const row = existing[0]!;
      const ids: unknown = JSON.parse(row.messageIdsJson);
      if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new StoreError("STORE_CORRUPT", "invalid decoded batch manifest");
      const messageIds = ids as string[];
      return this.finishPrepared(batchOf({ id: row.id, incarnation: row.incarnation, messageIds, sessionPath: row.sessionPath }, auth.actor, this.noticeFor(auth.actor, messageIds)));
    }
    const pending = selectBatch(this.store.pendingDeliveries(auth.actor).map(value => {
      const message = this.messagePlan(value);
      return { value, publicList: message.kind === "message" && message.to.length > 0 &&
        message.to.every(to => to === "commons" || to === "residents" || to.startsWith("topic/")) };
    }), this.maximum);
    if (pending.length === 0) return null;
    const batch = { id: generateBatchId(), agent: auth.actor, incarnation: auth.incarnation,
      messageIds: pending.map(delivery => delivery.messageId), sessionPath: null };
    const prepared = batchOf(batch, auth.actor, this.noticeFor(auth.actor, batch.messageIds));
    encodeBatchView(prepared, this.limits);
    try { this.store.transaction(tx => { tx.insertPreparedBatch(batch); tx.linkDeliveriesToBatch(batch.id, batch.messageIds); }); }
    catch (error) { if (error instanceof StoreError && error.code === "BATCH_CONFLICT") return null; throw error; }
    return this.finishPrepared(prepared);
  }
  async complete(auth: AuthContext, evidence: BoundaryEvidence): Promise<void> {
    const batch = this.store.getBatch(evidence.batchId);
    if (!batch) throw new StoreError("BATCH_CONFLICT", `unknown batch ${evidence.batchId}`);
    if (batch.agent !== auth.actor || auth.incarnation !== evidence.incarnation || batch.incarnation !== evidence.incarnation)
      throw new StoreError("BATCH_CONFLICT", "batch ownership mismatch");
    if (!this.limits || evidence.adapterRevision !== PI_ADAPTER_REVISION ||
        evidence.receiptPath !== runnerReceiptPathAt(this.stateRoot, auth.actor, batch.id))
      throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", "batch completion does not identify the pinned trusted receipt");
    const prepared = this.snapshot(batch, auth.actor);
    const receipt = readDeliveryReceipt(this.stateRoot, prepared, this.limits.frameBytes);
    if (receipt.sessionPath !== evidence.sessionPath)
      throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", "receipt and completion session paths differ");
    this.store.transaction(tx => tx.completeBatch(batch.id, prepared.messageIds, auth.actor, batch.incarnation, receipt.sessionPath));
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
    if (row.agent !== quiescence.actor || row.incarnation !== quiescence.incarnation)
      throw new StoreError("BATCH_CONFLICT", "settlement authority names another actor or incarnation");
    if (row.state === "completed") return { kind: "completed" };
    const snapshot = this.snapshot(row, quiescence.actor);
    const observed = observeDeliveryReceipt(this.stateRoot, snapshot, this.limits.frameBytes);
    if (observed.kind !== "verified") return observed;
    quiescence.confirm();
    this.store.transaction(tx => tx.completeBatch(row.id, snapshot.messageIds, quiescence.actor, row.incarnation, observed.receipt.sessionPath));
    return { kind: "settled", receipt: observed.receipt };
  }
  moveToCur(agent: Actor, ids: readonly MessageId[]): number {
    let count = 0;
    for (const id of ids) {
      const from = mailInboxPathAt(this.stateRoot, agent, id, "new");
      const to = mailInboxPathAt(this.stateRoot, agent, id, "cur");
      const delivery = this.store.getDelivery(id, agent);
      if (!delivery) throw new StoreError("STORE_CORRUPT", `missing delivery ${id}/${agent}`);
      const message = this.messagePlan(delivery); const object = mailObjectPathAt(this.stateRoot, id);
      readImmutableBytes(object, message.sha256, message.bytes);
      const observe = (path: string): boolean => {
        const result = observeImmutableFile(path, message.sha256, message.bytes);
        if (result.kind === "corrupt") throw result.error;
        if (result.kind === "unavailable")
          throw new StoreError("BROKER_UNAVAILABLE", "mailbox observation is unavailable", { cause: result.error });
        return result.kind === "present";
      };
      const fresh = observe(from); const current = observe(to);
      if (fresh) {
        // Persist cur's name in the mailbox parent BEFORE removing the new link.
        ensureDurableDirectory(dirname(to));
        if (current) unlinkSync(from); else renameSync(from, to);
        count++;
      } else if (!current) throw new StoreError("STORE_CORRUPT", `missing mailbox delivery ${id}/${agent}`);
      fsyncDir(dirname(from)); fsyncDir(dirname(to));
    }
    return count;
  }
}
function oneLine(value: string | null): string { return (value ?? "").replace(/\s+/g, " ").trim(); }
export function batchOf(batch: { id: string; incarnation: number; messageIds: string[]; sessionPath: string | null }, agent: Actor, notice = batchNotice(batch.messageIds)): PreparedBatch {
  return { id: batch.id, agent, incarnation: batch.incarnation, messageIds: batch.messageIds,
    sessionPath: batch.sessionPath, deliveryMode: "followUp", notice, indexPath: "/inbox.md" };
}
export function batchNotice(ids: readonly string[]): string {
  const lines = ids.slice(0, 6).map((id, index) => `${index + 1}. mail ${id}`);
  if (ids.length > 6) lines.push(`… +${ids.length - 6} more`);
  lines.push("전체 목록: /inbox.md"); return lines.join("\n");
}
