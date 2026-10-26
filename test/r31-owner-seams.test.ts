import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
// R31: real facade composition and existing fault hooks must reach the moved owners.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule, expandAddresses } from "@oma/mail";
import { expandAddresses as routingOwner } from "@oma/mail/routing";
import { Broker } from "@oma/broker";
import { PolicyExecution } from "./fixtures/execution.js";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { sendWithStop, StopSignal } from "./fixtures/mail-faults.js";
import { goalPublishedAt } from "./fixtures/goal.js";

const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: 1000, gid: 1000 } };

test("R31 public facade delegates status and mutation with the original authority and receipt semantics", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-r31-composition-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  t.after(() => { try { store.close(); } finally { rmSync(root, { recursive: true, force: true }); } });
  store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
  const units = new PolicyExecution();
  // WP23: status observes through the batched, asynchronous unit read.
  t.mock.method(units, "observeStatus", async (agents: readonly string[]) =>
    new Map(agents.map(agent => [agent, { activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, scope: "", invocationId: "" }])));
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => false, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  const broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: goalPublishedAt(root) } });
  const before = Date.now();
  const status = await broker.dispatch(auth, { v: 1, id: "status", method: "status.get", params: { agent: "alice" } }, null);
  assert.ok("ok" in status && status.ok === true && "result" in status);
  assert.ok(status.result !== null && typeof status.result === "object" && "agents" in status.result && "observedAtMs" in status.result);
  assert.ok(typeof status.result.observedAtMs === "number" && status.result.observedAtMs >= before);
  assert.deepEqual(status.result.agents, [{ agent: "alice", desired: "enabled", activeState: "inactive", subState: "dead", unitResult: "success",
    execMainStatus: 0, pending: 0, preparedBatches: 0, reason: null, runnerObservedAtMs: null }]);
  const request = { v: 1, id: "follow", method: "route.follow", request: "r31-follow", params: { topic: "dev" } } as const;
  const first = await broker.dispatch(auth, request, null);
  assert.ok("ok" in first && first.ok === true);
  assert.deepEqual(await broker.dispatch(auth, request, null), first, "facade movement preserves terminal replay");
  const stored = store.getOperation("alice", "r31-follow")!;
  assert.equal(stored.state, "succeeded");
  assert.deepEqual(store.subscribers("dev"), ["alice"]);
  const unauthorized = await broker.dispatch({ ...auth, capabilities: new Set() }, request, null);
  assert.ok("ok" in unauthorized && unauthorized.ok === false, "replay does not bypass dispatch authority");
  assert.equal(store.getOperation("alice", "r31-follow")!.resultJson, stored.resultJson);
  assert.equal(expandAddresses, routingOwner, "the compatibility facade reexports one owner, not a second definition");
});

test("R31 acceptance fault hook still intercepts the physical Store transaction after SQL owner movement", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-r31-fault-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  t.after(() => { try { store.close(); } finally { rmSync(root, { recursive: true, force: true }); } });
  store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
  await assert.rejects(sendWithStop(mail, store, auth, "r31-mail", { to: ["alice"], subject: "fault", kind: "message", body: "frozen" }, "accepted"),
    error => error instanceof StopSignal && error.point === "accepted");
  const accepted = store.getOperation("alice", "r31-mail")!;
  assert.equal(accepted.state, "pending");
  assert.equal(store.deliveriesForOperation(accepted.id).length, 1);
  await mail.reconcilePending();
  const recovered = store.getOperation("alice", "r31-mail")!;
  assert.equal(recovered.id, accepted.id); assert.equal(recovered.planJson, accepted.planJson);
  assert.equal(recovered.state, "succeeded");
  assert.throws(() => store.setOperationUnknown(recovered.id), { code: "INTERNAL_ERROR" }, "moved SQL still requires the live root capability");
});
