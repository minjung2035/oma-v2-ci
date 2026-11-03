/** Actual Store and original Lifecycle policy. Count reuse is diagnostic only;
 * fresh admission and in-T observations must still read original agent rows. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "@oma/storage";
import { LifecyclePolicy } from "@oma/lifecycle/policy";
import type { AuthContext } from "@oma/contracts";
import { lifecycleLedger } from "#oma-test/app/broker/lifecycle-ledger";
import { ALL_CAPS, makeValidAgent, withWorkerCapacity } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";

function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-creation-observation-")), path = join(root, "runtime.sqlite"), store = new Store(path);
  t.after(() => { store.close(); removeTree(root); });
  store.transaction(tx => { for (const name of ["principal", "alice", "bob"]) tx.insertAgent(makeValidAgent(name)); });
  const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor", capabilities: new Set(ALL_CAPS),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
  let scans = 0; const list = store.listAgents.bind(store);
  store.listAgents = () => { scans++; return list(); };
  const resolver = withWorkerCapacity(() => null, 2);
  return { store, path, auth, resolver, ledger: lifecycleLedger(store), scans: () => scans };
}

test("001. Creation observation: unchanged diagnostic counts share a scan, never fresh capacity admission or transaction-local rows", t => {
  const f = fixture(t), policy = new LifecyclePolicy(f.ledger, f.resolver);
  assert.equal(policy.observeCreation(f.auth).workerCount, 2);
  assert.equal(policy.observeCreation(f.auth).workerCount, 2);
  assert.equal(f.scans(), 1, "a status burst cannot re-decode the entire society for each caller");
  assert.throws(() => policy.assertCreationCapacity(), { code: "LIMIT_EXCEEDED" });
  assert.equal(f.scans(), 2, "cached observations cannot grant or deny fresh capacity admission");
  f.store.transaction(tx => tx.updateAgent({ name: "bob", desired: "stopped" }));
  assert.equal(policy.observeCreation(f.auth).workerCount, 1);
  const rollback = new Error("injected rollback"), before = f.scans();
  assert.throws(() => f.store.transaction(tx => {
    tx.updateAgent({ name: "bob", desired: "enabled" });
    assert.equal(policy.observeCreation(f.auth).workerCount, 2, "T sees its own rows, not a cached outside-T count");
    throw rollback;
  }), error => error === rollback);
  assert.equal(policy.observeCreation(f.auth).workerCount, 1, "a rolled-back count cannot escape T");
  assert.ok(f.scans() >= before + 2, "transaction-local and post-rollback observations read original rows");
  assert.doesNotThrow(() => policy.assertCreationCapacity());
});

test("002. Creation observation: an external database edit invalidates the count without becoming another supported writer", t => {
  const f = fixture(t), policy = new LifecyclePolicy(f.ledger, f.resolver);
  assert.equal(policy.observeCreation(f.auth).workerCount, 2);
  // Explicit storage mutation fixture, not an alternate broker or authority port.
  const external = new DatabaseSync(f.path);
  try { external.prepare("UPDATE agents SET desired='stopped' WHERE name='bob'").run(); }
  finally { external.close(); }
  assert.equal(policy.observeCreation(f.auth).workerCount, 1);
  assert.equal(f.scans(), 2);
});

test("003. Creation observation: a changed stamp cannot hide corruption in another Worker's original rows", t => {
  const f = fixture(t), policy = new LifecyclePolicy(f.ledger, f.resolver);
  assert.equal(policy.observeCreation(f.auth).workerCount, 2);
  // Explicit corruption fixture: retain valid hash syntax but break its exact
  // relationship to the original resolved spec. No production repair is inferred.
  const external = new DatabaseSync(f.path);
  try { external.prepare("UPDATE agents SET spec_hash=? WHERE name='bob'").run("f".repeat(64)); }
  finally { external.close(); }
  assert.throws(() => policy.observeCreation(f.auth), { code: "STORE_CORRUPT" });
  assert.throws(() => policy.observeCreation(f.auth), { code: "STORE_CORRUPT" }, "failed validation cannot publish a new cache entry");
});

test("004. Creation observation: stamp failure is unavailable, while unstamped ledgers keep uncached original behavior", t => {
  const f = fixture(t); let unavailable = false;
  const failure = Object.assign(new Error("injected stamp I/O failure"), { code: "EIO" });
  const observedLedger = { ...f.ledger, observationStamp: () => {
    if (unavailable) throw failure;
    return f.store.observationStamp();
  }, get inTransaction() { return f.store.inTransaction; } };
  const policy = new LifecyclePolicy(observedLedger, f.resolver);
  assert.equal(policy.observeCreation(f.auth).workerCount, 2); unavailable = true;
  assert.throws(() => policy.observeCreation(f.auth), error => error === failure, "a cache hit cannot hide failed observation");
  const { observationStamp: _stamp, inTransaction: _transaction, ...unstamped } = f.ledger;
  const fallback = new LifecyclePolicy(unstamped, f.resolver), before = f.scans();
  assert.equal(fallback.observeCreation(f.auth).workerCount, 2);
  assert.equal(fallback.observeCreation(f.auth).workerCount, 2);
  assert.equal(f.scans(), before + 2, "unqualified legacy ports cannot acquire cache semantics");
});
