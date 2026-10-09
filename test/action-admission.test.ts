/** V21B: the logical storage quota refuses only what a method's or recovery
 * stage's category says: new work (and, until WP22 supplies a reserve,
 * settlement), never reads or safety stops, and never a same-key lookup of
 * accepted work; a failure after acceptance is reported as accepted. Real
 * Store, Broker, dispatchers, MailModule, LifecycleModule, ReconcileModule and
 * GitModule; unit control is a scripted port.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync } from "node:fs";
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
import { StorageAdmission } from "../src/storage/quota.js";
import { parseUnitObservation } from "../src/units/observe.js";
import { ALL_CAPS, TEST_RESOURCES, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { padTree } from "./fixtures/storage-pad.js";
import { sendWithStop } from "./fixtures/mail-faults.js";
import { gitFixture, seedGit, submitFixture } from "./fixtures/git-crash.js";
import { goalPublishedAt } from "./fixtures/goal.js";

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
/** A fixed configured quota; "over the limit" places the tree past the settlement headroom too. */
const QUOTA = 1024 * 1024 * 1024;
const HEADROOM = 256 * 1024;
function society(t: TestContext) {
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
  // The broker composition gives recovery the same storage owner as dispatch.
  const storage = new StorageAdmission(root, QUOTA, HEADROOM);
  const reconcile = new ReconcileModule(store, mail, null, units, lifecycle, { projectGit: join(root, "project.git"),
    hasGoal: () => true, activationAllowed: () => true, resourceGate: category => storage.admit(category) });
  const broker = new Broker(store, mail, units, views, lifecycle, null, reconcile, { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: goalPublishedAt(root), storageBytes: QUOTA, storage });
  const internal = (method: string, params: Record<string, unknown>, channel: "runner" | "host") =>
    (Reflect.get(broker, "dispatchInternal") as (raw: object, peer: object, stream: null, channel: string) => Promise<object>)
      .call(broker, { v: 1, id: method, method, params }, { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() }, null, channel);
  const overLimit = () => padTree(root, QUOTA + HEADROOM + 1);
  return { root, store, mail, units, broker, reconcile, internal, overLimit };
}

test("V21B: over the storage limit reads and accepted same-key lookups answer, new work is refused, a stop proceeds", async t => {
  const f = society(t);
  const input: MailInput = { to: ["bob"], subject: "accepted before the limit", kind: "message", body: "frozen" };
  const accepted = await f.mail.send(auth, "accepted", input);
  assert.equal(accepted.state, "succeeded");
  f.overLimit();
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

test("V21B: over the storage limit runner reads answer and settlement past its headroom is refused", async t => {
  const f = society(t);
  f.overLimit();
  t.mock.method(f.broker as unknown as Record<string, () => string>, "runnerActor", () => "alice");
  t.mock.method(f.broker as unknown as Record<string, () => AuthContext>, "runnerAuth", () => auth);
  const pending = await answer(f.internal("runner.pending", {}, "runner"));
  assert.deepEqual(pending, { ok: true, result: { pending: 0, recoverableBatchIds: [] } });
  const complete = await answer(f.internal("batch.complete", { batchId: "b-00000000-0000-4000-8000-000000000001", incarnation: 1,
    sessionPath: "/s", adapterRevision: "r", receiptPath: "/r" }, "runner"));
  // Past the bounded settlement headroom, settlement is refused like new work.
  assert.deepEqual(complete, { ok: false, code: "QUOTA_EXCEEDED", retry: "never" });
});

test("V21B: over the storage limit recovery settles safety stages and holds new effects and settlement", async t => {
  const f = society(t);
  t.mock.method(f.broker as unknown as Record<string, () => void>, "requireHostUnit", () => undefined);
  // Accepted mail whose publication was lost: settling it writes derived views.
  await assert.rejects(sendWithStop(f.mail, f.store, auth, "lost", { to: ["carol"], subject: "held", kind: "message", body: "held" }, "accepted"));
  assert.equal(f.store.getOperation("alice", "lost")?.state, "pending");
  // carol has delivered work and an inactive unit (start is new work); bob is
  // stopped but still running (stop is a safety action).
  assert.equal((await f.mail.send(auth, "work", { to: ["carol"], subject: "work", kind: "message", body: "work" })).state, "succeeded");
  f.store.transaction(tx => tx.updateAgent({ name: "bob", desired: "stopped" }));
  f.units.state.set("bob", running);
  f.overLimit();
  const report = await answer(f.reconcile.sweep().then(result => ({ ok: true as const, result })));
  assert.ok(report.ok, `recovery is staged, not refused as a whole: ${JSON.stringify(report)}`);
  assert.deepEqual(report.result, { examined: 1, repaired: 0, remaining: 1 });
  assert.equal(f.store.getOperation("alice", "lost")?.state, "pending", "settlement past its headroom waits");
  assert.deepEqual(f.units.stops, ["bob"], "the safety stop ran");
  assert.deepEqual(f.units.starts, [], "no new activation over the limit");
  const carol = f.reconcile.unitDiagnostics.find(value => value.agent === "carol");
  assert.deepEqual(carol, { agent: "carol", outcome: "unknown", reason: "QUOTA_EXCEEDED" });
});

test("V21B: within the limit the same recovery settles the mail and activates the waiting unit", async t => {
  const f = society(t);
  t.mock.method(f.broker as unknown as Record<string, () => void>, "requireHostUnit", () => undefined);
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
  t.mock.method(git as unknown as Record<string, () => void>, "publishRef", () => {
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

test("D04: over-quota is a degraded start, not a stopped one -- and only over-quota", async t => {
  // The broker entry calls startupState() where a bare admit() used to stop
  // startup: the same fresh scan answers "degraded" so the broker can serve
  // reads, stops and settlement while every new admission is still refused
  // per request. A quota-free deployment always admits; and an observation
  // that is not a quota answer -- an unreadable store -- still throws, never
  // a silent "degraded".
  const root = mkdtempSync(join(tmpdir(), "oma-startup-degraded-"));
  t.after(() => removeTree(root));
  const open = new StorageAdmission(root, QUOTA, HEADROOM);
  assert.equal(await open.startupState(), "admitted");
  assert.equal(await new StorageAdmission(root, undefined, HEADROOM).startupState(), "admitted",
    "a deployment with no quota configured admits unconditionally");
  padTree(root, QUOTA + 1);
  assert.equal(await open.startupState(), "degraded", "over the admission cap the store still starts");
  await assert.rejects(open.admit("admit"), { code: "QUOTA_EXCEEDED" },
    "the degraded state refuses new work per request, not at construction");
  (await open.admit("settle"))(); // settlement keeps its bounded headroom
  padTree(root, QUOTA + HEADROOM + 1);
  await assert.rejects(open.admit("settle"), { code: "QUOTA_EXCEEDED" },
    "past the headroom settlement is refused like new work");
  const blind = mkdtempSync(join(tmpdir(), "oma-startup-blind-"));
  mkdirSync(join(blind, "hidden"));
  chmodSync(join(blind, "hidden"), 0o000);
  t.after(() => { chmodSync(join(blind, "hidden"), 0o700); removeTree(blind); });
  await assert.rejects(new StorageAdmission(join(blind, "hidden", "owned"), QUOTA, HEADROOM).startupState(), { code: "BROKER_UNAVAILABLE" },
    "an unobservable store is not a quota answer -- startup still fails");
});
