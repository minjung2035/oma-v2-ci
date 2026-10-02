import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { LedgerReader } from "../src/storage/ledger-reader.js";
import { DIAGNOSTIC_READ_LIMITS } from "../src/storage/diagnostic-snapshot.js";
import { makeValidAgent } from "./fixtures/spec.js";

test("G02-ledger-r2: operational list reads refuse excess before decoding and close the cursor", () => {
  let visited = 0; let closed = false;
  const db = { prepare: () => ({ *iterate() {
    try { for (;;) { visited++; yield { name: "alice" }; } }
    finally { closed = true; }
  } }) } as unknown as Pick<DatabaseSync, "prepare">;
  const reader = new LedgerReader(db, "/unused", () => null);
  assert.throws(() => reader.agentNames(), { code: "LIMIT_EXCEEDED" });
  assert.equal(visited, DIAGNOSTIC_READ_LIMITS.maxRows + 1);
  assert.equal(closed, true);
});

test("G02-ledger-r2: a single-agent lookup bounds its complete ancestor chain without inventing lineage corruption", () => {
  let visited = 0; let length = DIAGNOSTIC_READ_LIMITS.maxRows;
  const db = { prepare: () => ({ get(name: string) {
    visited++;
    const index = Number(name.slice(1));
    const row = makeValidAgent(name, { createdBy: index + 1 < length ? `a${index + 1}` : null });
    return { name: row.name, spec_hash: row.specHash, role: row.role, desired: row.desired,
      incarnation: row.incarnation, profile: row.profile, created_by: row.createdBy,
      spec_json: row.specJson, created_at_ms: 1, updated_at_ms: 1 };
  } }) } as unknown as Pick<DatabaseSync, "prepare">;
  const reader = new LedgerReader(db, "/unused", () => null);
  assert.equal(reader.agent("a0")?.name, "a0");
  assert.equal(visited, length);
  length++; visited = 0;
  assert.throws(() => reader.agent("a0"), { code: "LIMIT_EXCEEDED" });
  assert.equal(visited, DIAGNOSTIC_READ_LIMITS.maxRows + 1);
});

test("G02-ledger-r2: delivery keyset pages close before yielding and exclude later accepts", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE deliveries(message_id TEXT, recipient TEXT, materialized INTEGER, presented INTEGER, batch_id TEXT)");
    const insert = db.prepare("INSERT INTO deliveries VALUES (?, 'alice', 1, 0, NULL)");
    for (let i = 0; i < 300; i++) insert.run(`m-${i}`);
    const reader = new LedgerReader(db, "/unused", () => null);
    // This oracle isolates traversal from row/relationship decoding; actual
    // validated deliveries are exercised by the batch and mail suites.
    Object.defineProperty(reader, "deliveryRow", { value: (raw: { message_id: string }) => ({ messageId: raw.message_id }) });
    const cursor = reader.pendingDeliveryRows("alice");
    assert.equal(cursor.next().value?.messageId, "m-0");
    insert.run("later");
    db.exec("DELETE FROM deliveries WHERE message_id='m-150'");
    const rest = [...cursor].map(row => row.messageId);
    assert.equal(rest.length, 298);
    assert.equal(rest.includes("later"), false);
    assert.equal(rest.includes("m-150"), false);
    assert.equal(rest.at(-1), "m-299");
    assert.equal(new Set(rest).size, rest.length);
    assert.equal([...reader.pendingDeliveryRows("alice")].at(-1)?.messageId, "later");
  } finally { db.close(); }
});

test("G02-ledger-r2: the row and byte budgets are independent, never STORE_CORRUPT or partial success", () => {
  const db = { prepare: () => ({ *iterate() { yield { name: "x".repeat(DIAGNOSTIC_READ_LIMITS.maxBytes) }; } }) } as unknown as Pick<DatabaseSync, "prepare">;
  assert.throws(() => new LedgerReader(db, "/unused", () => null).agentNames(), { code: "LIMIT_EXCEEDED" });
});
