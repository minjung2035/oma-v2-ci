/** V21B: the logical storage quota refuses only what a method's or recovery
 * stage's category says: new work (and, until WP22 supplies a reserve,
 * settlement), never reads or safety stops, and never a same-key lookup of
 * accepted work; a failure after acceptance is reported as accepted. Real
 * Store, Broker, dispatchers, MailModule, LifecycleModule, ReconcileModule and
 * GitModule; unit control is a scripted port.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, MailInput, UnitObservation } from "../implementation/contracts.js";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { Broker } from "../src/broker.js";
import { UnitsModule } from "../src/units.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { ReconcileModule } from "../src/reconcile.js";
import { StoreError, publicFailure } from "../src/domain/errors.js";
import { storageResourceGate } from "../src/storage/quota.js";
import { parseUnitObservation } from "../src/units/observe.js";
import { ALL_CAPS, TEST_RESOURCES, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { sendWithStop } from "./fixtures/mail-faults.js";
import { gitFixture, seedGit, submitFixture } from "./fixtures/git-crash.js";

const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
const idle = parseUnitObservation({ kind: "succeeded", status: 0, signal: null, stderr: "",
  stdout: `ActiveState=inactive\nSubState=dead\nResult=success\nExecMainStatus=0\nControlGroup=/oma-test\nInvocationID=${"1".repeat(32)}\n` });
const running = parseUnitObservation({ kind: "succeeded", status: 0, signal: null, stderr: "",
  stdout: `ActiveState=active\nSubState=running\nResult=success\nExecMainStatus=0\nControlGroup=/oma-test\nInvocationID=${"2".repeat(32)}\n` });

/** Unit control is scripted: this suite is about which effects are admitted, not systemd. */
class ScriptedUnits extends UnitsModule {
  starts: string[] = []; stops: string[] = []; state = new Map<string, UnitObservation>(); stubborn = new Set<string>();
  constructor(root: string) { super("demo", { node: process.execPath, libdir: root, state: root, society: "demo", agent: "" }, join(root, "units"), { p: TEST_RESOURCES }); }
  override observe(agent: string): UnitObservation { return this.state.get(agent) ?? idle; }
  override async observeAsync(agent: string): Promise<UnitObservation> { return this.observe(agent); }
  override confirmDead(agent: string): boolean { return this.observe(agent).activeState !== "active"; }
  override start(agent: string): void { this.starts.push(agent); }
  override stop(agent: string): UnitObservation {
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
function society(t: TestContext, storageBytes: number) {
  const root = mkdtempSync(join(tmpdir(), "oma-admission-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  t.after(() => { try { store.close(); } finally { removeTree(root); } });
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" }));
    tx.insertAgent(makeValidAgent("bob", { createdBy: "alice" }));
    tx.insertAgent(makeValidAgent("carol", { createdBy: "principal" }));
  });
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
  const units = new ScriptedUnits(root);
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = new LifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  // The broker composition gives recovery the same storage gate as dispatch.
  const reconcile = new ReconcileModule(store, mail, null, units, lifecycle, { projectGit: join(root, "project.git"),
    hasGoal: () => true, activationAllowed: () => true, resourceGate: storageResourceGate(root, storageBytes) });
  const broker = new Broker(store, mail, units, views, lifecycle, null, reconcile, { stateRoot: root, runRoot: join(root, "run"), society: "demo", storageBytes });
  const internal = (method: string, params: Record<string, unknown>, channel: "runner" | "host") =>
    (Reflect.get(broker, "dispatchInternal") as (raw: object, peer: object, stream: null, channel: string) => Promise<object>)
      .call(broker, { v: 1, id: method, method, params }, { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() }, null, channel);
  return { root, store, mail, units, broker, reconcile, internal };
}

test("V21B: over the storage limit reads and accepted same-key lookups answer, new work is refused, a stop proceeds", async t => {
  const f = society(t, 1);
  const input: MailInput = { to: ["bob"], subject: "accepted before the limit", kind: "message", body: "frozen" };
  const accepted = await f.mail.send(auth, "accepted", input);
  assert.equal(accepted.state, "succeeded");
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
  assert.deepEqual(fresh, { ok: false, code: "QUOTA_EXCEEDED", retry: "never" });
  assert.equal(f.store.getOperation("alice", "fresh"), null, "a refused admission leaves no row");
  f.units.state.set("bob", running);
  const start = await call({ v: 1, id: "a", method: "agent.start", request: "start-bob", params: { agent: "bob" } });
  assert.deepEqual(start, { ok: false, code: "QUOTA_EXCEEDED", retry: "never" });

  const stop = await call({ v: 1, id: "x", method: "agent.stop", request: "stop-bob", params: { agent: "bob" } });
  assert.ok(stop.ok, `a safety stop is not new consumption: ${JSON.stringify(stop)}`);
  assert.deepEqual(f.units.stops, ["bob"]);
  assert.equal(f.store.getAgent("bob")?.desired, "stopped");
});

test("V21B: over the storage limit runner reads answer and settlement waits for its reserve", async t => {
  const f = society(t, 1);
  t.mock.method(f.broker as unknown as Record<string, () => string>, "runnerActor", () => "alice");
  t.mock.method(f.broker as unknown as Record<string, () => AuthContext>, "runnerAuth", () => auth);
  const pending = await answer(f.internal("runner.pending", {}, "runner"));
  assert.deepEqual(pending, { ok: true, result: { pending: 0, recoverableBatchIds: [] } });
  const complete = await answer(f.internal("batch.complete", { batchId: "b-00000000-0000-4000-8000-000000000001", incarnation: 1,
    sessionPath: "/s", adapterRevision: "r", receiptPath: "/r" }, "runner"));
  // WP22 owns the bounded settlement reserve; until then settlement is not exempt.
  assert.deepEqual(complete, { ok: false, code: "QUOTA_EXCEEDED", retry: "never" });
});

test("V21B: over the storage limit recovery settles safety stages and holds new effects and settlement", async t => {
  const f = society(t, 1);
  t.mock.method(f.broker as unknown as Record<string, () => void>, "requireHostUnit", () => undefined);
  // Accepted mail whose publication was lost: settling it writes derived views.
  await assert.rejects(sendWithStop(f.mail, f.store, auth, "lost", { to: ["carol"], subject: "held", kind: "message", body: "held" }, "accepted"));
  assert.equal(f.store.getOperation("alice", "lost")?.state, "pending");
  // carol has delivered work and an inactive unit (start is new work); bob is
  // stopped but still running (stop is a safety action).
  assert.equal((await f.mail.send(auth, "work", { to: ["carol"], subject: "work", kind: "message", body: "work" })).state, "succeeded");
  f.store.transaction(tx => tx.updateAgent({ name: "bob", desired: "stopped" }));
  f.units.state.set("bob", running);
  const report = await answer(f.internal("host.reconcile", {}, "host"));
  assert.ok(report.ok, `recovery is staged, not refused as a whole: ${JSON.stringify(report)}`);
  assert.deepEqual(report.result, { examined: 1, repaired: 0, remaining: 1 });
  assert.equal(f.store.getOperation("alice", "lost")?.state, "pending", "settlement waits for the WP22 reserve");
  assert.deepEqual(f.units.stops, ["bob"], "the safety stop ran");
  assert.deepEqual(f.units.starts, [], "no new activation over the limit");
  const carol = f.reconcile.unitDiagnostics.find(value => value.agent === "carol");
  assert.deepEqual(carol, { agent: "carol", outcome: "unknown", reason: "QUOTA_EXCEEDED" });
});

test("V21B: within the limit the same recovery settles the mail and activates the waiting unit", async t => {
  const f = society(t, Number.MAX_SAFE_INTEGER);
  t.mock.method(f.broker as unknown as Record<string, () => void>, "requireHostUnit", () => undefined);
  await assert.rejects(sendWithStop(f.mail, f.store, auth, "lost", { to: ["carol"], subject: "held", kind: "message", body: "held" }, "accepted"));
  const report = await answer(f.internal("host.reconcile", {}, "host"));
  assert.deepEqual(report, { ok: true, result: { examined: 1, repaired: 1, remaining: 0 } });
  assert.deepEqual(f.units.starts, ["carol"]);
});

test("V21B: a mail failure after its acceptance is reported as accepted, never as a refusal", async t => {
  const f = society(t, Number.MAX_SAFE_INTEGER);
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
  t.mock.method(git as unknown as Record<string, () => void>, "publishRef", () => {
    throw new StoreError("PUBLISHED_REF_CONFLICT", "injected conflict at the published ref");
  });
  const error = await submitFixture(root, git, "conflict").then(() => null, (reason: unknown) => reason);
  assert.ok(error instanceof StoreError && error.code === "PUBLISHED_REF_CONFLICT", String(error));
  assert.equal(store.getOperation("a", "conflict")?.state, "unknown");
  assert.deepEqual(publicFailure(error), { code: "PUBLISHED_REF_CONFLICT", message: "PUBLISHED_REF_CONFLICT", retry: "same-key" });
});

test("V21B: a startup stop that cannot be confirmed still leaves every other resident stopped", async t => {
  const f = society(t, Number.MAX_SAFE_INTEGER);
  for (const agent of ["alice", "bob"]) f.units.state.set(agent, running);
  f.units.stubborn.add("alice");
  await assert.rejects(f.reconcile.startup(false), { code: "RUN_TERMINATION_UNKNOWN" });
  assert.deepEqual(f.units.stops, ["alice", "bob"], "one unconfirmed stop does not skip the next safety action");
  assert.equal(f.units.observe("bob").activeState, "inactive");
});
