import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Store, StoreError } from "../src/store.js";
import { requestHash } from "../src/hash.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { makeValidMessagePlan, makeValidUsage } from "./fixtures/valid.js";

const OP = "op-00000000-0000-4000-8000-000000000012";
const MESSAGE = "m-00000000-0000-4000-8000-000000000012-0";
const EXTRA = "m-00000000-0000-4000-8000-000000000012-1";
const BATCH = "b-00000000-0000-4000-8000-000000000012";
const matches = (expected: string) => (error: unknown) => error instanceof StoreError && error.code === expected;
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-transitions-"));
  const store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const input = { to: ["alice"], subject: "fixture", kind: "message", body: "fixture\n" };
  const message = makeValidMessagePlan(OP);
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("alice")); tx.insertAgent(makeValidAgent("bob"));
    tx.acceptOperation({ id: OP, actor: "alice", requestKey: "r12-mail", requestHash: requestHash("mail.send", input),
      kind: "mail.send", payloadJson: JSON.stringify(input), planJson: JSON.stringify({ kind: "mail.send", message }) });
    tx.insertDeliveries([{ messageId: MESSAGE, recipient: "alice", operationId: OP }]);
  });
  assert.equal(store.getDelivery(MESSAGE, "alice")?.materialized, 0);
  return store;
}
function batch(store: Store): void {
  store.transaction(tx => {
    tx.markMaterialized(MESSAGE, "alice");
    tx.insertPreparedBatch({ id: BATCH, agent: "alice", incarnation: 1, messageIds: [MESSAGE], sessionPath: null });
    tx.linkDeliveriesToBatch(BATCH, [MESSAGE]);
  });
  assert.equal(store.getBatch(BATCH)?.state, "prepared");
}

test("P0V-30 / N06, P0-5: a wall clock that steps back makes no state change fail and no row read as corrupt", t => {
  const at = Date.UTC(2026, 8, 26, 12);
  t.mock.timers.enable({ apis: ["Date"], now: at });
  const store = fixture(t);
  const usage = makeValidUsage("alice");
  store.transaction(tx => tx.reserveUsage(usage));
  // NTP, a suspend on a drifting clock or an operator: the host's wall clock
  // is now an hour earlier than when these rows were created.
  t.mock.timers.setTime(at - 3_600_000);
  batch(store);
  store.transaction(tx => tx.completeBatch(BATCH, [MESSAGE], "alice", 1, "/session/alice"));
  store.transaction(tx => tx.markAcknowledged(MESSAGE, "alice"));
  const incarnation = store.getAgent("alice")!.incarnation;
  store.transaction(tx => tx.updateAgent({ name: "alice", incarnation: incarnation + 1 }));
  store.transaction(() => store.setOperationUnknown(OP));
  store.transaction(tx => tx.settleUsage(usage.requestId, "unknown", null, null));
  // Every row still reads as what was recorded, with no stage before its creation.
  const delivery = store.getDelivery(MESSAGE, "alice")!;
  for (const stage of [delivery.materializedAtMs, delivery.presentedAtMs, delivery.acknowledgedAtMs])
    assert.ok(stage !== null && stage >= delivery.createdAtMs);
  const recorded = store.getBatch(BATCH)!;
  assert.equal(recorded.state, "completed");
  assert.ok(recorded.completedAtMs! >= recorded.createdAtMs);
  const agent = store.getAgent("alice")!;
  assert.equal(agent.incarnation, incarnation + 1);
  assert.ok(agent.updatedAtMs >= agent.createdAtMs);
  const operation = store.getOperationById(OP)!;
  assert.equal(operation.state, "unknown");
  assert.ok(operation.updatedAtMs >= operation.createdAtMs);
  assert.equal(store.getUsage(usage.requestId)?.outcome, "unknown");
});

test("R12: only the intended identical delivery/subscription conflicts are no-ops", async t => {
  const store = fixture(t);
  store.transaction(tx => tx.follow("dev", "alice"));
  const delivery = store.getDelivery(MESSAGE, "alice");
  const subscriptions = store.allSubscriptions();
  await delay(10);
  store.transaction(tx => {
    tx.insertDeliveries([{ messageId: MESSAGE, recipient: "alice", operationId: OP }]);
    tx.follow("dev", "alice");
  });
  assert.deepEqual(store.getDelivery(MESSAGE, "alice"), delivery);
  assert.deepEqual(store.allSubscriptions(), subscriptions);
  assert.throws(() => store.transaction(tx => tx.insertDeliveries([{ messageId: MESSAGE, recipient: "alice", operationId: "op-00000000-0000-4000-8000-000000000099" }])), matches("STORE_CORRUPT"));
  assert.throws(() => store.transaction(tx => tx.follow("INVALID/TOPIC", "alice")), matches("INVALID_REQUEST"));
  assert.throws(() => store.transaction(tx => tx.follow("dev", "missing")), /FOREIGN KEY/i);
  assert.throws(() => store.transaction(tx => tx.insertDeliveries([{ messageId: MESSAGE, recipient: "missing", operationId: OP }])), /FOREIGN KEY/i);
  assert.deepEqual(store.getDelivery(MESSAGE, "alice"), delivery);
});

test("R12: missing rows are not successful materialization or acknowledgement", t => {
  const store = fixture(t);
  assert.throws(() => store.transaction(tx => tx.markMaterialized(EXTRA, "alice")), matches("STORE_CORRUPT"));
  assert.throws(() => store.transaction(tx => tx.markAcknowledged(EXTRA, "alice")), matches("REQUEST_NOT_FOUND"));
});

test("R12: incomplete batch acceptance rolls back instead of persisting an empty linked set", t => {
  const store = fixture(t);
  assert.throws(() => store.transaction(tx => tx.insertPreparedBatch({ id: BATCH, agent: "alice", incarnation: 1, messageIds: [MESSAGE], sessionPath: null })), matches("STORE_CORRUPT"));
  assert.equal(store.getBatch(BATCH), null);
  assert.equal(store.getDelivery(MESSAGE, "alice")?.batchId, null);
});

test("R12: links and completion reject different owner, incarnation, missing/extra/duplicate manifest", t => {
  const store = fixture(t); batch(store);
  for (const values of [[], [MESSAGE, EXTRA], [MESSAGE, MESSAGE]]) {
    assert.throws(() => store.transaction(tx => tx.linkDeliveriesToBatch(BATCH, values)), matches("BATCH_CONFLICT"));
    assert.throws(() => store.transaction(tx => tx.completeBatch(BATCH, values, "alice", 1, "/session/alice")), matches("BATCH_CONFLICT"));
  }
  assert.throws(() => store.transaction(tx => tx.completeBatch(BATCH, [MESSAGE], "bob", 1, "/session/bob")), matches("BATCH_CONFLICT"));
  assert.throws(() => store.transaction(tx => tx.completeBatch(BATCH, [MESSAGE], "alice", 2, "/session/alice")), matches("BATCH_CONFLICT"));
  assert.throws(() => store.transaction(tx => tx.insertPreparedBatch({ id: BATCH, agent: "bob", incarnation: 1, messageIds: [MESSAGE], sessionPath: null })), matches("BATCH_CONFLICT"));
  store.transaction(tx => tx.linkDeliveriesToBatch(BATCH, [MESSAGE]));
  assert.equal(store.getDelivery(MESSAGE, "alice")?.presented, 0);
});

test("R12, DR9: a later lease is the batch's next attempt, the row keeps its first; completed replay preserves first fact times", async t => {
  const store = fixture(t); batch(store);
  store.transaction(tx => tx.updateAgent({ name: "alice", incarnation: 2 }));
  assert.equal(store.getBatch(BATCH)?.incarnation, 1, "the attempt the batch was created in is a past fact");
  assert.throws(() => store.transaction(tx => tx.updateAgent({ name: "alice", incarnation: 2 })), matches("STORE_CORRUPT"),
    "a lease never goes back or repeats");
  for (const attempt of [0, 3])
    assert.throws(() => store.transaction(tx => tx.completeBatch(BATCH, [MESSAGE], "alice", attempt, "/session/alice")), matches("BATCH_CONFLICT"),
      `attempt ${attempt} is not one of the batch's`);
  // This is the low-level DB contract, not production S-03 completion authority.
  store.transaction(tx => { tx.markAcknowledged(MESSAGE, "alice"); tx.completeBatch(BATCH, [MESSAGE], "alice", 2, "/session/alice"); });
  const beforeBatch = store.getBatch(BATCH); const beforeDelivery = store.getDelivery(MESSAGE, "alice");
  await delay(10);
  store.transaction(tx => {
    tx.markMaterialized(MESSAGE, "alice"); tx.markAcknowledged(MESSAGE, "alice");
    tx.completeBatch(BATCH, [MESSAGE], "alice", 2, "/session/alice");
  });
  assert.deepEqual(store.getBatch(BATCH), beforeBatch);
  assert.deepEqual(store.getDelivery(MESSAGE, "alice"), beforeDelivery);
  assert.equal(beforeDelivery?.presented, 1);
});

test("R12: exact usage replay preserves bytes/times; terminal and unknown evidence cannot be overwritten", async t => {
  const store = fixture(t);
  const reservation = { ...makeValidUsage(), requestId: "usage-completed" };
  store.transaction(tx => {
    tx.reserveUsage(reservation);
    tx.reserveUsage({ ...reservation, requestId: "usage-cancelled" });
    tx.reserveUsage({ ...reservation, requestId: "usage-unknown" });
    tx.settleUsage("usage-completed", "completed", 1, '{ "reportedUnits": 1 }');
    tx.settleUsage("usage-cancelled", "cancelled", 0, null);
    tx.settleUsage("usage-unknown", "unknown", null, null);
  });
  const rows = store.usageRows();
  await delay(10);
  store.transaction(tx => {
    tx.reserveUsage(reservation);
    tx.settleUsage("usage-completed", "completed", 1, '{ "reportedUnits": 1 }');
    tx.settleUsage("usage-cancelled", "cancelled", 0, null);
    tx.settleUsage("usage-unknown", "unknown", null, null);
  });
  assert.deepEqual(store.usageRows(), rows);
  assert.throws(() => store.transaction(tx => tx.reserveUsage({ ...reservation, reservedUnits: 2 })), matches("REQUEST_KEY_REUSED"));
  assert.throws(() => store.transaction(tx => tx.settleUsage("usage-completed", "completed", 1, '{"reportedUnits":1}')), matches("STORE_CORRUPT"));
  assert.throws(() => store.transaction(tx => tx.settleUsage("usage-completed", "unknown", null, null)), matches("STORE_CORRUPT"));
  assert.throws(() => store.transaction(tx => tx.settleUsage("usage-cancelled", "completed", 1, null)), matches("STORE_CORRUPT"));
  assert.throws(() => store.transaction(tx => tx.settleUsage("usage-unknown", "cancelled", 0, null)), matches("STORE_CORRUPT"));
  assert.throws(() => store.transaction(tx => tx.settleUsage("usage-unknown", "completed", 1, null)), matches("STORE_CORRUPT"));
  assert.throws(() => store.transaction(tx => tx.settleUsage("missing", "cancelled", 0, null)), matches("STORE_CORRUPT"));
  assert.deepEqual(store.usageRows(), rows);
});
