// MUST [DB-001..009]: sole broker writer; synchronous transactions.
// No Git/process/filesystem effects or await inside transactions (M-004).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Actor, MessageId, OperationId, RequestKey } from "@oma/contracts/identity";
import type { ErrorCode } from "@oma/contracts/errors";
import type { RepositoryIdentity, OperationPlanContext } from "@oma/domain/durable";
import type { DecodedOperation, OperationOf } from "@oma/protocol/operation-codec";
import { LedgerReader, type PendingWorkRows } from "./ledger-reader.js";
import { assertDirectory } from "./directory.js";
import { LEDGER_TABLES, DIAGNOSTIC_READ_LIMITS, type DiagnosticReadLimits, type DiagnosticSnapshot, type LedgerTable } from "./diagnostic-snapshot.js";
import { fullRow, safeInteger } from "./rows.js";
import { type AgentRow, type DeliveryRow, type BatchRow, type SubscriptionRow } from "@oma/contracts/ledger";
import { LedgerTransitions, type DeliveryIdentity, type PreparedBatchInput } from "./transitions.js";
import { OperationTransitions } from "./operation-transitions.js";
import { type NewOperation } from "@oma/contracts/ledger";
import { OperationJournal } from "./operation-journal.js";
import { readFacets } from "./facets.js";
import type { NewAgent } from "@oma/contracts/ledger";
import type { StoreQueries, StoreWrites } from "./store-access.js";

import { TransactionScope, assertSynchronousResult, type SyncCallback } from "./transaction.js";
import { isValidSocietyName, isValidFullOid, isValidOperationId } from "@oma/domain/identifiers";
import { SCHEMA_USER_VERSION_READABLE, SCHEMA_USER_VERSION_WRITTEN } from "@oma/protocol/persisted-formats";
import { StoreError, normalizeStorageFailure, unobserved, sqlitePrimaryCode } from "@oma/domain/errors";
import { observeStoreFailure } from "@oma/domain/admission";



export type { Transaction, StoreReads, StoreWrites } from "./transaction.js";

export const SCHEMA_PATH = fileURLToPath(new URL("./schema-v4.sql", import.meta.url));
/** SQLITE_BUSY or SQLITE_LOCKED, read from SQLite's result code rather than
 * from its message (P0V-69). */
export function isBusyError(error: unknown): boolean {
  const primary = sqlitePrimaryCode(error);
  return primary === 5 || primary === 6;
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
    const expectedTables = LEDGER_TABLES;
    const schema = [];
    for (const row of db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','view','trigger')").iterate()) {
      if (schema.length >= expectedTables.length) throw new StoreError("STORE_CORRUPT", "unexpected diagnostic database objects");
      schema.push(row);
    }
    if (schema.length !== expectedTables.length || schema.some(row => row.type !== "table" || typeof row.name !== "string" ||
      !expectedTables.some(table => table === row.name) || typeof row.sql !== "string" || /CREATE\s+VIRTUAL/i.test(row.sql)))
      throw new StoreError("STORE_CORRUPT", "diagnostic database entity set differs from its schema version");
    let rows = 0, bytes = 0;
    const tables: Record<LedgerTable, unknown[]> = { agents: [], operations: [], subscriptions: [], deliveries: [], batches: [], attestations: [] };
    for (const table of expectedTables) {
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
export class Store implements StoreQueries, StoreWrites {
  private readonly readViews = readFacets(this);
  readonly operations = this.readViews.operations;
  readonly attestations = this.readViews.attestations;
  readonly agents = this.readViews.agents;
  readonly subscriptions = this.readViews.subscriptions;
  readonly deliveries = this.readViews.deliveries;
  readonly batches = this.readViews.batches;
  private readonly db: DatabaseSync;
  private readonly reader: LedgerReader;
  private readonly transitions: LedgerTransitions;
  private readonly journal: OperationJournal;
  private readonly transactions = new TransactionScope(this);
  private unavailable: StoreError | null = null;
  private repositoryIdentity: RepositoryIdentity | null;
  /** P0V-126 (G02-ledger-r2-03), P0-2: the one clock every row this store
   * writes is stamped from -- agents, operations, deliveries, subscriptions
   * and batches alike. A reading that goes backwards is clamped where it
   * lands (MAX(?, created_at_ms)); what the time is, is read here only. */
  private readonly now: () => number;
  constructor(readonly path: string, readonly busyRetries: number = DEFAULT_BUSY_RETRIES, identity: RepositoryIdentity | null = null,
    now: () => number = () => Date.now()) {
    this.now = now;
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
      // R6-19: the bound on how long this synchronous connection -- and so the
      // broker's event loop -- waits for another writer's lock (validation,
      // "known limitations"). A watchdog, if one is added, must be longer.
      this.db.exec("PRAGMA busy_timeout = 5000");
      this.migrate();
      const statements = { prepare: (sql: string) => this.prepare(sql) };
      this.reader = new LedgerReader(statements, dirname(path), () => this.repositoryIdentity);
      this.transitions = new LedgerTransitions(statements, this.reader, () => this.requireTx(), this.now);
      this.journal = new OperationJournal(this.reader,
        new OperationTransitions(statements, this.reader, this.transactions, operation => this.planContext(operation), this.now),
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
  private planContext(operation: DecodedOperation): OperationPlanContext {
    return { operationId: operation.id, actor: operation.actor, stateRoot: dirname(this.path), repositoryIdentity: this.repositoryIdentity };
  }
  close(): void {
    // A failed rollback may leave a native transaction to abandon on close.
    // Only a still-running callback prevents its owner from closing the handle.
    if (this.transactions.active) throw new StoreError("INTERNAL_ERROR", "cannot close a live transaction");
    this.db.close();
  }
  private assertAvailable(): void {
    if (this.unavailable !== null) throw this.unavailable;
  }
  private prepare(sql: string) {
    this.assertAvailable();
    return this.db.prepare(sql);
  }
  private migrate(): void {
    const version = this.userVersion();
    // P8 / v0.1.0 pre-release: the only readable version is the one this build
    // writes. Anything else fails closed with no migration attempt and no
    // rewrite of the existing file.
    if (version === SCHEMA_USER_VERSION_WRITTEN) return;
    if (version !== 0) throw new StoreError("STORE_CORRUPT", `unexpected schema user_version ${version}; no migration was attempted`);
    let ddl: string;
    try { ddl = readFileSync(SCHEMA_PATH, "utf8"); }
    catch (error) { throw unobserved(error, "the schema file") ?? new StoreError("STORE_CORRUPT", `schema file unreadable: ${(error as Error).message}`, { cause: error }); }
    try { this.db.exec(ddl); }
    catch (error) {
      let failure: unknown = error;
      if (this.db.isTransaction) {
        try { this.db.exec("ROLLBACK"); }
        catch (rollbackError) { failure = new AggregateError([error, rollbackError], "schema application and rollback failed"); }
      }
      const normalized = normalizeStorageFailure(failure);
      if (normalized instanceof StoreError) throw normalized;
      throw new StoreError("STORE_CORRUPT", `schema application failed: ${(error as Error).message}`, { cause: failure });
    }
    if (this.userVersion() !== SCHEMA_USER_VERSION_WRITTEN)
      throw new StoreError("STORE_CORRUPT", `schema application did not set user_version=${SCHEMA_USER_VERSION_WRITTEN}`);
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
        // P0V-69, P0-5: a failure SQLite does not name as corruption is not
        // taken for it; corruption closes admission for this process.
        throw new StoreError("INTERNAL_ERROR", `BEGIN IMMEDIATE failed: ${(error as Error).message}`, { cause: error });
      }
    }
    throw new StoreError("INTERNAL_ERROR", "invalid transaction retry configuration");
  }
  transaction<T>(fn: SyncCallback<T>): T {
    this.assertAvailable();
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
      let failure: unknown = error;
      try {
        if (this.db.isTransaction) {
          this.db.exec("ROLLBACK");
          if (this.db.isTransaction)
            throw new StoreError("BROKER_UNAVAILABLE", "database rollback left its transaction open");
        }
      } catch (rollbackError) {
        failure = new AggregateError([error, rollbackError], "transaction and rollback failed");
        const rollback = normalizeStorageFailure(rollbackError);
        this.unavailable = new StoreError(rollback instanceof StoreError && rollback.code === "STORE_CORRUPT"
          ? "STORE_CORRUPT" : "BROKER_UNAVAILABLE", "database rollback could not be confirmed; reopen the Store", { cause: failure });
        observeStoreFailure(this, this.unavailable);
      }
      throw normalizeStorageFailure(failure);
    } finally { this.transitions.reset(); }
  }
  get inTransaction(): boolean { return this.transactions.active || (this.db.isOpen && this.db.isTransaction); }
  private requireTx(): void { this.transactions.requireLive(); }
  insertAgent(agent: NewAgent): void {
    this.requireTx();
    // P0V-56: one event, one reading of the clock -- two readings could put
    // the update before the creation it belongs to.
    const now = this.now();
    this.db.prepare(`INSERT INTO agents
      (name, spec_hash, role, desired, incarnation, profile, created_by, spec_json, created_at_ms, updated_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(agent.name, agent.specHash, agent.role, agent.desired, agent.incarnation,
      agent.profile, agent.createdBy, agent.specJson, now, now);
  }
  getAgent(name: string): AgentRow | null { return this.reader.agent(name); }
  listAgents(): AgentRow[] { return this.reader.agents(); }
  /** WP23.03: names only; see LedgerReader.agentNames. */
  agentNames(): string[] { return this.reader.agentNames(); }
  /** P0-1: an agent row holds one past fact and two current ones. The resolved
   * spec is fixed when the agent is created (LIFE-008) and past operations,
   * usage and receipts are read against it, so nothing rewrites it; revoking
   * authority is the host's current policy, not a rewrite of this fact. What
   * moves is the desired state and the run lease, and a lease only moves
   * forward: an incarnation used again would let a new run's facts be read as
   * an earlier run's. */
  updateAgent(agent: { name: string; desired?: AgentRow["desired"]; incarnation?: number }): void {
    this.requireTx(); const now = this.now();
    for (const key of Object.keys(agent))
      if (key !== "name" && key !== "desired" && key !== "incarnation")
        throw new StoreError("INTERNAL_ERROR", `agent update has no spec rewrite or other field: ${key}`);
    const existing = this.getAgent(agent.name);
    if (!existing) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${agent.name}`);
    if (agent.desired !== undefined) {
      if (!validDesiredTransition(existing.desired, agent.desired)) throw new StoreError("INVALID_REQUEST", `invalid desired transition ${existing.desired}->${agent.desired}`);
      this.db.prepare("UPDATE agents SET desired=?, updated_at_ms=MAX(?, created_at_ms) WHERE name=?").run(agent.desired, now, agent.name);
    }
    if (agent.incarnation !== undefined) {
      if (!Number.isSafeInteger(agent.incarnation) || agent.incarnation <= existing.incarnation)
        throw new StoreError("STORE_CORRUPT", `agent ${agent.name} incarnation can only move forward`);
      this.db.prepare("UPDATE agents SET incarnation=?, updated_at_ms=MAX(?, created_at_ms) WHERE name=?").run(agent.incarnation, now, agent.name);
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
  acceptOperation(operation: NewOperation): "inserted" | "retry" { return this.claimOperation(operation); }
  getOperation(actor: Actor, key: RequestKey): DecodedOperation | null { return this.journal.get(actor, key); }
  /** P0V-92 (R6-15): the operation behind a key the ledger has just answered
   * as a retry. No code removes an operation, so a missing one is a ledger
   * that no longer says what it said -- corrupt, and said so, not a `!`. */
  retriedOperation(actor: Actor, key: RequestKey): DecodedOperation {
    const operation = this.getOperation(actor, key);
    if (operation === null) throw new StoreError("STORE_CORRUPT", `request key ${key} was answered as a retry and has no operation`);
    return operation;
  }
  getOperationById(id: OperationId): DecodedOperation | null { return this.journal.getById(id); }
  /** Bounded presentation lookup: ordinary mail needs no full operation decode.
   * Only an integration's validated accepted plan can identify a notice. */
  integrationNoticeRequester(messageId: MessageId): Actor | null {
    this.assertAvailable();
    const id = `op-${messageId.slice(2, 38)}`;
    if (!this.db.prepare("SELECT id FROM operations WHERE id = ? AND kind = 'git.integrate' AND state <> 'failed'").get(id)) return null;
    const operation = this.getOperationById(id);
    return operation?.kind === "git.integrate" && operation.plan.merge?.notice.some(message =>
      message.id === messageId && message.review?.role === "notice") ? operation.actor : null;
  }
  latestSocietyAction() { return this.reader.latestSocietyAction(); }
  societyOpen(): boolean {
    const action = this.latestSocietyAction();
    return action === null || (action.plan.state === "open" && action.state === "succeeded");
  }
  latestAgentAction(agent: Actor, actor?: Actor) { return this.reader.latestAction(agent, actor); }
  submittedOperations() { return this.reader.submissions(); }
  attestationFacts() { return this.reader.attestations(); }
  findPhysicalCreate(name: Actor, specHash: string): OperationOf<"agent.create"> | null { return this.reader.physicalCreate(name, specHash); }
  recoverableOperations(): OperationId[] { return this.journal.recoverableIds(); }
  /** CTX-006: a prepared tree or current symlink is not a completed GOAL.
   * This filtered identity projection is followed by the full relational decoder.
   * No new index, table, receipt variant or schema migration is introduced.
   */
  findSucceededContext(candidate: string): OperationOf<"context.publish"> | null {
    this.assertAvailable();
    if (!isValidFullOid(candidate)) throw new StoreError("STORE_CORRUPT", "invalid completed context candidate");
    let selected: unknown;
    try {
      selected = this.db.prepare(`SELECT id FROM operations WHERE kind='context.publish' AND state='succeeded'
        AND json_extract(plan_json, '$.intent.candidate')=? ORDER BY rowid DESC LIMIT 1`).get(candidate);
    } catch (error) {
      // As every other query: busy is DB_BUSY, and the native storage owner reads the rest.
      if (isBusyError(error)) throw new StoreError("DB_BUSY", "completed context identity query failed");
      throw normalizeStorageFailure(error);
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
  insertDeliveries(deliveries: readonly DeliveryIdentity[]): void { this.transitions.insertDeliveries(deliveries); }
  markMaterialized(message: MessageId, recipient: Actor): boolean { return this.transitions.markMaterialized(message, recipient); }
  markAcknowledged(message: MessageId, recipient: Actor): void { this.transitions.markAcknowledged(message, recipient); }
  pendingDeliveries(agent: Actor): DeliveryRow[] { return this.reader.pendingDeliveries(agent); }
  /** runner.pending's count: the same eligible rows, counted in SQL. */
  pendingDeliveryCount(agent: Actor): number { return this.reader.pendingDeliveryCount(agent); }
  *pendingDeliveryRows(agent: Actor): IterableIterator<DeliveryRow> {
    this.assertAvailable();
    for (const row of this.reader.pendingDeliveryRows(agent)) {
      // The reader may have a validated page buffered across caller work.
      // A later rollback failure revokes that page's connection too.
      this.assertAvailable();
      yield row;
    }
  }
  getDelivery(message: MessageId, recipient: Actor): DeliveryRow | null { return this.reader.delivery(message, recipient); }
  deliveriesForOperation(id: OperationId): DeliveryRow[] { return this.reader.operationDeliveries(id); }
  insertPreparedBatch(batch: PreparedBatchInput): void { this.transitions.insertPreparedBatch(batch); }
  getBatch(id: string): BatchRow | null { return this.reader.batch(id); }
  preparedBatches(agent: Actor): BatchRow[] { return this.reader.preparedBatches(agent); }
  /** WP23.03: display projection only; see LedgerReader.pendingWorkRows. */
  pendingWorkRows(): Promise<PendingWorkRows> { return this.reader.pendingWorkRows(); }
  linkDeliveriesToBatch(batchId: string, messages: MessageId[]): void { this.transitions.linkDeliveriesToBatch(batchId, messages); }
  /** DR9: the prepared batches a run at `incarnation` may present -- every
   * prepared batch created no later than that run, since a run inherits all of
   * them when it opens. */
  pendingBatchesFor(agent: Actor, incarnation: number): BatchRow[] { return this.preparedBatches(agent).filter(batch => batch.incarnation <= incarnation); }
  completeBatch(batchId: string, messages: MessageId[], agent: Actor, attempt: number, sessionPath: string): void { this.transitions.completeBatch(batchId, messages, agent, attempt, sessionPath); }
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
