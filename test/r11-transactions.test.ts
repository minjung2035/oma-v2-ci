import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, type Transaction, type StoreReads } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { makeValidAgent } from "./fixtures/spec.js";
import { makeValidOperation } from "./fixtures/valid.js";

const OP = "op-00000000-0000-4000-8000-000000000011";
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-tx-capability-"));
  const store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  store.transaction(tx => tx.insertAgent(makeValidAgent()));
  return { root, store };
}
const rejected = (error: unknown) => error instanceof StoreError && ["INTERNAL_ERROR", "STORE_CORRUPT"].includes(error.code);

// Compiled by the normal test tsconfig, never called. No casts erase this boundary.
function staticRejections(store: Store, reads: StoreReads): void {
  // @ts-expect-error asynchronous callbacks cannot create a synchronous transaction
  store.transaction(async () => 1);
  // @ts-expect-error a returned Promise is forbidden even without an async keyword
  store.transaction(() => Promise.resolve(1));
  // @ts-expect-error read-only consumers have no mutation authority
  reads.insertAgent(makeValidAgent("bob"));
  // @ts-expect-error a caller cannot fabricate the private transaction brand
  const forged: Transaction = {};
  void forged;
}
void staticRejections;

test("R11: root transactions issue distinct capabilities and reject escaped and foreign scope use", t => {
  const { root, store } = fixture(t);
  let escaped: Transaction | undefined;
  store.transaction(tx => { escaped = tx; tx.insertAgent(makeValidAgent("bob")); });
  assert.ok(escaped);
  assert.throws(() => escaped!.insertAgent(makeValidAgent("stale")), rejected);
  assert.throws(() => store.insertAgent(makeValidAgent("outside")), rejected);
  store.transaction(tx => {
    assert.notEqual(tx, escaped);
    assert.throws(() => escaped!.insertAgent(makeValidAgent("borrowed")), rejected);
  });
  const other = new Store(join(root, "other.sqlite"));
  try {
    store.transaction(tx => {
      assert.throws(() => other.transaction(() => tx.insertAgent(makeValidAgent("foreign"))), rejected);
      assert.throws(() => other.insertAgent(makeValidAgent("wrong-store")), rejected);
    });
  } finally { other.close(); }
  assert.equal(store.getAgent("bob")?.name, "bob");
  for (const name of ["stale", "outside", "borrowed", "foreign", "wrong-store"]) assert.equal(store.getAgent(name), null);
});

test("R11: nested transactions remain rejected and roll back their outer writes", t => {
  const { store } = fixture(t);
  assert.throws(() => store.transaction(tx => {
    tx.insertAgent(makeValidAgent("nested"));
    store.transaction(() => undefined);
  }), rejected);
  assert.equal(store.getAgent("nested"), null);
  assert.equal(store.inTransaction, false);
});

test("R11: runtime thenable guard rolls back untyped callers without executing arbitrary then", t => {
  const { store } = fixture(t); let called = false;
  assert.throws(() => Reflect.apply(store.transaction, store, [() => {
    store.insertAgent(makeValidAgent("thenable"));
    return { then() { called = true; } };
  }]), rejected);
  assert.equal(called, false);
  assert.equal(store.getAgent("thenable"), null);
});

test("R11: an already-started asynchronous continuation cannot reuse the expired capability", async t => {
  const { store } = fixture(t);
  let resume!: () => void;
  const pause = new Promise<void>(resolve => { resume = resolve; });
  let continuation: Promise<void> | undefined;
  assert.throws(() => Reflect.apply(store.transaction, store, [(tx: Transaction) => {
    continuation = (async () => {
      await pause;
      assert.throws(() => tx.insertAgent(makeValidAgent("escaped")), rejected);
      assert.throws(() => store.insertAgent(makeValidAgent("ambient-escape")), rejected);
    })();
    return continuation;
  }]), rejected);
  resume(); await continuation;
  assert.equal(store.getAgent("escaped"), null);
  assert.equal(store.getAgent("ambient-escape"), null);
});

test("R11: only the original acceptance transaction may prepare its plan; incomplete acceptance rolls back", t => {
  const { root, store } = fixture(t);
  const operation = makeValidOperation({ stateRoot: root, id: OP });
  store.transaction(tx => {
    assert.equal(tx.acceptOperation(operation), "inserted");
    tx.updateOperationPlanJson(OP, operation.planJson);
  });
  assert.throws(() => store.transaction(tx => tx.updateOperationPlanJson(OP, operation.planJson)), rejected);
  assert.equal(store.getOperationById(OP)?.planJson, operation.planJson);
  const broken = makeValidOperation({ stateRoot: root, id: "op-00000000-0000-4000-8000-000000000012", requestKey: "broken" });
  assert.throws(() => store.transaction(tx => {
    tx.acceptOperation(broken);
    tx.updateOperationPlanJson(broken.id, JSON.stringify({ kind: "route.follow", topic: "different", agent: "alice" }));
  }), rejected);
  assert.equal(store.getOperationById(broken.id), null);
});

test("R11: identical terminal replay preserves original JSON bytes and forbids any plan/state replacement", t => {
  const { root, store } = fixture(t);
  const operation = makeValidOperation({ stateRoot: root, id: OP });
  const bytes = '{ "kind": "route.follow", "topic": "dev", "subscribed": true }';
  store.transaction(tx => { tx.acceptOperation(operation); tx.setOperationSucceeded(OP, bytes); });
  store.transaction(tx => tx.setOperationSucceeded(OP, bytes));
  assert.equal(store.getOperationById(OP)?.resultJson, bytes);
  assert.throws(() => store.transaction(tx => tx.setOperationSucceeded(OP, JSON.stringify(JSON.parse(bytes)))), rejected);
  assert.throws(() => store.transaction(tx => tx.setOperationFailed(OP, "INTERNAL_ERROR")), rejected);
  assert.throws(() => store.transaction(tx => tx.setOperationUnknown(OP)), rejected);
  assert.throws(() => store.transaction(tx => tx.updateOperationPlanJson(OP, operation.planJson)), rejected);
  assert.equal(store.getOperationById(OP)?.resultJson, bytes);
});
