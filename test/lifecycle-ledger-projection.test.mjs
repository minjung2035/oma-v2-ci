import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import { lifecycleLedger } from "#oma-test/app/broker/lifecycle-ledger";
import { makeValidAgent } from "../dist/test/fixtures/spec.js";

function world(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-lifecycle-ledger-")), store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { try { store.close(); } finally { rmSync(root, { recursive: true, force: true }); } });
  store.transaction(tx => tx.insertAgent(makeValidAgent("alice")));
  return { store, ledger: lifecycleLedger(store) };
}
test("DR46 Lifecycle: every captured write refuses escape or borrowing a later root transaction", t => {
  const { store, ledger } = world(t); let saved;
  ledger.transaction(tx => { saved = tx; assert.ok(Object.isFrozen(tx)); });
  assert.ok(Object.isFrozen(ledger));
  for (const name of ["db", "close", "operations", "insertAgent"]) assert.equal(name in ledger, false, name);
  const stale = () => {
    for (const call of [() => saved.acceptOperation({}), () => saved.insertAgent({}),
      () => saved.updateAgent({ name: "alice", desired: "stopped" }), () => saved.insertDeliveries([]),
      () => saved.setOperationSucceeded("missing", "{}"), () => saved.setOperationFailed("missing", "INTERNAL_ERROR"),
      () => saved.setOperationUnknown("missing"), () => saved.markAcknowledged("missing", "alice"),
      () => saved.follow("work", "alice"), () => saved.unfollow("work", "alice")])
      assert.throws(call, { code: "INTERNAL_ERROR" });
  };
  stale(); store.transaction(stale); ledger.transaction(tx => { assert.notEqual(tx, saved); stale(); });
  assert.equal(ledger.getAgent("alice").desired, "enabled");
  assert.deepEqual(store.subscribers("work"), []);
});
test("DR46 Lifecycle: projected T rejects async continuations and observes live incarnation and intent", t => {
  const { store, ledger } = world(t);
  assert.throws(() => ledger.transaction(() => Promise.resolve("late")), { code: "INTERNAL_ERROR" });
  assert.throws(() => ledger.transaction(() => ({ then() {} })), { code: "INTERNAL_ERROR" });
  store.transaction(tx => tx.updateAgent({ name: "alice", incarnation: 2, desired: "stopped" }));
  assert.equal(ledger.getAgent("alice").incarnation, 2);
  assert.equal(ledger.getAgent("alice").desired, "stopped");
  assert.equal(store.inTransaction, false);
});
