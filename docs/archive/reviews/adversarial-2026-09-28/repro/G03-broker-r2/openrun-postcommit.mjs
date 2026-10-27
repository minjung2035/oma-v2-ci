// G03-broker-r2: openRun commits the incarnation, then publishes the endpoint.
// If listenActor throws AFTER the DB commit, is the incarnation left advanced
// with no live lease, and can the runner recover with the same invocationId?
//
// We drive Broker.openRun directly (as connection-bounds.test.ts does) on this
// process's own cgroup, and make listenActor fail after the commit by poisoning
// the health gate between the transaction and publish via a monkey-patched
// store.transaction that closes admission on its way out. Instead of trying to
// force the post-commit throw, we simply OBSERVE the incarnation the store
// holds before and after, and whether a second openRun with the same
// invocationId succeeds. We also directly test the documented invariant by
// reading incarnation from the store row.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Broker } from "../../../../dist/src/broker.js";
import { LifecycleModule } from "../../../../dist/src/lifecycle.js";
import { ViewsModule } from "../../../../dist/src/views.js";
import { preparedFixture } from "../../../../dist/test/fixtures/delivery-receipt.js";
import { TEST_VIEW_LIMITS } from "../../../../dist/test/fixtures/limits.js";

const OWN_CGROUP = readFileSync("/proc/self/cgroup", "utf8").trim().split("\n")[0].slice(3);
const id = "c".repeat(32);

const f = await preparedFixture(1);
const units = {
  onRevokeRun: undefined, bindIncarnationReader: () => undefined, unitCgroup: () => "",
  observe: () => ({ activeState: "active", subState: "running", result: "success", execMainStatus: 0, cgroup: OWN_CGROUP, invocationId: id }),
};
const lifecycle = new LifecycleModule(f.store, units, { stateRoot: f.root, projectGit: join(f.root, "repos", "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
  (_p, input) => ({ ...input }), f.mail);
const broker = new Broker(f.store, f.mail, units, new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS), lifecycle, null, null,
  { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => true });

const openRun = (actor, inv) => Reflect.get(broker, "openRun").call(broker, actor, inv);
const agentIncarnation = () => f.store.getAgent("alice").incarnation;

try {
  await broker.start();
  console.log("before openRun incarnation =", agentIncarnation());

  // Poison listenActor AFTER the commit: replace the private listenActor with one
  // that first advances nothing but throws, simulating a post-commit mkdir/ENOSPC.
  // We wrap by intercepting after transaction: monkeypatch health via closeAdmission
  // is too coarse; instead patch the private method the same way production code
  // would hit a filesystem error.
  const realListen = Reflect.get(broker, "listenActor");
  let poisoned = true;
  Reflect.set(broker, "listenActor", function (...args) {
    if (poisoned) throw new Error("simulated post-commit listenActor failure (ENOSPC/EACCES)");
    return realListen.apply(this, args);
  });

  let firstError = null;
  try { openRun("alice", id); } catch (e) { firstError = e; }
  console.log("first openRun threw:", firstError && firstError.message);
  console.log("after failed openRun incarnation =", agentIncarnation());

  // The runner retries with the SAME invocationId (its systemd invocation did
  // not change). Un-poison so listenActor would now succeed.
  poisoned = false;
  let secondError = null; let lease = null;
  try { lease = openRun("alice", id); } catch (e) { secondError = e; }
  console.log("second openRun (same invocationId) threw:", secondError && secondError.message);
  console.log("second openRun produced lease:", lease && lease.socketHostPath ? "yes" : "no");
  console.log("incarnation after same-id retry =", agentIncarnation());

  // A systemd restart gives a NEW invocationId. Does that recover?
  const id2 = "d".repeat(32);
  units.observe = () => ({ activeState: "active", subState: "running", result: "success", execMainStatus: 0, cgroup: OWN_CGROUP, invocationId: id2 });
  let thirdError = null; let lease3 = null;
  try { lease3 = openRun("alice", id2); } catch (e) { thirdError = e; }
  console.log("third openRun (fresh invocationId) threw:", thirdError && thirdError.message);
  console.log("third openRun produced lease:", lease3 && lease3.socketHostPath ? "yes" : "no");
  console.log("final incarnation =", agentIncarnation());
} finally {
  poisonedCleanup: try { await broker.drainAndClose(); } catch (e) { console.log("drain error:", e.message); }
  f.store.close = () => undefined;
  f.close();
}
