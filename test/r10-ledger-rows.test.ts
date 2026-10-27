import { serializePlanIntent } from "./fixtures/plan.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { requestHash } from "@oma/domain/request-identity";
import { decodeAgentRow, decodeDeliveryRow, decodeOperationIdProjection, safeInteger } from "@oma/storage/rows";
import { makeValidAgent } from "./fixtures/spec.js";
import { makeValidMessagePlan } from "./fixtures/valid.js";
import { mutateRawRowAfterClose } from "./fixtures/corruption.js";

const OP = "op-00000000-0000-4000-8000-000000000010";
const BATCH = "b-00000000-0000-4000-8000-000000000010";
const MESSAGE = "m-00000000-0000-4000-8000-000000000010-0";
const isCorrupt = (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT";

function seed(path: string): Store {
  const store = new Store(path);
  const payload = { to: ["alice"], subject: "fixture", kind: "message", body: "fixture\n" };
  const message = makeValidMessagePlan(OP);
  store.transaction(() => {
    store.insertAgent(makeValidAgent("alice"));
    store.insertAgent(makeValidAgent("bob"));
    store.insertOperation({ id: OP, actor: "alice", requestKey: "mail-r10", requestHash: requestHash("mail.send", payload), kind: "mail.send",
      payloadJson: JSON.stringify(payload), planJson: serializePlanIntent({ kind: "mail.send", message }) });
    store.insertDeliveries([{ messageId: MESSAGE, recipient: "alice", operationId: OP }]);
    store.markMaterialized(MESSAGE, "alice");
    store.insertPreparedBatch({ id: BATCH, agent: "alice", incarnation: 1, messageIds: [MESSAGE], sessionPath: null });
    store.linkDeliveriesToBatch(BATCH, [MESSAGE]);
    store.follow("dev", "alice");
  });
  assert.equal(store.getAgent("alice")?.name, "alice");
  assert.equal(store.getOperationById(OP)?.state, "pending");
  assert.equal(store.getDelivery(MESSAGE, "alice")?.batchId, BATCH);
  assert.equal(store.getBatch(BATCH)?.state, "prepared");
  assert.deepEqual(store.subscribers("dev"), ["alice"]);
  return store;
}

test("R10: full-row scalars never coerce numeric strings, flags or incomplete projections", () => {
  for (const invalid of ["1", 1.5, Number.MAX_SAFE_INTEGER + 1, -1, NaN, Infinity]) assert.throws(() => safeInteger(invalid, "fixture"), isCorrupt);
  const agent = makeValidAgent();
  const raw = { name: agent.name, spec_hash: agent.specHash, role: agent.role, desired: agent.desired, incarnation: 1,
    profile: agent.profile, created_by: null, spec_json: agent.specJson, created_at_ms: 1, updated_at_ms: 1 };
  assert.equal(decodeAgentRow(raw).name, "alice");
  assert.throws(() => decodeAgentRow({ ...raw, incarnation: "1" }), isCorrupt);
  assert.throws(() => decodeAgentRow({ name: "alice" }), isCorrupt);
  assert.equal(decodeOperationIdProjection({ id: OP }), OP);
  assert.throws(() => decodeOperationIdProjection({ id: OP, extra: 0 }), isCorrupt);
  const delivery = { message_id: MESSAGE, recipient: "alice", operation_id: OP, materialized: 0, batch_id: null,
    presented: 0, acknowledged: 1, created_at_ms: 1, materialized_at_ms: null, presented_at_ms: null, acknowledged_at_ms: 1 };
  assert.equal(decodeDeliveryRow(delivery).acknowledged, 1, "acknowledged does not imply presented");
  assert.throws(() => decodeDeliveryRow({ ...delivery, presented: "0" }), isCorrupt);
});

test("R10: one-field durable corruption fails before validated values escape on get and list", () => {
  const cases: Array<{ table: string; column: string; value: SQLInputValue; where: string; get: (store: Store) => unknown; list: (store: Store) => unknown }> = [
    { table: "agents", column: "spec_hash", value: "f".repeat(64), where: "name='alice'", get: s => s.getAgent("alice"), list: s => s.listAgents() },
    { table: "agents", column: "role", value: "principal", where: "name='alice'", get: s => s.getAgent("alice"), list: s => s.listAgents() },
    { table: "agents", column: "created_by", value: "missing", where: "name='alice'", get: s => s.getAgent("alice"), list: s => s.listAgents() },
    { table: "operations", column: "updated_at_ms", value: 0, where: `id='${OP}'`, get: s => s.getOperationById(OP), list: s => s.getOperation("alice", "mail-r10") },
    { table: "deliveries", column: "materialized", value: 2, where: `message_id='${MESSAGE}'`, get: s => s.getDelivery(MESSAGE, "alice"), list: s => s.deliveriesForOperation(OP) },
    { table: "deliveries", column: "recipient", value: "bob", where: `message_id='${MESSAGE}'`, get: s => s.getDelivery(MESSAGE, "bob"), list: s => s.deliveriesForOperation(OP) },
    { table: "batches", column: "agent", value: "bob", where: `id='${BATCH}'`, get: s => s.getBatch(BATCH), list: s => s.preparedBatches("bob") },
    { table: "batches", column: "message_ids_json", value: JSON.stringify([MESSAGE, MESSAGE]), where: `id='${BATCH}'`, get: s => s.getBatch(BATCH), list: s => s.preparedBatches("alice") },
    { table: "batches", column: "completed_at_ms", value: 0, where: `id='${BATCH}'`, get: s => s.getBatch(BATCH), list: s => s.pendingBatchesFor("alice", 1) },
    { table: "subscriptions", column: "topic", value: "INVALID/TOPIC", where: "agent='alice'", get: s => s.subscribers("INVALID/TOPIC"), list: s => s.allSubscriptions() },
  ];
  for (const item of cases) {
    const root = mkdtempSync(join(tmpdir(), "oma-row-corruption-"));
    const path = join(root, "runtime.sqlite");
    seed(path).close();
    try {
      mutateRawRowAfterClose(path, raw => {
        // Inject the boundary value itself; node:sqlite enables foreign keys by
        // default and an invalid reference is one of the cases under test.
        raw.exec("PRAGMA foreign_keys=OFF");
        raw.exec("PRAGMA ignore_check_constraints=ON");
        const result = raw.prepare(`UPDATE ${item.table} SET ${item.column}=? WHERE ${item.where}`).run(item.value);
        assert.equal(Number(result.changes), 1);
      });
      const store = new Store(path);
      try {
        assert.throws(() => item.get(store), isCorrupt, `${item.table}.${item.column} get`);
        assert.throws(() => item.list(store), isCorrupt, `${item.table}.${item.column} list`);
      } finally { store.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("R10: normal restart and independent acknowledgement preserve exact facts", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-row-restart-"));
  const path = join(root, "runtime.sqlite");
  seed(path).close();
  try {
    const store = new Store(path);
    try {
      store.transaction(() => store.markAcknowledged(MESSAGE, "alice"));
      assert.equal(store.getDelivery(MESSAGE, "alice")?.presented, 0);
      assert.equal(store.getDelivery(MESSAGE, "alice")?.acknowledged, 1);
      store.transaction(() => store.completeBatch(BATCH, [MESSAGE], "alice", 1, "/session/alice"));
      assert.equal(store.getBatch(BATCH)?.state, "completed");
      assert.equal(store.getDelivery(MESSAGE, "alice")?.presented, 1);
    } finally { store.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
