import type { PeerAuthenticator } from "@oma/broker/peer-authenticator";
import { testBroker } from "./helpers/broker-fixture.js";
import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** Reads, accepted replay, fresh work and safety actions remain available
 * with a large existing tree. Store integrity and current authority still apply. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, MailInput, ExecutionObservation } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { Broker } from "@oma/broker";
import { PolicyExecution } from "./fixtures/execution.js";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { ReconcileModule } from "@oma/reconcile";
import { StoreError, publicFailure } from "@oma/domain/errors";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { padTree } from "./fixtures/storage-pad.js";
import { sendWithStop } from "./fixtures/mail-faults.js";
import { gitFixture, seedGit, submitFixture } from "./fixtures/git-crash.js";
import { goalPublishedAt } from "./fixtures/goal.js";

const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
const idle: ExecutionObservation = { activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, scope: "", invocationId: "1".repeat(32) };
const running: ExecutionObservation = { activeState: "active", subState: "running", result: "success", execMainStatus: 0, scope: "fixture-scope", invocationId: "2".repeat(32) };

/** Unit control is scripted: this suite is about which effects are admitted, not systemd. */
class ScriptedUnits extends PolicyExecution {
  starts: string[] = []; stops: string[] = []; state = new Map<string, ExecutionObservation>(); stubborn = new Set<string>();
  override observe(agent: string): ExecutionObservation { return this.state.get(agent) ?? idle; }
  override async observeAsync(agent: string): Promise<ExecutionObservation> { return this.observe(agent); }
  override confirmDead(agent: string): boolean { return this.observe(agent).activeState !== "active"; }
  override start(agent: string): void { this.starts.push(agent); }
  override stop(agent: string): ExecutionObservation {
    this.stops.push(agent);
    if (!this.stubborn.has(agent)) this.state.set(agent, idle);
    return this.observe(agent);
  }
}
type Answer = { ok: true; result: unknown } | { ok: false; code: string | undefined; retry: string | undefined };
/** A refusal may be an answer frame or a thrown error; both are the caller's outcome. */
async function answer(call: Promise<object>): Promise<Answer> {
  try {
    const value = await call as { ok: boolean; result?: unknown; error?: { code: string; retry: string } };
    return value.ok ? { ok: true, result: value.result } : { ok: false, code: value.error?.code, retry: value.error?.retry };
  } catch (error) { return { ok: false, code: (error as { code?: string }).code, retry: undefined }; }
}
/** Synthetic existing data, generated sparsely. */
const TREE_BYTES = 1024 * 1024 * 1024;
const TREE_MARGIN_BYTES = 256 * 1024;
function society(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-admission-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  let ownedBroker: Broker | null = null;
  t.after(async () => { try { if (ownedBroker) await ownedBroker.drainAndClose(); else store.close(); } finally { removeTree(root); } });
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" }));
    tx.insertAgent(makeValidAgent("bob", { createdBy: "alice" }));
    tx.insertAgent(makeValidAgent("carol", { createdBy: "principal" }));
  });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
  const units = new ScriptedUnits();
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  const reconcile = createReconcileModule(store, mail, null, null, units, lifecycle, { projectGit: join(root, "project.git"),
    hasGoal: () => true, activationAllowed: () => true });
  const broker = ownedBroker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: reconcile, paths: { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: goalPublishedAt(root), } });
  const internal = (method: string, params: Record<string, unknown>, channel: "runner" | "host") =>
    (Reflect.get(broker, "dispatchInternal") as (raw: object, peer: object, stream: null, channel: string) => Promise<object>)
      .call(broker, { v: 1, id: method, method, params }, { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() }, null, channel);
  const populateLargeTree = () => padTree(root, TREE_BYTES + TREE_MARGIN_BYTES + 1);
  return { root, store, mail, units, broker, peers: Reflect.get(broker, "peers") as PeerAuthenticator, reconcile, internal, populateLargeTree };
}

test("V21B: over the storage limit reads and accepted same-key lookups answer, new work and safety stops proceed", async t => {
  const f = society(t);
  const input: MailInput = { to: ["bob"], subject: "accepted before the limit", kind: "message", body: "frozen" };
  const accepted = await f.mail.send(auth, "accepted", input);
  assert.equal(accepted.state, "succeeded");
  f.populateLargeTree();
  const call = (request: Record<string, unknown>) => answer(f.broker.dispatch(auth, request as never, null));

  const receipt = await call({ v: 1, id: "g", method: "operation.get", params: { key: "accepted" } });
  assert.ok(receipt.ok, JSON.stringify(receipt));
  assert.equal((receipt.result as { operation: string }).operation, accepted.operation);
  const missing = await call({ v: 1, id: "m", method: "operation.get", params: { key: "never-sent" } });
  assert.ok(missing.ok, "an absent receipt is an observation, not a quota refusal");
  const status = await call({ v: 1, id: "s", method: "status.get", params: { agent: "alice" } });
  assert.ok(status.ok, JSON.stringify(status));

  const replay = await call({ v: 1, id: "r", method: "mail.send", request: "accepted", params: input });
  assert.ok(replay.ok, `accepted same-key lookup precedes new consumption: ${JSON.stringify(replay)}`);
  assert.equal((replay.result as { operation: string }).operation, accepted.operation);

  const fresh = await call({ v: 1, id: "n", method: "mail.send", request: "fresh", params: input });
  assert.equal(fresh.ok, true);
  assert.equal(f.store.getOperation("alice", "fresh")?.state, "succeeded");
  f.units.state.set("bob", running);
  const start = await call({ v: 1, id: "a", method: "agent.start", request: "start-bob", params: { agent: "bob" } });
  assert.equal(start.ok, true);

  const stop = await call({ v: 1, id: "x", method: "agent.stop", request: "stop-bob", params: { agent: "bob" } });
  assert.ok(stop.ok, `a safety stop is not new consumption: ${JSON.stringify(stop)}`);
  assert.deepEqual(f.units.stops, ["bob"]);
  assert.equal(f.store.getAgent("bob")?.desired, "stopped");
});

test("V21B: over the storage limit runner reads answer and settlement uses its normal validation", async t => {
  const f = society(t);
  f.populateLargeTree();
  t.mock.method(f.peers, "runnerActor", () => "alice");
  t.mock.method(f.peers, "runnerAuth", () => auth);
  const pending = await answer(f.internal("runner.pending", {}, "runner"));
  assert.deepEqual(pending, { ok: true, result: { pending: 0, recoverableBatchIds: [] } });
  const complete = await answer(f.internal("batch.complete", { batchId: "b-00000000-0000-4000-8000-000000000001", incarnation: 1,
    sessionPath: "/s", adapterRevision: "r", receiptPath: "/r" }, "runner"));
  // Past the bounded settlement headroom, settlement is refused like new work.
  assert.equal(complete.ok, false);
  if (!complete.ok) assert.notEqual(complete.code, "TREE_BYTES_EXCEEDED");
});

test("V21B: over the storage limit recovery settles safety stages and settles new effects and settlement", async t => {
  const f = society(t);
  // Accepted mail whose publication was lost: settling it writes derived views.
  await assert.rejects(sendWithStop(f.mail, f.store, auth, "lost", { to: ["carol"], subject: "held", kind: "message", body: "held" }, "accepted"));
  assert.equal(f.store.getOperation("alice", "lost")?.state, "pending");
  // carol has delivered work and an inactive unit (start is new work); bob is
  // stopped but still running (stop is a safety action).
  assert.equal((await f.mail.send(auth, "work", { to: ["carol"], subject: "work", kind: "message", body: "work" })).state, "succeeded");
  f.store.transaction(tx => tx.updateAgent({ name: "bob", desired: "stopped" }));
  f.units.state.set("bob", running);
  f.populateLargeTree();
  const report = await answer(f.reconcile.sweep().then(result => ({ ok: true as const, result })));
  assert.ok(report.ok, `recovery is staged, not refused as a whole: ${JSON.stringify(report)}`);
  assert.deepEqual(report.result, { examined: 1, repaired: 1, remaining: 0 });
  assert.equal(f.store.getOperation("alice", "lost")?.state, "succeeded");
  assert.deepEqual(f.units.stops, ["bob"], "the safety stop ran");
  assert.deepEqual(f.units.starts, ["carol"]);
  const carol = f.reconcile.unitDiagnostics.find(value => value.agent === "carol");
  assert.notEqual(carol?.reason, "TREE_BYTES_EXCEEDED");
});

test("V21B: within the limit the same recovery settles the mail and activates the waiting unit", async t => {
  const f = society(t);
  await assert.rejects(sendWithStop(f.mail, f.store, auth, "lost", { to: ["carol"], subject: "held", kind: "message", body: "held" }, "accepted"));
  const report = await answer(f.reconcile.sweep().then(result => ({ ok: true as const, result })));
  assert.deepEqual(report, { ok: true, result: { examined: 1, repaired: 1, remaining: 0 } });
  assert.deepEqual(f.units.starts, ["carol"]);
});

test("V21B: a mail failure after its acceptance is reported as accepted, never as a refusal", async t => {
  const f = society(t);
  const transaction = f.store.transaction.bind(f.store);
  let calls = 0;
  t.mock.method(f.store, "transaction", ((work: Parameters<Store["transaction"]>[0]) => {
    // acceptance, then materialization per delivery, then the success record
    if (++calls === 3) throw Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
    return transaction(work);
  }) as Store["transaction"]);
  const failure = await answer(f.broker.dispatch(auth, { v: 1, id: "full", method: "mail.send", request: "full",
    params: { to: ["bob"], subject: "full", kind: "message", body: "full" } } as never, null));
  t.mock.restoreAll();
  assert.deepEqual(failure, { ok: false, code: "STORAGE_FULL", retry: "same-key" }, "the accepted intent must be looked up, not abandoned");
  assert.equal(f.store.getOperation("alice", "full")?.state, "pending");
});

test("V21B: a submit effect failure recorded as unknown is reported for same-key lookup", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-admission-git-"));
  const store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { try { store.close(); } finally { removeTree(root); } });
  store.transaction(tx => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
  seedGit(root);
  const { git } = gitFixture(root, store);
  t.mock.method(Reflect.get(git, "repository") as Record<string, () => void>, "publishRef", () => {
    throw new StoreError("PUBLISHED_REF_CONFLICT", "injected conflict at the published ref");
  });
  const error = await submitFixture(root, git, "conflict").then(() => null, (reason: unknown) => reason);
  assert.ok(error instanceof StoreError && error.code === "PUBLISHED_REF_CONFLICT", String(error));
  assert.equal(store.getOperation("a", "conflict")?.state, "unknown");
  assert.deepEqual(publicFailure(error), { code: "PUBLISHED_REF_CONFLICT", message: "PUBLISHED_REF_CONFLICT", retry: "same-key" });
});

test("V21B: a startup stop that cannot be confirmed still leaves every other resident stopped", async t => {
  const f = society(t);
  for (const agent of ["alice", "bob"]) f.units.state.set(agent, running);
  f.units.stubborn.add("alice");
  await assert.rejects(f.reconcile.startup(false), { code: "RUN_TERMINATION_UNKNOWN" });
  assert.deepEqual(f.units.stops, ["alice", "bob", "carol"], "one unconfirmed stop does not skip any remaining Resident");
  assert.equal(f.units.observe("bob").activeState, "inactive");
});
