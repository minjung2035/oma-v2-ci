// VIEW-001/002: real validated rows are inputs; numeric expectations are independent oracles.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext } from "../implementation/contracts.js";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { ViewsModule, fieldEsce } from "../src/views.js";
import { pendingWork } from "../src/views/pending-work.js";
import { generateBatchId } from "../src/ids.js";
import { ALL_CAPS, makeValidAgent } from "./fixtures/spec.js";
import { mutateRawRowAfterClose } from "./fixtures/corruption.js";

async function fixture(t: TestContext, count: number) {
  const root = mkdtempSync(join(tmpdir(), "oma-r30-"));
  const context = { root, store: new Store(join(root, "runtime.sqlite"), 5, { society: "demo" }) };
  t.after(() => { try { context.store.close(); } finally { rmSync(root, { recursive: true, force: true }); } });
  context.store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); });
  const mail = new MailModule({ stateRoot: root, society: "demo" }, context.store, 64);
  const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
    capabilities: new Set(ALL_CAPS), peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null } };
  for (let index = 0; index < count; index++) {
    const receipt = await mail.send(auth, `r30-${index}`, { to: ["alice"], subject: `message ${index}`, kind: "message", body: `private-body-${index}` });
    assert.equal(receipt.state, "succeeded", "normal setup must reach the intended durable phase");
  }
  return context;
}
function prepare(store: Store, messages: string[]): string {
  const id = generateBatchId();
  store.transaction(tx => {
    tx.insertPreparedBatch({ id, agent: "alice", incarnation: 1, messageIds: messages, sessionPath: null });
    tx.linkDeliveriesToBatch(id, messages);
  });
  return id;
}

test("R30 empty, unbatched, prepared, mixed and acknowledged work all use message units", async t => {
  const f = await fixture(t, 13);
  assert.deepEqual(pendingWork(f.store, "alice"), { pendingDeliveryMessages: 13, preparedBatchCount: 0,
    preparedMessageCount: 0, pendingMessages: 13, hasPendingWork: true });
  const messages = f.store.pendingDeliveries("alice").map(row => row.messageId);
  f.store.transaction(tx => { tx.markAcknowledged(messages[0]!, "alice"); });
  assert.equal(pendingWork(f.store, "alice").pendingMessages, 13, "ACK is not presentation");
  const first = prepare(f.store, messages.slice(0, 10));
  assert.deepEqual(pendingWork(f.store, "alice"), { pendingDeliveryMessages: 3, preparedBatchCount: 1,
    preparedMessageCount: 10, pendingMessages: 13, hasPendingWork: true });
  const views = new ViewsModule(f.store, f.root, "demo", "p");
  const status = views.status("alice", () => ({ activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0 }))[0]!;
  assert.equal(status.pending, 13); assert.equal(status.preparedBatches, 1);
  assert.equal(status.runnerObservedAtMs, null);
  assert.equal(views.unitObservations[0]!.unknownReason, null);
  assert.ok(Number.isSafeInteger(views.unitObservations[0]!.observedAtMs));
  // Low-level ledger characterization only; this does not authorize S-03's public batch.complete.
  // The next batch is prepared only after the first completes, never concurrently.
  f.store.transaction(tx => { tx.completeBatch(first, messages.slice(0, 10), "alice", 1); });
  assert.equal(pendingWork(f.store, "alice").pendingMessages, 3);
  const second = prepare(f.store, messages.slice(10));
  assert.deepEqual(pendingWork(f.store, "alice"), { pendingDeliveryMessages: 0, preparedBatchCount: 1,
    preparedMessageCount: 3, pendingMessages: 3, hasPendingWork: true });
  f.store.transaction(tx => { tx.completeBatch(second, messages.slice(10), "alice", 1); });
  assert.deepEqual(pendingWork(f.store, "alice"), { pendingDeliveryMessages: 0, preparedBatchCount: 0,
    preparedMessageCount: 0, pendingMessages: 0, hasPendingWork: false });
});

test("R30 unavailable and unknown units do not synthesize running or exit zero", async t => {
  const f = await fixture(t, 0);
  const views = new ViewsModule(f.store, f.root, "demo", "p");
  for (const observe of [() => null, () => { throw new Error("private diagnostic must not escape"); },
    () => ({ activeState: "unknown", subState: "unknown", result: "unknown", execMainStatus: -1 })]) {
    const status = views.status("alice", observe)[0]!;
    assert.equal(status.activeState, null); assert.equal(status.execMainStatus, null);
    assert.equal(status.runnerObservedAtMs, null); assert.equal(status.reason, null);
    assert.ok(views.unitObservations[0]!.unknownReason);
    assert.equal(JSON.stringify(views.unitObservations).includes("private diagnostic"), false);
    assert.equal(Object.hasOwn(status, "unitObservedAtMs"), false, "D04 public field addition remains blocked");
  }
});

test("R30 duplicate manifests fail before a Set can hide corrupt linkage", async t => {
  const f = await fixture(t, 2);
  const messages = f.store.pendingDeliveries("alice").map(row => row.messageId);
  const batch = prepare(f.store, messages);
  assert.equal(pendingWork(f.store, "alice").preparedMessageCount, 2);
  const path = f.store.path;
  f.store.close();
  mutateRawRowAfterClose(path, raw => {
    assert.equal(Number(raw.prepare("UPDATE batches SET message_ids_json=? WHERE id=?").run(JSON.stringify([messages[0], messages[0]]), batch).changes), 1);
  });
  f.store = new Store(path, 5, { society: "demo" });
  assert.throws(() => pendingWork(f.store, "alice"), { code: "STORE_CORRUPT" });
});

test("R30 rebuildable world files preserve durable receipts and exclude private mail bodies", async t => {
  const f = await fixture(t, 1);
  const receiptBefore = f.store.getOperation("alice", "r30-0")!.resultJson;
  const views = new ViewsModule(f.store, f.root, "demo", "p");
  views.refreshWorld();
  const paths = ["agents.tsv", "topics.tsv", "START.md"];
  const expected = paths.map(path => readFileSync(join(f.root, "world", path), "utf8"));
  for (const path of paths) rmSync(join(f.root, "world", path));
  views.refreshWorld();
  assert.deepEqual(paths.map(path => readFileSync(join(f.root, "world", path), "utf8")), expected);
  assert.equal(expected.join("\n").includes("private-body-0"), false);
  assert.equal(f.store.getOperation("alice", "r30-0")!.resultJson, receiptBefore);
  assert.equal(fieldEsce("동료\tmetadata\nline\r"), "동료\\tmetadata\\nline");
});
