/** DB-004..009: equality is checked explicitly; zero changed rows are not proof.
 * Called only under one Store root transaction. No host or physical effects.
 */
import type { DatabaseSync } from "node:sqlite";
import { StoreError } from "@oma/domain/errors";
import { isValidActor, isValidTopicName, isValidMessageId, isValidOperationId, parseMessageId } from "@oma/domain/identifiers";
import type { LedgerReader } from "./ledger-reader.js";
import { decodeSubscriptionRow, decodeDeliveryRow, decodeBatchRow, decodeBatchManifest } from "./rows.js";

export interface DeliveryIdentity { messageId: string; recipient: string; operationId: string }
export interface PreparedBatchInput { id: string; agent: string; incarnation: number; messageIds: string[]; sessionPath: string | null }
function corrupt(message: string): never { throw new StoreError("STORE_CORRUPT", message); }
function conflict(message: string): never { throw new StoreError("BATCH_CONFLICT", message); }
function changedExactlyOne(result: { changes: number | bigint }, label: string): void {
  if (result.changes !== 1 && result.changes !== 1n) corrupt(`${label} did not change exactly one expected row`);
}
function equalManifest(frozen: string, values: readonly string[]): void {
  const ids = decodeBatchManifest(frozen);
  if (ids.length !== values.length || ids.some((id, index) => id !== values[index])) conflict("batch manifest differs in identity, count or order");
}

export class LedgerTransitions {
  private readonly touchedBatches = new Set<string>();
  private readonly touchedOperations = new Set<string>();
  constructor(private readonly db: Pick<DatabaseSync, "prepare">, private readonly read: LedgerReader,
    private readonly requireLive: () => void, private readonly now: () => number = Date.now) {}
  /** Complete-set checks run before COMMIT, never in a deliberately partial link step. */
  validatePending(): void {
    this.requireLive();
    for (const id of this.touchedOperations) if (this.read.operationById(id) === null) corrupt("delivery operation is missing");
    for (const id of this.touchedBatches) if (this.read.batch(id) === null) corrupt("touched batch is missing");
  }
  reset(): void { this.touchedBatches.clear(); this.touchedOperations.clear(); }

  follow(topic: string, agent: string): void {
    this.requireLive();
    if (!isValidTopicName(topic) || !isValidActor(agent)) throw new StoreError("INVALID_REQUEST", "invalid subscription identity");
    this.db.prepare(`INSERT INTO subscriptions (topic, agent, created_at_ms) VALUES (?,?,?)
      ON CONFLICT(topic, agent) DO NOTHING`).run(topic, agent, this.now());
    const row = decodeSubscriptionRow(this.db.prepare("SELECT * FROM subscriptions WHERE topic=? AND agent=?").get(topic, agent));
    if (row.topic !== topic || row.agent !== agent || this.read.agent(agent) === null) corrupt("subscription identity mismatch after insert/replay");
  }
  insertDeliveries(deliveries: readonly DeliveryIdentity[]): void {
    this.requireLive();
    const insert = this.db.prepare(`INSERT INTO deliveries
      (message_id, recipient, operation_id, materialized, presented, acknowledged, created_at_ms)
      VALUES (?,?,?,0,0,0,?) ON CONFLICT(message_id, recipient) DO NOTHING`);
    for (const input of deliveries) {
      if (!isValidMessageId(input.messageId) || !isValidOperationId(input.operationId) || !isValidActor(input.recipient) ||
          parseMessageId(input.messageId)?.operationId !== input.operationId) corrupt("delivery immutable identity is inconsistent");
      insert.run(input.messageId, input.recipient, input.operationId, this.now());
      const row = decodeDeliveryRow(this.db.prepare("SELECT * FROM deliveries WHERE message_id=? AND recipient=?").get(input.messageId, input.recipient));
      if (row.operationId !== input.operationId || row.messageId !== input.messageId || row.recipient !== input.recipient)
        corrupt("delivery key already belongs to different immutable facts");
      this.touchedOperations.add(input.operationId);
    }
  }
  markMaterialized(message: string, recipient: string): boolean {
    this.requireLive();
    const row = this.read.delivery(message, recipient);
    if (!row) corrupt("cannot materialize a missing delivery");
    if (row.materialized === 1) return false; // Preserve the first durable fact time.
    changedExactlyOne(this.db.prepare(`UPDATE deliveries SET materialized=1, materialized_at_ms=MAX(?, created_at_ms)
      WHERE message_id=? AND recipient=? AND operation_id=? AND materialized=0 AND materialized_at_ms IS NULL`)
      .run(this.now(), message, recipient, row.operationId), "materialization");
    this.read.delivery(message, recipient);
    return true;
  }
  markAcknowledged(message: string, recipient: string): void {
    this.requireLive();
    const row = this.read.delivery(message, recipient);
    if (!row) throw new StoreError("REQUEST_NOT_FOUND", "cannot acknowledge a missing delivery");
    if (row.acknowledged === 1) return;
    changedExactlyOne(this.db.prepare(`UPDATE deliveries SET acknowledged=1, acknowledged_at_ms=MAX(?, created_at_ms)
      WHERE message_id=? AND recipient=? AND operation_id=? AND acknowledged=0 AND acknowledged_at_ms IS NULL`)
      .run(this.now(), message, recipient, row.operationId), "acknowledgement");
    this.read.delivery(message, recipient);
  }
  /** DR9: `incarnation` is the batch's first delivery attempt, the lease that
   * prepares it, and it never changes. Later attempts are the later leases of
   * the same agent; nothing here moves a batch to them. */
  insertPreparedBatch(input: PreparedBatchInput): void {
    this.requireLive();
    const manifest = JSON.stringify(input.messageIds);
    const createdAt = this.now();
    decodeBatchRow({ id: input.id, agent: input.agent, incarnation: input.incarnation, message_ids_json: manifest,
      session_path: input.sessionPath, state: "prepared", created_at_ms: createdAt, completed_at_ms: null });
    const existing = this.db.prepare("SELECT * FROM batches WHERE id=?").get(input.id);
    if (existing !== undefined) {
      const batch = decodeBatchRow(existing);
      if (batch.agent !== input.agent || batch.incarnation !== input.incarnation || batch.messageIdsJson !== manifest || batch.sessionPath !== input.sessionPath)
        conflict("batch id already belongs to different immutable facts");
      this.touchedBatches.add(input.id);
      return;
    }
    if (this.read.agent(input.agent)?.incarnation !== input.incarnation) conflict("batch creation incarnation is not current");
    this.db.prepare(`INSERT INTO batches (id, agent, incarnation, message_ids_json, session_path, state, created_at_ms, completed_at_ms)
      VALUES (?,?,?,?,?,'prepared',?,NULL)`).run(input.id, input.agent, input.incarnation, manifest, input.sessionPath, createdAt);
    this.touchedBatches.add(input.id);
  }
  linkDeliveriesToBatch(id: string, messages: readonly string[]): void {
    this.requireLive();
    const raw = this.db.prepare("SELECT * FROM batches WHERE id=?").get(id);
    if (raw === undefined) conflict("batch does not exist");
    const batch = decodeBatchRow(raw);
    if (batch.state !== "prepared") conflict("completed batch is immutable");
    if (this.read.agent(batch.agent)?.incarnation !== batch.incarnation) conflict("batch link incarnation is stale");
    equalManifest(batch.messageIdsJson, messages);
    const already = this.db.prepare("SELECT * FROM deliveries WHERE batch_id=?").all(id).map(decodeDeliveryRow);
    if (already.some(row => row.recipient !== batch.agent || !messages.includes(row.messageId))) conflict("batch has additional or foreign linked deliveries");
    const rows = messages.map(message => {
      const rawDelivery = this.db.prepare("SELECT * FROM deliveries WHERE message_id=? AND recipient=?").get(message, batch.agent);
      if (rawDelivery === undefined) conflict("batch manifest delivery is missing");
      const delivery = decodeDeliveryRow(rawDelivery);
      if (delivery.materialized !== 1 || delivery.presented !== 0 || (delivery.batchId !== null && delivery.batchId !== id)) conflict("delivery is not available for this batch");
      this.read.operationById(delivery.operationId); // checks the immutable recipient snapshot, not a partial batch set
      return delivery;
    });
    for (const delivery of rows) {
      if (delivery.batchId === id) continue;
      changedExactlyOne(this.db.prepare(`UPDATE deliveries SET batch_id=? WHERE message_id=? AND recipient=?
        AND operation_id=? AND materialized=1 AND presented=0 AND batch_id IS NULL`)
        .run(id, delivery.messageId, batch.agent, delivery.operationId), "batch delivery link");
    }
    this.touchedBatches.add(id);
    this.read.batch(id);
  }
  /** DR9: a completion records a presentation that already happened in one of
   * the batch's delivery attempts -- the lease it was created in up to the
   * agent's current one. It is not a new effect, so it is bound to that attempt
   * and its evidence, never to which lease is current now; the caller checks
   * the requester's own authority. */
  completeBatch(id: string, messages: readonly string[], agent: string, attempt: number, sessionPath: string): void {
    this.requireLive();
    const batch = this.read.batch(id);
    if (!batch || batch.agent !== agent) conflict("batch owner does not match");
    equalManifest(batch.messageIdsJson, messages);
    const owner = this.read.agent(agent);
    if (!Number.isSafeInteger(attempt) || attempt < batch.incarnation || owner === null || attempt > owner.incarnation)
      conflict("batch completion names no delivery attempt of this batch");
    if (batch.state === "completed") {
      if (batch.sessionPath !== sessionPath) conflict("completed batch session differs");
      return; // Exact replay keeps all first fact timestamps.
    }
    if (batch.sessionPath !== null && batch.sessionPath !== sessionPath) conflict("prepared batch session differs");
    const at = this.now();
    changedExactlyOne(this.db.prepare(`UPDATE batches SET state='completed', completed_at_ms=MAX(?, created_at_ms), session_path=?
      WHERE id=? AND agent=? AND incarnation=? AND state='prepared' AND completed_at_ms IS NULL AND (session_path IS NULL OR session_path=?)`)
      .run(at, sessionPath, id, agent, batch.incarnation, sessionPath), "batch completion");
    for (const message of messages) {
      // P0V-56, P0-5: presentation follows materialization as well as
      // creation; a wall clock that stepped back in between is not a row
      // the decoder must reject as corrupt.
      changedExactlyOne(this.db.prepare(`UPDATE deliveries SET presented=1, presented_at_ms=MAX(?, created_at_ms, materialized_at_ms)
        WHERE message_id=? AND recipient=? AND batch_id=? AND materialized=1 AND presented=0 AND presented_at_ms IS NULL
        AND EXISTS (SELECT 1 FROM batches WHERE id=? AND agent=? AND incarnation=? AND state='completed')`)
        .run(at, message, agent, id, id, agent, batch.incarnation), "batch presentation");
    }
    this.touchedBatches.add(id);
    this.read.batch(id);
  }
}
