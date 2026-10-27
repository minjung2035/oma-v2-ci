import { serializePlanIntent } from "./fixtures/plan.js";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { requestHash } from "@oma/domain/request-identity";
import { makeValidAgent } from "./fixtures/spec.js";
import { makeValidMessagePlan } from "./fixtures/valid.js";
import { AdmissionGate, bindAdmissionGate } from "@oma/domain/admission";

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
      kind: "mail.send", payloadJson: JSON.stringify(input), planJson: serializePlanIntent({ kind: "mail.send", message }) });
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
  // NTP, a suspend on a drifting clock or an operator: the host's wall clock
  // is now an hour earlier than when these rows were created.
  t.mock.timers.setTime(at - 3_600_000);
  batch(store);
  store.transaction(tx => tx.completeBatch(BATCH, [MESSAGE], "alice", 1, "/session/alice"));
  store.transaction(tx => tx.markAcknowledged(MESSAGE, "alice"));
  const incarnation = store.getAgent("alice")!.incarnation;
  store.transaction(tx => tx.updateAgent({ name: "alice", incarnation: incarnation + 1 }));
  store.transaction(() => store.setOperationUnknown(OP));
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
});

test("P0V-56 / R01, P0-5: a clock that steps back after materialization does not make the batch's completion corrupt", t => {
  const created = Date.UTC(2026, 8, 27, 9);
  t.mock.timers.enable({ apis: ["Date"], now: created });
  const store = fixture(t);
  // Materialized and prepared an hour after creation...
  t.mock.timers.setTime(created + 3_600_000);
  batch(store);
  const materialized = store.getDelivery(MESSAGE, "alice")!.materializedAtMs!;
  // ...and completed after the clock went back to half an hour after creation.
  t.mock.timers.setTime(created + 1_800_000);
  store.transaction(tx => tx.completeBatch(BATCH, [MESSAGE], "alice", 1, "/session/alice"));
  const delivery = store.getDelivery(MESSAGE, "alice")!;
  assert.equal(delivery.presented, 1);
  assert.ok(delivery.presentedAtMs! >= materialized, "presentation is not before the materialization it follows");
  assert.equal(store.getBatch(BATCH)?.state, "completed");
});

test("P0V-56 / R01: an agent and an operation are created with one reading of the clock", t => {
  // Two readings would put the update before the creation if the clock
  // stepped back between them, and the row would then read as corrupt.
  // Here every reading is earlier than the one before it.
  let clock = Date.UTC(2026, 8, 27, 9);
  t.mock.method(Date, "now", () => (clock -= 1_000));
  const store = fixture(t);
  const agent = store.getAgent("alice")!;
  assert.equal(agent.updatedAtMs, agent.createdAtMs);
  const operation = store.getOperationById(OP)!;
  assert.equal(operation.updatedAtMs, operation.createdAtMs);
});

test("P0V-56 / R01, F1: every order of the wall clock across a delivery's stages is a valid history", t => {
  // Creation, materialization with the batch, completion and acknowledgement
  // each at one of three wall-clock times, in every combination (3^4): no
  // legal transition is read back as corruption, the fence stays open, and a
  // repeated completion keeps the first facts.
  const times = [1_000_000, 2_000_000, 3_000_000];
  for (const created of times) for (const prepared of times) for (const completed of times) for (const acknowledged of times) {
    const at = `created ${created}, prepared ${prepared}, completed ${completed}, acknowledged ${acknowledged}`;
    t.mock.timers.enable({ apis: ["Date"], now: created });
    const root = mkdtempSync(join(tmpdir(), "oma-clock-orders-"));
    const store = new Store(join(root, "runtime.sqlite"));
    const gate = new AdmissionGate(); bindAdmissionGate(store, gate);
    try {
      const input = { to: ["alice"], subject: "fixture", kind: "message", body: "fixture\n" };
      store.transaction(tx => {
        tx.insertAgent(makeValidAgent("alice"));
        tx.acceptOperation({ id: OP, actor: "alice", requestKey: "orders", requestHash: requestHash("mail.send", input),
          kind: "mail.send", payloadJson: JSON.stringify(input), planJson: serializePlanIntent({ kind: "mail.send", message: makeValidMessagePlan(OP) }) });
        tx.insertDeliveries([{ messageId: MESSAGE, recipient: "alice", operationId: OP }]);
      });
      t.mock.timers.setTime(prepared); batch(store);
      t.mock.timers.setTime(completed);
      store.transaction(tx => tx.completeBatch(BATCH, [MESSAGE], "alice", 1, "/session/alice"));
      const first = store.getDelivery(MESSAGE, "alice")!;
      t.mock.timers.setTime(acknowledged);
      store.transaction(tx => tx.markAcknowledged(MESSAGE, "alice"));
      store.transaction(tx => tx.completeBatch(BATCH, [MESSAGE], "alice", 1, "/session/alice"));
      const delivery = store.getDelivery(MESSAGE, "alice")!;
      assert.equal(delivery.presentedAtMs, first.presentedAtMs, `${at}: a repeated completion moved the first presentation`);
      assert.ok(delivery.presentedAtMs! >= delivery.materializedAtMs!, at);
      assert.ok(delivery.acknowledgedAtMs! >= delivery.createdAtMs, at);
      assert.equal(store.getBatch(BATCH)?.state, "completed", at);
      assert.equal(gate.state, "healthy", `${at}: a legal history closed the fence`);
    } finally { t.mock.timers.reset(); store.close(); rmSync(root, { recursive: true, force: true }); }
  }
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
