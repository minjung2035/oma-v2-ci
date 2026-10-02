/** DR27/P0-7: only this fixture's child is killed. Units are local fakes; no
 * manager service, user OMA, provider or VM participates in these boundaries. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { SocietyControl } from "../src/lifecycle/society.js";
import type { UnitsModule } from "../src/units.js";
import type { AuthContext } from "../implementation/contracts.js";
import { ALL_CAPS } from "./fixtures/spec.js";

for (const state of ["open", "closed"] as const) {
  for (const point of ["accepted", "settled", "unknown", "superseded"] as const) {
    test(`DR27/P0-7: society ${state} SIGKILL after ${point} preserves its fence and same-key history`, t => {
      const root = mkdtempSync(join(tmpdir(), "oma-society-crash-"));
      let opened: Store | undefined;
      t.after(() => { opened?.close(); rmSync(root, { recursive: true, force: true }); });
      const path = join(root, "runtime.sqlite");
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
        import { DatabaseSync } from "node:sqlite";
        import { Store } from ${JSON.stringify(new URL("../src/store.js", import.meta.url).href)};
        import { SocietyControl } from ${JSON.stringify(new URL("../src/lifecycle/society.js", import.meta.url).href)};
        import { makeValidAgent, ALL_CAPS } from ${JSON.stringify(new URL("./fixtures/spec.js", import.meta.url).href)};
        const store = new Store(${JSON.stringify(path)}, 0, { society: "demo" });
        store.transaction(tx => {
          tx.insertAgent(makeValidAgent("principal"));
          tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" }));
          tx.insertAgent(makeValidAgent("bob", { createdBy: "alice", desired: "stopped", incarnation: 4 }));
        });
        let dead = true;
        const units = { stop() {}, confirmDead() { return dead; } };
        const control = new SocietyControl(store, units);
        const auth = { actor: "principal", role: "principal", incarnation: 0, channel: "actor",
          capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid(), gid: process.getgid(), cgroup: null } };
        control.set(auth, "closed", "initial-close");
        const point = ${JSON.stringify(point)}, state = ${JSON.stringify(state)};
        let prior;
        if (point === "superseded") {
          dead = false; prior = control.set(auth, state, "target");
          dead = true; control.set(auth, "open", "successor");
        }
        dead = point !== "unknown";
        const exec = DatabaseSync.prototype.exec;
        let commits = 0;
        DatabaseSync.prototype.exec = function(sql) {
          const result = exec.call(this, sql);
          if (sql === "COMMIT" && ++commits === (point === "accepted" || point === "superseded" ? 1 : 2))
            process.kill(process.pid, "SIGKILL");
          return result;
        };
        if (point === "superseded") control.reconcileById(prior.operation);
        else control.set(auth, state, "target");
        throw new Error("boundary not reached");
      `], { encoding: "utf8", timeout: 10_000 });
      assert.equal(child.error, undefined);
      assert.equal(child.signal, "SIGKILL", child.stderr);
      const store = new Store(path, 0, { society: "demo" });
      opened = store;
      const original = store.getOperation("principal", "target")!;
      assert.ok(original);
      assert.equal(original.state, point === "accepted" ? "pending" : point === "settled" ? "succeeded" : "unknown");
      assert.equal(store.societyOpen(), point === "superseded" || (point === "settled" && state === "open"));
      const before = store.listAgents();
      const stopped: string[] = [];
      const control = new SocietyControl(store, { stop(agent: string) {
        assert.equal(store.societyOpen(), false); stopped.push(agent);
      }, confirmDead() { return true; } } as unknown as UnitsModule);
      const auth: AuthContext = { actor: "principal", role: "principal", incarnation: 0, channel: "actor",
        capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
      const receipt = control.set(auth, state, "target");
      assert.equal(receipt.operation, original.id);
      assert.equal(receipt.state, point === "superseded" ? "unknown" : "succeeded");
      assert.equal(store.societyOpen(), point === "superseded" || state === "open");
      assert.deepEqual(stopped, point === "settled" || point === "superseded" ? [] : ["alice", "bob"]);
      const count = stopped.length;
      assert.deepEqual(control.set(auth, state, "target"), receipt);
      assert.equal(stopped.length, count, "same key cannot repeat physical effects after settlement or supersession");
      assert.deepEqual(store.listAgents(), before, "society control never rewrites individual intent or incarnation");
      const current = store.getOperation("principal", "target")!;
      for (const key of ["id", "requestHash", "payloadJson", "planJson", "createdAtMs"] as const)
        assert.equal(current[key], original[key], key);
    });
  }
}
