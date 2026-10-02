/** DR27 / P0: whole-society execution is a durable fence, not a mass desired-state edit. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AuthContext, UnitObservation } from "../implementation/contracts.js";
import { Store, readDiagnosticSnapshot } from "../src/store.js";
import { ReconcileModule } from "../src/reconcile.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { SocietyControl } from "../src/lifecycle/society.js";
import { parseUnitObservation } from "../src/units/observe.js";
import { UnitsModule } from "../src/units.js";
import { MailModule } from "../src/mail.js";
import { assertCurrentActor } from "../src/authority.js";
import { AcceptedFailure, StoreError } from "../src/domain/errors.js";
import { inspectLedger } from "../src/diagnostics/ledger.js";
import { ALL_CAPS, TEST_RESOURCES, makeValidAgent } from "./fixtures/spec.js";

class ControlledUnits extends UnitsModule {
  readonly stops: { agent: string; incarnation: number | undefined }[] = [];
  readonly failures = new Map<string, Error>();
  readonly alive = new Set<string>();
  readonly starts: string[] = [];
  observing: (() => Promise<void>) | undefined;
  onStop: (() => void) | undefined;
  constructor(root: string) {
    super("demo", { node: process.execPath, libdir: root, state: root, society: "demo", agent: "" }, join(root, "units"), { p: TEST_RESOURCES });
  }
  override stop(agent: string, incarnation: number): UnitObservation {
    this.stops.push({ agent, incarnation }); this.onStop?.();
    const failure = this.failures.get(agent); if (failure) throw failure;
    return parseUnitObservation({ kind: "succeeded", status: 0, signal: null, stderr: "",
      stdout: `ActiveState=inactive\nSubState=dead\nResult=success\nExecMainStatus=0\nControlGroup=/oma-test\nInvocationID=${"1".repeat(32)}\n` });
  }
  override start(agent: string): void { this.starts.push(agent); }
  override observe(): UnitObservation {
    return parseUnitObservation({ kind: "succeeded", status: 0, signal: null, stderr: "",
      stdout: `ActiveState=inactive\nSubState=dead\nResult=success\nExecMainStatus=0\nControlGroup=/oma-test\nInvocationID=${"1".repeat(32)}\n` });
  }
  override async observeAsync(): Promise<UnitObservation> { await this.observing?.(); return this.observe(); }
  override confirmDead(agent: string): boolean { return !this.alive.has(agent); }
}
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-society-control-")); const path = join(root, "runtime.sqlite");
  let now = 100; let store = new Store(path, 0, { society: "demo" }, () => now);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" }));
    tx.insertAgent(makeValidAgent("bob", { createdBy: "alice", desired: "stopped", incarnation: 4 }));
  });
  const units = new ControlledUnits(root);
  const auth = (actor = "principal"): AuthContext => ({ actor, role: actor === "principal" ? "principal" : "resident",
    incarnation: actor === "principal" ? 0 : actor === "bob" ? 4 : 1, channel: "actor", capabilities: new Set(ALL_CAPS),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } });
  return { root, units, auth, get store() { return store; }, get control() { return new SocietyControl(store, units); },
    time(value: number) { now = value; }, reopen() { store.close(); store = new Store(path, 0, { society: "demo" }, () => now); } };
}
const code = (value: string) => (error: unknown) => error instanceof StoreError && error.code === value;

test("DR27: close disables every path, persists across restart, and open preserves individual stops", t => {
  const f = fixture(t); const before = f.store.listAgents(); assert.equal(f.store.societyOpen(), true);
  f.units.onStop = () => assert.equal(f.store.societyOpen(), false, "activation must be fenced before stopping units");
  const closed = f.control.set(f.auth(), "closed", "close"); assert.equal(closed.state, "succeeded");
  assert.deepEqual(f.units.stops, [{ agent: "alice", incarnation: 1 }, { agent: "bob", incarnation: 4 }]);
  assert.deepEqual(f.store.listAgents(), before);
  f.reopen(); assert.equal(f.store.societyOpen(), false);
  assert.deepEqual(f.control.set(f.auth(), "closed", "close"), closed);
  assert.equal(f.units.stops.length, 2, "terminal replay cannot stop a new execution");
  const open = f.control.set(f.auth(), "open", "open"); assert.equal(open.state, "succeeded");
  assert.equal(f.store.societyOpen(), true); assert.deepEqual(f.store.listAgents(), before);
  assert.equal(f.units.stops.length, 4, "reopen proves quiescence before releasing execution");
  f.control.set(f.auth(), "open", "already-open"); assert.equal(f.units.stops.length, 4, "open society need not kill healthy Workers");
  const report = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" }).report;
  assert.equal(report.status, "PASS", JSON.stringify(report));
});

test("DR27: failed stop still attempts all Residents; neither new-key open nor timeout means death", t => {
  const f = fixture(t); f.units.failures.set("alice", new StoreError("RUN_TERMINATION_UNKNOWN", "injected timeout"));
  assert.equal(f.control.set(f.auth(), "closed", "close").state, "unknown");
  assert.deepEqual(f.units.stops.map(x => x.agent), ["alice", "bob"]);
  assert.equal(f.store.societyOpen(), false);
  assert.equal(f.control.set(f.auth(), "open", "open").state, "unknown");
  assert.equal(f.store.societyOpen(), false);
  f.units.failures.clear(); f.units.alive.add("alice");
  assert.equal(f.control.set(f.auth(), "open", "open").state, "unknown");
  f.reopen(); assert.equal(f.store.societyOpen(), false);
  f.units.alive.clear(); assert.equal(f.control.set(f.auth(), "open", "open").state, "succeeded");
  assert.equal(f.store.societyOpen(), true);
  const count = f.units.stops.length;
  assert.equal(f.control.set(f.auth(), "closed", "close").state, "unknown");
  assert.equal(f.units.stops.length, count, "superseded unknown intent cannot act on newer work");
  assert.equal(f.store.societyOpen(), true);
});

test("DR27: accepted order survives clock rollback; same-key history never changes current execution", t => {
  const f = fixture(t);
  const open = f.control.set(f.auth(), "open", "open");
  f.time(50); const close = f.control.set(f.auth(), "closed", "close");
  const count = f.units.stops.length;
  assert.deepEqual(f.control.set(f.auth(), "open", "open"), open);
  assert.equal(f.store.societyOpen(), false); assert.equal(f.units.stops.length, count);
  assert.throws(() => f.control.set(f.auth(), "open", "close"), code("REQUEST_KEY_REUSED"));
  f.time(25); f.control.set(f.auth(), "open", "later-open");
  assert.deepEqual(f.control.set(f.auth(), "closed", "close"), close); assert.equal(f.store.societyOpen(), true);
});

test("DR27: only the current Principal can accept control; closed gate refuses Resident effects, not Principal control", t => {
  const f = fixture(t);
  assert.throws(() => f.control.set(f.auth("alice"), "closed", "resident"), code("CAPABILITY_DENIED"));
  assert.throws(() => f.control.set({ ...f.auth(), capabilities: new Set() }, "closed", "no-cap"), code("CAPABILITY_DENIED"));
  assert.throws(() => f.control.set({ ...f.auth(), incarnation: 1 }, "closed", "stale"), code("STALE_RUN"));
  assert.equal(f.store.operations.latestSociety(), null);
  f.control.set(f.auth(), "closed", "close");
  assert.throws(() => assertCurrentActor(f.store, f.auth("alice"), "mail.send"), code("AGENT_NOT_READY"));
  assert.doesNotThrow(() => assertCurrentActor(f.store, f.auth(), "mail.send"));
});

test("DR27: recovered opening requires current authority, whereas accepted closing finishes its safety fence", t => {
  const f = fixture(t); f.units.alive.add("alice");
  f.control.set(f.auth(), "open", "noop-open"); // Already open: no stop needed.
  const close = f.control.set(f.auth(), "closed", "close");
  f.store.transaction(tx => tx.updateAgent({ name: "principal", desired: "stopped" }));
  f.units.alive.clear(); f.control.reconcileById(close.operation);
  assert.equal(f.store.operations.getById(close.operation)!.state, "succeeded");
  assert.equal(f.store.societyOpen(), false);
  f.store.transaction(tx => tx.updateAgent({ name: "principal", desired: "enabled" }));
  f.units.alive.add("alice"); const open = f.control.set(f.auth(), "open", "open");
  f.store.transaction(tx => tx.updateAgent({ name: "principal", desired: "stopped" }));
  f.units.alive.clear(); f.reopen(); f.control.reconcileById(open.operation);
  assert.equal(f.store.operations.getById(open.operation)!.state, "unknown");
  assert.equal(f.store.societyOpen(), false);
  f.store.transaction(tx => tx.updateAgent({ name: "principal", desired: "enabled" }));
  f.control.reconcileById(open.operation); assert.equal(f.store.societyOpen(), true);
});

test("DR27: live opening rechecks its lease before releasing execution", t => {
  const f = fixture(t); f.control.set(f.auth(), "closed", "close");
  const capabilities = new Set(ALL_CAPS); const auth = { ...f.auth(), capabilities };
  f.units.onStop = () => capabilities.clear();
  assert.equal(f.control.set(auth, "open", "open").state, "unknown");
  assert.equal(f.store.societyOpen(), false);
});

test("DR27/P0: corruption after acceptance remains an accepted failure and does not skip other stops", t => {
  const f = fixture(t); f.units.failures.set("alice", new StoreError("STORE_CORRUPT", "injected broken unit identity"));
  assert.throws(() => f.control.set(f.auth(), "closed", "close"), error => error instanceof AcceptedFailure && error.code === "STORE_CORRUPT");
  assert.equal(f.store.societyOpen(), false);
  assert.deepEqual(f.units.stops.map(x => x.agent), ["alice", "bob"]);
});

test("DR27: closed society keeps queued and prepared mail without an automatic Principal or Resident turn", async t => {
  const f = fixture(t); const mail = new MailModule({ stateRoot: f.root, society: "demo" }, f.store, 64, 24, { frameBytes: 1024 * 1024, batchMaxMessages: 24 });
  await mail.send(f.auth("alice"), "mail", { to: ["principal"], subject: "Keep this task", body: "unfinished", kind: "message" });
  const prepared = await mail.prepare(f.auth()); assert.ok(prepared);
  const batch = f.store.getBatch(prepared.id); const pending = f.store.pendingDeliveries("principal");
  f.control.set(f.auth(), "closed", "close");
  assert.equal(await mail.prepare(f.auth()), null); assert.equal(await mail.prepare(f.auth("alice")), null);
  assert.deepEqual(f.store.getBatch(prepared.id), batch); assert.deepEqual(f.store.pendingDeliveries("principal"), pending);
  f.control.set(f.auth(), "open", "open"); const resumed = await mail.prepare(f.auth());
  assert.equal(resumed!.id, prepared.id); assert.deepEqual(resumed!.messageIds, prepared.messageIds);
});

test("DR27: reopen resumes enabled pending-mail Workers through reconciliation, never force-stopped Workers", async t => {
  const f = fixture(t); const mail = new MailModule({ stateRoot: f.root, society: "demo" }, f.store, 64);
  const paths = { stateRoot: f.root, projectGit: join(f.root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true };
  const lifecycle = new LifecycleModule(f.store, f.units, paths, () => null, mail);
  const reconcile = new ReconcileModule(f.store, mail, null, f.units, lifecycle, paths);
  await mail.send(f.auth(), "work", { to: ["alice", "bob"], subject: "Work", body: "Continue", kind: "message" });
  f.control.set(f.auth(), "closed", "close"); await reconcile.sweep();
  assert.deepEqual(f.units.starts, []);
  f.control.set(f.auth(), "open", "open"); await reconcile.sweep();
  assert.deepEqual(f.units.starts, ["alice"]); assert.equal(f.store.getAgent("bob")!.desired, "stopped");
  let observing!: () => void, release!: () => void;
  const seen = new Promise<void>(resolve => { observing = resolve; }); const held = new Promise<void>(resolve => { release = resolve; });
  f.units.observing = async () => { observing(); await held; };
  const sweep = reconcile.sweep(); await seen;
  f.control.set(f.auth(), "closed", "close-during-observation"); release(); await sweep;
  assert.deepEqual(f.units.starts, ["alice"], "an in-flight inactive observation cannot reopen society execution");
});
