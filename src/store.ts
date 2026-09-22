// MUST [DB-001..009]: sole broker writer; synchronous transactions; six entities.
// No Git/systemd/fsync/await inside transactions (M-004).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Actor, MessageId, OperationId, RequestKey } from "../implementation/contracts/identity.js";
import type { ErrorCode } from "../implementation/contracts/errors.js";
import type { RepositoryIdentity, OperationPlanContext } from "./durable.js";
import type { DecodedOperation, OperationOf } from "./storage/operation-codec.js";
import { LedgerReader } from "./storage/ledger-reader.js";
import { assertDirectory } from "./storage/directory.js";
import { LEDGER_TABLES, DIAGNOSTIC_READ_LIMITS, type DiagnosticReadLimits, type DiagnosticSnapshot, type LedgerTable } from "./storage/diagnostic-snapshot.js";
import { fullRow, safeInteger, type AgentRow, type DeliveryRow, type BatchRow, type SubscriptionRow, type UsageRow } from "./storage/rows.js";
import { LedgerTransitions, type DeliveryIdentity, type PreparedBatchInput, type UsageReservation } from "./storage/transitions.js";
import { OperationTransitions, type NewOperation } from "./storage/operation-transitions.js";
import { OperationJournal } from "./storage/operation-journal.js";
import { readFacets } from "./storage/facets.js";
export { reused } from "./storage/operation-journal.js";
import { TransactionScope, assertSynchronousResult, type SyncCallback } from "./storage/transaction.js";
import { isValidSocietyName, isValidFullOid, isValidOperationId } from "./domain/identifiers.js";
import { SCHEMA_USER_VERSION_READABLE, SCHEMA_USER_VERSION_WRITTEN } from "./domain/persisted-formats.js";
import { StoreError, normalizeStorageFailure } from "./domain/errors.js";
export { StoreError } from "./domain/errors.js";
export type { DecodedOperation } from "./storage/operation-codec.js";
export type { AgentRow, DeliveryRow, BatchRow, SubscriptionRow, UsageRow } from "./storage/rows.js";
export type { Transaction, StoreReads, StoreWrites } from "./storage/transaction.js";

export const SCHEMA_PATH = fileURLToPath(new URL("../../implementation/schema-v1.sql", import.meta.url));
export type OperationRow = DecodedOperation;
export function isBusyError(error: unknown): boolean {
  return error instanceof Error && /busy|locked/i.test(error.message) && !(error instanceof StoreError);
}
export interface NewAgent {
  name: Actor; specHash: string; role: "resident" | "principal"; desired: AgentRow["desired"];
  incarnation: number; profile: string; createdBy: string | null; specJson: string;
}

/** Existing-file compatibility only. Startup must already own the broker's
 * single-writer fence; this observation is not a substitute for that authority.
 * Never ignore a WAL or journal by unconditionally declaring a file immutable.
 */
function preflightDatabase(path: string): void {
  if (path === ":memory:") return;
  if (path.startsWith("file:"))
    throw new StoreError("STORE_CORRUPT", "Store requires a filesystem path, not a SQLite URI");
  const suffixes = ["", "-wal", "-shm", "-journal"] as const;
  const identities = (): (string | null)[] => suffixes.map(suffix => {
    const stat = lstatSync(path + suffix, { bigint: true, throwIfNoEntry: false });
    if (!stat) return null;
    if (!stat.isFile() || stat.nlink !== 1n)
      throw new StoreError("STORE_CORRUPT", "database and sidecars must be unaliased regular files");
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  });
  const before = identities();
  if (before[0] === null) {
    if (before.slice(1).some(identity => identity !== null))
      throw new StoreError("BROKER_UNAVAILABLE", "database is absent but sidecar evidence remains");
    return;
  }
  if (before[3] !== null)
    throw new StoreError("BROKER_UNAVAILABLE", "journal recovery cannot precede schema compatibility; evidence preserved");
  const uri = pathToFileURL(path);
  uri.searchParams.set("mode", "ro");
  if (before[1] === null && before[2] === null) {
    // Under the startup writer fence, absent sidecars mean there is no pending
    // WAL/journal to ignore. Check the same identities again before writer setup.
    uri.searchParams.set("immutable", "1");
  } else {
    if (before[1] === null || before[2] === null)
      throw new StoreError("BROKER_UNAVAILABLE", "read-only WAL preflight requires both existing sidecars; evidence preserved");
    // SQLite's Unix VFS must not create/rebuild its shared-memory index here.
    uri.searchParams.set("readonly_shm", "1");
  }
  const db = new DatabaseSync(uri.href, { readOnly: true, allowExtension: false });
  let failure: unknown;
  let failed = false;
  try {
    const version = safeInteger(fullRow(db.prepare("PRAGMA user_version").get(), ["user_version"], "schema version").user_version, "schema version");
    if (!SCHEMA_USER_VERSION_READABLE.includes(version) && version !== 0)
      throw new StoreError("STORE_CORRUPT", `unexpected schema user_version ${version}; no migration was attempted`);
    if (version === 0 && db.prepare("SELECT 1 FROM sqlite_schema LIMIT 1").get() !== undefined)
      throw new StoreError("STORE_CORRUPT", "unversioned nonempty database is not a new OMA database");
  } catch (error) { failed = true; failure = error; }
  try { db.close(); }
  catch (closeError) {
    if (failed) throw new AggregateError([failure, closeError], "schema preflight and close failed");
    throw closeError;
  }
  if (failed) throw failure;
  if (identities().some((identity, index) => identity !== before[index]))
    throw new StoreError("BROKER_UNAVAILABLE", "database identity changed during schema preflight; writer setup refused");
}

/** Administrator-only read connection. No Store construction, migration, WAL
 * mode change, repair or writer is performed. Quiesce the broker for an offline
 * DB+filesystem scan; a live SQLite snapshot does not pin filesystem observations.
 */
export function readDiagnosticSnapshot(stateRoot: string, limits: DiagnosticReadLimits = DIAGNOSTIC_READ_LIMITS): DiagnosticSnapshot {
  for (const value of [limits.maxRows, limits.maxBytes, limits.maxDatabaseBytes])
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("invalid diagnostic read budget");
  assertDirectory(stateRoot);
  const path = join(stateRoot, "runtime.sqlite");
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new StoreError("STORE_CORRUPT", "diagnostic database is not a regular file");
  if (before.size > limits.maxDatabaseBytes) throw new StoreError("LIMIT_EXCEEDED", "diagnostic database byte budget exceeded");
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = lstatSync(path + suffix, { throwIfNoEntry: false });
    if (sidecar && (!sidecar.isFile() || sidecar.isSymbolicLink()))
      throw new StoreError("STORE_CORRUPT", "diagnostic database sidecar is not a regular file");
    if (sidecar && sidecar.size > limits.maxDatabaseBytes) throw new StoreError("LIMIT_EXCEEDED", "diagnostic sidecar byte budget exceeded");
  }
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  let reading = false;
  try {
    db.exec("PRAGMA query_only = ON; BEGIN"); reading = true;
    const version = safeInteger(fullRow(db.prepare("PRAGMA user_version").get(), ["user_version"], "schema version").user_version, "schema version");
    if (!SCHEMA_USER_VERSION_READABLE.includes(version))
      throw new StoreError("STORE_CORRUPT", `diagnostics require a readable schema version; found ${version} and no migration was attempted`);
    const schema = [];
    for (const row of db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','view','trigger')").iterate()) {
      if (schema.length >= LEDGER_TABLES.length) throw new StoreError("STORE_CORRUPT", "unexpected diagnostic database objects");
      schema.push(row);
    }
    if (schema.length !== LEDGER_TABLES.length || schema.some(row => row.type !== "table" || typeof row.name !== "string" ||
      !LEDGER_TABLES.some(table => table === row.name) || typeof row.sql !== "string" || /CREATE\s+VIRTUAL/i.test(row.sql)))
      throw new StoreError("STORE_CORRUPT", "diagnostic database entity set differs from v1");
    let rows = 0, bytes = 0;
    const tables: Record<LedgerTable, unknown[]> = { agents: [], operations: [], subscriptions: [], deliveries: [], batches: [], usage: [] };
    for (const table of LEDGER_TABLES) {
      // Table names come only from the closed constant, never from persisted SQL.
      for (const row of db.prepare(`SELECT * FROM ${table}`).iterate()) {
        if (++rows > limits.maxRows) throw new StoreError("LIMIT_EXCEEDED", "diagnostic row budget exceeded");
        for (const value of Object.values(row)) bytes += typeof value === "string" ? Buffer.byteLength(value) :
          ArrayBuffer.isView(value) ? value.byteLength : value === null ? 0 : 8;
        if (bytes > limits.maxBytes) throw new StoreError("LIMIT_EXCEEDED", "diagnostic snapshot byte budget exceeded");
        tables[table].push(Object.freeze({ ...row }));
      }
      Object.freeze(tables[table]);
    }
    const integrity = db.prepare("PRAGMA integrity_check(100)").all().map(row => String(row.integrity_check));
    const foreignKeys: unknown[] = [];
    for (const row of db.prepare("PRAGMA foreign_key_check").iterate()) {
      if (foreignKeys.length >= 100) throw new StoreError("LIMIT_EXCEEDED", "diagnostic foreign-key issue budget exceeded");
      foreignKeys.push(Object.freeze({ ...row }));
    }
    const after = lstatSync(path);
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino)
      throw new StoreError("BROKER_UNAVAILABLE", "diagnostic database identity changed during observation");
    return Object.freeze({ schemaVersion: version, tables: Object.freeze(tables), integrity: Object.freeze(integrity), foreignKeys: Object.freeze(foreignKeys) });
  } finally {
    try { if (reading) db.exec("ROLLBACK"); } finally { db.close(); }
  }
}

const DEFAULT_BUSY_RETRIES = 5;
export class Store {
  private readonly readViews = readFacets(this);
  readonly operations = this.readViews.operations;
  readonly agents = this.readViews.agents;
  readonly subscriptions = this.readViews.subscriptions;
  readonly deliveries = this.readViews.deliveries;
  readonly batches = this.readViews.batches;
  readonly usage = this.readViews.usage;
  private readonly db: DatabaseSync;
  private readonly reader: LedgerReader;
  private readonly transitions: LedgerTransitions;
  private readonly journal: OperationJournal;
  private readonly transactions = new TransactionScope(this);
  private repositoryIdentity: RepositoryIdentity | null;
  constructor(readonly path: string, readonly busyRetries: number = DEFAULT_BUSY_RETRIES, identity: RepositoryIdentity | null = null) {
    this.repositoryIdentity = null;
    if (identity !== null) this.bindRepositoryIdentity(identity);
    preflightDatabase(path);
    this.db = new DatabaseSync(path);
    // Until construction returns, this scope owns the native connection. The
    // broker lifetime cannot retain a Store whose constructor threw.
    try {
      this.db.exec("PRAGMA foreign_keys = ON");
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = FULL");
      this.db.exec("PRAGMA busy_timeout = 5000");
      this.migrate();
      this.reader = new LedgerReader(this.db, dirname(path), () => this.repositoryIdentity);
      this.transitions = new LedgerTransitions(this.db, this.reader, () => this.requireTx());
      this.journal = new OperationJournal(this.reader,
        new OperationTransitions(this.db, this.reader, this.transactions, operation => this.planContext(operation)),
        this.transactions);
    } catch (error) {
      try { this.db.close(); }
      catch (closeError) { throw new AggregateError([error, closeError], "Store initialization and close failed"); }
      throw error;
    }
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
    // P8: the readable version set is explicit. Anything else fails closed with
    // no migration attempt and no rewrite of the existing file.
    if (SCHEMA_USER_VERSION_READABLE.includes(version)) return;
    if (version !== 0) throw new StoreError("STORE_CORRUPT", `unexpected schema user_version ${version}; no migration was attempted`);
    let ddl: string;
    try { ddl = readFileSync(SCHEMA_PATH, "utf8"); }
    catch (error) { throw new StoreError("STORE_CORRUPT", `schema file unreadable: ${(error as Error).message}`, { cause: error }); }
    try { this.db.exec(ddl); }
    catch (error) {
      let failure: unknown = error;
      if (this.db.isTransaction) {
        try { this.db.exec("ROLLBACK"); }
        catch (rollbackError) { failure = new AggregateError([error, rollbackError], "migration and rollback failed"); }
      }
      const normalized = normalizeStorageFailure(failure);
      if (normalized instanceof StoreError) throw normalized;
      throw new StoreError("STORE_CORRUPT", `migration failed: ${(error as Error).message}`, { cause: failure });
    }
    if (this.userVersion() !== SCHEMA_USER_VERSION_WRITTEN)
      throw new StoreError("STORE_CORRUPT", `migration did not set user_version=${SCHEMA_USER_VERSION_WRITTEN}`);
  }
  private userVersion(): number {
    return safeInteger(fullRow(this.db.prepare("PRAGMA user_version").get(), ["user_version"], "schema version").user_version, "schema version");
  }
  private begin(): void {
    for (let index = 0; index <= this.busyRetries; index++) {
      try { this.db.exec("BEGIN IMMEDIATE"); return; }
      catch (error) {
        if (isBusyError(error)) {
          if (index < this.busyRetries) continue;
          throw new StoreError("DB_BUSY", "BEGIN IMMEDIATE blocked");
        }
        const normalized = normalizeStorageFailure(error);
        if (normalized instanceof StoreError) throw normalized;
        throw new StoreError("STORE_CORRUPT", `BEGIN IMMEDIATE failed: ${(error as Error).message}`);
      }
    }
    throw new StoreError("INTERNAL_ERROR", "invalid transaction retry configuration");
  }
  transaction<T>(fn: SyncCallback<T>): T {
    if (this.inTransaction) throw new StoreError("INTERNAL_ERROR", "nested store transaction");
    this.begin();
    try {
      return this.transactions.run<T>(tx => {
        const result = fn(tx);
        assertSynchronousResult(result);
        for (const id of this.transactions.insertedIds())
          if (this.getOperationById(id) === null) throw new StoreError("STORE_CORRUPT", "newly accepted operation disappeared");
        this.transitions.validatePending();
        this.db.exec("COMMIT");
        return result;
      });
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      throw normalizeStorageFailure(error);
    } finally { this.transitions.reset(); }
  }
  get inTransaction(): boolean { return this.transactions.active; }
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
  follow(topic: string, agent: string): void { this.transitions.follow(topic, agent); }
  unfollow(topic: string, agent: string): void {
    this.requireTx(); this.db.prepare("DELETE FROM subscriptions WHERE topic=? AND agent=?").run(topic, agent);
  }
  subscribers(topic: string): string[] { return this.reader.subscriptions(topic).map(row => row.agent); }
  allSubscriptions(): SubscriptionRow[] { return this.reader.subscriptions(); }
  insertOperation(operation: NewOperation): void { this.journal.insert(operation); }
  claimKey(actor: Actor, key: RequestKey, hash: string): "retry" | "reused" | "absent" {
    return this.journal.classifyKey(actor, key, hash);
  }
  claimOperation(operation: NewOperation): "inserted" | "retry" { return this.journal.accept(operation); }
  acceptOperation(operation: Parameters<Store["insertOperation"]>[0]): "inserted" | "retry" { return this.claimOperation(operation); }
  getOperation(actor: Actor, key: RequestKey): OperationRow | null { return this.journal.get(actor, key); }
  getOperationById(id: OperationId): OperationRow | null { return this.journal.getById(id); }
  findPhysicalCreate(name: Actor, specHash: string): OperationOf<"agent.create"> | null { return this.reader.physicalCreate(name, specHash); }
  recoverableOperations(): OperationId[] { return this.journal.recoverableIds(); }
  /** CTX-006: a prepared tree or current symlink is not a completed GOAL.
   * This filtered identity projection is followed by the full relational decoder.
   * No new index, table, receipt variant or schema migration is introduced.
   */
  findSucceededContext(candidate: string): OperationOf<"context.publish"> | null {
    if (!isValidFullOid(candidate)) throw new StoreError("STORE_CORRUPT", "invalid completed context candidate");
    let selected: unknown;
    try {
      selected = this.db.prepare(`SELECT id FROM operations WHERE kind='context.publish' AND state='succeeded'
        AND json_extract(plan_json, '$.candidate')=? ORDER BY created_at_ms DESC, id DESC LIMIT 1`).get(candidate);
    } catch (error) {
      throw new StoreError(isBusyError(error) ? "DB_BUSY" : "STORE_CORRUPT", "completed context identity query failed");
    }
    if (selected === undefined) return null;
    const id = fullRow(selected, ["id"], "completed context projection").id;
    if (!isValidOperationId(id)) throw new StoreError("STORE_CORRUPT", "invalid completed context operation identity");
    const operation = this.getOperationById(id);
    if (!operation || operation.kind !== "context.publish" || operation.state !== "succeeded" || operation.plan.candidate !== candidate)
      throw new StoreError("STORE_CORRUPT", "completed context projection differs from its decoded row");
    return operation;
  }
  updateOperationPlanJson(id: OperationId, planJson: string): void { this.journal.prepare(id, planJson); }
  setOperationSucceeded(id: OperationId, resultJson: string): void { this.journal.succeed(id, resultJson); }
  setOperationFailed(id: OperationId, code: ErrorCode): void { this.journal.fail(id, code); }
  setOperationUnknown(id: OperationId): void { this.journal.markUnknown(id); }
  insertDeliveries(deliveries: DeliveryIdentity[]): void { this.transitions.insertDeliveries(deliveries); }
  markMaterialized(message: MessageId, recipient: Actor): void { this.transitions.markMaterialized(message, recipient); }
  markAcknowledged(message: MessageId, recipient: Actor): void { this.transitions.markAcknowledged(message, recipient); }
  pendingDeliveries(agent: Actor): DeliveryRow[] { return this.reader.pendingDeliveries(agent); }
  getDelivery(message: MessageId, recipient: Actor): DeliveryRow | null { return this.reader.delivery(message, recipient); }
  deliveriesForOperation(id: OperationId): DeliveryRow[] { return this.reader.operationDeliveries(id); }
  insertPreparedBatch(batch: PreparedBatchInput): void { this.transitions.insertPreparedBatch(batch); }
  getBatch(id: string): BatchRow | null { return this.reader.batch(id); }
  preparedBatches(agent: Actor): BatchRow[] { return this.reader.preparedBatches(agent); }
  reassignPreparedBatches(agent: Actor, incarnation: number): void { this.transitions.reassignPreparedBatches(agent, incarnation); }
  linkDeliveriesToBatch(batchId: string, messages: MessageId[]): void { this.transitions.linkDeliveriesToBatch(batchId, messages); }
  pendingBatchesFor(agent: Actor, incarnation: number): BatchRow[] { return this.preparedBatches(agent).filter(batch => batch.incarnation === incarnation); }
  completeBatch(batchId: string, messages: MessageId[], agent: Actor, incarnation: number, sessionPath: string): void { this.transitions.completeBatch(batchId, messages, agent, incarnation, sessionPath); }
  reserveUsage(usage: UsageReservation): void { this.transitions.reserveUsage(usage); }
  usageRows(): UsageRow[] { return this.reader.usages(); }
  getUsage(id: string): UsageRow | null { return this.reader.usage(id); }
  settleUsage(id: string, outcome: UsageRow["outcome"], reportedUnits: number | null, detailsJson: string | null): void { this.transitions.settleUsage(id, outcome, reportedUnits, detailsJson); }
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