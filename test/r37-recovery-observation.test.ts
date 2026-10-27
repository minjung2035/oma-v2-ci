import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionObservation } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { PolicyExecution } from "./fixtures/execution.js";
import { LifecycleModule } from "@oma/lifecycle";
import { ReconcileModule } from "@oma/reconcile";
import { makeValidAgent, makeValidResolvedSpec, ALL_CAPS } from "./fixtures/spec.js";
import { gitAuth } from "./fixtures/git-crash.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
const idle: ExecutionObservation = { activeState: "inactive", subState: "dead", result: "success",
  execMainStatus: 0, scope: "", invocationId: "" };
const unknown: ExecutionObservation = { ...idle, activeState: "unknown", result: "unknown", execMainStatus: -1 };

// A scripted policy port checks ordering only. Actual native death and
// isolation are tested with the production backend in native-*.test.mjs.
class ObservedUnits extends PolicyExecution {
  readonly entered = deferred(); readonly release = deferred();
  starts = 0; stops = 0; result: ExecutionObservation = idle;
  deathConfirmed = false;
  constructor(_root: string) { super(); }
  override async observeAsync(): Promise<ExecutionObservation> { this.entered.resolve(); await this.release.promise; return this.result; }
  override observe(): ExecutionObservation { return this.result; }
  override confirmDead(): boolean { return this.deathConfirmed; }
  override start(_actor: string, _repair: boolean, authorize?: () => void): void { authorize?.(); this.starts++; }
  override stop(): ExecutionObservation { this.stops++; return idle; }
}

for (const change of ["none", "stop", "incarnation", "shutdown", "unknown", "death-unknown"] as const) {
  test(`R37: delayed recovery observation rechecks ${change}`, { timeout: 10000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-r37-recovery-"));
    const store = new Store(join(root, "runtime.sqlite"));
    const units = new ObservedUnits(root);
    units.deathConfirmed = change === "none";
    let activation = true; let sweep: Promise<unknown> | undefined;
    try {
      store.transaction(tx => {
        tx.insertAgent(makeValidAgent("principal"));
        tx.insertAgent(makeValidAgent("a", { createdBy: "principal" }));
      });
      const mail = createMailModule({ stateRoot: root, society: "crash" }, store, 64);
      const pending = await mail.send({ ...gitAuth, capabilities: new Set(ALL_CAPS) }, "pending-work", { to: ["a"], subject: "work", kind: "message", body: "work" });
      assert.equal(pending.state, "succeeded");
      const paths = { stateRoot: root, projectGit: join(root, "unused.git"), society: "crash", hasGoal: () => true, activationAllowed: () => true };
      const lifecycle = createLifecycleModule(store, units, paths,
        (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
      const reconcile = createReconcileModule(store, mail, null, null, units, lifecycle,
        { projectGit: paths.projectGit, hasGoal: () => true, activationAllowed: () => activation });
      assert.equal(idle.activeState, "inactive", "normal observation fixture must decode");
      sweep = reconcile.sweep();
      await Promise.race([units.entered.promise, sweep.then(() => { throw new Error("sweep returned before the controlled observation"); })]);
      assert.equal(units.starts, 0);
      if (change === "stop") store.transaction(tx => tx.updateAgent({ name: "a", desired: "stopped" }));
      if (change === "incarnation") store.transaction(tx => tx.updateAgent({ name: "a", incarnation: 2 }));
      if (change === "shutdown") activation = false;
      if (change === "unknown") units.result = unknown;
      units.release.resolve(); await sweep;
      assert.equal(units.starts, change === "none" ? 1 : 0);
      assert.equal(units.stops, change === "stop" ? 1 : 0);
      const diagnostic = reconcile.unitDiagnostics.find(value => value.agent === "a");
      assert.ok(diagnostic);
      if (change === "incarnation" || change === "unknown" || change === "death-unknown") assert.equal(diagnostic.outcome, "unknown");
      if (change === "death-unknown") assert.equal(diagnostic.reason, "RUN_TERMINATION_UNKNOWN");
    } finally { units.release.resolve(); await sweep?.catch(() => undefined); store.close(); rmSync(root, { recursive: true, force: true }); }
  });
}
