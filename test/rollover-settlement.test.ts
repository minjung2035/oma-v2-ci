import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** V07A/V07B (WP07, D01): a Resident's next run settles the previous
 * incarnation's receipts before rollover.
 *
 * Real Store, Mail, receipts and Broker.openRun use an owned native namespace.
 * Server-owner calls exercise settlement policy; authentication has its
 * separate private-channel and actual sender suites.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthContext, ResolvedAgentSpec } from "@oma/contracts";
import { Broker } from "@oma/broker";
import { LifecycleModule } from "@oma/lifecycle";
import { ViewsModule } from "#oma-test/app/views";
import { nativeReceiptBroker, type NativeReceiptBroker } from "./fixtures/native-receipt-broker.js";
import { publishDeliveryReceipt } from "@oma/storage/delivery-receipt";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { REDELIVERY_NOTICE } from "@oma/mail/batches";
import { runnerReceiptPathAt } from "@oma/domain/paths";
import { boundaryOf, completeSession, preparedFixture, type ReceiptFixture } from "./fixtures/delivery-receipt.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

const FIRST = "a".repeat(32);
const SECOND = "b".repeat(32);

async function restartedBroker(f: ReceiptFixture, _invocation: () => string): Promise<Broker> {
  return nativeReceiptBroker(f);
}
const openRun = (broker: Broker, invocation: string) =>
  (broker as NativeReceiptBroker).openReceiptRun(invocation);

function withReceipt(f: ReceiptFixture): Buffer {
  const session = completeSession(f.root, f.batch);
  publishDeliveryReceipt(f.root, f.batch, boundaryOf(f.batch, session), TEST_VIEW_LIMITS.frameBytes);
  return readFileSync(runnerReceiptPathAt(f.root, "alice", f.batch.id));
}
/** The broker's drain closes the Store it was given; the fixture then only removes files. */
async function closeAll(broker: Broker | null, f: ReceiptFixture): Promise<void> {
  if (broker) { await broker.drainAndClose(); (f.store as unknown as { close(): void }).close = () => undefined; }
  f.close();
}
const nextAuth = (incarnation: number): AuthContext => ({ actor: "alice", incarnation, role: "resident", channel: "actor",
  capabilities: new Set(["mail.send"]), peer: { pid: 1, uid: 1, gid: 1 } });

test("V07A: a receipt made durable just before the runner died completes its batch before rollover, with no redelivery", async () => {
  const f = await preparedFixture(1);
  let broker: Broker | null = null;
  try {
    const receipt = withReceipt(f);
    // The ledger was not completed: the process died after the receipt.
    assert.equal(f.store.getBatch(f.batch.id)!.state, "prepared");
    broker = await restartedBroker(f, () => FIRST);
    const lease = await openRun(broker, FIRST);
    assert.equal(lease.incarnation, 2);
    const settled = f.store.getBatch(f.batch.id)!;
    assert.equal(settled.state, "completed");
    assert.equal(settled.incarnation, 1, "the completed batch keeps its historical incarnation");
    assert.deepEqual(f.store.preparedBatches("alice"), [], "nothing was rolled over for the engine to present again");
    assert.deepEqual(readFileSync(runnerReceiptPathAt(f.root, "alice", f.batch.id)), receipt, "the receipt bytes are unchanged");
    // Later work proceeds under the new incarnation.
    await f.mail.send(nextAuth(2), "later", { to: ["alice"], subject: "later", kind: "message", body: "next" });
    const next = await f.mail.prepare(nextAuth(2));
    assert.ok(next && next.id !== f.batch.id && next.incarnation === 2);
  } finally { await closeAll(broker, f); }
});

test("V07A, DR9: a batch whose receipt is proven absent is the next run's delivery attempt, and its row is not rewritten", async () => {
  const f = await preparedFixture(1);
  let broker: Broker | null = null;
  try {
    broker = await restartedBroker(f, () => FIRST);
    assert.equal((await openRun(broker, FIRST)).incarnation, 2);
    const kept = f.store.getBatch(f.batch.id)!;
    assert.equal(kept.state, "prepared");
    assert.equal(kept.incarnation, 1, "the run the batch was created in stays a past fact");
    const again = await f.mail.prepare(nextAuth(2));
    assert.equal(again?.id, f.batch.id);
    assert.equal(again?.incarnation, 2, "presented in the new lease's attempt");
    assert.ok(again?.notice.startsWith(REDELIVERY_NOTICE), "a batch presented again says so (DR6)");
  } finally { await closeAll(broker, f); }
});

test("DR9: a receipt of an earlier attempt that appears after a later run opened still settles the batch, with no redelivery", async () => {
  const f = await preparedFixture(1);
  let broker: Broker | null = null;
  try {
    broker = await restartedBroker(f, () => FIRST);
    assert.equal((await openRun(broker, FIRST)).incarnation, 2, "no receipt yet: the batch passes to run 2");
    const receipt = withReceipt(f); // attempt 1's receipt, published late
    await broker.drainAndClose(); broker = null;
    const store = new Store(join(f.root, "runtime.sqlite"));
    const reopened = Object.assign(Object.create(Object.getPrototypeOf(f)), f, {
      store, mail: createMailModule({ stateRoot: f.root, society: "demo" }, store, 64, TEST_VIEW_LIMITS.batchMaxMessages, TEST_VIEW_LIMITS),
    }) as ReceiptFixture;
    broker = await restartedBroker(reopened, () => SECOND);
    assert.equal((await openRun(broker, SECOND)).incarnation, 3);
    const settled = store.getBatch(f.batch.id)!;
    assert.equal(settled.state, "completed", "attempt 1's receipt is this batch's evidence under any later lease");
    assert.equal(settled.incarnation, 1);
    assert.deepEqual(store.preparedBatches("alice"), [], "nothing is presented again");
    assert.deepEqual(readFileSync(runnerReceiptPathAt(f.root, "alice", f.batch.id)), receipt, "the receipt bytes are unchanged");
  } finally { await closeAll(broker, f); }
});

test("V07B: unavailable or conflicting receipt evidence opens no run, keeps the evidence and changes no incarnation", async () => {
  for (const fault of ["conflicting", "unavailable"] as const) {
    const f = await preparedFixture(1);
    let broker: Broker | null = null;
    try {
      const path = runnerReceiptPathAt(f.root, "alice", f.batch.id);
      withReceipt(f);
      if (fault === "conflicting") {
        chmodSync(path, 0o600);
        const legacy = JSON.parse(readFileSync(path, "utf8"));
        legacy.messageIds = [...legacy.messageIds].reverse().concat(["m-00000000-0000-4000-8000-000000000000-0"]);
        writeFileSync(path, JSON.stringify(legacy));
      } else chmodSync(path, 0o000);
      const before = fault === "conflicting" ? readFileSync(path) : null;
      let invocation = FIRST;
      broker = await restartedBroker(f, () => invocation);
      await assert.rejects(() => openRun(broker!, FIRST), { code: fault === "conflicting" ? "BATCH_CONFLICT" : "BROKER_UNAVAILABLE" });
      assert.equal(f.store.getAgent("alice")!.incarnation, 1);
      const row = f.store.getBatch(f.batch.id)!;
      assert.deepEqual([row.state, row.incarnation], ["prepared", 1], "blocked evidence was neither settled nor rolled over");
      if (before) assert.deepEqual(readFileSync(path), before, "the mismatched receipt is kept for diagnosis");
      // The same invocation cannot retry into a half-open run: it must end
      // and a new invocation opens once the evidence can be read.
      await assert.rejects(() => openRun(broker!, FIRST), { code: "STALE_RUN" });
      if (fault === "unavailable") {
        chmodSync(path, 0o400);
        invocation = SECOND;
        await assert.rejects(() => openRun(broker!, SECOND), { code: "RUN_TERMINATION_UNKNOWN" },
          "the failed opening's own namespace is still populated and blocks a replacement");
      }
    } finally { chmodSync(runnerReceiptPathAt(f.root, "alice", f.batch.id), 0o600); await closeAll(broker, f); }
  }
});

test("V07B: a failure at the incarnation commit leaves the settled batch settled and no live lease", async () => {
  const f = await preparedFixture(1);
  let broker: Broker | null = null;
  try {
    withReceipt(f);
    broker = await restartedBroker(f, () => FIRST);
    // Fail the rollover transaction after settlement committed.
    const store = f.store as unknown as { transaction: (fn: (tx: unknown) => unknown) => unknown };
    const original = store.transaction.bind(f.store);
    let calls = 0;
    store.transaction = fn => { calls += 1; if (calls === 2) throw Object.assign(new Error("injected"), { code: "DB_BUSY" }); return original(fn); };
    await assert.rejects(() => openRun(broker!, FIRST), /injected/);
    store.transaction = original;
    assert.equal(f.store.getBatch(f.batch.id)!.state, "completed", "the settlement stands on its own");
    assert.equal(f.store.getAgent("alice")!.incarnation, 1, "no incarnation was published");
    assert.equal((Reflect.get(broker, "runLeases") as { get(a: string): { lease: unknown } | undefined }).get("alice")!.lease, null,
      "no live lease exists after a failed opening");
  } finally { await closeAll(broker, f); }
});
