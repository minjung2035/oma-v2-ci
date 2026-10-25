import { generateOperationId } from "@oma/native/identity";
import { lifecycleLedger } from "#oma-test/app/broker/lifecycle-ledger";
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { rmSync } from "node:fs";
import type { AuthContext } from "@oma/contracts";
import { Store } from "@oma/storage";
import { LifecycleActions } from "@oma/lifecycle/actions";
import { LifecyclePolicy } from "@oma/lifecycle/policy";
import { lifecycleReplayFixture } from "./fixtures/lifecycle-replay.js";
import { PUBLIC_METHODS } from "@oma/protocol/methods";

function principal(auth: AuthContext): AuthContext {
  return { ...auth, actor: "principal", incarnation: 0, role: "principal", channel: "host" };
}
test("DR27: a Principal stop survives Worker stop, restart and same-key replay; only an explicit resume releases it", async t => {
  const f = lifecycleReplayFixture(); let closed = false;
  t.after(() => { if (!closed) f.store.close(); rmSync(f.root, { recursive: true, force: true }); });
  const p = principal(f.auth);
  const oldStart = (await f.lifecycle.start(f.auth, "a", "old-start"));
  const stop = (await f.lifecycle.stop(p, "a", "force-stop")); assert.equal(stop.state, "succeeded");
  const original = f.store.operations.getById(stop.operation!)!;
  assert.equal((await f.lifecycle.stop(f.auth, "a", "worker-stop")).state, "succeeded");
  assert.deepEqual((await f.lifecycle.start(f.auth, "a", "old-start")), oldStart, "a past receipt is not a new effect");
  const before = f.units.effects.length;
  (await assert.rejects(async () => (await f.lifecycle.start(f.auth, "a", "new-start")), /force-stopped/));
  assert.equal(f.store.operations.get("manager", "new-start"), null);
  assert.equal(f.units.effects.length, before);
  closed = true; f.store.close();
  const reopened = new Store(join(f.root, "runtime.sqlite"));
  try {
    const actions = new LifecycleActions(lifecycleLedger(reopened), f.units, { stateRoot: f.root,
      society: "replay", hasGoal: () => true, activationAllowed: () => true }, new LifecyclePolicy(lifecycleLedger(reopened), () => null), { nextOperationId: generateOperationId });
    (await assert.rejects(async () => (await actions.start(f.auth, "a", "after-restart")), /force-stopped/));
    assert.equal((await actions.start(p, "a", "explicit-resume")).state, "succeeded");
    assert.equal((await actions.stop(f.auth, "a", "ordinary-stop")).state, "succeeded");
    assert.equal((await actions.start(f.auth, "a", "ordinary-start")).state, "succeeded");
    assert.equal(reopened.operations.getById(original.id)?.planJson, original.planJson);
    assert.equal(reopened.operations.getById(original.id)?.resultJson, original.resultJson);
  } finally { reopened.close(); }
});

for (const action of ["agent.start", "agent.stop"] as const) test(`DR27/P0-0: ${action} replay never gains authority from a later equal desired state`, async t => {
  const f = lifecycleReplayFixture(); t.after(() => f.close()); const p = principal(f.auth);
  const old = f.seedPending(action, "old-intent");
  // Both changes happen before a runner increments incarnation: desired
  // returns to the same value, but it is a different accepted action.
  if (action === "agent.start") {
    (await f.lifecycle.stop(p, "a", "new-stop")); (await f.lifecycle.start(p, "a", "new-start"));
  } else {
    (await f.lifecycle.start(p, "a", "new-start")); (await f.lifecycle.stop(p, "a", "new-stop"));
  }
  const before = f.units.effects.length;
  (await f.lifecycle.reconcileAction(old.id));
  const replay = action === "agent.start" ? (await f.lifecycle.start(f.auth, "a", "old-intent")) : (await f.lifecycle.stop(f.auth, "a", "old-intent"));
  assert.equal(replay.state, "unknown"); assert.equal(f.units.effects.length, before);
  assert.equal(f.store.operations.getById(old.id)?.planJson, old.planJson);
});

test("DR27: an unconfirmed physical stop is still an accepted stop fence", async t => {
  const f = lifecycleReplayFixture(); t.after(() => f.close()); f.units.failEffect = true;
  const stopped = (await f.lifecycle.stop(principal(f.auth), "a", "unconfirmed-stop"));
  assert.equal(stopped.state, "unknown"); f.units.failEffect = false;
  (await assert.rejects(async () => (await f.lifecycle.start(f.auth, "a", "restart")), /force-stopped/));
  assert.equal(f.store.operations.get("manager", "restart"), null);
});

test("DR27: the Principal actor releases its safety stop but cannot orchestrate routine starts", async t => {
  const f = lifecycleReplayFixture(); t.after(() => f.close());
  const p: AuthContext = { ...principal(f.auth), channel: "actor", incarnation: 0 };
  const start = (key: string) => f.dispatcher.dispatch(p,
    { v: 1, id: key, method: "agent.start", request: key, params: { agent: "a" } }, null);
  assert.match(JSON.stringify(await start("routine")), /CAPABILITY_DENIED/);
  assert.equal(f.store.operations.get("principal", "routine"), null);
  assert.deepEqual(f.units.effects, []);
  const stopped = await f.dispatcher.dispatch(p,
    { v: 1, id: "safety", method: "agent.stop", request: "safety", params: { agent: "a" } }, null);
  assert.match(JSON.stringify(stopped), /succeeded/);
  const resumed = await start("release"); assert.match(JSON.stringify(resumed), /succeeded/);
  const before = f.units.effects.length;
  assert.deepEqual(await start("release"), resumed);
  assert.equal(f.units.effects.length, before);
  assert.match(JSON.stringify(await start("another-routine")), /CAPABILITY_DENIED/);
});

test("DR27: broad legacy grants cannot expose Principal routine RPCs; own receipts remain readable", async t => {
  const f = lifecycleReplayFixture(); t.after(() => f.close());
  const p: AuthContext = { ...principal(f.auth), channel: "actor" };
  const calls = {
    "status.get": {}, "logs.read": { agent: "a", sinceSeconds: 60 },
    "mail.ack": { message: "m-00000000-0000-4000-8000-000000000001-0" },
    "route.follow": { topic: "dev" }, "route.unfollow": { topic: "dev" },
    "agent.create": { name: "peer", from: "a".repeat(40), brief: "review" },
    "agent.continue": { note: "routine" }, "agent.wait": {},
    "git.integrate": { candidate: "a".repeat(40), expected: "b".repeat(40) },
    "context.publish": { expected: null, entries: [{ path: "GOAL.md", bytes: 1, sha256: "a".repeat(64) }],
      content: { bytes: 1, sha256: "a".repeat(64), mediaType: "application/vnd.oma.context-v1" } },
  };
  for (const [method, params] of Object.entries(calls)) {
    const keyed = PUBLIC_METHODS[method as keyof typeof PUBLIC_METHODS].key === "required";
    const response = await f.dispatcher.dispatch(p, { v: 1, id: method, method, params,
      ...(keyed ? { request: method } : {}) } as never, null);
    assert.equal((response as { error?: { code: string } }).error?.code, "CAPABILITY_DENIED", method);
  }
  for (const key of Object.keys(calls)) assert.equal(f.store.operations.get("principal", key), null);
  const result = await f.dispatcher.dispatch(p,
    { v: 1, id: "receipt", method: "operation.get", params: { key: "absent" } }, null);
  assert.equal((result as { ok: boolean }).ok, true);
});
