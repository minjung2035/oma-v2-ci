// MUST [DB-001..009]: sole broker writer; synchronous transactions; six entities.
// No Git/systemd/fsync/await inside transactions (M-004).
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Actor, BatchId, ErrorCode, MessageId, OperationId, RequestKey, OperationPlan } from "../implementation/contracts.js";
import { operationResultCheck } from "./validate.js";
import { operationResultRelationCheck, type RepositoryIdentity, type OperationPlanContext } from "./durable.js";
import { decodeOperation, type DecodedOperation, type OperationOf, type OperationDecodeContext } from "./storage/operation-codec.js";
import { isValidOperationId, isValidSocietyName } from "./ids.js";
import { StoreError, isErrorCode, isPreacceptOnlyFailure } from "./domain/errors.js";
export { StoreError } from "./domain/errors.js";
export type { DecodedOperation } from "./storage/operation-codec.js";

export const SCHEMA_PATH = fileURLToPath(new URL("../../implementation/schema-v1.sql", import.meta.url));
export interface AgentRow {
  name: Actor; specHash: string; role: "resident" | "principal";
  desired: "provisioning" | "enabled" | "stopped" | "retired";
  incarnation: number; profile: string; createdBy: string | null; specJson: string;
  createdAtMs: number; updatedAtMs: number;
}
/** Compatibility type name; every exposed value now carries decoded plan/payload/result. */
export type OperationRow = DecodedOperation;
export interface SubscriptionRow { topic: string; agent: Actor; createdAtMs: number }
export interface DeliveryRow {
  messageId: MessageId; recipient: Actor; operationId: OperationId; materialized: 0 | 1;
  batchId: BatchId | null; presented: 0 | 1; acknowledged: 0 | 1; createdAtMs: number;
  materializedAtMs: number | null; presentedAtMs: number | null; acknowledgedAtMs: number | null;
}
export interface BatchRow {
  id: BatchId; agent: Actor; incarnation: number; messageIdsJson: string;
  sessionPath: string | null; state: "prepared" | "completed"; createdAtMs: number; completedAtMs: number | null;
}
export interface UsageRow {
  requestId: string; actor: Actor; incarnation: number; profile: string; pricingRevision: string;
  reservedUnits: number; reportedUnits: number | null; outcome: "reserved" | "completed" | "cancelled" | "unknown";
  detailsJson: string | null; createdAtMs: number; updatedAtMs: number;
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
  name: Actor; specHash: string; role: "resident" | "principal"; desired: AgentRow["desired"];
  incarnation: number; profile: string; createdBy: string | null; specJson: string;
}
const DEFAULT_BUSY_RETRIES = 5;
export class Store {
  private readonly db: DatabaseSync;
  private depth = 0;
  private repositoryIdentity: RepositoryIdentity | null;
  constructor(readonly path: string, readonly busyRetries: number = DEFAULT_BUSY_RETRIES, identity: RepositoryIdentity | null = null) {
    this.repositoryIdentity = null;
    if (identity !== null) this.bindRepositoryIdentity(identity);
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }
  /** Existing host configuration supplies this fact, never a value parsed from a plan. */
  bindRepositoryIdentity(identity: RepositoryIdentity): void {
    if (!isValidSocietyName(identity.society)) throw new StoreError("STORE_CORRUPT", "invalid repository society identity");
    if (this.repositoryIdentity !== null && this.repositoryIdentity.society !== identity.society)
      throw new StoreError("STORE_CORRUPT", "conflicting repository society identities");
    this.repositoryIdentity = Object.freeze({ society: identity.society });
  }
  private decodeContext(): OperationDecodeContext {
    return {
      stateRoot: dirname(this.path), repositoryIdentity: this.repositoryIdentity,
      relations: {
        operation: id => this.db.prepare("SELECT * FROM operations WHERE id=?").get(id) ?? null,
        agent: name => this.db.prepare("SELECT * FROM agents WHERE name=?").get(name) ?? null,
        deliveries: id => this.db.prepare("SELECT * FROM deliveries WHERE operation_id=? ORDER BY message_id, recipient").all(id),
      },
    };
  }
  private planContext(operation: OperationRow): OperationPlanContext {
    return { operationId: operation.id, actor: operation.actor, stateRoot: dirname(this.path), repositoryIdentity: this.repositoryIdentity };
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
    for (let index = 0; index < this.busyRetries + 1 && !ok; index++) {
      try { this.db.exec("BEGIN IMMEDIATE"); ok = true; }
      catch (error) {
        if (isBusyError(error)) {
          if (index < this.busyRetries) continue;
          throw new StoreError("DB_BUSY", "BEGIN IMMEDIATE blocked");
        }
        throw new StoreError("STORE_CORRUPT", `BEGIN IMMEDIATE failed: ${(error as Error).message}`);
      }
    }
  }
  transaction<T>(fn: (tx: Transaction) => T): T {
    if (this.depth > 0) throw new StoreError("INTERNAL_ERROR", "nested store transaction");
    this.begin(); this.depth = 1;
    try {
      const result = fn(TX);
      this.db.exec("COMMIT"); this.depth = 0;
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      this.depth = 0;
      throw error;
    }
  }
  get inTransaction(): boolean { return this.depth > 0; }
  private requireTx(): void { if (this.depth === 0) throw new StoreError("INTERNAL_ERROR", "mutation outside transaction"); }
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
      if (!validDesiredTransition(existing.desired, agent.desired)) throw new StoreError("INVALID_REQUEST", `invalid desired transition ${existing.desired}->${agent.desired}`);
      this.db.prepare("UPDATE agents SET desired=?, updated_at_ms=? WHERE name=?").run(agent.desired, now, agent.name);
    }
    if (agent.incarnation !== undefined) this.db.prepare("UPDATE agents SET incarnation=?, updated_at_ms=? WHERE name=?").run(agent.incarnation, now, agent.name);
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
  insertOperation(operation: { id: OperationId; actor: Actor; requestKey: RequestKey; requestHash: string; kind: OperationPlan["kind"]; payloadJson: string; planJson: string }): void {
    this.requireTx();
    try {
      this.db.prepare(`INSERT INTO operations
        (id, actor, request_key, request_hash, kind, payload_json, plan_json, state, created_at_ms, updated_at_ms)
        VALUES (?,?,?,?,?,?,?, 'pending', ?, ?)`).run(operation.id, operation.actor, operation.requestKey,
        operation.requestHash, operation.kind, operation.payloadJson, operation.planJson, Date.now(), Date.now());
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: operations.actor, operations.request_key/.test(error.message)) throw new StoreError("REQUEST_KEY_REUSED", "request key already used by this actor");
      throw error;
    }
  }
  claimKey(actor: Actor, key: RequestKey, hash: string): "retry" | "reused" | "absent" {
    const existing = this.getOperation(actor, key);
    return existing === null ? "absent" : existing.requestHash === hash ? "retry" : "reused";
  }
  claimOperation(operation: { id: OperationId; actor: Actor; requestKey: RequestKey; requestHash: string; kind: OperationPlan["kind"]; payloadJson: string; planJson: string }): "inserted" | "retry" {
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
    const raw = this.db.prepare("SELECT * FROM operations WHERE actor=? AND request_key=?").get(actor, key);
    return raw === undefined ? null : decodeOperation(raw, this.decodeContext());
  }
  getOperationById(id: OperationId): OperationRow | null {
    const raw = this.db.prepare("SELECT * FROM operations WHERE id=?").get(id);
    return raw === undefined ? null : decodeOperation(raw, this.decodeContext());
  }
  findPhysicalCreate(name: Actor, specHash: string): OperationOf<"agent.create"> | null {
    const raw = this.db.prepare(`SELECT * FROM operations
      WHERE kind='agent.create' AND json_extract(plan_json,'$.spec.name')=?
        AND json_extract(plan_json,'$.specHash')=? AND json_type(plan_json,'$.existingCreation')='null'
      ORDER BY created_at_ms, id LIMIT 1`).get(name, specHash);
    if (raw === undefined) return null;
    const operation = decodeOperation(raw, this.decodeContext());
    if (operation.kind !== "agent.create") throw new StoreError("STORE_CORRUPT", "physical create query returned another kind");
    return operation;
  }
  recoverableOperations(): OperationId[] {
    const rows = this.db.prepare("SELECT id FROM operations WHERE state IN ('pending','unknown') ORDER BY created_at_ms, id").all();
    return rows.map(row => {
      if (!isValidOperationId(row.id)) throw new StoreError("STORE_CORRUPT", "invalid recoverable operation id");
      return row.id;
    });
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
    const invalid = operationResultCheck(current.kind)(result) ?? operationResultRelationCheck(current.kind, current.plan, result, this.planContext(current));
    if (invalid) throw new StoreError("STORE_CORRUPT", `operation ${id} result: ${invalid}`);
    if (current.state === "succeeded") {
      if (current.resultJson === resultJson) return;
      throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
    }
    if (current.state === "failed") throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
    const updated = this.db.prepare("UPDATE operations SET state='succeeded', result_json=?, error_code=NULL, updated_at_ms=? WHERE id=? AND state IN ('pending','unknown')").run(resultJson, Date.now(), id);
    if (Number(updated.changes) !== 1) throw new StoreError("STORE_CORRUPT", `operation ${id} transition was not applied exactly once`);
  }
  setOperationFailed(id: OperationId, code: ErrorCode): void {
    this.requireTx();
    if (!isErrorCode(code) || isPreacceptOnlyFailure(code)) throw new StoreError("STORE_CORRUPT", `accepted operation ${id} cannot transition to preaccept or invalid failure`);
    const current = this.getOperationById(id);
    if (!current) throw new StoreError("STORE_CORRUPT", `missing operation ${id}`);
    if (current.state === "failed" && current.errorCode === code) return;
    if (current.state === "failed" || current.state === "succeeded") throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
    const updated = this.db.prepare("UPDATE operations SET state='failed', result_json=NULL, error_code=?, updated_at_ms=? WHERE id=? AND state IN ('pending','unknown')").run(code, Date.now(), id);
    if (Number(updated.changes) !== 1) throw new StoreError("STORE_CORRUPT", `operation ${id} transition was not applied exactly once`);
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
      (message_id, recipient, operation_id, materialized, presented, acknowledged, created_at_ms) VALUES (?,?,?,0,0,0,?)`);
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
      WHERE recipient=? AND materialized=1 AND presented=0 AND batch_id IS NULL ORDER BY created_at_ms, message_id`).all(agent) as Record<string, unknown>[];
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
    if (implied.size !== have.size || [...implied].some(id => !have.has(id))) throw new StoreError("BATCH_CONFLICT", "batch message ids do not match the linked deliveries");
    for (const id of messageIds) {
      const delivery = this.getDelivery(id, batch.agent);
      if (!delivery) throw new StoreError("BATCH_CONFLICT", `message ${id} has no delivery for ${batch.agent}`);
      if (delivery.batchId !== null && delivery.batchId !== batchId) throw new StoreError("BATCH_CONFLICT", `message ${id} already in batch ${delivery.batchId}`);
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
    this.db.prepare("UPDATE usage SET outcome=?, reported_units=?, details_json=?, updated_at_ms=? WHERE request_id=?").run(outcome, reportedUnits, detailsJson, Date.now(), requestId);
  }
}
function validDesiredTransition(from: AgentRow["desired"], to: AgentRow["desired"]): boolean {
  if (from === to) return true;
  switch (from) {
    case "provisioning": return to === "enabled" || to === "stopped";
    case "enabled": return to === "stopped" || to === "retired";
    case "stopped": return to === "enabled" || to === "retired";
    case "retired": return false;
  }
}
function num(value: unknown): number { return typeof value === "number" ? value : Number(value); }
function rowToAgent(row: Record<string, unknown>): AgentRow {
  return { name: row.name as Actor, specHash: row.spec_hash as string, role: row.role as AgentRow["role"], desired: row.desired as AgentRow["desired"], incarnation: num(row.incarnation), profile: row.profile as string, createdBy: row.created_by as string | null, specJson: row.spec_json as string, createdAtMs: num(row.created_at_ms), updatedAtMs: num(row.updated_at_ms) };
}
function rowToDelivery(row: Record<string, unknown>): DeliveryRow {
  return { messageId: row.message_id as MessageId, recipient: row.recipient as Actor, operationId: row.operation_id as OperationId, materialized: row.materialized as 0 | 1, batchId: row.batch_id as BatchId | null, presented: row.presented as 0 | 1, acknowledged: row.acknowledged as 0 | 1, createdAtMs: num(row.created_at_ms), materializedAtMs: row.materialized_at_ms === null ? null : num(row.materialized_at_ms), presentedAtMs: row.presented_at_ms === null ? null : num(row.presented_at_ms), acknowledgedAtMs: row.acknowledged_at_ms === null ? null : num(row.acknowledged_at_ms) };
}
function rowToBatch(row: Record<string, unknown>): BatchRow {
  return { id: row.id as BatchId, agent: row.agent as Actor, incarnation: num(row.incarnation), messageIdsJson: row.message_ids_json as string, sessionPath: row.session_path as string | null, state: row.state as BatchRow["state"], createdAtMs: num(row.created_at_ms), completedAtMs: row.completed_at_ms === null ? null : num(row.completed_at_ms) };
}
function rowToUsage(row: Record<string, unknown>): UsageRow {
  return { requestId: row.request_id as string, actor: row.actor as Actor, incarnation: num(row.incarnation), profile: row.profile as string, pricingRevision: row.pricing_revision as string, reservedUnits: num(row.reserved_units), reportedUnits: row.reported_units === null ? null : num(row.reported_units), outcome: row.outcome as UsageRow["outcome"], detailsJson: row.details_json as string | null, createdAtMs: num(row.created_at_ms), updatedAtMs: num(row.updated_at_ms) };
}
