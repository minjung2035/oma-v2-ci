import { serializePlanIntent } from "../dist/test/fixtures/plan.js";
/** P4: facets share the same on-disk Store, not alternate connection fakes. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { READ_FACETS, WRITE_FACETS, WRITE_METHODS } from "@oma/storage/facets";
import { AdmissionGate, bindAdmissionGate } from "@oma/domain/admission";
import { generateBatchId, generateOperationId } from "@oma/native/identity";
import { messageIdForOperation as generateMessageId } from "@oma/domain/derived";
import { requestHash } from "@oma/domain/request-identity";
import { ledgerFixture, routeOperation, routeResult, agentRecord } from "./helpers/ledger-fixture.mjs";

const code = expected => error => error?.code === expected;

test("P4 facets: frozen descriptors cover ledger entities and compatibility writes exactly once", () => {
  const groups = ["agents", "batches", "deliveries", "operations", "subscriptions"];
  assert.deepEqual(Object.keys(READ_FACETS).sort(), [...groups, "attestations"].sort());
  assert.deepEqual(Object.keys(WRITE_FACETS).sort(), groups);
  for (const table of [READ_FACETS, WRITE_FACETS]) {
    assert.ok(Object.isFrozen(table));
    for (const group of Object.values(table)) assert.ok(Object.isFrozen(group));
  }
  const mapped = Object.values(WRITE_FACETS).flatMap(group => Object.values(group));
  assert.equal(new Set(mapped).size, mapped.length);
  assert.deepEqual([...WRITE_METHODS].sort(), mapped.sort());
});

test("P4 facets: read views remain live, immutable and contain no write capability", t => {
  const { store } = ledgerFixture(t), operation = routeOperation();
  const read = store.operations;
  assert.equal(read.getById(operation.id), null);
  store.transaction(tx => {
    assert.ok(Object.isFrozen(tx.operations));
    tx.operations.accept(operation);
    tx.subscriptions.follow("design", "alice");
    tx.operations.succeed(operation.id, routeResult(operation));
  });
  assert.equal(read.getById(operation.id).state, "succeeded");
  assert.equal(read.classifyKey("alice", operation.requestKey, operation.requestHash), "retry");
  assert.deepEqual(store.subscriptions.subscribers("design"), ["alice"]);
  assert.equal(store.agents.get("alice").createdBy, "principal");
  for (const [group, members] of Object.entries(READ_FACETS)) {
    assert.ok(Object.isFrozen(store[group]));
    assert.deepEqual(Object.keys(store[group]).sort(), Object.keys(members).sort());
  }
  assert.equal(store.operations.succeed, undefined);
});

test("P4 facets: every escaped write and extracted function refuses a later transaction", t => {
  const { store } = ledgerFixture(t);
  let stale;
  store.transaction(tx => { stale = tx; });
  const calls = Object.keys(WRITE_FACETS).flatMap(group => Object.values(stale[group]));
  for (const fn of calls) assert.throws(() => fn(), code("INTERNAL_ERROR"));
  store.transaction(tx => {
    for (const fn of calls) assert.throws(() => fn(), code("INTERNAL_ERROR"));
    tx.subscriptions.follow("live", "alice");
  });
  assert.deepEqual(store.subscriptions.subscribers("live"), ["alice"]);
});

test("P4 facets: operation, agent, subscription and batch writes roll back together", t => {
  const { store } = ledgerFixture(t), operation = routeOperation(), batch = generateBatchId();
  assert.throws(() => store.transaction(tx => {
    tx.agents.insert(agentRecord("bob", "principal"));
    tx.agents.update({ name: "alice", desired: "stopped" });
    tx.operations.accept(operation);
    tx.subscriptions.follow("design", "alice");
    tx.batches.prepare({ id: batch, agent: "alice", incarnation: 0, messageIds: [generateMessageId(operation.id, 0)], sessionPath: null });
    throw new Error("abort");
  }), /abort/);
  assert.equal(store.agents.get("bob"), null);
  assert.equal(store.agents.get("alice").desired, "enabled");
  assert.equal(store.operations.getById(operation.id), null);
  assert.deepEqual(store.subscriptions.all(), []);
  assert.equal(store.batches.get(batch), null);
});

test("P4 facets: admission blocks new intents but permits explicit existing settlement", t => {
  const { store } = ledgerFixture(t), operation = routeOperation();
  store.transaction(tx => tx.operations.accept(operation));
  const id = generateOperationId(), message = generateMessageId(id, 0);
  const payload = { to: ["alice"], subject: "settle", body: "x", kind: "message" };
  const plan = { kind: "mail.send", message: { id: message, objectPath: `mail/objects/${message}.eml`, sha256: "a".repeat(64), bytes: 1, dateMs: Date.now(),
    to: ["alice"], recipients: ["alice"], kind: "message", contextRevision: null, replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] } } };
  store.transaction(tx => {
    tx.operations.accept({ id, actor: "alice", requestKey: "mail", requestHash: requestHash("mail.send", payload),
      kind: "mail.send", payloadJson: JSON.stringify(payload), planJson: serializePlanIntent(plan) });
    tx.deliveries.insert([{ messageId: message, recipient: "alice", operationId: id }]);
  });
  const gate = new AdmissionGate();
  bindAdmissionGate(store, gate);
  gate.close();
  assert.throws(() => store.transaction(tx => tx.operations.accept(routeOperation())), code("BROKER_UNAVAILABLE"));
  assert.throws(() => store.transaction(tx => tx.batches.prepare({})), code("BROKER_UNAVAILABLE"));
  // Settlement of already-accepted facts is not a new intent: delivery
  // materialization and the explicit unknown transition remain writable
  // under a closed gate, which is exactly what the gate is for.
  store.transaction(tx => tx.deliveries.materialize(message, "alice"));
  assert.equal(store.deliveries.get(message, "alice").materialized, 1);
  store.transaction(tx => tx.operations.unknown(operation.id));
  assert.equal(store.operations.getById(operation.id).state, "unknown");
  // The explicit unknown and the still-pending accepted mail send are both
  // recoverable; gate closure changed neither.
  assert.equal(store.operations.recoverableIds().length, 2);
});

test("P4 facets: escaped asynchronous continuation never borrows fresh root authority", async t => {
  const { store } = ledgerFixture(t), operation = routeOperation();
  let escaped;
  assert.throws(() => store.transaction(tx => {
    tx.operations.accept(operation);
    return Promise.resolve().then(() => {
      store.transaction(() => {
        try { tx.subscriptions.follow("forbidden", "alice"); }
        catch (error) { escaped = error; }
      });
    });
  }), code("INTERNAL_ERROR"));
  await Promise.resolve();
  assert.equal(escaped?.code, "INTERNAL_ERROR");
  assert.equal(store.operations.getById(operation.id), null);
  assert.deepEqual(store.subscriptions.all(), []);
});

test("P4 facets: compile-time method separation and argument types remain enforced", () => {
  const dir = mkdtempSync(join(process.cwd(), "test", ".facets-types-"));
  try {
    const file = join(dir, "fixture.ts");
    writeFileSync(file, "\n      import type { Store } from \"../../packages/storage/dist/store.js\";\n      import type { Transaction } from \"../../packages/storage/dist/transaction.js\";\n      declare const store: Store;\n      declare const tx: Transaction;\n      store.operations.getById(\"op\");\n      tx.operations.unknown(\"op\");\n      // @ts-expect-error reads never expose a transition\n      store.operations.succeed(\"op\", \"{}\");\n      // @ts-expect-error transitions never invent a second read implementation\n      tx.operations.getById(\"op\");\n      // @ts-expect-error preserve concrete batch arguments\n      tx.batches.complete(\"id\", \"made-up-outcome\");\n      // @ts-expect-error facet objects cannot be replaced on a scoped transaction\n      tx.operations = store.operations;\n    ");
    execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit",
      "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext",
      "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--skipLibCheck", file],
      { cwd: process.cwd(), timeout: 40000, stdio: "pipe" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
