import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { AdmissionGate, bindAdmissionGate } from "@oma/domain/admission";
import { StoreError } from "@oma/domain/errors";
import { gitLedger } from "#oma-test/app/broker/git-ledger";
import { reviewLedger } from "#oma-test/app/broker/review-composition";
import { routeOperation } from "./helpers/ledger-fixture.mjs";
import { makeValidAgent } from "../dist/test/fixtures/spec.js";

const internal = error => error?.code === "INTERNAL_ERROR";
function world(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-feature-ledger-"));
  const store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { try { store.close(); } finally { rmSync(root, { recursive: true, force: true }); } });
  return store;
}
for (const [name, project] of [["Git", gitLedger], ["Review", reviewLedger]]) {
  test(`DR46 ${name}: captured writes cannot escape T or borrow a later T`, t => {
    const store = world(t), ledger = project(store);
    let saved;
    ledger.transaction(tx => { saved = tx; assert.ok(Object.isFrozen(tx)); });
    assert.ok(Object.isFrozen(ledger));
    for (const key of ["db", "insertAgent", "operations", "close"]) assert.equal(key in ledger, false, key);
    const stale = () => {
      assert.throws(() => saved.acceptOperation({}), internal);
      assert.throws(() => saved.insertDeliveries([]), internal);
      assert.throws(() => saved.setOperationSucceeded("missing", "{}"), internal);
      if (name === "Git") {
        assert.throws(() => saved.setOperationFailed("missing", "INTERNAL_ERROR"), internal);
        assert.throws(() => saved.setOperationUnknown("missing"), internal);
      }
    };
    stale(); store.transaction(stale);
    ledger.transaction(tx => { assert.notEqual(tx, saved); stale(); });
    assert.equal(store.inTransaction, false);
  });
  test(`DR46 ${name}: real projection rejects Promises and thenables; readers remain live`, t => {
    const store = world(t), ledger = project(store);
    assert.throws(() => ledger.transaction(() => Promise.resolve("late")), internal);
    assert.throws(() => ledger.transaction(() => ({ then() {} })), internal);
    assert.equal(ledger.getAgent("alice"), null);
    store.transaction(tx => tx.insertAgent(makeValidAgent("alice")));
    store.transaction(tx => tx.updateAgent({ name: "alice", incarnation: 2 }));
    assert.equal(ledger.getAgent("alice").incarnation, 2);
    assert.equal(store.inTransaction, false);
    if (name === "Git") {
      assert.equal(ledger.inTransaction, false);
      store.transaction(() => assert.equal(ledger.inTransaction, true));
      assert.equal(ledger.inTransaction, false);
    }
  });
}
test("DR46 Review: observed corruption fences the original Store through the projection", t => {
  const store = world(t), gate = new AdmissionGate();
  bindAdmissionGate(store, gate);
  const ledger = reviewLedger(store);
  store.transaction(tx => tx.insertAgent(makeValidAgent("alice")));
  ledger.observeFailure(new StoreError("BROKER_UNAVAILABLE", "temporary"));
  assert.equal(gate.state, "healthy");
  ledger.observeFailure(new StoreError("STORE_CORRUPT", "observed durable corruption"));
  assert.equal(gate.state, "corrupt");
  const request = routeOperation();
  assert.throws(() => ledger.transaction(tx => tx.acceptOperation(request)), { code: "STORE_CORRUPT" });
  assert.equal(store.getOperationById(request.id), null);
  assert.equal(ledger.getAgent("alice").name, "alice");
  assert.equal(ledger.getAgent("bob"), null);
});
