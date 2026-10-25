/** V06A: one receipt observation, and what each production consumer does with
 * it. A Resident runner and the live `batch.complete` endpoint read the same
 * receipt; only a verified receipt completes a batch, only an observed absence
 * lets a runner present the batch again, and an observation that failed is
 * neither -- it is never a reason for a new delivery.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PreparedBatch } from "@oma/contracts";
import { RunnerModule } from "#oma-test/app/runner";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import { isCheckedReceipt, observeDeliveryReceipt, publishDeliveryReceipt, type ReceiptObservation } from "@oma/storage/delivery-receipt";
import { agentRootPathAt, runnerSessionDirPathAt } from "@oma/domain/paths";
import { TEST_PROTOCOL_LIMITS, TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { ENTRY, boundaryOf, completeSession, evidenceOf, preparedFixture, type ReceiptFixture as Fixture } from "./fixtures/delivery-receipt.js";

/** The production runner's consume step with the engine and the broker
 * channel replaced by counters: the decision under test is the runner's own. */
async function runnerConsume(t: TestContext, f: Fixture, wait = false): Promise<{ deliveries: number; completions: Record<string, unknown>[]; error: unknown }> {
  const runner = new RunnerModule({ runRoot: join(f.root, "run"), stateRoot: f.root, society: "demo" }, "alice", TEST_PROTOCOL_LIMITS);
  let deliveries = 0;
  const completions: Record<string, unknown>[] = [];
  // w11/U1: a confined delivery opens the inference relay before the adapter.
  // The relay is engine plumbing like the adapter, not the receipt decision
  // under test, so it is substituted the same way.
  t.mock.method(runner as unknown as Record<string, () => unknown>, "openRelay", async () => ({
    inference: { socketHostPath: join(f.root, "run", "inference.sock"), provider: "pi", model: "current", placeholder: "placeholder" },
    relay: { async close() {} },
  }));
  t.mock.method(runner as unknown as Record<string, () => unknown>, "adapter", () => ({
    deliver: async (batch: PreparedBatch) => {
      deliveries++;
      if (wait) return null;
      return boundaryOf(batch, completeSession(f.root, batch, "redelivered.jsonl"));
    },
  }));
  const channel = Reflect.get(runner, "channel") as {
    connect: (path: string) => Promise<void>; call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  };
  // AV21: completion dials again after a delivery; the replaced channel has nothing to dial.
  t.mock.method(channel, "connect", async () => {});
  t.mock.method(channel, "call", async (method: string, params: Record<string, unknown>) => {
    assert.equal(method, "batch.complete");
    completions.push(params);
    return { ok: true, result: { completed: true } };
  });
  const consume = Reflect.get(runner, "consume") as (batch: PreparedBatch) => Promise<void>;
  try { await consume.call(runner, f.batch); return { deliveries, completions, error: null }; }
  catch (error) { return { deliveries, completions, error }; }
}
function codeOf(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : error;
}
async function liveComplete(f: Fixture, sessionPath: string): Promise<unknown> {
  try { await f.mail.complete(f.auth, evidenceOf(f.root, f.batch, sessionPath)); return null; }
  catch (error) { return codeOf(error); }
}

test("V06A: a verified receipt completes the batch and the runner presents nothing again", async t => {
  const f = await preparedFixture();
  try {
    const session = completeSession(f.root, f.batch);
    publishDeliveryReceipt(f.root, f.batch, boundaryOf(f.batch, session), TEST_VIEW_LIMITS.frameBytes);
    const runner = await runnerConsume(t, f);
    assert.equal(runner.error, null);
    assert.equal(runner.deliveries, 0);
    assert.deepEqual(runner.completions.map(call => call.sessionPath), [session]);
    assert.equal(await liveComplete(f, session), null);
    assert.equal(f.store.getBatch(f.batch.id)?.state, "completed");
    assert.equal(f.presented(), 1);
  } finally { f.close(); }
});

test("DR27: runner wait leaves no receipt or batch completion and preserves delivery and desired intent", async t => {
  const f = await preparedFixture();
  try {
    const before = f.store.getDelivery(f.batch.messageIds[0]!, "alice");
    const agent = f.store.getAgent("alice");
    const result = await runnerConsume(t, f, true);
    assert.equal(result.error, null);
    assert.equal(result.deliveries, 1);
    assert.deepEqual(result.completions, []);
    assert.equal(existsSync(f.receipt), false);
    assert.equal(f.store.getBatch(f.batch.id)?.state, "prepared");
    assert.deepEqual(f.store.getDelivery(f.batch.messageIds[0]!, "alice"), before);
    assert.deepEqual(f.store.getAgent("alice"), agent);
  } finally { f.close(); }
});

for (const where of ["receipt-directory", "receipt"] as const) {
  test(`V06A: an observed absent ${where} lets the runner present once, but completes nothing`, async t => {
    const f = await preparedFixture();
    try {
      if (where === "receipt") mkdirSync(dirname(f.receipt), { recursive: true, mode: 0o700 });
      assert.equal(await liveComplete(f, "/nonexistent/session.jsonl"), "SESSION_BOUNDARY_UNCONFIRMED");
      assert.equal(f.store.getBatch(f.batch.id)?.state, "prepared");
      const runner = await runnerConsume(t, f);
      assert.equal(runner.error, null);
      assert.equal(runner.deliveries, 1);
      assert.equal(runner.completions.length, 1);
    } finally { f.close(); }
  });
}

const unavailable: ReadonlyArray<{ readonly point: string; readonly arrange: (f: Fixture) => void }> = [
  { point: "an unreadable receipt", arrange: f => chmodSync(f.receipt, 0o000) },
  { point: "a vanished runner root the batch was prepared under", arrange: f => rmSync(join(agentRootPathAt(f.root, "alice"), "runner"), { recursive: true }) },
];
for (const item of unavailable) {
  test(`V06A: ${item.point} is unavailable evidence: no completion and no new delivery`, async t => {
    assert.notEqual(process.getuid?.(), 0, "permission-based unavailability needs a non-root test user");
    const f = await preparedFixture();
    try {
      const session = completeSession(f.root, f.batch);
      publishDeliveryReceipt(f.root, f.batch, boundaryOf(f.batch, session), TEST_VIEW_LIMITS.frameBytes);
      const before = readFileSync(f.receipt);
      item.arrange(f);
      const runner = await runnerConsume(t, f);
      assert.equal(runner.deliveries, 0, "an observation that failed is not a reason for a new delivery");
      assert.deepEqual(runner.completions, []);
      assert.equal(codeOf(runner.error), "BROKER_UNAVAILABLE");
      assert.equal(await liveComplete(f, session), "BROKER_UNAVAILABLE");
      assert.equal(f.store.getBatch(f.batch.id)?.state, "prepared");
      if (existsSync(f.receipt)) { chmodSync(f.receipt, 0o600); assert.deepEqual(readFileSync(f.receipt), before); }
    } finally { f.close(); }
  });
}

const conflicting: ReadonlyArray<{ readonly point: string; readonly arrange: (f: Fixture, session: string) => void }> = [
  { point: "a legacy receipt from an earlier incarnation", arrange: (f, session) => {
    mkdirSync(dirname(f.receipt), { recursive: true, mode: 0o700 });
    writeFileSync(f.receipt, `${JSON.stringify({ schemaVersion: 1, adapterRevision: PI_ADAPTER_REVISION, batchId: f.batch.id,
      actor: "alice", incarnation: f.batch.incarnation - 1, messageIds: f.batch.messageIds, sessionPath: session, entryId: ENTRY })}\n`, { mode: 0o600 });
  } },
];
for (const item of conflicting) {
  test(`V06A: ${item.point} is conflicting evidence: preserved, never completed or re-presented`, async t => {
    const f = await preparedFixture(2);
    try {
      const session = completeSession(f.root, f.batch);
      item.arrange(f, session);
      const before = readFileSync(f.receipt);
      const runner = await runnerConsume(t, f);
      assert.equal(runner.deliveries, 0);
      assert.equal(codeOf(runner.error), "BATCH_CONFLICT");
      assert.equal(await liveComplete(f, session), "BATCH_CONFLICT");
      assert.equal(f.store.getBatch(f.batch.id)?.state, "prepared");
      assert.deepEqual(readFileSync(f.receipt), before);
    } finally { f.close(); }
  });
}

const observe = (f: Fixture, batch: PreparedBatch = f.batch): ReceiptObservation =>
  observeDeliveryReceipt(f.root, batch, TEST_VIEW_LIMITS.frameBytes);
function published(f: Fixture): string {
  const session = completeSession(f.root, f.batch);
  publishDeliveryReceipt(f.root, f.batch, boundaryOf(f.batch, session), TEST_VIEW_LIMITS.frameBytes);
  return session;
}
function diagnosticOf(observation: ReceiptObservation) {
  assert.ok(observation.kind === "unavailable" || observation.kind === "conflicting", JSON.stringify(observation));
  // Identity only: the session's text and the batch notice never reach a diagnostic.
  const text = JSON.stringify(observation.diagnostic);
  assert.equal(text.includes("read the mail"), false);
  assert.equal(text.includes("sender="), false);
  return observation.diagnostic;
}

test("V06A: the observer returns verified receipts it issued, and nothing else counts as one", async () => {
  const f = await preparedFixture();
  try {
    const session = published(f);
    const observed = observe(f);
    assert.equal(observed.kind, "verified");
    assert.ok(observed.kind === "verified");
    assert.equal(observed.receipt.sessionPath, session);
    assert.equal(observed.receipt.entryId, ENTRY);
    assert.equal(isCheckedReceipt(observed.receipt), true);
    assert.equal(isCheckedReceipt({ ...observed.receipt }), false, "a structural copy is not a checked receipt");
  } finally { f.close(); }
});

test("V06A: absence names which name is missing, under a runner root that exists", async () => {
  const f = await preparedFixture();
  try {
    assert.deepEqual(observe(f), { kind: "absent", missing: "receipt-directory" });
    mkdirSync(dirname(f.receipt), { recursive: true, mode: 0o700 });
    assert.deepEqual(observe(f), { kind: "absent", missing: "receipt" });
    rmSync(join(agentRootPathAt(f.root, "alice"), "runner"), { recursive: true });
    const root = diagnosticOf(observe(f));
    assert.equal(observe(f).kind, "unavailable");
    assert.equal(root.problem, "runner-root-unavailable");
    assert.equal(root.cause, "ENOENT");
  } finally { f.close(); }
});

test("V06A: an observation that did not complete is unavailable, with its cause and the expected identity", async () => {
  assert.notEqual(process.getuid?.(), 0, "permission-based unavailability needs a non-root test user");
  const f = await preparedFixture();
  try {
    published(f);
    chmodSync(f.receipt, 0o000);
    const receipt = diagnosticOf(observe(f));
    assert.equal(observe(f).kind, "unavailable");
    assert.deepEqual([receipt.problem, receipt.cause], ["receipt-unreadable", "EACCES"]);
    assert.deepEqual(receipt.expected, { actor: "alice", batchId: f.batch.id, incarnation: f.batch.incarnation,
      earliestIncarnation: f.batch.incarnation,
      adapterRevision: PI_ADAPTER_REVISION, messageIds: f.batch.messageIds });
    chmodSync(f.receipt, 0o600);
    // P0V-107: the session the receipt names is not observed again.
    chmodSync(runnerSessionDirPathAt(f.root, "alice"), 0o000);
    assert.equal(observe(f).kind, "verified");
  } finally { chmodSync(runnerSessionDirPathAt(f.root, "alice"), 0o700); f.close(); }
});

test("V06A: conflicting evidence says what differs, and a legacy incarnation is never accepted as current", async () => {
  const f = await preparedFixture(2);
  try {
    const session = completeSession(f.root, f.batch);
    mkdirSync(dirname(f.receipt), { recursive: true, mode: 0o700 });
    const legacy = { schemaVersion: 1, adapterRevision: PI_ADAPTER_REVISION, batchId: f.batch.id, actor: "alice",
      incarnation: 1, messageIds: f.batch.messageIds, sessionPath: session, entryId: ENTRY };
    writeFileSync(f.receipt, `${JSON.stringify(legacy)}\n`, { mode: 0o600 });
    const identity = diagnosticOf(observe(f));
    assert.equal(observe(f).kind, "conflicting");
    assert.equal(identity.problem, "receipt-identity-differs");
    assert.equal(identity.expected.incarnation, 2);
    assert.equal(identity.observed?.incarnation, 1);
    chmodSync(f.receipt, 0o644);
    assert.equal(diagnosticOf(observe(f)).problem, "receipt-not-private-regular");
    unlinkSync(f.receipt);
    writeFileSync(f.receipt, "{not json\n", { mode: 0o600 });
    assert.equal(diagnosticOf(observe(f)).problem, "receipt-not-json");
    unlinkSync(f.receipt);
    publishDeliveryReceipt(f.root, f.batch, boundaryOf(f.batch, session), TEST_VIEW_LIMITS.frameBytes);
    // P0V-107: a session file gone after publication changes nothing.
    unlinkSync(session);
    assert.equal(observe(f).kind, "verified");
  } finally { f.close(); }
});

test("V06A: a receipt directory that cannot be opened is unavailable, never absent", async () => {
  assert.notEqual(process.getuid?.(), 0, "permission-based unavailability needs a non-root test user");
  const f = await preparedFixture();
  try {
    published(f);
    chmodSync(dirname(f.receipt), 0o000);
    const observed = observe(f);
    assert.equal(observed.kind, "unavailable", "an unreadable receipt directory was taken as proof of absence");
    assert.deepEqual([diagnosticOf(observed).problem, diagnosticOf(observed).cause], ["receipt-directory-unavailable", "EACCES"]);
  } finally { chmodSync(dirname(f.receipt), 0o700); f.close(); }
});

test("V06A: live completion binds the current run's incarnation and the receipt's session", async () => {
  const f = await preparedFixture(1);
  try {
    const session = published(f);
    // A current-lease runner presenting evidence from another incarnation.
    const other = { ...evidenceOf(f.root, f.batch, session), incarnation: 2 };
    await assert.rejects(f.mail.complete({ ...f.auth, incarnation: 2 }, other), { code: "BATCH_CONFLICT" });
    await assert.rejects(f.mail.complete(f.auth, other), { code: "BATCH_CONFLICT" });
    // The right incarnation, a session the receipt does not name.
    await assert.rejects(f.mail.complete(f.auth, { ...evidenceOf(f.root, f.batch, session), sessionPath: `${session}.other` }),
      { code: "SESSION_BOUNDARY_UNCONFIRMED" });
    assert.equal(f.store.getBatch(f.batch.id)?.state, "prepared", "a mismatched completion completed the batch");
    assert.equal(await liveComplete(f, session), null);
    assert.equal(f.store.getBatch(f.batch.id)?.state, "completed");
  } finally { f.close(); }
});

const afterPublication: ReadonlyArray<{ readonly point: string; readonly arrange: (f: Fixture, session: string) => void }> = [
  { point: "removed", arrange: (_f, session) => { unlinkSync(session); } },
  { point: "emptied", arrange: (_f, session) => { writeFileSync(session, ""); } },
  { point: "rewritten", arrange: (_f, session) => { writeFileSync(session, "{\"type\":\"custom\",\"id\":\"other\"}\n"); } },
  { point: "behind a directory that cannot be read", arrange: f => { chmodSync(runnerSessionDirPathAt(f.root, "alice"), 0o000); } },
];
for (const item of afterPublication) {
  test(`P0V-107 / F-04, P0-1: once published, a receipt settles its batch though the session it names was then ${item.point}`, async t => {
    const f = await preparedFixture(2);
    try {
      const session = completeSession(f.root, f.batch);
      publishDeliveryReceipt(f.root, f.batch, boundaryOf(f.batch, session), TEST_VIEW_LIMITS.frameBytes);
      const before = readFileSync(f.receipt);
      item.arrange(f, session);
      assert.equal(observe(f).kind, "verified");
      const runner = await runnerConsume(t, f);
      assert.equal(runner.error, null);
      assert.equal(runner.deliveries, 0, "a delivered batch is not presented again");
      assert.deepEqual(runner.completions.map(call => call.sessionPath), [session]);
      assert.deepEqual(readFileSync(f.receipt), before);
    } finally { chmodSync(runnerSessionDirPathAt(f.root, "alice"), 0o700); f.close(); }
  });
}
