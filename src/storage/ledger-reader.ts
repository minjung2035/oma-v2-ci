/** DB-009: SELECT-only facade. Full-row, local-reference and whole-list
 * validation are distinct; every lineage rule belongs to LineageSnapshot.
 */
import { DIAGNOSTIC_READ_LIMITS } from "./diagnostic-snapshot.js";
import { StoreError } from "../domain/errors.js";
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import { isValidOperationId, isValidActor, type OperationId } from "../domain/identifiers.js";
import { ownedMessage, type RepositoryIdentity } from "../durable.js";
import { LineageSnapshot } from "../domain/lineage.js";
import { decodeOperation, type DecodedOperation, type OperationDecodeContext, type OperationOf } from "./operation-codec.js";
import {
  decodeAgentRow, decodeAgentSpec, decodeSubscriptionRow, decodeDeliveryRow, decodeBatchRow,
  decodeBatchManifest, decodeUsageRow, decodeOperationIdProjection, rowCorrupt, safeInteger,
  type AgentRow, type SubscriptionRow, type DeliveryRow, type BatchRow, type UsageRow,
} from "./rows.js";

export interface PendingWorkRows {
  readonly agents: readonly AgentRow[];
  readonly unbatched: readonly DeliveryRow[];
  readonly prepared: readonly BatchRow[];
  readonly linked: readonly DeliveryRow[];
}

/** P0V-87 (R6-10): an order that means something -- recovery, delivery, the
 * batches a runner is handed -- is the order rows were accepted in, which is
 * their rowid: the ledger has one writer, a new row's rowid is above every
 * existing one, and this product never VACUUMs (the one operation that may
 * renumber a table without an INTEGER PRIMARY KEY). The wall-clock
 * `created_at_ms` is when, for display and audit; a clock set back must not
 * put later mail in front of earlier. */
export class LedgerReader {
  constructor(private readonly db: Pick<DatabaseSync, "prepare">, private readonly stateRoot: string, private readonly identity: () => RepositoryIdentity | null) {}
  /** Full-set semantics are retained, but an operational read is never an
   * unbounded allocation. Reuse diagnostic budgets; exhaustion is not corruption. */
  private budget(): (row: unknown) => void {
    let rows = 0; let bytes = 0;
    return row => {
      if (++rows > DIAGNOSTIC_READ_LIMITS.maxRows)
        throw new StoreError("LIMIT_EXCEEDED", "operational ledger row budget exceeded");
      bytes += Buffer.byteLength(JSON.stringify(row));
      if (bytes > DIAGNOSTIC_READ_LIMITS.maxBytes)
        throw new StoreError("LIMIT_EXCEEDED", "operational ledger byte budget exceeded");
    };
  }
  private all(sql: string, ...params: SQLInputValue[]): Record<string, SQLOutputValue>[] {
    const rows: Record<string, SQLOutputValue>[] = []; const charge = this.budget();
    for (const row of this.db.prepare(sql).iterate(...params)) { charge(row); rows.push(row); }
    return rows;
  }
  private rawAgent(name: string) { return this.db.prepare("SELECT * FROM agents WHERE name=?").get(name); }
  private lineage(agent: AgentRow): void {
    // Collect only this ancestor chain. Stop fetching repeats, but pass the
    // original cyclic/missing edge to the domain validator; never truncate it.
    const rows = [agent]; const charge = this.budget(); charge(agent);
    const fetched = new Set([agent.name]);
    let parent = agent.createdBy;
    while (parent !== null && !fetched.has(parent)) {
      const raw = this.rawAgent(parent);
      if (raw === undefined) break;
      const row = decodeAgentRow(raw);
      if (row.name !== parent) rowCorrupt("agent query identity mismatch");
      charge(row); rows.push(row); fetched.add(row.name); parent = row.createdBy;
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
  /** WP23.03: which agents exist, by name only -- for request parameter checks
   * and choosing which units to observe. Each name is checked as an identity;
   * a caller that acts on an agent reads its full row. */
  agentNames(): string[] {
    return this.all("SELECT name FROM agents ORDER BY name").map(row => {
      const name = (row as { name?: unknown }).name;
      return isValidActor(name) ? name : rowCorrupt("agent name is not a valid identity");
    });
  }
  agents(): AgentRow[] {
    const rows = this.all("SELECT * FROM agents ORDER BY name").map(decodeAgentRow);
    new LineageSnapshot(rows); // validate the complete list once, not once per row
    return rows;
  }
  private subscription(value: unknown): SubscriptionRow {
    const row = decodeSubscriptionRow(value); this.requiredAgent(row.agent); return row;
  }
  subscriptions(topic?: string): SubscriptionRow[] {
    const raw = topic === undefined
      ? this.all("SELECT * FROM subscriptions ORDER BY topic, agent")
      : this.all("SELECT * FROM subscriptions WHERE topic=? ORDER BY agent", topic);
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
      attestation: id => this.db.prepare("SELECT * FROM attestations WHERE operation_id=?").get(id) ?? null,
      operation: id => this.db.prepare("SELECT * FROM operations WHERE id=?").get(id) ?? null,
      agent: name => {
        const raw = this.rawAgent(name);
        if (raw !== undefined) this.lineage(decodeAgentRow(raw));
        return raw ?? null;
      },
      deliveries: id => {
        const rows = this.all("SELECT * FROM deliveries WHERE operation_id=? ORDER BY message_id, recipient", id);
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
  /** DR27: the last accepted whole-society intent, ordered independently of time. */
  latestSocietyAction(): OperationOf<"society.set"> | null {
    const raw = this.db.prepare("SELECT * FROM operations WHERE kind='society.set' ORDER BY rowid DESC LIMIT 1").get();
    if (raw === undefined) return null;
    const operation = this.operationRow(raw);
    if (operation.kind !== "society.set") return rowCorrupt("society query returned another kind");
    return operation;
  }
  /** LIFE-003/DR27: accepted action order, not time or current desired state.
   * A Principal stop stays a fence until a later Principal start is accepted;
   * another Resident's stop cannot replace that authority. */
  latestAction(agent: string, actor?: string): OperationOf<"agent.start"> | OperationOf<"agent.stop"> | null {
    const sql = `SELECT * FROM operations WHERE kind IN ('agent.start','agent.stop')
      AND json_extract(plan_json,'$.agent')=? ${actor === undefined ? "" : "AND actor=?"} ORDER BY rowid DESC LIMIT 1`;
    const raw = actor === undefined ? this.db.prepare(sql).get(agent) : this.db.prepare(sql).get(agent, actor);
    if (raw === undefined) return null;
    const operation = this.operationRow(raw);
    if ((operation.kind !== "agent.start" && operation.kind !== "agent.stop") || operation.plan.agent !== agent ||
        (actor !== undefined && operation.actor !== actor)) return rowCorrupt("lifecycle action query returned another identity");
    return operation;
  }
  submissions(): readonly OperationOf<"git.submit">[] {
    return this.all("SELECT * FROM operations WHERE kind='git.submit' ORDER BY rowid").map(raw => {
      const operation = this.operationRow(raw);
      if (operation.kind !== "git.submit") return rowCorrupt("submission query returned another kind");
      return operation;
    });
  }
  attestations(): readonly { readonly sequence: number; readonly operation: OperationOf<"attest.record"> }[] {
    // LEFT JOIN exposes a missing index too; it must never erase an accepted fact.
    const rows = this.all(`SELECT a.sequence, o.id FROM operations o LEFT JOIN attestations a ON a.operation_id=o.id
      WHERE o.kind='attest.record' ORDER BY a.sequence`);
    return Object.freeze(rows.map(row => {
      const sequence = safeInteger(row.sequence, "attestation sequence", 1);
      if (!isValidOperationId(row.id)) return rowCorrupt("invalid attestation operation identity");
      const operation = this.operationById(row.id);
      if (operation === null || operation.kind !== "attest.record") return rowCorrupt("attestation index has no fact");
      return Object.freeze({ sequence, operation });
    }));
  }
  physicalCreate(name: string, specHash: string): OperationOf<"agent.create"> | null {
    const raw = this.db.prepare(`SELECT * FROM operations WHERE kind='agent.create'
      AND json_extract(plan_json,'$.spec.name')=? AND json_extract(plan_json,'$.specHash')=?
      AND json_type(plan_json,'$.existingCreation')='null' ORDER BY rowid LIMIT 1`).get(name, specHash);
    if (raw === undefined) return null;
    const operation = this.operationRow(raw);
    if (operation.kind !== "agent.create") return rowCorrupt("physical create query returned another kind");
    return operation;
  }
  recoverableIds(): OperationId[] {
    return this.all("SELECT id FROM operations WHERE state IN ('pending','unknown') ORDER BY rowid").map(decodeOperationIdProjection);
  }
  private deliveryCore(raw: unknown): DeliveryRow {
    const row = decodeDeliveryRow(raw); this.requiredAgent(row.recipient);
    const operation = this.operationById(row.operationId);
    const message = operation === null ? null : ownedMessage(operation.plan);
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
  *pendingDeliveryRows(agent: string): IterableIterator<DeliveryRow> {
    // A cursor never stays open across a caller's work. Freeze the upper rowid
    // so newly accepted mail belongs to the next traversal, not an endless tail.
    const upper = this.db.prepare("SELECT MAX(rowid) AS value FROM deliveries").get()?.value;
    if (upper === null || upper === undefined) return;
    const last = safeInteger(upper, "delivery traversal upper rowid", 1);
    let after = 0;
    for (;;) {
      const page = this.all(`SELECT rowid AS sequence, * FROM deliveries WHERE recipient=? AND materialized=1
        AND presented=0 AND batch_id IS NULL AND rowid>? AND rowid<=? ORDER BY rowid LIMIT 128`, agent, after, last);
      if (page.length === 0) return;
      for (const raw of page) {
        const { sequence, ...row } = raw;
        const next = safeInteger(sequence, "delivery traversal rowid", after + 1);
        if (next > last) rowCorrupt("delivery traversal exceeded its upper rowid");
        after = next; yield this.deliveryRow(row);
      }
    }
  }
  pendingDeliveries(agent: string): DeliveryRow[] {
    return this.all(`SELECT * FROM deliveries WHERE recipient=? AND materialized=1
      AND presented=0 AND batch_id IS NULL ORDER BY rowid`, agent).map(raw => this.deliveryRow(raw));
  }
  operationDeliveries(id: string): DeliveryRow[] {
    const operation = this.operationById(id);
    const rows = this.all("SELECT * FROM deliveries WHERE operation_id=? ORDER BY rowid", id);
    if (operation === null && rows.length > 0) rowCorrupt("deliveries reference a missing operation");
    return rows.map(raw => this.deliveryRow(raw));
  }
  private batchRow(raw: unknown): BatchRow {
    const batch = decodeBatchRow(raw);
    const owner = this.requiredAgent(batch.agent);
    if (batch.incarnation > owner.incarnation) rowCorrupt("batch belongs to a future incarnation");
    const manifest = decodeBatchManifest(batch.messageIdsJson);
    const deliveries = this.all("SELECT * FROM deliveries WHERE batch_id=? ORDER BY message_id, recipient", batch.id).map(row => this.deliveryCore(row));
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
  /** WP23.03: every row that display counts of pending work rest on, read
   * together with no await between the SELECTs (the broker is the only
   * writer). Each row is decoded; relation checks are pendingWorkByAgent's.
   * Unlike the full-row reads above it does not re-check each delivery against
   * its operation's recipient snapshot -- a cost that grew with the square of
   * an operation's recipients -- so no mutation or recovery path reads it. */
  pendingWorkRows(): PendingWorkRows {
    return {
      agents: this.agents(),
      unbatched: this.all(`SELECT * FROM deliveries WHERE materialized=1 AND presented=0 AND batch_id IS NULL
        ORDER BY recipient, rowid`).map(decodeDeliveryRow),
      prepared: this.all("SELECT * FROM batches WHERE state='prepared' ORDER BY agent, rowid").map(decodeBatchRow),
      linked: this.all(`SELECT * FROM deliveries WHERE batch_id IN (SELECT id FROM batches WHERE state='prepared')
        ORDER BY batch_id, message_id`).map(decodeDeliveryRow),
    };
  }
  preparedBatches(agent: string): BatchRow[] {
    return this.all("SELECT * FROM batches WHERE agent=? AND state='prepared' ORDER BY rowid", agent).map(raw => this.batchRow(raw));
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
    return this.all("SELECT * FROM usage ORDER BY rowid").map(raw => this.usageRow(raw));
  }
}
