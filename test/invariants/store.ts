import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { Store } from "@oma/storage";
import type { AgentRow, DeliveryRow, BatchRow, SubscriptionRow } from "@oma/contracts/ledger";
import type { DecodedOperation as OperationRow } from "@oma/protocol/operation-codec";
import { LineageSnapshot } from "@oma/domain/lineage";

export type InvariantPhase = "settled" | "accepted-before-effect" | "partial-materialization" | "unknown-external";
export interface LedgerSnapshot {
  readonly agents: readonly AgentRow[];
  readonly operations: readonly OperationRow[];
  readonly deliveries: readonly DeliveryRow[];
  readonly batches: readonly BatchRow[];
  readonly subscriptions: readonly SubscriptionRow[];
  readonly recoverable: readonly string[];
  readonly raw: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}
function text(row: Record<string, unknown>, key: string): string {
  const value = row[key]; assert.equal(typeof value, "string", `STORE_PROJECTION:${key}`); return value as string;
}
function required<T>(value: T | null, label: string): T { assert.notEqual(value, null, label); return value!; }

/** No Store construction, migration, repair, reconciliation or file publication.
 * Read-only SQL captures identifiers. Each public Store read then exercises the
 * actual validated boundary, including rows not reached by a local scenario.
 * Call at a quiescent checkpoint; file/process checks run after this SQL reader closes.
 */
export function captureLedger(store: Store): LedgerSnapshot {
  assert.equal(store.inTransaction, false, "CHECKER_IO_INSIDE_STORE_TRANSACTION");
  const database = new DatabaseSync(store.path, { readOnly: true });
  const raw: Record<string, readonly Readonly<Record<string, unknown>>[]> = {};
  try {
    database.exec("BEGIN");
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [], "STORE_FOREIGN_KEY");
    const integrity = database.prepare("PRAGMA quick_check").all();
    assert.equal(integrity.length, 1, "STORE_INTEGRITY");
    assert.equal(Object.values(integrity[0]!)[0], "ok", "STORE_INTEGRITY");
    for (const [table, order] of [["agents", "name"], ["operations", "id"], ["deliveries", "message_id,recipient"],
      ["batches", "id"], ["subscriptions", "topic,agent"]] as const) {
      raw[table] = Object.freeze(database.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all().map(row => Object.freeze({ ...row })));
    }
    database.exec("COMMIT");
  } finally { database.close(); }
  const agents = store.listAgents();
  const operations = raw.operations!.map(row => required(store.getOperationById(text(row, "id")), "STORE_OPERATION_MISSING"));
  const deliveries = raw.deliveries!.map(row => required(store.getDelivery(text(row, "message_id"), text(row, "recipient")), "STORE_DELIVERY_MISSING"));
  const batches = raw.batches!.map(row => required(store.getBatch(text(row, "id")), "STORE_BATCH_MISSING"));
  const subscriptions = store.allSubscriptions();
  assert.equal(agents.length, raw.agents!.length, "STORE_AGENT_PROJECTION");
  assert.equal(subscriptions.length, raw.subscriptions!.length, "STORE_SUBSCRIPTION_PROJECTION");
  const lineage = new LineageSnapshot(agents);
  for (const agent of agents) lineage.ancestors(agent.name);
  const recoverable = store.recoverableOperations();
  assert.deepEqual([...recoverable].sort(), operations.filter(operation => operation.state === "pending" || operation.state === "unknown").map(operation => operation.id).sort(), "STORE_RECOVERY_PROJECTION");
  return Object.freeze({ agents: Object.freeze(agents), operations: Object.freeze(operations), deliveries: Object.freeze(deliveries),
    batches: Object.freeze(batches), subscriptions: Object.freeze(subscriptions),
    recoverable: Object.freeze(recoverable), raw: Object.freeze(raw) });
}

export function assertAcceptedHistory(before: LedgerSnapshot, after: LedgerSnapshot): void {
  const current = new Map(after.operations.map(operation => [operation.id, operation]));
  for (const original of before.operations) {
    const operation = required(current.get(original.id) ?? null, `ACCEPTED_OPERATION_DELETED:${original.id}`);
    for (const key of ["id", "actor", "requestKey", "requestHash", "kind", "payloadJson", "planJson", "createdAtMs"] as const)
      assert.equal(operation[key], original[key], `ACCEPTED_FACT_CHANGED:${original.id}:${key}`);
    if (original.state === "succeeded" || original.state === "failed") {
      assert.equal(operation.state, original.state, `TERMINAL_STATE_CHANGED:${original.id}`);
      assert.equal(operation.resultJson, original.resultJson, `TERMINAL_RESULT_BYTES_CHANGED:${original.id}`);
      assert.equal(operation.errorCode, original.errorCode, `TERMINAL_ERROR_CHANGED:${original.id}`);
      assert.equal(operation.updatedAtMs, original.updatedAtMs, `TERMINAL_TIME_CHANGED:${original.id}`);
    } else if (original.state === "unknown") assert.notEqual(operation.state, "pending", `UNKNOWN_DOWNGRADED:${original.id}`);
  }
  const keys = ["message_id", "recipient"];
  const identity = (row: Readonly<Record<string, unknown>>) => JSON.stringify(keys.map(key => row[key]));
  const rows = new Map(after.raw.deliveries!.map(row => [identity(row), row]));
  for (const original of before.raw.deliveries!) {
    const row = required(rows.get(identity(original)) ?? null, "LEDGER_ROW_DELETED:deliveries");
    for (const key of ["message_id", "recipient", "operation_id", "created_at_ms"])
      assert.equal(row[key], original[key], `DELIVERY_IDENTITY_CHANGED:${key}`);
    for (const [flag, time] of [["materialized", "materialized_at_ms"], ["presented", "presented_at_ms"], ["acknowledged", "acknowledged_at_ms"]])
      if (original[flag!] === 1) { assert.equal(row[flag!], 1, `DELIVERY_FACT_REMOVED:${flag}`); assert.equal(row[time!], original[time!], `DELIVERY_FIRST_TIME_CHANGED:${time}`); }
  }
}
