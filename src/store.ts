// MUST [DB-001..009]: sole broker writer; synchronous transactions; six entities.
// No Git/systemd/fsync/await inside transactions (M-004).
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Actor, ErrorCode, MessageId, OperationId, RequestKey, OperationPlan } from "../implementation/contracts.js";
import { operationResultCheck } from "./validate.js";
import { operationResultRelationCheck, type RepositoryIdentity, type OperationPlanContext } from "./durable.js";
import type { DecodedOperation, OperationOf } from "./storage/operation-codec.js";
import { LedgerReader } from "./storage/ledger-reader.js";
import { decodeBatchRow, decodeBatchManifest, fullRow, safeInteger, type AgentRow, type DeliveryRow, type BatchRow, type SubscriptionRow, type UsageRow } from "./storage/rows.js";
import { TransactionScope, assertSynchronousResult, type SyncCallback } from "./storage/transaction.js";
import { isValidSocietyName } from "./ids.js";
import { StoreError, isErrorCode, isPreacceptOnlyFailure } from "./domain/errors.js";
export { StoreError } from "./domain/errors.js";
export type { DecodedOperation } from "./storage/operation-codec.js";
export type { AgentRow, DeliveryRow, BatchRow, SubscriptionRow, UsageRow } from "./storage/rows.js";
export type { Transaction, StoreReads, StoreWrites } from "./storage/transaction.js";

export const SCHEMA_PATH = fileURLToPath(new URL("../../implementation/schema-v1.sql", import.meta.url));
export type OperationRow = DecodedOperation;
export function reused(actor: Actor, key: RequestKey): StoreError {
  return new StoreError("REQUEST_KEY_REUSED", `request key ${key} (actor ${actor}) already used with a different payload`);
}
export function isBusyError(error: unknown): boolean {
  return error instanceof Error && /busy|locked/i.test(error.message) && !(error instanceof StoreError);
}
export interface NewAgent {
  name: Actor; specHash: string; role: "resident" | "principal"; desired: AgentRow["desired"];
  incarnation: number; profile: string; createdBy: string | null; specJson: string;
}
const DEFAULT_BUSY_RETRIES = 5;
export class Store {
  private readonly db: DatabaseSync;
  private readonly reader: LedgerReader;
  private readonly transactions = new TransactionScope(this);
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
    this.reader = new LedgerReader(this.db, dirname(path), () => this.repositoryIdentity);
  }
  bindRepositoryIdentity(identity: RepositoryIdentity): void {
    if (!isValidSocietyName(identity.society)) throw new StoreError("STORE_CORRUPT", "invalid repository society identity");
    if (this.repositoryIdentity !== null && this.repositoryIdentity.society !== identity.society)
      throw new StoreError("STORE_CORRUPT", "conflicting repository society identities");
    this.repositoryIdentity = Object.freeze({ society: identity.society });
  }
  private planContext(operation: OperationRow): OperationPlanContext {
    return { operationId: operation.id, actor: operation.actor, stateRoot: dirname(this.path), repositoryIdentity: this.repositoryIdentity };
  }
  close(): void {
    if (this.inTransaction) throw new StoreError("INTERNAL_ERROR", "cannot close a live transaction");
    this.db.close();
  }
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
    return safeInteger(fullRow(this.db.prepare("PRAGMA user_version").get(), ["user_version"], "schema version").user_version, "schema version");
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
  transaction<T>(fn: SyncCallback<T>): T {
    // Preserve the characterized no-nesting contract: no implicit savepoints.
    if (this.inTransaction) throw new StoreError("INTERNAL_ERROR", "nested store transaction");
    this.begin();
    try {
      return this.transactions.run<T>(tx => {
        const result = fn(tx);
        assertSynchronousResult(result);
        // Before an acceptance becomes visible, validate the complete frozen plan,
        // current related rows, recipient snapshot and optional terminal intent.
        for (const id of this.transactions.insertedIds()) {
          if (this.getOperationById(id) === null) throw new StoreError("STORE_CORRUPT", "newly accepted operation disappeared");
        }
        this.db.exec("COMMIT");
        return result;
      });
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      throw error;
    }
  }
  get inTransaction(): boolean { return this.transactions.active; }
  /** Compatibility mutations require the same live capability as tx.* methods.
   * New consumers should depend on StoreReads and write through the callback tx.
   */
  private requireTx(): void { this.transactions.requireLive(); }
  insertAgent(agent: NewAgent): void {
    this.requireTx();
    this.db.prepare(`INSERT INTO agents
      (name, spec_hash, role, desired, incarnation, profile, created_by, spec_json, created_at_ms, updated_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(agent.name, agent.specHash, agent.role, agent.desired, agent.incarnation,
      agent.profile, agent.createdBy, agent.specJson, Date.now(), Date.now());
  }
  getAgent(name: string): AgentRow | null { return this.reader.agent(name); }
  listAgents(): AgentRow[] { return this.reader.agents(); }
  updateAgent(agent: { name: string; desired?: AgentRow["desired"]; incarnation?: number; specHash?: string; specJson?: string }): void {
    this.requireTx(); const now = Date.now();
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
      this.db.prepare("UPDATE agents SET spec_hash=?, spec_json=?, updated_at_ms=? WHERE name=?").run(agent.specHash ?? current.specHash, agent.specJson ?? current.specJson, now, agent.name);
    }
  }
  follow(topic: string, agent: string): void {
    this.requireTx();
    this.db.prepare("INSERT OR IGNORE INTO subscriptions (topic, agent, created_at_ms) VALUES (?,?,?)").run(topic, agent, Date.now());
  }
  unfollow(topic: string, agent: string): void {
    this.requireTx(); this.db.prepare("DELETE FROM subscriptions WHERE topic=? AND agent=?").run(topic, agent);
  }
  subscribers(topic: string): string[] { return this.reader.subscriptions(topic).map(row => row.agent); }
  allSubscriptions(): SubscriptionRow[] { return this.reader.subscriptions(); }
  insertOperation(operation: { id: OperationId; actor: Actor; requestKey: RequestKey; requestHash: string; kind: OperationPlan["kind"]; payloadJson: string; planJson: string }): void {
    this.requireTx();
    try {
      this.db.prepare(`INSERT INTO operations
        (id, actor, request_key, request_hash, kind, payload_json, plan_json, state, created_at_ms, updated_at_ms)
        VALUES (?,?,?,?,?,?,?, 'pending', ?, ?)`).run(operation.id, operation.actor, operation.requestKey, operation.requestHash,
        operation.kind, operation.payloadJson, operation.planJson, Date.now(), Date.now());
      this.transactions.recordInserted(operation.id);
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
  acceptOperation(operation: Parameters<Store["insertOperation"]>[0]): "inserted" | "retry" {
    return this.claimOperation(operation);
  }
  getOperation(actor: Actor, key: RequestKey): OperationRow | null { return this.reader.operation(actor, key); }
  getOperationById(id: OperationId): OperationRow | null { return this.reader.operationById(id); }
  findPhysicalCreate(name: Actor, specHash: string): OperationOf<"agent.create"> | null { return this.reader.physicalCreate(name, specHash); }
  recoverableOperations(): OperationId[] { return this.reader.recoverableIds(); }
  updateOperationPlanJson(id: OperationId, planJson: string): void {
    this.requireTx(); this.transactions.requireUnaccepted(id);
    const value = this.db.prepare("SELECT state FROM operations WHERE id=?").get(id);
    const row = fullRow(value, ["state"], "unaccepted operation state");
    if (row.state !== "pending") throw new StoreError("STORE_CORRUPT", "terminal or unknown operation plan is immutable");
    const result = this.db.prepare("UPDATE operations SET plan_json=?, updated_at_ms=? WHERE id=? AND state='pending'").run(planJson, Date.now(), id);
    if (Number(result.changes) !== 1) throw new StoreError("STORE_CORRUPT", "unaccepted plan update was not applied exactly once");
  }
  setOperationSucceeded(id: OperationId, resultJson: string): void {
    this.requireTx(); const current = this.getOperationById(id);
    if (!current) throw new StoreError("STORE_CORRUPT", `missing operation ${id}`);
    let result: unknown;
    try { result = JSON.parse(resultJson); } catch { throw new StoreError("STORE_CORRUPT", `operation ${id} result is not valid JSON`); }
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
    this.requireTx(); const current = this.getOperationById(id);
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
    this.db.prepare("UPDATE deliveries SET materialized=1, materialized_at_ms=? WHERE message_id=? AND recipient=? AND materialized=0").run(Date.now(), messageId, recipient);
  }
  markAcknowledged(messageId: MessageId, recipient: Actor): void {
    this.requireTx();
    this.db.prepare("UPDATE deliveries SET acknowledged=1, acknowledged_at_ms=? WHERE message_id=? AND recipient=? AND acknowledged=0").run(Date.now(), messageId, recipient);
  }
  pendingDeliveries(agent: Actor): DeliveryRow[] { return this.reader.pendingDeliveries(agent); }
  getDelivery(messageId: MessageId, recipient: Actor): DeliveryRow | null { return this.reader.delivery(messageId, recipient); }
  deliveriesForOperation(operationId: OperationId): DeliveryRow[] { return this.reader.operationDeliveries(operationId); }
  insertPreparedBatch(batch: { id: string; agent: Actor; incarnation: number; messageIds: MessageId[]; sessionPath: string | null }): void {
    this.requireTx();
    this.db.prepare(`INSERT INTO batches (id, agent, incarnation, message_ids_json, session_path, state, created_at_ms, completed_at_ms)
      VALUES (?,?,?,?,?, 'prepared', ?, NULL)`).run(batch.id, batch.agent, batch.incarnation, JSON.stringify(batch.messageIds), batch.sessionPath, Date.now());
  }
  getBatch(id: string): BatchRow | null { return this.reader.batch(id); }
  preparedBatches(agent: Actor): BatchRow[] { return this.reader.preparedBatches(agent); }
  reassignPreparedBatches(agent: Actor, incarnation: number): void {
    this.requireTx(); this.db.prepare("UPDATE batches SET incarnation=? WHERE agent=? AND state='prepared'").run(incarnation, agent);
  }
  linkDeliveriesToBatch(batchId: string, messageIds: MessageId[]): void {
    this.requireTx();
    // A just-inserted batch is not externally accepted until its exact set is linked.
    const raw = this.db.prepare("SELECT * FROM batches WHERE id=?").get(batchId);
    if (raw === undefined) throw new StoreError("BATCH_CONFLICT", `no such batch ${batchId}`);
    const batch = decodeBatchRow(raw);
    if (batch.state === "completed") throw new StoreError("BATCH_CONFLICT", `completed batch ${batchId} is immutable`);
    const implied = decodeBatchManifest(batch.messageIdsJson);
    if (implied.length !== messageIds.length || implied.some((id, index) => id !== messageIds[index])) throw new StoreError("BATCH_CONFLICT", "batch message order differs from the frozen manifest");
    for (const id of messageIds) {
      const delivery = this.getDelivery(id, batch.agent);
      if (!delivery || delivery.materialized !== 1 || delivery.presented !== 0) throw new StoreError("BATCH_CONFLICT", `message ${id} is not pending for ${batch.agent}`);
      if (delivery.batchId !== null && delivery.batchId !== batchId) throw new StoreError("BATCH_CONFLICT", `message ${id} already in another batch`);
    }
    const update = this.db.prepare("UPDATE deliveries SET batch_id=? WHERE message_id=? AND recipient=?");
    for (const id of messageIds) update.run(batchId, id, batch.agent);
    this.getBatch(batchId);
  }
  pendingBatchesFor(agent: Actor, incarnation: number): BatchRow[] { return this.preparedBatches(agent).filter(batch => batch.incarnation === incarnation); }
  completeBatch(batchId: string, markPresentedIds: MessageId[], agent: Actor): void {
    this.requireTx(); const batch = this.getBatch(batchId);
    if (!batch) throw new StoreError("BATCH_CONFLICT", `no such batch ${batchId}`);
    if (batch.agent !== agent) throw new StoreError("BATCH_CONFLICT", "batch owner mismatch");
    const manifest = decodeBatchManifest(batch.messageIdsJson);
    if (manifest.length !== markPresentedIds.length || manifest.some((id, index) => id !== markPresentedIds[index])) throw new StoreError("BATCH_CONFLICT", "batch completion manifest mismatch");
    if (batch.state === "completed") return;
    this.db.prepare("UPDATE batches SET state='completed', completed_at_ms=? WHERE id=?").run(Date.now(), batchId);
    const statement = this.db.prepare("UPDATE deliveries SET presented=1, presented_at_ms=? WHERE message_id=? AND recipient=? AND presented=0");
    for (const id of markPresentedIds) statement.run(Date.now(), id, agent);
    this.getBatch(batchId);
  }
  reserveUsage(usage: { requestId: string; actor: Actor; incarnation: number; profile: string; pricingRevision: string; reservedUnits: number }): void {
    this.requireTx();
    this.db.prepare(`INSERT INTO usage
      (request_id, actor, incarnation, profile, pricing_revision, reserved_units, reported_units, outcome, details_json, created_at_ms, updated_at_ms)
      VALUES (?,?,?,?,?,?,NULL,'reserved',NULL,?,?)`).run(usage.requestId, usage.actor, usage.incarnation, usage.profile,
      usage.pricingRevision, usage.reservedUnits, Date.now(), Date.now());
  }
  usageRows(): UsageRow[] { return this.reader.usages(); }
  getUsage(requestId: string): UsageRow | null { return this.reader.usage(requestId); }
  settleUsage(requestId: string, outcome: UsageRow["outcome"], reportedUnits: number | null, detailsJson: string | null): void {
    this.requireTx(); this.db.prepare("UPDATE usage SET outcome=?, reported_units=?, details_json=?, updated_at_ms=? WHERE request_id=?").run(outcome, reportedUnits, detailsJson, Date.now(), requestId);
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
