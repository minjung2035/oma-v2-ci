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
import type { UnitObservation } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { Broker } from "@oma/broker";
import { UnitsModule } from "@oma/platform-linux/units";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import type { ReconcileModule } from "@oma/reconcile";
import { RECONCILE_INTERVAL_MS } from "@oma/domain/recovery-policy";
import { parseUnitObservation } from "@oma/platform-linux/units/observe";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { goalPublishedAt } from "./fixtures/goal.js";

const idle = parseUnitObservation({ kind: "succeeded", status: 0, signal: null, stderr: "",
  stdout: `ActiveState=inactive\nSubState=dead\nResult=success\nExecMainStatus=0\nControlGroup=/oma-test\nInvocationID=${"1".repeat(32)}\n` });

/** Unit control is scripted: this suite is about when the broker sweeps, not systemd. */
class ScriptedUnits extends UnitsModule {
  constructor(root: string) { super("demo", { node: process.execPath, libdir: root, state: root, society: "demo", agent: "" }, join(root, "units")); }
  override observe(): UnitObservation { return idle; }
  override async observeAsync(): Promise<UnitObservation> { return idle; }
  override async observeStatus(): Promise<ReadonlyMap<string, UnitObservation | "no-unit">> { return new Map(); }
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
  store.transaction(tx => { tx.insertAgent(makeValidAgent("principal")); });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
  const units = new ScriptedUnits(root);
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  const recovery = countingRecovery();
  const broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: recovery as unknown as ReconcileModule, paths: { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: goalPublishedAt(root) } });
  let drained = false;
  const drain = async () => { if (!drained) { drained = true; await broker.drainAndClose(); } };
  t.after(async () => { try { await drain(); } finally { removeTree(root); } });
  return { broker, recovery, drain };
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

test("AV20 / D03, INV04: no external reconcile or broker unit ships -- the in-process sweep and its five-second interval are the only owner", () => {
  for (const name of ["reconcile.service.in", "reconcile.timer.in", "broker.service.in"]) {
    assert.equal(existsSync(fileURLToPath(new URL(`../../packages/platform-linux/dist/systemd/${name}`, import.meta.url))), false,
      `${name} still ships`);
  }
  // INV04: the interval the broker starts is REC-002's five seconds itself,
  // bound where the unit template's interval used to be.
  assert.equal(RECONCILE_INTERVAL_MS, 5_000);
});
