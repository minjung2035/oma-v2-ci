import { serializePlanIntent } from "../dist/test/fixtures/plan.js";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, existsSync, symlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ledgerFixture, routeOperation, routeResult } from "./helpers/ledger-fixture.mjs";
import { readDiagnosticSnapshot } from "@oma/storage";
import { inspectLedger } from "#oma-test/app/diagnostics/ledger";
import { DIAGNOSTIC_READ_LIMITS } from "@oma/storage/diagnostic-snapshot";
import { generateOperationId, generateBatchId } from "@oma/native/identity";
import { messageIdForOperation as generateMessageId } from "@oma/domain/derived";
import { requestHash } from "@oma/domain/request-identity";
const context = root => ({ stateRoot: root, society: "fixture" });
const code = expected => error => error?.code === expected;
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
function fullFixture(t) {
  const fixture = ledgerFixture(t), { store } = fixture;
  const id = generateOperationId(), message = generateMessageId(id, 0), batch = generateBatchId();
  const payload = { to: ["alice"], subject: "fixture", body: "x", kind: "message" };
  const plan = { kind: "mail.send", message: { id: message, objectPath: `mail/objects/${message}.eml`, sha256: "a".repeat(64), bytes: 1, dateMs: Date.now(),
    to: ["alice"], recipients: ["alice"], kind: "message", contextRevision: null, replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] } } };
  store.transaction(tx => {
    tx.operations.insert({ id, actor: "alice", requestKey: "mail", requestHash: requestHash("mail.send", payload), kind: "mail.send", payloadJson: JSON.stringify(payload), planJson: serializePlanIntent(plan) });
    tx.deliveries.insert([{ messageId: message, operationId: id, recipient: "alice" }]);
  });
  store.transaction(tx => { tx.deliveries.materialize(message, "alice"); tx.batches.prepare({ id: batch, agent: "alice", incarnation: 0, messageIds: [message], sessionPath: null }); tx.batches.link(batch, [message]); tx.subscriptions.follow("design", "alice"); });
  return { ...fixture, id, message, batch, raw: () => structuredClone(readDiagnosticSnapshot(fixture.root)) };
}
test("P6 ledger: all six entities are inspected without changing accepted bytes or flags", t => {
  const f = fullFixture(t), before = f.store.getOperationById(f.id), snapshot = f.raw();
  const report = inspectLedger(snapshot, context(f.root)).report;
  assert.equal(report.status, "PASS", JSON.stringify(report));
  assert.deepEqual(report.scanned, { agents: 2, operations: 1, subscriptions: 1, deliveries: 1, batches: 1, attestations: 0 });
  assert.equal(report.pendingOperations, 1);
  assert.deepEqual(f.store.getOperationById(f.id), before);
  assert.equal(f.store.getDelivery(f.message, "alice").presented, 0);
});
test("P6 reader: closed offline database content is unchanged and nonexistent DB is not created", t => {
  const f = fullFixture(t); f.close();
  const db = join(f.root, "runtime.sqlite"), before = hash(db);
  assert.equal(inspectLedger(readDiagnosticSnapshot(f.root), context(f.root)).report.status, "PASS");
  assert.equal(hash(db), before);
  const empty = join(f.root, "empty"); mkdirSync(empty);
  assert.throws(() => readDiagnosticSnapshot(empty));
  assert.equal(existsSync(join(empty, "runtime.sqlite")), false);
});
test("P6 reader: symlink database, linked ancestor and unsupported version are rejected without migration", t => {
  const f = fullFixture(t); f.close();
  const linked = join(f.root, "linked"); mkdirSync(linked);
  symlinkSync(join(f.root, "runtime.sqlite"), join(linked, "runtime.sqlite"));
  assert.throws(() => readDiagnosticSnapshot(linked), code("STORE_CORRUPT"));
  const alias = join(f.root, "alias"); symlinkSync(linked, alias);
  assert.throws(() => readDiagnosticSnapshot(alias), code("STORE_CORRUPT"));
  const db = new DatabaseSync(join(f.root, "runtime.sqlite")); db.exec("PRAGMA user_version=77"); db.close();
  const before = hash(join(f.root, "runtime.sqlite"));
  assert.throws(() => readDiagnosticSnapshot(f.root), code("STORE_CORRUPT"));
  assert.equal(hash(join(f.root, "runtime.sqlite")), before);
});
test("P6 reader: budgets refuse incomplete snapshots rather than returning an empty healthy ledger", t => {
  const f = fullFixture(t);
  assert.throws(() => readDiagnosticSnapshot(f.root, { ...DIAGNOSTIC_READ_LIMITS, maxRows: 1 }), code("LIMIT_EXCEEDED"));
  assert.throws(() => readDiagnosticSnapshot(f.root, { ...DIAGNOSTIC_READ_LIMITS, maxBytes: 1 }), code("LIMIT_EXCEEDED"));
  assert.equal(inspectLedger(f.raw(), context(f.root), { maxRows: 1 }).report.status, "UNKNOWN");
});
test("P6 ledger: each malformed closed row is rejected and payloads are not printed", t => {
  const f = fullFixture(t);
  for (const table of ["agents", "operations", "subscriptions", "deliveries", "batches"]) {
    const raw = f.raw(); raw.tables[table][0].injectedSecret = "do-not-output";
    const report = inspectLedger(raw, context(f.root)).report;
    assert.equal(report.status, "FAIL", table);
    assert.ok(!JSON.stringify(report).includes("do-not-output"));
  }
});
test("P6 ledger: dangling actor, lineage cycle and duplicate identity cannot be hidden by map overwrite", t => {
  const f = fullFixture(t);
  const variants = [raw => { raw.tables.operations[0].actor = "bob"; }, raw => { raw.tables.agents[1].created_by = "alice"; }, raw => { raw.tables.agents.push(raw.tables.agents[1]); }];
  for (const mutate of variants) { const raw = f.raw(); mutate(raw); assert.equal(inspectLedger(raw, context(f.root)).report.status, "FAIL"); }
});
test("P6 ledger: exact delivery/batch membership, ownership and presentation are independent checks", t => {
  const f = fullFixture(t);
  for (const mutate of [raw => { raw.tables.deliveries = []; }, raw => { raw.tables.batches[0].agent = "principal"; }, raw => { raw.tables.batches[0].incarnation = 1; }, raw => { raw.tables.batches[0].state = "completed"; raw.tables.batches[0].completed_at_ms = Date.now(); }]) {
    const raw = f.raw(); mutate(raw); assert.equal(inspectLedger(raw, context(f.root)).report.status, "FAIL");
  }
});
test("P6 ledger: operation hash/result relations remain closed", t => {
  const f = fullFixture(t);
  for (const mutate of [raw => { raw.tables.operations[0].request_hash = "b".repeat(64); }, raw => { raw.tables.operations[0].updated_at_ms = 0; }]) {
    const raw = f.raw(); mutate(raw); assert.equal(inspectLedger(raw, context(f.root)).report.status, "FAIL");
  }
});
test("P6 ledger: historical route state and explicit unknown are not rewritten to current state", t => {
  const f = fullFixture(t), route = routeOperation();
  f.store.transaction(tx => { tx.operations.insert(route); tx.operations.succeed(route.id, routeResult(route)); tx.subscriptions.unfollow("design", "alice"); tx.operations.unknown(f.id); });
  const before = f.raw(), result = inspectLedger(before, context(f.root));
  assert.equal(result.report.status, "PASS", JSON.stringify(result.report));
  assert.equal(result.report.unknownOperations, 1);
  assert.equal(f.store.getOperationById(f.id).state, "unknown");
  assert.deepEqual(f.raw(), before);
});
test("P6 ledger: absent table, failed SQLite checks and truncated issues never become PASS", t => {
  const f = fullFixture(t);
  const missing = f.raw(); delete missing.tables.attestations;
  assert.equal(inspectLedger(missing, context(f.root)).report.status, "FAIL");
  const bad = f.raw(); bad.integrity = ["bad"]; bad.foreignKeys = [{}];
  const report = inspectLedger(bad, context(f.root), { maxIssues: 1 }).report;
  assert.equal(report.status, "FAIL"); assert.equal(report.truncated, true); assert.equal(report.issueCount, 2);
});
