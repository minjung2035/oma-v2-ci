/** DB-009: SELECT-only facade. Full-row, local-reference and whole-list
 * validation are distinct; every lineage rule belongs to LineageSnapshot.
 *
 * P0: an operational read never refuses for the size of a complete result.
 * `all` returns every matching row and `pendingDeliveryRows` pages a live
 * traversal so caller work cannot pin a cursor; the bounded collector lives
 * in the administrator's diagnostic snapshot and nothing here shares it.
 * A failed read still fails -- unknown is never answered as an empty set.
 */
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import { isValidOperationId, isValidActor, type OperationId } from "@oma/domain/identifiers";
import { ownedMessages, type RepositoryIdentity } from "@oma/domain/durable";
import { LineageSnapshot } from "@oma/domain/lineage";
import { decodeOperation, type DecodedOperation, type OperationDecodeContext, type OperationOf } from "@oma/protocol/operation-codec";
import { decodeAgentRow, decodeSubscriptionRow, decodeDeliveryRow, decodeBatchRow, decodeBatchManifest, decodeOperationIdProjection, fullRow, rowCorrupt, safeInteger } from "./rows.js";
import { type AgentRow, type SubscriptionRow, type DeliveryRow, type BatchRow } from "@oma/contracts/ledger";

/** Reads shared inside one synchronous collection: an operation's plan, an
 * agent's lineage, a batch's manifest are decoded and validated once per
 * collection instead of once per row. A memoized entry is the decoding of the
 * row bytes first read under its key inside this collection -- it is not a
 * snapshot of the database, and a row another writer changes mid-collection
 * is not re-observed. Callers needing newer bytes open a new scope. */
interface ReadScope {
  readonly operations: Map<string, DecodedOperation | null>;
  readonly agents: Map<string, AgentRow>;
  readonly batches: Map<string, { readonly row: BatchRow; readonly manifest: ReadonlySet<string> }>;
  readonly batchRows: Map<string, BatchRow | null>;
}
function readScope(): ReadScope {
  return { operations: new Map(), agents: new Map(), batches: new Map(), batchRows: new Map() };
}

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
  private all(sql: string, ...params: SQLInputValue[]): Record<string, SQLOutputValue>[] {
    return this.db.prepare(sql).all(...params);
  }
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
  private agentAt(scope: ReadScope | undefined, name: string): AgentRow {
    if (scope === undefined) return this.requiredAgent(name);
    const known = scope.agents.get(name);
    if (known !== undefined) return known;
    const agent = this.requiredAgent(name);
    scope.agents.set(name, agent);
    return agent;
  }
  private operationAt(scope: ReadScope | undefined, id: string): DecodedOperation | null {
    if (scope === undefined) return this.operationById(id);
    if (!scope.operations.has(id)) scope.operations.set(id, this.operationById(id));
    return scope.operations.get(id) ?? null;
  }
  private batchAt(scope: ReadScope | undefined, id: string): BatchRow | null {
    if (scope === undefined) return this.batch(id);
    if (!scope.batchRows.has(id)) scope.batchRows.set(id, this.batchScoped(id, scope));
    return scope.batchRows.get(id) ?? null;
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
  private subscription(value: unknown, scope: ReadScope): SubscriptionRow {
    const row = decodeSubscriptionRow(value); this.agentAt(scope, row.agent); return row;
  }
  subscriptions(topic?: string): SubscriptionRow[] {
    const scope = readScope();
    const raw = topic === undefined
      ? this.all("SELECT * FROM subscriptions ORDER BY topic, agent")
      : this.all("SELECT * FROM subscriptions WHERE topic=? ORDER BY agent", topic);
    const rows = raw.map(value => this.subscription(value, scope));
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.topic}/${row.agent}`;
      if (seen.has(key) || (topic !== undefined && row.topic !== topic)) rowCorrupt("subscription query contains duplicate or wrong identity");
      seen.add(key);
    }
    return rows;
  }
  private batchMembership(delivery: DeliveryRow, scope?: ReadScope): void {
    if (delivery.batchId === null) return;
    const id = delivery.batchId;
    let known = scope?.batches.get(id);
    if (known === undefined) {
      const raw = this.db.prepare("SELECT * FROM batches WHERE id=?").get(id);
      if (raw === undefined) rowCorrupt("delivery references a missing batch");
      const row = decodeBatchRow(raw);
      known = { row, manifest: new Set(decodeBatchManifest(row.messageIdsJson)) };
      scope?.batches.set(id, known);
    }
    const owner = this.agentAt(scope, known.row.agent);
    if (known.row.agent !== delivery.recipient || known.row.incarnation > owner.incarnation || !known.manifest.has(delivery.messageId))
      rowCorrupt("delivery batch owner/incarnation/manifest mismatch");
    if ((known.row.state === "completed") !== (delivery.presented === 1)) rowCorrupt("delivery presentation differs from batch state");
  }
  private context(): OperationDecodeContext {
    const scope = readScope();
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
          const row = decodeDeliveryRow(raw); this.agentAt(scope, row.recipient); this.batchMembership(row, scope);
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
      AND json_extract(plan_json,'$.intent.agent')=? ${actor === undefined ? "" : "AND actor=?"} ORDER BY rowid DESC LIMIT 1`;
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
      AND json_extract(plan_json,'$.intent.spec.name')=? AND json_extract(plan_json,'$.intent.specHash')=?
      AND json_type(plan_json,'$.intent.existingCreation')='null' ORDER BY rowid LIMIT 1`).get(name, specHash);
    if (raw === undefined) return null;
    const operation = this.operationRow(raw);
    if (operation.kind !== "agent.create") return rowCorrupt("physical create query returned another kind");
    return operation;
  }
  recoverableIds(): OperationId[] {
    return this.all("SELECT id FROM operations WHERE state IN ('pending','unknown') ORDER BY rowid").map(decodeOperationIdProjection);
  }
  private deliveryCore(raw: unknown, scope?: ReadScope): DeliveryRow {
    const row = decodeDeliveryRow(raw); this.agentAt(scope, row.recipient);
    const operation = this.operationAt(scope, row.operationId);
    const message = operation === null ? undefined
      : ownedMessages(operation.plan).find(candidate => candidate.id === row.messageId);
    if (message === undefined || !message.recipients.includes(row.recipient)) rowCorrupt("delivery differs from immutable operation recipient snapshot");
    this.batchMembership(row, scope);
    return row;
  }
  private deliveryRow(raw: unknown, scope?: ReadScope): DeliveryRow {
    const row = this.deliveryCore(raw, scope);
    if (row.batchId !== null) this.batchAt(scope, row.batchId);
    return row;
  }
  delivery(messageId: string, recipient: string): DeliveryRow | null {
    const raw = this.db.prepare("SELECT * FROM deliveries WHERE message_id=? AND recipient=?").get(messageId, recipient);
    return raw === undefined ? null : this.deliveryRow(raw);
  }
  *pendingDeliveryRows(agent: string): IterableIterator<DeliveryRow> {
    // A cursor never stays open across a caller's work. Freeze the upper rowid
    // so newly accepted mail belongs to the next traversal, not an endless tail.
    const scope = readScope();
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
        after = next; yield this.deliveryRow(row, scope);
      }
    }
  }
  pendingDeliveries(agent: string): DeliveryRow[] {
    return [...this.pendingDeliveryRows(agent)];
  }
  /** The pending count is a count: SQL counts the same eligible rows
   * `pendingDeliveries` decodes, without materializing the list a caller
   * never asked for. The answer can only shrink a read, never hide one:
   * anything that actually iterates still validates every row. */
  pendingDeliveryCount(agent: string): number {
    const row = fullRow(this.db.prepare(`SELECT COUNT(*) AS value FROM deliveries WHERE recipient=? AND materialized=1
      AND presented=0 AND batch_id IS NULL`).get(agent), ["value"], "pending delivery count");
    return safeInteger(row.value, "pending delivery count", 0);
  }
  operationDeliveries(id: string): DeliveryRow[] {
    const operation = this.operationById(id);
    const scope = readScope();
    scope.operations.set(id, operation);
    const rows = this.all("SELECT * FROM deliveries WHERE operation_id=? ORDER BY rowid", id);
    if (operation === null && rows.length > 0) rowCorrupt("deliveries reference a missing operation");
    return rows.map(raw => this.deliveryRow(raw, scope));
  }
  private batchRow(raw: unknown, scope: ReadScope): BatchRow {
    const batch = decodeBatchRow(raw);
    const owner = this.agentAt(scope, batch.agent);
    if (batch.incarnation > owner.incarnation) rowCorrupt("batch belongs to a future incarnation");
    const manifest = decodeBatchManifest(batch.messageIdsJson);
    // The batch being validated is also the membership fact its own linked
    // deliveries read: identical rows inside the same synchronous window.
    scope.batches.set(batch.id, { row: batch, manifest: new Set(manifest) });
    const deliveries = this.all("SELECT * FROM deliveries WHERE batch_id=? ORDER BY message_id, recipient", batch.id).map(row => this.deliveryCore(row, scope));
    const linked = new Set<string>();
    for (const delivery of deliveries) {
      if (delivery.recipient !== batch.agent || delivery.batchId !== batch.id || linked.has(delivery.messageId)) rowCorrupt("batch linked delivery identity mismatch");
      linked.add(delivery.messageId);
    }
    if (manifest.length !== linked.size || manifest.some(id => !linked.has(id))) rowCorrupt("batch manifest differs from its exact linked delivery set");
    return batch;
  }
  private batchScoped(id: string, scope: ReadScope): BatchRow | null {
    const raw = this.db.prepare("SELECT * FROM batches WHERE id=?").get(id);
    return raw === undefined ? null : this.batchRow(raw, scope);
  }
  batch(id: string): BatchRow | null {
    return this.batchScoped(id, readScope());
  }
  /** WP23.03: every row that display counts of pending work rest on, read
   * together with no await between the SELECTs (the broker is the only
   * writer). Each row is decoded; relation checks are pendingWorkByAgent's.
   * Unlike the full-row reads above it does not re-check each delivery against
   * its operation's recipient snapshot -- a cost that grew with the square of
   * an operation's recipients -- so no mutation or recovery path reads it.
   * The complete result is the contract: status must still answer past any
   * count of rows, not refuse a society for being large. */
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
    const scope = readScope();
    return this.all("SELECT * FROM batches WHERE agent=? AND state='prepared' ORDER BY rowid", agent).map(raw => this.batchRow(raw, scope));
  }
}
