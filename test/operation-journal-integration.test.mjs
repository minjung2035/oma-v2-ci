/** P3: actual Store/SQLite now routes through the Journal; no effect fake. */
import test from "node:test";
import assert from "node:assert/strict";
import { OperationJournal } from "@oma/storage/operation-journal";
import { reused } from "@oma/domain/request-identity";
import { ledgerFixture, routeOperation, routeResult } from "./helpers/ledger-fixture.mjs";

test("P3 Journal integration: every compatibility transition delegates to its mechanism", t => {
  const names = ["get", "getById", "classifyKey", "recoverableIds", "accept", "insert",
    "prepare", "succeed", "fail", "markUnknown"];
  const seen = new Set();
  const originals = new Map(names.map(name => [name, OperationJournal.prototype[name]]));
  for (const [name, original] of originals) {
    OperationJournal.prototype[name] = function (...args) {
      seen.add(name);
      return Reflect.apply(original, this, args);
    };
  }
  try {
    const { store } = ledgerFixture(t), first = routeOperation(), second = routeOperation();
    store.claimKey(first.actor, first.requestKey, first.requestHash);
    store.transaction(tx => {
      tx.acceptOperation(first);
      tx.updateOperationPlanJson(first.id, first.planJson);
      tx.insertOperation(second);
    });
    store.getOperation(first.actor, first.requestKey);
    store.getOperationById(first.id);
    store.recoverableOperations();
    store.transaction(tx => tx.setOperationUnknown(first.id));
    store.transaction(tx => tx.setOperationSucceeded(first.id, routeResult(first)));
    store.transaction(tx => tx.setOperationFailed(second.id, "CHECK_FAILED"));
    assert.deepEqual([...seen].sort(), names.sort());
    assert.equal(store.getOperationById(first.id).resultJson, routeResult(first));
    assert.equal(store.getOperationById(second.id).state, "failed");
  } finally {
    for (const [name, original] of originals) OperationJournal.prototype[name] = original;
  }
});

test("DR46: request-key error has its domain owner and preserves the actual Store refusal", t => {
  const error = reused("alice", "same-key");
  assert.equal(error.code, "REQUEST_KEY_REUSED");
  assert.equal(error.message, "request key same-key (actor alice) already used with a different payload");
  const { store } = ledgerFixture(t), first = routeOperation();
  store.transaction(tx => tx.acceptOperation(first));
  assert.throws(() => store.transaction(tx => tx.acceptOperation({ ...first, requestHash: "changed" })), {
    code: "REQUEST_KEY_REUSED",
    message: `request key ${first.requestKey} (actor ${first.actor}) already used with a different payload`,
  });
});
