import { closeSync, unlinkSync, renameSync } from "node:fs";
import { entryAt, openDirectory } from "../storage/contained-fs.js";
import { basename, dirname } from "node:path";
import type { Actor, AuthContext, BoundaryEvidence, MessageId, PreparedBatch } from "../../implementation/contracts.js";
import { Store, type DeliveryRow } from "../store.js";
import { StoreError } from "../domain/errors.js";
import { generateBatchId } from "../ids.js";
import { mailArchiveDisplayPath, contextRevisionDisplayPath } from "../domain/derived.js";
import { mailObjectPathAt, mailInboxPathAt, runnerReceiptPathAt } from "../storage/paths.js";
import { ensureDurableDirectory, fsyncHeldDir } from "../storage/durable-fs.js";
import { observeImmutableEntry, readImmutableBytes, type ImmutableObservation } from "../storage/immutable-file.js";
import { publishBatchView } from "../storage/batch-view.js";
import { encodeBatchView, type BatchViewLimits } from "../protocol/batch-view.js";
import {
  PI_ADAPTER_REVISION, deliveryDecision, observeDeliveryReceipt, readDeliveryReceipt, type CheckedReceipt,
} from "../storage/delivery-receipt.js";
import type { BatchRow } from "../storage/rows.js";
import { MailMaterializer, operationMessage } from "./materializer.js";
import { selectBatch } from "./batch-policy.js";
import { displaySubject } from "./headers.js";

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
/** What a broker-owned settlement found. `present` and `hold` are the receipt
 * decision's own answers (D01, P0-2): the batch may be presented in the next
 * attempt, or nothing may happen until the evidence is observed or repaired. */
export type SettlementOutcome =
  | { readonly kind: "settled"; readonly receipt: CheckedReceipt }
  | { readonly kind: "completed" }
  | { readonly kind: "present" }
  | { readonly kind: "hold"; readonly error: StoreError };

export class BatchCoordinator {
  constructor(private readonly store: Store, private readonly stateRoot: string,
    private readonly materializer: MailMaterializer, private readonly maximum: number,
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
      lines.push(`${index + 1}. sender=${oneLine(headers.from)} subject=${oneLine(displaySubject(headers.subject))} kind=${message.kind} path=${mailArchiveDisplayPath(id)}${reply ? ` reply=${reply}` : ""}${context}`);
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
    publishBatchView(this.stateRoot, batch, this.limits);
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
    const batch = { id: generateBatchId(), agent: auth.actor, incarnation: auth.incarnation,
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
    const receipt = readDeliveryReceipt(this.stateRoot, prepared, this.limits.frameBytes);
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
    const decision = deliveryDecision(observeDeliveryReceipt(this.stateRoot, snapshot, this.limits.frameBytes,
      { first: row.incarnation, last: quiescence.incarnation }));
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
      const from = mailInboxPathAt(this.stateRoot, agent, id, "new");
      const to = mailInboxPathAt(this.stateRoot, agent, id, "cur");
      const delivery = this.store.getDelivery(id, agent);
      if (!delivery) throw new StoreError("STORE_CORRUPT", `missing delivery ${id}/${agent}`);
      const message = this.messagePlan(delivery); const object = mailObjectPathAt(this.stateRoot, id);
      readImmutableBytes(object, message.sha256, message.bytes);
      const present = (result: ImmutableObservation): boolean => {
        if (result.kind === "corrupt") throw result.error;
        if (result.kind === "unavailable")
          throw new StoreError("BROKER_UNAVAILABLE", "mailbox observation is unavailable", { cause: result.error });
        return result.kind === "present";
      };
      // FS-005 / INV09: each mailbox directory is resolved once; what is observed in it
      // and what is renamed or removed there are the same entries.
      const newDirectory = heldParent(from);
      try {
        const fresh = newDirectory !== null && present(observeImmutableEntry(newDirectory, basename(from), message.sha256, message.bytes));
        // Persist cur's name in the mailbox parent BEFORE removing the new link.
        if (fresh) ensureDurableDirectory(dirname(to));
        const curDirectory = heldParent(to);
        try {
          const current = curDirectory !== null && present(observeImmutableEntry(curDirectory, basename(to), message.sha256, message.bytes));
          if (fresh && newDirectory !== null && curDirectory !== null) {
            if (current) unlinkSync(entryAt(newDirectory, basename(from)));
            else renameSync(entryAt(newDirectory, basename(from)), entryAt(curDirectory, basename(to)));
            count++;
          } else if (!current) throw new StoreError("STORE_CORRUPT", `missing mailbox delivery ${id}/${agent}`);
          if (curDirectory !== null) fsyncHeldDir(curDirectory, dirname(to));
        } finally { if (curDirectory !== null) closeSync(curDirectory); }
        if (newDirectory !== null) fsyncHeldDir(newDirectory, dirname(from));
      } finally { if (newDirectory !== null) closeSync(newDirectory); }
    }
    return count;
  }
}
/** A mailbox directory held for one move, or null when it does not exist. */
function heldParent(path: string): number | null {
  try { return openDirectory(dirname(path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
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
