/** DB-009: SELECT-only facade. Full-row, local-reference and whole-list
 * validation are distinct; every lineage rule belongs to LineageSnapshot.
 */
import type { DatabaseSync } from "node:sqlite";
import type { MessagePlan } from "../../implementation/contracts/durable.js";
import type { RepositoryIdentity } from "../durable.js";
import { LineageSnapshot } from "../domain/lineage.js";
import { decodeOperation, type DecodedOperation, type OperationDecodeContext, type OperationOf } from "./operation-codec.js";
import {
  decodeAgentRow, decodeAgentSpec, decodeSubscriptionRow, decodeDeliveryRow, decodeBatchRow,
  decodeBatchManifest, decodeUsageRow, decodeOperationIdProjection, rowCorrupt, safeInteger,
  type AgentRow, type SubscriptionRow, type DeliveryRow, type BatchRow, type UsageRow,
} from "./rows.js";

export class LedgerReader {
  constructor(private readonly db: Pick<DatabaseSync, "prepare">, private readonly stateRoot: string, private readonly identity: () => RepositoryIdentity | null) {}
  private rawAgent(name: string) { return this.db.prepare("SELECT * FROM agents WHERE name=?").get(name); }
  private lineage(agent: AgentRow): void {
    // Collect only this ancestor chain. Stop fetching repeats, but pass the
    // original cyclic/missing edge to the domain validator; never truncate it.
    const rows = [agent];
    const fetched = new Set([agent.name]);
    let parent = agent.createdBy;
    while (parent !== null && !fetched.has(parent)) {
      const raw = this.rawAgent(parent);
      if (raw === undefined) break;
      const row = decodeAgentRow(raw);
      if (row.name !== parent) rowCorrupt("agent query identity mismatch");
      rows.push(row); fetched.add(row.name); parent = row.createdBy;
    }
    new LineageSnapshot(rows);
  }
  private requiredAgent(name: string): AgentRow {
    const raw = this.rawAgent(name);
    if (raw === undefined) return rowCorrupt("referenced agent is missing");
    const agent = decodeAgentRow(raw);
    if (agent.name !== name) return rowCorrupt("agent query identity mismatch");
    this.lineage(agent);
    return agent;
  }
  agent(name: string): AgentRow | null {
    const raw = this.rawAgent(name);
    if (raw === undefined) return null;
    const row = decodeAgentRow(raw); this.lineage(row); return row;
  }
  agents(): AgentRow[] {
    const rows = this.db.prepare("SELECT * FROM agents ORDER BY name").all().map(decodeAgentRow);
    new LineageSnapshot(rows); // validate the complete list once, not once per row
    return rows;
  }
  private subscription(value: unknown): SubscriptionRow {
    const row = decodeSubscriptionRow(value); this.requiredAgent(row.agent); return row;
  }
  subscriptions(topic?: string): SubscriptionRow[] {
    const raw = topic === undefined
      ? this.db.prepare("SELECT * FROM subscriptions ORDER BY topic, agent").all()
      : this.db.prepare("SELECT * FROM subscriptions WHERE topic=? ORDER BY agent").all(topic);
    const rows = raw.map(value => this.subscription(value));
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.topic}/${row.agent}`;
      if (seen.has(key) || (topic !== undefined && row.topic !== topic)) rowCorrupt("subscription query contains duplicate or wrong identity");
      seen.add(key);
    }
    return rows;
  }
  private batchMembership(delivery: DeliveryRow): void {
    if (delivery.batchId === null) return;
    const raw = this.db.prepare("SELECT * FROM batches WHERE id=?").get(delivery.batchId);
    if (raw === undefined) rowCorrupt("delivery references a missing batch");
    const batch = decodeBatchRow(raw);
    const owner = this.requiredAgent(batch.agent);
    if (batch.agent !== delivery.recipient || batch.incarnation > owner.incarnation || !decodeBatchManifest(batch.messageIdsJson).includes(delivery.messageId))
      rowCorrupt("delivery batch owner/incarnation/manifest mismatch");
    if ((batch.state === "completed") !== (delivery.presented === 1)) rowCorrupt("delivery presentation differs from batch state");
  }
  private context(): OperationDecodeContext {
    return { stateRoot: this.stateRoot, repositoryIdentity: this.identity(), relations: {
      operation: id => this.db.prepare("SELECT * FROM operations WHERE id=?").get(id) ?? null,
      agent: name => {
        const raw = this.rawAgent(name);
        if (raw !== undefined) this.lineage(decodeAgentRow(raw));
        return raw ?? null;
      },
      deliveries: id => {
        const rows = this.db.prepare("SELECT * FROM deliveries WHERE operation_id=? ORDER BY message_id, recipient").all(id);
        for (const raw of rows) {
          const row = decodeDeliveryRow(raw); this.requiredAgent(row.recipient); this.batchMembership(row);
        }
        return rows;
      },
    } };
  }
  private operationRow(raw: unknown): DecodedOperation {
    const row = decodeOperation(raw, this.context());
    this.requiredAgent(row.actor);
    safeInteger(row.updatedAtMs, "operation update time", row.createdAtMs);
    return row;
  }
  operation(actor: string, key: string): DecodedOperation | null {
    const raw = this.db.prepare("SELECT * FROM operations WHERE actor=? AND request_key=?").get(actor, key);
    return raw === undefined ? null : this.operationRow(raw);
  }
  operationById(id: string): DecodedOperation | null {
    const raw = this.db.prepare("SELECT * FROM operations WHERE id=?").get(id);
    return raw === undefined ? null : this.operationRow(raw);
  }
  physicalCreate(name: string, specHash: string): OperationOf<"agent.create"> | null {
    const raw = this.db.prepare(`SELECT * FROM operations WHERE kind='agent.create'
      AND json_extract(plan_json,'$.spec.name')=? AND json_extract(plan_json,'$.specHash')=?
      AND json_type(plan_json,'$.existingCreation')='null' ORDER BY created_at_ms, id LIMIT 1`).get(name, specHash);
    if (raw === undefined) return null;
    const operation = this.operationRow(raw);
    if (operation.kind !== "agent.create") return rowCorrupt("physical create query returned another kind");
    return operation;
  }
  recoverableIds(): string[] {
    return this.db.prepare("SELECT id FROM operations WHERE state IN ('pending','unknown') ORDER BY created_at_ms, id").all().map(decodeOperationIdProjection);
  }
  private message(operation: DecodedOperation): MessagePlan | null {
    switch (operation.kind) {
      case "mail.send": case "agent.continue": case "git.submit": case "context.publish": return operation.plan.message;
      case "agent.create": return operation.plan.initialMessage;
      default: return null;
    }
  }
  private deliveryCore(raw: unknown): DeliveryRow {
    const row = decodeDeliveryRow(raw); this.requiredAgent(row.recipient);
    const operation = this.operationById(row.operationId);
    const message = operation === null ? null : this.message(operation);
    if (message === null || message.id !== row.messageId || !message.recipients.includes(row.recipient)) rowCorrupt("delivery differs from immutable operation recipient snapshot");
    this.batchMembership(row);
    return row;
  }
  private deliveryRow(raw: unknown): DeliveryRow {
    const row = this.deliveryCore(raw);
    if (row.batchId !== null) this.batch(row.batchId);
    return row;
  }
  delivery(messageId: string, recipient: string): DeliveryRow | null {
    const raw = this.db.prepare("SELECT * FROM deliveries WHERE message_id=? AND recipient=?").get(messageId, recipient);
    return raw === undefined ? null : this.deliveryRow(raw);
  }
  pendingDeliveries(agent: string): DeliveryRow[] {
    return this.db.prepare(`SELECT * FROM deliveries WHERE recipient=? AND materialized=1
      AND presented=0 AND batch_id IS NULL ORDER BY created_at_ms, message_id`).all(agent).map(raw => this.deliveryRow(raw));
  }
  operationDeliveries(id: string): DeliveryRow[] {
    const operation = this.operationById(id);
    const rows = this.db.prepare("SELECT * FROM deliveries WHERE operation_id=? ORDER BY created_at_ms, message_id").all(id);
    if (operation === null && rows.length > 0) rowCorrupt("deliveries reference a missing operation");
    return rows.map(raw => this.deliveryRow(raw));
  }
  private batchRow(raw: unknown): BatchRow {
    const batch = decodeBatchRow(raw);
    const owner = this.requiredAgent(batch.agent);
    if (batch.incarnation > owner.incarnation) rowCorrupt("batch belongs to a future incarnation");
    const manifest = decodeBatchManifest(batch.messageIdsJson);
    const deliveries = this.db.prepare("SELECT * FROM deliveries WHERE batch_id=? ORDER BY message_id, recipient").all(batch.id).map(row => this.deliveryCore(row));
    const linked = new Set<string>();
    for (const delivery of deliveries) {
      if (delivery.recipient !== batch.agent || delivery.batchId !== batch.id || linked.has(delivery.messageId)) rowCorrupt("batch linked delivery identity mismatch");
      linked.add(delivery.messageId);
    }
    if (manifest.length !== linked.size || manifest.some(id => !linked.has(id))) rowCorrupt("batch manifest differs from its exact linked delivery set");
    return batch;
  }
  batch(id: string): BatchRow | null {
    const raw = this.db.prepare("SELECT * FROM batches WHERE id=?").get(id);
    return raw === undefined ? null : this.batchRow(raw);
  }
  preparedBatches(agent: string): BatchRow[] {
    return this.db.prepare("SELECT * FROM batches WHERE agent=? AND state='prepared' ORDER BY created_at_ms, id").all(agent).map(raw => this.batchRow(raw));
  }
  private usageRow(raw: unknown): UsageRow {
    const row = decodeUsageRow(raw);
    const actor = this.requiredAgent(row.actor);
    if (row.incarnation > actor.incarnation || row.profile !== decodeAgentSpec(actor.specJson).modelProfile) rowCorrupt("usage actor/incarnation/model-profile identity mismatch");
    return row;
  }
  usage(id: string): UsageRow | null {
    const raw = this.db.prepare("SELECT * FROM usage WHERE request_id=?").get(id);
    return raw === undefined ? null : this.usageRow(raw);
  }
  usages(): UsageRow[] {
    return this.db.prepare("SELECT * FROM usage ORDER BY created_at_ms, request_id").all().map(raw => this.usageRow(raw));
  }
}
