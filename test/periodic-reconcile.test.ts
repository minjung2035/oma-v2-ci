import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** AV20 -- REC-002, arch §6.5, §17.1, D03: physical state is reconciled every
 * five seconds, by whichever owner the deployment's lifetime really has.
 *
 * The sixth functional run: the Principal created two Residents at once. The
 * second creation was accepted, found the first still completing and answered
 * BROKER_UNAVAILABLE, "its intent is retained" -- retained for the reconcile
 * timer, which nothing ever installed (`ensureReconcile` had no caller since it
 * was written). The Resident stayed `provisioning` for as long as the broker
 * ran. The product's broker is a foreground one: no timer unit can share its
 * lifetime, so the broker runs the sweep itself -- and v0.1.0 ships no
 * external reconcile service or timer unit at all.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionObservation, AuthContext } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { Broker } from "@oma/broker";
import { PolicyExecution } from "./fixtures/execution.js";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import type { ReconcileModule } from "@oma/reconcile";
import { RECONCILE_INTERVAL_MS } from "@oma/domain/recovery-policy";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { goalPublishedAt } from "./fixtures/goal.js";

const idle: ExecutionObservation = { activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, scope: "", invocationId: "1".repeat(32) };

/** Unit control is scripted: this suite is about when the broker sweeps, not systemd. */
class ScriptedUnits extends PolicyExecution {
  override observe(): ExecutionObservation { return idle; }
  override async observeAsync(): Promise<ExecutionObservation> { return idle; }
  override async observeStatus(): Promise<ReadonlyMap<string, ExecutionObservation | "no-unit">> { return new Map(); }
  override confirmDead(): boolean { return true; }
}

/** A recovery owner that counts sweeps; `hold` keeps the next one running. */
function countingRecovery() {
  let release: (() => void) | null = null;
  const recovery = {
    sweeps: 0, hold: false,
    release: () => { release?.(); release = null; },
    sweep(): Promise<object> {
      recovery.sweeps++;
      if (!recovery.hold) return Promise.resolve({});
      return new Promise(resolve => { release = () => { resolve({}); }; });
    },
  };
  return recovery;
}

function society(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-av20-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  store.transaction(tx => { tx.insertAgent(makeValidAgent("principal")); tx.insertAgent(makeValidAgent("bob")); });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64, 24, undefined, () => broker.hintWork());
  const units = new ScriptedUnits();
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  const recovery = countingRecovery();
  const broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: recovery as unknown as ReconcileModule, paths: { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: goalPublishedAt(root) } });
  let drained = false;
  const drain = async () => { if (!drained) { drained = true; await broker.drainAndClose(); } };
  t.after(async () => { try { await drain(); } finally { removeTree(root); } });
  return { broker, recovery, drain, mail, store };
}
/** Lets the promise work an interval started run to the end. */
const settle = () => new Promise<void>(resolve => { setImmediate(resolve); });

test("AV20 / REC-002, D03: a foreground broker sweeps once per interval while it admits work, and not after", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = society(t);
  await f.broker.start();
  t.mock.timers.tick(RECONCILE_INTERVAL_MS - 1);
  await settle();
  assert.equal(f.recovery.sweeps, 0, "a sweep ran before its interval");
  t.mock.timers.tick(1);
  await settle();
  assert.equal(f.recovery.sweeps, 1, "no sweep ran at the interval: a retained intent waits for a restart");
  t.mock.timers.tick(RECONCILE_INTERVAL_MS);
  await settle();
  assert.equal(f.recovery.sweeps, 2);
  f.broker.closeAdmission();
  t.mock.timers.tick(3 * RECONCILE_INTERVAL_MS);
  await settle();
  assert.equal(f.recovery.sweeps, 2, "a draining broker kept sweeping");
});

test("AV20 / REC-002: the drain waits for a sweep the interval started, as for any dispatched task", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = society(t);
  await f.broker.start();
  f.recovery.hold = true;
  t.mock.timers.tick(RECONCILE_INTERVAL_MS);
  await settle();
  assert.equal(f.recovery.sweeps, 1);
  let closed = false;
  const closing = f.drain().then(() => { closed = true; });
  await settle();
  assert.equal(closed, false, "the Store closed under a running sweep");
  f.recovery.release();
  await closing;
  assert.equal(closed, true);
});

test("native wake: a burst and in-flight hints retain one active sweep and one fresh pass", async t => {
  const f = society(t);
  await f.broker.start(); f.recovery.hold = true;
  for (let i = 0; i < 1000; i++) f.broker.hintWork();
  await settle(); assert.equal(f.recovery.sweeps, 1);
  for (let i = 0; i < 1000; i++) f.broker.hintWork();
  await settle(); assert.equal(f.recovery.sweeps, 1);
  f.recovery.hold = false; f.recovery.release(); await settle();
  assert.equal(f.recovery.sweeps, 2);
  f.broker.closeAdmission(); f.broker.hintWork(); await settle();
  assert.equal(f.recovery.sweeps, 2);
});

test("native wake: closing admission cancels a hint queued before dispatch", async t => {
  const f = society(t); await f.broker.start();
  f.broker.hintWork(); f.broker.closeAdmission(); await settle();
  assert.equal(f.recovery.sweeps, 0);
});

test("native wake: committed Mail reaches the live Broker and a same-key receipt does not wake again", async t => {
  const f = society(t); await f.broker.start();
  const auth: AuthContext = { actor: "principal", incarnation: 0, role: "principal", channel: "host",
    capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
  const input = { to: ["bob"], subject: "committed wake", kind: "message" as const, body: "original bytes" };
  const first = await f.mail.send(auth, "committed-wake", input);
  assert.equal(first.state, "succeeded"); await settle();
  assert.equal(f.recovery.sweeps, 1);
  const accepted = f.store.getOperation("principal", "committed-wake")!;
  const plan = accepted.planJson;
  assert.deepEqual(await f.mail.send(auth, "committed-wake", input), first); await settle();
  assert.equal(f.recovery.sweeps, 1);
  assert.equal(f.store.getOperation("principal", "committed-wake")!.planJson, plan);
});

test("AV20 / D03, INV04: no external reconcile or broker unit ships -- the in-process sweep and its five-second interval are the only owner", () => {
  for (const name of ["reconcile.service.in", "reconcile.timer.in", "broker.service.in"]) {
    assert.equal(existsSync(fileURLToPath(new URL(`../../packages/platform-linux/dist/systemd/${name}`, import.meta.url))), false,
      `${name} still ships`);
  }
  // INV04: the interval the broker starts is REC-002's five seconds itself,
  // bound where the unit template's interval used to be.
  assert.equal(RECONCILE_INTERVAL_MS, 5_000);
});
