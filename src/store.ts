// MUST [DB-001..009]: sole broker writer; synchronous transactions; six entities;
// plan_json closed union; migration via user_version. No Git/systemd/fsync/await
// inside transactions (M-004).
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Actor,
  BatchId,
  ErrorCode,
  MessageId,
  OperationId,
  RequestKey,
} from "../implementation/contracts.js";
import type { OperationPlan } from "../implementation/contracts.js";
import { operationResultCheck } from "./validate.js";
import { operationPlanCheck } from "./durable.js";

export const SCHEMA_PATH = fileURLToPath(
  new URL("../../implementation/schema-v1.sql", import.meta.url),
);

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

export interface SubscriptionRow {
  topic: string;
  agent: Actor;
  createdAtMs: number;
}

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

export class StoreError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export function reused(actor: Actor, key: RequestKey): StoreError {
  return new StoreError(
    "REQUEST_KEY_REUSED",
    `request key ${key} (actor ${actor}) already used with a different payload`,
  );
}
export function isBusyError(e: unknown): boolean {
  return (
    e instanceof Error &&
    /busy|locked/i.test(e.message) &&
    !(e instanceof StoreError)
  );
}

export interface Transaction {
  readonly transactionBrand: unique symbol;
}

const TX: Transaction = {
  transactionBrand: Symbol("tx"),
} as unknown as Transaction;

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
  constructor(
    readonly path: string,
    readonly busyRetries: number = DEFAULT_BUSY_RETRIES,
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    this.db.exec(`PRAGMA busy_timeout = 5000`);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const v = this.userVersion();
    if (v === 1) return;
    if (v !== 0)
      throw new StoreError(
        "STORE_CORRUPT",
        `unexpected schema user_version ${v}`,
      );
    let ddl: string;
    try {
      ddl = readFileSync(SCHEMA_PATH, "utf8");
    } catch (e) {
      throw new StoreError(
        "STORE_CORRUPT",
        `schema file unreadable: ${(e as Error).message}`,
      );
    }
    try {
      this.db.exec(ddl);
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* no open transaction */
      }
      throw new StoreError(
        "STORE_CORRUPT",
        `migration failed: ${(e as Error).message}`,
      );
    }
    if (this.userVersion() !== 1) {
      throw new StoreError(
        "STORE_CORRUPT",
        "migration did not set user_version=1",
      );
    }
  }

  private userVersion(): number {
    const row = this.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    return row.user_version;
  }

  private begin(): void {
    let ok = false;
    for (let i = 0; i < this.busyRetries + 1 && !ok; i++) {
      try {
        this.db.exec("BEGIN IMMEDIATE");
        ok = true;
      } catch (e) {
        if (isBusyError(e)) {
          if (i < this.busyRetries) continue;
          throw new StoreError("DB_BUSY", "BEGIN IMMEDIATE blocked");
        }
        throw new StoreError(
          "STORE_CORRUPT",
          `BEGIN IMMEDIATE failed: ${(e as Error).message}`,
        );
      }
    }
  }

  transaction<T>(fn: (tx: Transaction) => T): T {
    if (this.depth > 0)
      throw new StoreError("INTERNAL_ERROR", "nested store transaction");
    this.begin();
    this.depth = 1;
    try {
      const r = fn(TX);
      this.db.exec("COMMIT");
      this.depth = 0;
      return r;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      this.depth = 0;
      throw e;
    }
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  private requireTx(): void {
    if (this.depth === 0)
      throw new StoreError("INTERNAL_ERROR", "mutation outside transaction");
  }

  insertAgent(a: NewAgent): void {
    this.requireTx();
    this.db
      .prepare(`INSERT INTO agents
      (name, spec_hash, role, desired, incarnation, profile, created_by, spec_json, created_at_ms, updated_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(
        a.name,
        a.specHash,
        a.role,
        a.desired,
        a.incarnation,
        a.profile,
        a.createdBy,
        a.specJson,
        Date.now(),
        Date.now(),
      );
  }

  getAgent(name: string): AgentRow | null {
    const r = this.db
      .prepare("SELECT * FROM agents WHERE name = ?")
      .get(name) as Record<string, unknown> | undefined;
    return r ? rowToAgent(r) : null;
  }

  listAgents(): AgentRow[] {
    return (
      this.db.prepare("SELECT * FROM agents ORDER BY name").all() as Record<
        string,
        unknown
      >[]
    ).map(rowToAgent);
  }

  updateAgent(a: {
    name: string;
    desired?: AgentRow["desired"];
    incarnation?: number;
    specHash?: string;
    specJson?: string;
  }): void {
    this.requireTx();
    const now = Date.now();
    if (a.desired !== undefined) {
      const existing = this.getAgent(a.name);
      if (!existing)
        throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${a.name}`);
      if (!validDesiredTransition(existing.desired, a.desired)) {
        throw new StoreError(
          "INVALID_REQUEST",
          `invalid desired transition ${existing.desired}->${a.desired}`,
        );
      }
      this.db
        .prepare("UPDATE agents SET desired=?, updated_at_ms=? WHERE name=?")
        .run(a.desired, now, a.name);
    }
    if (a.incarnation !== undefined) {
      this.db
        .prepare(
          "UPDATE agents SET incarnation=?, updated_at_ms=? WHERE name=?",
        )
        .run(a.incarnation, now, a.name);
    }
    if (a.specHash !== undefined || a.specJson !== undefined) {
      const cur = this.getAgent(a.name);
      if (!cur) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${a.name}`);
      const specHash = a.specHash ?? cur.specHash;
      const specJson = a.specJson ?? cur.specJson;
      this.db
        .prepare(
          "UPDATE agents SET spec_hash=?, spec_json=?, updated_at_ms=? WHERE name=?",
        )
        .run(specHash, specJson, now, a.name);
    }
  }

  follow(topic: string, agent: string): void {
    this.requireTx();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO subscriptions (topic, agent, created_at_ms) VALUES (?,?,?)",
      )
      .run(topic, agent, Date.now());
  }

  unfollow(topic: string, agent: string): void {
    this.requireTx();
    this.db
      .prepare("DELETE FROM subscriptions WHERE topic=? AND agent=?")
      .run(topic, agent);
  }

  subscribers(topic: string): string[] {
    const rows = this.db
      .prepare("SELECT agent FROM subscriptions WHERE topic=? ORDER BY agent")
      .all(topic) as { agent: string }[];
    return rows.map((r) => r.agent);
  }

  allSubscriptions(): SubscriptionRow[] {
    const rows = this.db
      .prepare("SELECT * FROM subscriptions ORDER BY topic, agent")
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      topic: r.topic as string,
      agent: r.agent as Actor,
      createdAtMs: num(r.created_at_ms),
    }));
  }

  insertOperation(op: {
    id: OperationId;
    actor: Actor;
    requestKey: RequestKey;
    requestHash: string;
    kind: OperationPlan["kind"];
    payloadJson: string;
    planJson: string;
  }): void {
    this.requireTx();
    try {
      this.db
        .prepare(`INSERT INTO operations
        (id, actor, request_key, request_hash, kind, payload_json, plan_json, state, created_at_ms, updated_at_ms)
        VALUES (?,?,?,?,?,?,?, 'pending', ?, ?)`)
        .run(
          op.id,
          op.actor,
          op.requestKey,
          op.requestHash,
          op.kind,
          op.payloadJson,
          op.planJson,
          Date.now(),
          Date.now(),
        );
    } catch (e) {
      if (
        e instanceof Error &&
        /UNIQUE constraint failed: operations.actor, operations.request_key/.test(
          e.message,
        )
      ) {
        throw new StoreError(
          "REQUEST_KEY_REUSED",
          "request key already used by this actor",
        );
      }
      throw e;
    }
  }

  claimKey(
    actor: Actor,
    key: RequestKey,
    requestHash: string,
  ): "retry" | "reused" | "absent" {
    const existing = this.getOperation(actor, key);
    if (!existing) return "absent";
    return existing.requestHash === requestHash ? "retry" : "reused";
  }

  claimOperation(op: {
    id: OperationId;
    actor: Actor;
    requestKey: RequestKey;
    requestHash: string;
    kind: OperationPlan["kind"];
    payloadJson: string;
    planJson: string;
  }): "inserted" | "retry" {
    this.requireTx();
    const pre = this.claimKey(op.actor, op.requestKey, op.requestHash);
    if (pre === "retry") return "retry";
    if (pre === "reused") throw reused(op.actor, op.requestKey);
    try {
      this.insertOperation(op);
      return "inserted";
    } catch (e) {
      if (e instanceof StoreError && e.code === "REQUEST_KEY_REUSED") {
        if (
          this.claimKey(op.actor, op.requestKey, op.requestHash) === "retry"
        ) {
          return "retry";
        }
        throw reused(op.actor, op.requestKey);
      }
      throw e;
    }
  }

  getOperation(actor: Actor, key: RequestKey): OperationRow | null {
    const r = this.db
      .prepare("SELECT * FROM operations WHERE actor=? AND request_key=?")
      .get(actor, key) as Record<string, unknown> | undefined;
    return r ? rowToOperation(r, dirname(this.path)) : null;
  }

  getOperationById(id: OperationId): OperationRow | null {
    const r = this.db.prepare("SELECT * FROM operations WHERE id=?").get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToOperation(r, dirname(this.path)) : null;
  }

  findPhysicalCreate(name: Actor, specHash: string): OperationRow | null {
    const r = this.db.prepare(`SELECT * FROM operations
      WHERE kind='agent.create'
        AND json_extract(plan_json,'$.spec.name')=?
        AND json_extract(plan_json,'$.specHash')=?
        AND json_type(plan_json,'$.existingCreation')='null'
      ORDER BY created_at_ms, id LIMIT 1`).get(name, specHash) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToOperation(r, dirname(this.path)) : null;
  }

  recoverableOperations(): OperationId[] {
    const rows = this.db
      .prepare(
        "SELECT id FROM operations WHERE state IN ('pending','unknown') ORDER BY created_at_ms, id",
      )
      .all() as { id: string }[];
    return rows.map((r) => r.id as OperationId);
  }

  updateOperationPlanJson(id: OperationId, planJson: string): void {
    this.requireTx();
    this.db
      .prepare("UPDATE operations SET plan_json=?, updated_at_ms=? WHERE id=?")
      .run(planJson, Date.now(), id);
  }

  setOperationSucceeded(id: OperationId, resultJson: string): void {
    this.requireTx();
    const updated = this.db
      .prepare(
        "UPDATE operations SET state='succeeded', result_json=?, error_code=NULL, updated_at_ms=? WHERE id=? AND state IN ('pending','unknown')",
      )
      .run(resultJson, Date.now(), id);
    if (Number(updated.changes) !== 0) return;
    const current = this.getOperationById(id);
    if (current?.state === "succeeded" && current.resultJson === resultJson && current.errorCode === null) return;
    throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
  }

  setOperationFailed(id: OperationId, code: ErrorCode): void {
    this.requireTx();
    const updated = this.db
      .prepare(
        "UPDATE operations SET state='failed', result_json=NULL, error_code=?, updated_at_ms=? WHERE id=? AND state IN ('pending','unknown')",
      )
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
    if (current.state !== "pending")
      throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
    this.db
      .prepare(
        "UPDATE operations SET state='unknown', updated_at_ms=? WHERE id=? AND state='pending'",
      )
      .run(Date.now(), id);
  }

  insertDeliveries(
    ds: Array<{
      messageId: MessageId;
      recipient: Actor;
      operationId: OperationId;
    }>,
  ): void {
    this.requireTx();
    const st = this.db.prepare(`INSERT OR IGNORE INTO deliveries
      (message_id, recipient, operation_id, materialized, presented, acknowledged, created_at_ms)
      VALUES (?,?,?,0,0,0,?)`);
    for (const d of ds)
      st.run(d.messageId, d.recipient, d.operationId, Date.now());
  }

  markMaterialized(messageId: MessageId, recipient: Actor): void {
    this.requireTx();
    this.db
      .prepare(
        "UPDATE deliveries SET materialized=1, materialized_at_ms=? WHERE message_id=? AND recipient=?",
      )
      .run(Date.now(), messageId, recipient);
  }

  markAcknowledged(messageId: MessageId, recipient: Actor): void {
    this.requireTx();
    this.db
      .prepare(
        "UPDATE deliveries SET acknowledged=1, acknowledged_at_ms=? WHERE message_id=? AND recipient=?",
      )
      .run(Date.now(), messageId, recipient);
  }

  pendingDeliveries(agent: Actor): DeliveryRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM deliveries
      WHERE recipient=? AND materialized=1 AND presented=0 AND batch_id IS NULL
      ORDER BY created_at_ms, message_id`)
      .all(agent) as Record<string, unknown>[];
    return rows.map(rowToDelivery);
  }

  getDelivery(messageId: MessageId, recipient: Actor): DeliveryRow | null {
    const r = this.db
      .prepare("SELECT * FROM deliveries WHERE message_id=? AND recipient=?")
      .get(messageId, recipient) as Record<string, unknown> | undefined;
    return r ? rowToDelivery(r) : null;
  }

  deliveriesForOperation(operationId: OperationId): DeliveryRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM deliveries WHERE operation_id=? ORDER BY created_at_ms, message_id",
      )
      .all(operationId) as Record<string, unknown>[];
    return rows.map(rowToDelivery);
  }

  insertPreparedBatch(b: {
    id: BatchId;
    agent: Actor;
    incarnation: number;
    messageIds: MessageId[];
    sessionPath: string | null;
  }): void {
    this.requireTx();
    this.db
      .prepare(`INSERT INTO batches (id, agent, incarnation, message_ids_json, session_path, state, created_at_ms, completed_at_ms)
      VALUES (?,?,?,?,?, 'prepared', ?, NULL)`)
      .run(
        b.id,
        b.agent,
        b.incarnation,
        JSON.stringify(b.messageIds),
        b.sessionPath,
        Date.now(),
      );
  }

  getBatch(id: BatchId): BatchRow | null {
    const r = this.db.prepare("SELECT * FROM batches WHERE id=?").get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToBatch(r) : null;
  }

  preparedBatches(agent: Actor): BatchRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM batches WHERE agent=? AND state='prepared' ORDER BY created_at_ms, id",
      )
      .all(agent) as Record<string, unknown>[];
    return rows.map(rowToBatch);
  }
  reassignPreparedBatches(agent: Actor, incarnation: number): void {
    this.requireTx();
    this.db
      .prepare("UPDATE batches SET incarnation=? WHERE agent=? AND state='prepared'")
      .run(incarnation, agent);
  }

  linkDeliveriesToBatch(batchId: BatchId, messageIds: MessageId[]): void {
    this.requireTx();
    const batch = this.getBatch(batchId);
    if (!batch)
      throw new StoreError("BATCH_CONFLICT", `no such batch ${batchId}`);
    if (batch.state === "completed")
      throw new StoreError(
        "BATCH_CONFLICT",
        `completed batch ${batchId} is immutable`,
      );
    let implied: Set<string>;
    try {
      implied = new Set(JSON.parse(batch.messageIdsJson) as string[]);
    } catch {
      throw new StoreError(
        "STORE_CORRUPT",
        `batch ${batchId} has corrupt message list`,
      );
    }
    const have = new Set(messageIds);
    if (implied.size !== have.size || [...implied].some((x) => !have.has(x))) {
      throw new StoreError(
        "BATCH_CONFLICT",
        "batch message ids do not match the linked deliveries",
      );
    }
    for (const id of messageIds) {
      const d = this.getDelivery(id, batch.agent);
      if (!d)
        throw new StoreError(
          "BATCH_CONFLICT",
          `message ${id} has no delivery for ${batch.agent}`,
        );
      if (d.batchId !== null && d.batchId !== batchId) {
        throw new StoreError(
          "BATCH_CONFLICT",
          `message ${id} already in batch ${d.batchId}`,
        );
      }
    }
    const upd = this.db.prepare(
      "UPDATE deliveries SET batch_id=? WHERE message_id=? AND recipient=?",
    );
    for (const id of messageIds) upd.run(batchId, id, batch.agent);
  }

  pendingBatchesFor(agent: Actor, incarnation: number): BatchRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM batches WHERE agent=? AND state='prepared' ORDER BY created_at_ms, id",
      )
      .all(agent) as Record<string, unknown>[];
    return rows.map(rowToBatch).filter((b) => b.incarnation === incarnation);
  }

  completeBatch(
    batchId: BatchId,
    markPresentedIds: MessageId[],
    agent: Actor,
  ): void {
    this.requireTx();
    const batch = this.getBatch(batchId);
    if (!batch)
      throw new StoreError("BATCH_CONFLICT", `no such batch ${batchId}`);
    if (batch.state === "completed") return;
    this.db
      .prepare(
        "UPDATE batches SET state='completed', completed_at_ms=? WHERE id=?",
      )
      .run(Date.now(), batchId);
    const st = this.db.prepare(
      "UPDATE deliveries SET presented=1, presented_at_ms=? WHERE message_id=? AND recipient=?",
    );
    for (const id of markPresentedIds) st.run(Date.now(), id, agent);
  }

  reserveUsage(u: {
    requestId: string;
    actor: Actor;
    incarnation: number;
    profile: string;
    pricingRevision: string;
    reservedUnits: number;
  }): void {
    this.requireTx();
    this.db
      .prepare(`INSERT INTO usage
      (request_id, actor, incarnation, profile, pricing_revision, reserved_units, reported_units, outcome, details_json, created_at_ms, updated_at_ms)
      VALUES (?,?,?,?,?,?,NULL,'reserved',NULL,?,?)`)
      .run(
        u.requestId,
        u.actor,
        u.incarnation,
        u.profile,
        u.pricingRevision,
        u.reservedUnits,
        Date.now(),
        Date.now(),
      );
  }

  usageRows(): UsageRow[] {
    const rows = this.db
      .prepare("SELECT * FROM usage ORDER BY created_at_ms, request_id")
      .all() as Record<string, unknown>[];
    return rows.map(rowToUsage);
  }

  getUsage(requestId: string): UsageRow | null {
    const r = this.db
      .prepare("SELECT * FROM usage WHERE request_id=?")
      .get(requestId) as Record<string, unknown> | undefined;
    return r ? rowToUsage(r) : null;
  }

  settleUsage(
    requestId: string,
    outcome: UsageRow["outcome"],
    reportedUnits: number | null,
    detailsJson: string | null,
  ): void {
    this.requireTx();
    this.db
      .prepare(
        "UPDATE usage SET outcome=?, reported_units=?, details_json=?, updated_at_ms=? WHERE request_id=?",
      )
      .run(outcome, reportedUnits, detailsJson, Date.now(), requestId);
  }
}

function validDesiredTransition(
  from: AgentRow["desired"],
  to: AgentRow["desired"],
): boolean {
  if (from === to) return true;
  switch (from) {
    case "provisioning":
      return to === "enabled" || to === "stopped";
    case "enabled":
      return to === "stopped" || to === "retired";
    case "stopped":
      return to === "enabled" || to === "retired";
    case "retired":
      return false;
    default:
      return false;
  }
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

function rowToAgent(r: Record<string, unknown>): AgentRow {
  return {
    name: r.name as Actor,
    specHash: r.spec_hash as string,
    role: r.role as AgentRow["role"],
    desired: r.desired as AgentRow["desired"],
    incarnation: num(r.incarnation),
    profile: r.profile as string,
    createdBy: r.created_by as string | null,
    specJson: r.spec_json as string,
    createdAtMs: num(r.created_at_ms),
    updatedAtMs: num(r.updated_at_ms),
  };
}

function rowToOperation(r: Record<string, unknown>, stateRoot: string): OperationRow {
  const row: OperationRow = {
    id: r.id as OperationId,
    actor: r.actor as Actor,
    requestKey: r.request_key as RequestKey,
    requestHash: r.request_hash as string,
    kind: r.kind as OperationPlan["kind"],
    payloadJson: r.payload_json as string,
    planJson: r.plan_json as string,
    state: r.state as OperationRow["state"],
    resultJson: r.result_json as string | null,
    errorCode: r.error_code as ErrorCode | null,
    createdAtMs: num(r.created_at_ms),
    updatedAtMs: num(r.updated_at_ms),
  };
  if (!(["pending", "succeeded", "failed", "unknown"] as const).includes(row.state))
    throw new StoreError("STORE_CORRUPT", `operation ${row.id} has invalid state`);

  let plan: unknown;
  try { plan = JSON.parse(row.planJson); }
  catch { throw new StoreError("STORE_CORRUPT", `operation ${row.id} has corrupt plan JSON`); }
  const invalidPlan = operationPlanCheck(row.kind, {
    operationId: row.id,
    actor: row.actor,
    stateRoot,
  })(plan);
  if (invalidPlan)
    throw new StoreError("STORE_CORRUPT", `operation ${row.id} plan: ${invalidPlan}`);

  if (row.state === "succeeded") {
    if (!row.resultJson || row.errorCode !== null)
      throw new StoreError("STORE_CORRUPT", `operation ${row.id} has inconsistent succeeded state`);
    let result: unknown;
    try { result = JSON.parse(row.resultJson); }
    catch { throw new StoreError("STORE_CORRUPT", `operation ${row.id} has corrupt result JSON`); }
    const invalid = operationResultCheck(row.kind)(result);
    if (invalid)
      throw new StoreError("STORE_CORRUPT", `operation ${row.id} result: ${invalid}`);
  } else if (row.state === "failed") {
    if (row.resultJson !== null || row.errorCode === null)
      throw new StoreError("STORE_CORRUPT", `operation ${row.id} has inconsistent failed state`);
  } else if (row.resultJson !== null || row.errorCode !== null) {
    throw new StoreError("STORE_CORRUPT", `operation ${row.id} has terminal data in ${row.state} state`);
  }
  return row;
}

function rowToDelivery(r: Record<string, unknown>): DeliveryRow {
  return {
    messageId: r.message_id as MessageId,
    recipient: r.recipient as Actor,
    operationId: r.operation_id as OperationId,
    materialized: r.materialized as 0 | 1,
    batchId: r.batch_id as BatchId | null,
    presented: r.presented as 0 | 1,
    acknowledged: r.acknowledged as 0 | 1,
    createdAtMs: num(r.created_at_ms),
    materializedAtMs:
      r.materialized_at_ms === null ? null : num(r.materialized_at_ms),
    presentedAtMs: r.presented_at_ms === null ? null : num(r.presented_at_ms),
    acknowledgedAtMs:
      r.acknowledged_at_ms === null ? null : num(r.acknowledged_at_ms),
  };
}

function rowToBatch(r: Record<string, unknown>): BatchRow {
  return {
    id: r.id as BatchId,
    agent: r.agent as Actor,
    incarnation: num(r.incarnation),
    messageIdsJson: r.message_ids_json as string,
    sessionPath: r.session_path as string | null,
    state: r.state as BatchRow["state"],
    createdAtMs: num(r.created_at_ms),
    completedAtMs: r.completed_at_ms === null ? null : num(r.completed_at_ms),
  };
}

function rowToUsage(r: Record<string, unknown>): UsageRow {
  return {
    requestId: r.request_id as string,
    actor: r.actor as Actor,
    incarnation: num(r.incarnation),
    profile: r.profile as string,
    pricingRevision: r.pricing_revision as string,
    reservedUnits: num(r.reserved_units),
    reportedUnits: r.reported_units === null ? null : num(r.reported_units),
    outcome: r.outcome as UsageRow["outcome"],
    detailsJson: r.details_json as string | null,
    createdAtMs: num(r.created_at_ms),
    updatedAtMs: num(r.updated_at_ms),
  };
}
