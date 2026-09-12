// MUST [DB-001..009]: sole broker writer; synchronous transactions; six entities.
// No Git/systemd/fsync/await inside transactions (M-004).
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Actor, BatchId, ErrorCode, MessageId, OperationId, RequestKey, OperationPlan } from "../implementation/contracts.js";
import { operationResultCheck } from "./validate.js";
import { operationPlanCheck, operationResultRelationCheck } from "./durable.js";
import { StoreError, isErrorCode, isPreacceptOnlyFailure } from "./domain/errors.js";
export { StoreError } from "./domain/errors.js";

export const SCHEMA_PATH = fileURLToPath(new URL("../../implementation/schema-v1.sql", import.meta.url));

export interface AgentRow {
  name: Actor;
  specHash: string;
  role: "resident" | "principal";
  desired: "provisioning" | "enabled" | "stopped" | "retired";
  incarnation: number;
  profile: string;
  createdBy: string | null;
  specJson: string;
  createdAtMs: number;
  updatedAtMs: number;
}
export interface OperationRow {
  id: OperationId;
  actor: Actor;
  requestKey: RequestKey;
  requestHash: string;
  kind: OperationPlan["kind"];
  payloadJson: string;
  planJson: string;
  state: "pending" | "succeeded" | "failed" | "unknown";
  resultJson: string | null;
  errorCode: ErrorCode | null;
  createdAtMs: number;
  updatedAtMs: number;
}
export interface SubscriptionRow { topic: string; agent: Actor; createdAtMs: number }
export interface DeliveryRow {
  messageId: MessageId;
  recipient: Actor;
  operationId: OperationId;
  materialized: 0 | 1;
  batchId: BatchId | null;
  presented: 0 | 1;
  acknowledged: 0 | 1;
  createdAtMs: number;
  materializedAtMs: number | null;
  presentedAtMs: number | null;
  acknowledgedAtMs: number | null;
}
export interface BatchRow {
  id: BatchId;
  agent: Actor;
  incarnation: number;
  messageIdsJson: string;
  sessionPath: string | null;
  state: "prepared" | "completed";
  createdAtMs: number;
  completedAtMs: number | null;
}
export interface UsageRow {
  requestId: string;
  actor: Actor;
  incarnation: number;
  profile: string;
  pricingRevision: string;
  reservedUnits: number;
  reportedUnits: number | null;
  outcome: "reserved" | "completed" | "cancelled" | "unknown";
  detailsJson: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export function reused(actor: Actor, key: RequestKey): StoreError {
  return new StoreError("REQUEST_KEY_REUSED", `request key ${key} (actor ${actor}) already used with a different payload`);
}
export function isBusyError(error: unknown): boolean {
  return error instanceof Error && /busy|locked/i.test(error.message) && !(error instanceof StoreError);
}
export interface Transaction { readonly transactionBrand: unique symbol }
const TX: Transaction = { transactionBrand: Symbol("tx") } as unknown as Transaction;
export interface NewAgent {
  name: Actor;
  specHash: string;
  role: "resident" | "principal";
  desired: AgentRow["desired"];
  incarnation: number;
  profile: string;
  createdBy: string | null;
  specJson: string;
}
const DEFAULT_BUSY_RETRIES = 5;

export class Store {
  private readonly db: DatabaseSync;
  private depth = 0;
  constructor(readonly path: string, readonly busyRetries: number = DEFAULT_BUSY_RETRIES) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }
  close(): void { this.db.close(); }
  private migrate(): void {
    const version = this.userVersion();
    if (version === 1) return;
    if (version !== 0) throw new StoreError("STORE_CORRUPT", `unexpected schema user_version ${version}`);
    let ddl: string;
    try { ddl = readFileSync(SCHEMA_PATH, "utf8"); }
    catch (error) { throw new StoreError("STORE_CORRUPT", `schema file unreadable: ${(error as Error).message}`); }
    try { this.db.exec(ddl); }
    catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* no open transaction */ }
      throw new StoreError("STORE_CORRUPT", `migration failed: ${(error as Error).message}`);
    }
    if (this.userVersion() !== 1) throw new StoreError("STORE_CORRUPT", "migration did not set user_version=1");
  }
  private userVersion(): number {
    const row = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    return row.user_version;
  }
  private begin(): void {
    let ok = false;
    for (let i = 0; i < this.busyRetries + 1 && !ok; i++) {
      try { this.db.exec("BEGIN IMMEDIATE"); ok = true; }
      catch (error) {
        if (isBusyError(error)) {
          if (i < this.busyRetries) continue;
          throw new StoreError("DB_BUSY", "BEGIN IMMEDIATE blocked");
        }
        throw new StoreError("STORE_CORRUPT", `BEGIN IMMEDIATE failed: ${(error as Error).message}`);
      }
    }
  }
  transaction<T>(fn: (tx: Transaction) => T): T {
    if (this.depth > 0) throw new StoreError("INTERNAL_ERROR", "nested store transaction");
    this.begin();
    this.depth = 1;
    try {
      const result = fn(TX);
      this.db.exec("COMMIT");
      this.depth = 0;
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      this.depth = 0;
      throw error;
    }
  }
  get inTransaction(): boolean { return this.depth > 0; }
  private requireTx(): void {
    if (this.depth === 0) throw new StoreError("INTERNAL_ERROR", "mutation outside transaction");
  }
  insertAgent(agent: NewAgent): void {
    this.requireTx();
    this.db.prepare(`INSERT INTO agents
      (name, spec_hash, role, desired, incarnation, profile, created_by, spec_json, created_at_ms, updated_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(agent.name, agent.specHash, agent.role, agent.desired, agent.incarnation,
      agent.profile, agent.createdBy, agent.specJson, Date.now(), Date.now());
  }
  getAgent(name: string): AgentRow | null {
    const row = this.db.prepare("SELECT * FROM agents WHERE name = ?").get(name) as Record<string, unknown> | undefined;
    return row ? rowToAgent(row) : null;
  }
  listAgents(): AgentRow[] {
    return (this.db.prepare("SELECT * FROM agents ORDER BY name").all() as Record<string, unknown>[]).map(rowToAgent);
  }
  updateAgent(agent: { name: string; desired?: AgentRow["desired"]; incarnation?: number; specHash?: string; specJson?: string }): void {
    this.requireTx();
    const now = Date.now();
    if (agent.desired !== undefined) {
      const existing = this.getAgent(agent.name);
      if (!existing) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${agent.name}`);
      if (!validDesiredTransition(existing.desired, agent.desired))
        throw new StoreError("INVALID_REQUEST", `invalid desired transition ${existing.desired}->${agent.desired}`);
      this.db.prepare("UPDATE agents SET desired=?, updated_at_ms=? WHERE name=?").run(agent.desired, now, agent.name);
    }
    if (agent.incarnation !== undefined)
      this.db.prepare("UPDATE agents SET incarnation=?, updated_at_ms=? WHERE name=?").run(agent.incarnation, now, agent.name);
    if (agent.specHash !== undefined || agent.specJson !== undefined) {
      const current = this.getAgent(agent.name);
      if (!current) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${agent.name}`);
      this.db.prepare("UPDATE agents SET spec_hash=?, spec_json=?, updated_at_ms=? WHERE name=?")
        .run(agent.specHash ?? current.specHash, agent.specJson ?? current.specJson, now, agent.name);
    }
  }
  follow(topic: string, agent: string): void {
    this.requireTx();
    this.db.prepare("INSERT OR IGNORE INTO subscriptions (topic, agent, created_at_ms) VALUES (?,?,?)").run(topic, agent, Date.now());
  }
  unfollow(topic: string, agent: string): void {
    this.requireTx();
    this.db.prepare("DELETE FROM subscriptions WHERE topic=? AND agent=?").run(topic, agent);
  }
  subscribers(topic: string): string[] {
    const rows = this.db.prepare("SELECT agent FROM subscriptions WHERE topic=? ORDER BY agent").all(topic) as { agent: string }[];
    return rows.map(row => row.agent);
  }
  allSubscriptions(): SubscriptionRow[] {
    const rows = this.db.prepare("SELECT * FROM subscriptions ORDER BY topic, agent").all() as Record<string, unknown>[];
    return rows.map(row => ({ topic: row.topic as string, agent: row.agent as Actor, createdAtMs: num(row.created_at_ms) }));
  }
  insertOperation(operation: {
    id: OperationId; actor: Actor; requestKey: RequestKey; requestHash: string;
    kind: OperationPlan["kind"]; payloadJson: string; planJson: string;
  }): void {
    this.requireTx();
    try {
      this.db.prepare(`INSERT INTO operations
        (id, actor, request_key, request_hash, kind, payload_json, plan_json, state, created_at_ms, updated_at_ms)
        VALUES (?,?,?,?,?,?,?, 'pending', ?, ?)`).run(operation.id, operation.actor, operation.requestKey,
        operation.requestHash, operation.kind, operation.payloadJson, operation.planJson, Date.now(), Date.now());
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: operations.actor, operations.request_key/.test(error.message))
        throw new StoreError("REQUEST_KEY_REUSED", "request key already used by this actor");
      throw error;
    }
  }
  claimKey(actor: Actor, key: RequestKey, requestHash: string): "retry" | "reused" | "absent" {
    const existing = this.getOperation(actor, key);
    if (!existing) return "absent";
    return existing.requestHash === requestHash ? "retry" : "reused";
  }
  claimOperation(operation: {
    id: OperationId; actor: Actor; requestKey: RequestKey; requestHash: string;
    kind: OperationPlan["kind"]; payloadJson: string; planJson: string;
  }): "inserted" | "retry" {
    this.requireTx();
    const before = this.claimKey(operation.actor, operation.requestKey, operation.requestHash);
    if (before === "retry") return "retry";
    if (before === "reused") throw reused(operation.actor, operation.requestKey);
    try { this.insertOperation(operation); return "inserted"; }
    catch (error) {
      if (error instanceof StoreError && error.code === "REQUEST_KEY_REUSED") {
        if (this.claimKey(operation.actor, operation.requestKey, operation.requestHash) === "retry") return "retry";
        throw reused(operation.actor, operation.requestKey);
      }
      throw error;
    }
  }
  getOperation(actor: Actor, key: RequestKey): OperationRow | null {
    const row = this.db.prepare("SELECT * FROM operations WHERE actor=? AND request_key=?").get(actor, key) as Record<string, unknown> | undefined;
    return row ? rowToOperation(row, dirname(this.path)) : null;
  }
  getOperationById(id: OperationId): OperationRow | null {
    const row = this.db.prepare("SELECT * FROM operations WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToOperation(row, dirname(this.path)) : null;
  }
  findPhysicalCreate(name: Actor, specHash: string): OperationRow | null {
    const row = this.db.prepare(`SELECT * FROM operations
      WHERE kind='agent.create'
        AND json_extract(plan_json,'$.spec.name')=?
        AND json_extract(plan_json,'$.specHash')=?
        AND json_type(plan_json,'$.existingCreation')='null'
      ORDER BY created_at_ms, id LIMIT 1`).get(name, specHash) as Record<string, unknown> | undefined;
    return row ? rowToOperation(row, dirname(this.path)) : null;
  }
  recoverableOperations(): OperationId[] {
    const rows = this.db.prepare("SELECT id FROM operations WHERE state IN ('pending','unknown') ORDER BY created_at_ms, id").all() as { id: string }[];
    return rows.map(row => row.id as OperationId);
  }
  updateOperationPlanJson(id: OperationId, planJson: string): void {
    this.requireTx();
    this.db.prepare("UPDATE operations SET plan_json=?, updated_at_ms=? WHERE id=?").run(planJson, Date.now(), id);
  }
  setOperationSucceeded(id: OperationId, resultJson: string): void {
    this.requireTx();
    const current = this.getOperationById(id);
    if (!current) throw new StoreError("STORE_CORRUPT", `missing operation ${id}`);
    let result: unknown;
    try { result = JSON.parse(resultJson); }
    catch { throw new StoreError("STORE_CORRUPT", `operation ${id} result is not valid JSON`); }
    const invalid = operationResultCheck(current.kind)(result);
    if (invalid) throw new StoreError("STORE_CORRUPT", `operation ${id} result: ${invalid}`);
    const plan = JSON.parse(current.planJson) as unknown;
    const relation = operationResultRelationCheck(current.kind, plan, result, {
      operationId: current.id, actor: current.actor, stateRoot: dirname(this.path),
    });
    if (relation) throw new StoreError("STORE_CORRUPT", `operation ${id} result: ${relation}`);
    const updated = this.db.prepare("UPDATE operations SET state='succeeded', result_json=?, error_code=NULL, updated_at_ms=? WHERE id=? AND state IN ('pending','unknown')")
      .run(resultJson, Date.now(), id);
    if (Number(updated.changes) !== 0) return;
    const after = this.getOperationById(id);
    if (after?.state === "succeeded" && after.resultJson === resultJson && after.errorCode === null) return;
    throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
  }
  setOperationFailed(id: OperationId, code: ErrorCode): void {
    this.requireTx();
    // ERR-001 remains a hard guard: never persist a preaccept-only failure on an accepted row.
    if (isPreacceptOnlyFailure(code))
      throw new StoreError("STORE_CORRUPT", `accepted operation ${id} cannot transition to preaccept ${code}`);
    const updated = this.db.prepare("UPDATE operations SET state='failed', result_json=NULL, error_code=?, updated_at_ms=? WHERE id=? AND state IN ('pending','unknown')")
      .run(code, Date.now(), id);
    if (Number(updated.changes) !== 0) return;
    const current = this.getOperationById(id);
    if (current?.state === "failed" && current.resultJson === null && current.errorCode === code) return;
    throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
  }
  setOperationUnknown(id: OperationId): void {
    this.requireTx();
    const current = this.getOperationById(id);
    if (!current) throw new StoreError("STORE_CORRUPT", `missing operation ${id}`);
    if (current.state === "unknown") return;
    if (current.state !== "pending") throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
    this.db.prepare("UPDATE operations SET state='unknown', updated_at_ms=? WHERE id=? AND state='pending'").run(Date.now(), id);
  }
  insertDeliveries(deliveries: Array<{ messageId: MessageId; recipient: Actor; operationId: OperationId }>): void {
    this.requireTx();
    const statement = this.db.prepare(`INSERT OR IGNORE INTO deliveries
      (message_id, recipient, operation_id, materialized, presented, acknowledged, created_at_ms)
      VALUES (?,?,?,0,0,0,?)`);
    for (const delivery of deliveries) statement.run(delivery.messageId, delivery.recipient, delivery.operationId, Date.now());
  }
  markMaterialized(messageId: MessageId, recipient: Actor): void {
    this.requireTx();
    this.db.prepare("UPDATE deliveries SET materialized=1, materialized_at_ms=? WHERE message_id=? AND recipient=?").run(Date.now(), messageId, recipient);
  }
  markAcknowledged(messageId: MessageId, recipient: Actor): void {
    this.requireTx();
    this.db.prepare("UPDATE deliveries SET acknowledged=1, acknowledged_at_ms=? WHERE message_id=? AND recipient=?").run(Date.now(), messageId, recipient);
  }
  pendingDeliveries(agent: Actor): DeliveryRow[] {
    const rows = this.db.prepare(`SELECT * FROM deliveries
      WHERE recipient=? AND materialized=1 AND presented=0 AND batch_id IS NULL
      ORDER BY created_at_ms, message_id`).all(agent) as Record<string, unknown>[];
    return rows.map(rowToDelivery);
  }
  getDelivery(messageId: MessageId, recipient: Actor): DeliveryRow | null {
    const row = this.db.prepare("SELECT * FROM deliveries WHERE message_id=? AND recipient=?").get(messageId, recipient) as Record<string, unknown> | undefined;
    return row ? rowToDelivery(row) : null;
  }
  deliveriesForOperation(operationId: OperationId): DeliveryRow[] {
    const rows = this.db.prepare("SELECT * FROM deliveries WHERE operation_id=? ORDER BY created_at_ms, message_id").all(operationId) as Record<string, unknown>[];
    return rows.map(rowToDelivery);
  }
  insertPreparedBatch(batch: { id: BatchId; agent: Actor; incarnation: number; messageIds: MessageId[]; sessionPath: string | null }): void {
    this.requireTx();
    this.db.prepare(`INSERT INTO batches (id, agent, incarnation, message_ids_json, session_path, state, created_at_ms, completed_at_ms)
      VALUES (?,?,?,?,?, 'prepared', ?, NULL)`).run(batch.id, batch.agent, batch.incarnation, JSON.stringify(batch.messageIds), batch.sessionPath, Date.now());
  }
  getBatch(id: BatchId): BatchRow | null {
    const row = this.db.prepare("SELECT * FROM batches WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToBatch(row) : null;
  }
  preparedBatches(agent: Actor): BatchRow[] {
    const rows = this.db.prepare("SELECT * FROM batches WHERE agent=? AND state='prepared' ORDER BY created_at_ms, id").all(agent) as Record<string, unknown>[];
    return rows.map(rowToBatch);
  }
  reassignPreparedBatches(agent: Actor, incarnation: number): void {
    this.requireTx();
    this.db.prepare("UPDATE batches SET incarnation=? WHERE agent=? AND state='prepared'").run(incarnation, agent);
  }
  linkDeliveriesToBatch(batchId: BatchId, messageIds: MessageId[]): void {
    this.requireTx();
    const batch = this.getBatch(batchId);
    if (!batch) throw new StoreError("BATCH_CONFLICT", `no such batch ${batchId}`);
    if (batch.state === "completed") throw new StoreError("BATCH_CONFLICT", `completed batch ${batchId} is immutable`);
    let implied: Set<string>;
    try { implied = new Set(JSON.parse(batch.messageIdsJson) as string[]); }
    catch { throw new StoreError("STORE_CORRUPT", `batch ${batchId} has corrupt message list`); }
    const have = new Set(messageIds);
    if (implied.size !== have.size || [...implied].some(id => !have.has(id)))
      throw new StoreError("BATCH_CONFLICT", "batch message ids do not match the linked deliveries");
    for (const id of messageIds) {
      const delivery = this.getDelivery(id, batch.agent);
      if (!delivery) throw new StoreError("BATCH_CONFLICT", `message ${id} has no delivery for ${batch.agent}`);
      if (delivery.batchId !== null && delivery.batchId !== batchId)
        throw new StoreError("BATCH_CONFLICT", `message ${id} already in batch ${delivery.batchId}`);
    }
    const update = this.db.prepare("UPDATE deliveries SET batch_id=? WHERE message_id=? AND recipient=?");
    for (const id of messageIds) update.run(batchId, id, batch.agent);
  }
  pendingBatchesFor(agent: Actor, incarnation: number): BatchRow[] {
    const rows = this.db.prepare("SELECT * FROM batches WHERE agent=? AND state='prepared' ORDER BY created_at_ms, id").all(agent) as Record<string, unknown>[];
    return rows.map(rowToBatch).filter(batch => batch.incarnation === incarnation);
  }
  completeBatch(batchId: BatchId, markPresentedIds: MessageId[], agent: Actor): void {
    this.requireTx();
    const batch = this.getBatch(batchId);
    if (!batch) throw new StoreError("BATCH_CONFLICT", `no such batch ${batchId}`);
    if (batch.state === "completed") return;
    this.db.prepare("UPDATE batches SET state='completed', completed_at_ms=? WHERE id=?").run(Date.now(), batchId);
    const statement = this.db.prepare("UPDATE deliveries SET presented=1, presented_at_ms=? WHERE message_id=? AND recipient=?");
    for (const id of markPresentedIds) statement.run(Date.now(), id, agent);
  }
  reserveUsage(usage: { requestId: string; actor: Actor; incarnation: number; profile: string; pricingRevision: string; reservedUnits: number }): void {
    this.requireTx();
    this.db.prepare(`INSERT INTO usage
      (request_id, actor, incarnation, profile, pricing_revision, reserved_units, reported_units, outcome, details_json, created_at_ms, updated_at_ms)
      VALUES (?,?,?,?,?,?,NULL,'reserved',NULL,?,?)`).run(usage.requestId, usage.actor, usage.incarnation, usage.profile,
      usage.pricingRevision, usage.reservedUnits, Date.now(), Date.now());
  }
  usageRows(): UsageRow[] {
    const rows = this.db.prepare("SELECT * FROM usage ORDER BY created_at_ms, request_id").all() as Record<string, unknown>[];
    return rows.map(rowToUsage);
  }
  getUsage(requestId: string): UsageRow | null {
    const row = this.db.prepare("SELECT * FROM usage WHERE request_id=?").get(requestId) as Record<string, unknown> | undefined;
    return row ? rowToUsage(row) : null;
  }
  settleUsage(requestId: string, outcome: UsageRow["outcome"], reportedUnits: number | null, detailsJson: string | null): void {
    this.requireTx();
    this.db.prepare("UPDATE usage SET outcome=?, reported_units=?, details_json=?, updated_at_ms=? WHERE request_id=?")
      .run(outcome, reportedUnits, detailsJson, Date.now(), requestId);
  }
}

function validDesiredTransition(from: AgentRow["desired"], to: AgentRow["desired"]): boolean {
  if (from === to) return true;
  switch (from) {
    case "provisioning": return to === "enabled" || to === "stopped";
    case "enabled": return to === "stopped" || to === "retired";
    case "stopped": return to === "enabled" || to === "retired";
    case "retired": return false;
    default: return false;
  }
}
function num(value: unknown): number { return typeof value === "number" ? value : Number(value); }
function rowToAgent(row: Record<string, unknown>): AgentRow {
  return {
    name: row.name as Actor, specHash: row.spec_hash as string, role: row.role as AgentRow["role"],
    desired: row.desired as AgentRow["desired"], incarnation: num(row.incarnation), profile: row.profile as string,
    createdBy: row.created_by as string | null, specJson: row.spec_json as string,
    createdAtMs: num(row.created_at_ms), updatedAtMs: num(row.updated_at_ms),
  };
}
function rowToOperation(raw: Record<string, unknown>, stateRoot: string): OperationRow {
  const row: OperationRow = {
    id: raw.id as OperationId, actor: raw.actor as Actor, requestKey: raw.request_key as RequestKey,
    requestHash: raw.request_hash as string, kind: raw.kind as OperationPlan["kind"],
    payloadJson: raw.payload_json as string, planJson: raw.plan_json as string,
    state: raw.state as OperationRow["state"], resultJson: raw.result_json as string | null,
    errorCode: raw.error_code as ErrorCode | null, createdAtMs: num(raw.created_at_ms), updatedAtMs: num(raw.updated_at_ms),
  };
  if (!( ["pending", "succeeded", "failed", "unknown"] as const).includes(row.state))
    throw new StoreError("STORE_CORRUPT", `operation ${row.id} has invalid state`);
  if (row.errorCode !== null && !isErrorCode(row.errorCode))
    throw new StoreError("STORE_CORRUPT", `operation ${row.id} has invalid error code`);
  if (row.state === "failed" && row.errorCode !== null && isPreacceptOnlyFailure(row.errorCode))
    throw new StoreError("STORE_CORRUPT", `operation ${row.id} persisted a preaccept-only terminal error`);
  let plan: unknown;
  try { plan = JSON.parse(row.planJson); }
  catch { throw new StoreError("STORE_CORRUPT", `operation ${row.id} has corrupt plan JSON`); }
  const context = { operationId: row.id, actor: row.actor, stateRoot };
  const invalidPlan = operationPlanCheck(row.kind, context)(plan);
  if (invalidPlan) throw new StoreError("STORE_CORRUPT", `operation ${row.id} plan: ${invalidPlan}`);
  if (row.state === "succeeded") {
    if (!row.resultJson || row.errorCode !== null)
      throw new StoreError("STORE_CORRUPT", `operation ${row.id} has inconsistent succeeded state`);
    let result: unknown;
    try { result = JSON.parse(row.resultJson); }
    catch { throw new StoreError("STORE_CORRUPT", `operation ${row.id} has corrupt result JSON`); }
    const invalid = operationResultCheck(row.kind)(result);
    if (invalid) throw new StoreError("STORE_CORRUPT", `operation ${row.id} result: ${invalid}`);
    const relation = operationResultRelationCheck(row.kind, plan, result, context);
    if (relation) throw new StoreError("STORE_CORRUPT", `operation ${row.id} result: ${relation}`);
  } else if (row.state === "failed") {
    if (row.resultJson !== null || row.errorCode === null)
      throw new StoreError("STORE_CORRUPT", `operation ${row.id} has inconsistent failed state`);
  } else if (row.resultJson !== null || row.errorCode !== null) {
    throw new StoreError("STORE_CORRUPT", `operation ${row.id} has terminal data in ${row.state} state`);
  }
  return row;
}
function rowToDelivery(row: Record<string, unknown>): DeliveryRow {
  return {
    messageId: row.message_id as MessageId, recipient: row.recipient as Actor, operationId: row.operation_id as OperationId,
    materialized: row.materialized as 0 | 1, batchId: row.batch_id as BatchId | null,
    presented: row.presented as 0 | 1, acknowledged: row.acknowledged as 0 | 1, createdAtMs: num(row.created_at_ms),
    materializedAtMs: row.materialized_at_ms === null ? null : num(row.materialized_at_ms),
    presentedAtMs: row.presented_at_ms === null ? null : num(row.presented_at_ms),
    acknowledgedAtMs: row.acknowledged_at_ms === null ? null : num(row.acknowledged_at_ms),
  };
}
function rowToBatch(row: Record<string, unknown>): BatchRow {
  return {
    id: row.id as BatchId, agent: row.agent as Actor, incarnation: num(row.incarnation),
    messageIdsJson: row.message_ids_json as string, sessionPath: row.session_path as string | null,
    state: row.state as BatchRow["state"], createdAtMs: num(row.created_at_ms),
    completedAtMs: row.completed_at_ms === null ? null : num(row.completed_at_ms),
  };
}
function rowToUsage(row: Record<string, unknown>): UsageRow {
  return {
    requestId: row.request_id as string, actor: row.actor as Actor, incarnation: num(row.incarnation),
    profile: row.profile as string, pricingRevision: row.pricing_revision as string,
    reservedUnits: num(row.reserved_units), reportedUnits: row.reported_units === null ? null : num(row.reported_units),
    outcome: row.outcome as UsageRow["outcome"], detailsJson: row.details_json as string | null,
    createdAtMs: num(row.created_at_ms), updatedAtMs: num(row.updated_at_ms),
  };
}
