import test from "node:test";
import assert from "node:assert/strict";
import { lifecycleReplayFixture } from "./fixtures/lifecycle-replay.js";
import { makeValidAgent } from "./fixtures/spec.js";

for (const kind of ["agent.start", "agent.stop"] as const) {
  for (const state of ["pending", "unknown"] as const) {
    for (const entry of ["normal", "recovery"] as const) {
      for (const changed of ["desired", "incarnation", "desired-and-incarnation"] as const) {
        test(`R25 C01/C02 ${kind} ${state} ${entry}: superseded ${changed} never authorizes a new physical effect`, async () => {
          const f = lifecycleReplayFixture();
          try {
            const prior = f.seedPending(kind, "old-action", state);
            const desired = kind === "agent.start" ? "stopped" : "enabled";
            f.store.transaction(tx => tx.updateAgent(changed === "desired" ? { name: "a", desired }
              : changed === "incarnation" ? { name: "a", incarnation: 2 }
              : { name: "a", desired, incarnation: 2 }));
            const target = f.store.getAgent("a");
            // Exact C02 report witness: old stop epoch 1, current enabled run
            // epoch 2. Controlled physical liveness must remain unchanged.
            f.units.active = kind === "agent.stop" && target?.desired === "enabled";
            const physicalBefore = f.units.active;
            if (entry === "normal") await f.dispatch(kind, "old-action");
            else f.lifecycle.reconcileAction(prior.id);
            assert.deepEqual(f.units.effects, []);
            assert.equal(f.units.active, physicalBefore);
            assert.deepEqual(f.store.getAgent("a"), target, "replay cannot repair desired or overwrite the new epoch");
            const after = f.store.getOperationById(prior.id)!;
            assert.equal(after.planJson, prior.planJson);
            assert.equal(after.payloadJson, prior.payloadJson);
            assert.equal(after.requestHash, prior.requestHash);
            assert.equal(after.state, "unknown", "absence of historical proof is not terminal success or failure");
          } finally { f.close(); }
        });
      }
    }
  }
  for (const entry of ["normal", "recovery"] as const) {
    test(`R25 ${kind} ${entry}: unchanged accepted intent completes with its frozen epoch`, async () => {
      const f = lifecycleReplayFixture();
      try {
        const prior = f.seedPending(kind, "same-intent");
        if (entry === "normal") await f.dispatch(kind, "same-intent");
        else f.lifecycle.reconcileAction(prior.id);
        assert.equal(f.store.getOperationById(prior.id)?.state, "succeeded");
        assert.equal(f.store.getOperationById(prior.id)?.planJson, prior.planJson);
        assert.deepEqual(f.units.effects, [kind === "agent.start" ? { kind: "start", agent: "a" } : { kind: "stop", agent: "a", incarnation: 1 }]);
        const terminal = f.store.getOperationById(prior.id)!;
        await f.dispatch(kind, "same-intent");
        f.lifecycle.reconcileAction(prior.id);
        assert.equal(f.units.effects.length, 1);
        assert.equal(f.store.getOperationById(prior.id)?.resultJson, terminal.resultJson);
      } finally { f.close(); }
    });
  }
  test(`R25 ${kind}: stale caller and revoked manager cannot replay an accepted action`, async () => {
    const f = lifecycleReplayFixture();
    try {
      const prior = f.seedPending(kind, "unauthorized");
      f.store.transaction(tx => tx.updateAgent({ name: "manager", incarnation: 2 }));
      const stale = await f.dispatch(kind, "unauthorized");
      assert.match(JSON.stringify(stale), /STALE_RUN/);
      assert.deepEqual(f.units.effects, []);
      f.capabilities.clear();
      const revoked = await f.dispatcher.dispatch({ ...f.auth, incarnation: 2 },
        { v: 1, id: "revoked", method: kind, request: "unauthorized", params: { agent: "a" } }, null);
      assert.match(JSON.stringify(revoked), /CAPABILITY_DENIED/);
      assert.deepEqual(f.units.effects, []);
      assert.equal(f.store.getOperationById(prior.id)?.planJson, prior.planJson);
    } finally { f.close(); }
  });
}

test("AV-20261003-27/R25: a same-key terminal receipt replays over a GOAL withdrawn since acceptance", async () => {
  const f = lifecycleReplayFixture();
  try {
    const accepted = await f.dispatch("agent.start", "terminal-goal");
    assert.match(JSON.stringify(accepted), /"state":"succeeded"/);
    f.controls.hasGoal = false;
    const replay = await f.dispatch("agent.start", "terminal-goal");
    assert.match(JSON.stringify(replay), /"state":"succeeded"/,
      "the recorded terminal receipt wins over the current environment; it is not re-judged");
    assert.deepEqual(f.units.effects, [{ kind: "start", agent: "a" }], "a replay runs no new effect");
    // A fresh key under the same absent GOAL is still refused: the gate keeps
    // its place over every new effect.
    assert.match(JSON.stringify(await f.dispatch("agent.start", "new-goal")), /GOAL_REQUIRED/);
    assert.equal(f.store.getOperation("manager", "new-goal"), null);
  } finally { f.close(); }
});

for (const kind of ["agent.start", "agent.stop"] as const) {
  test(`AV-20261003-27/P0 ${kind}: a terminal same-key receipt replays over a retired target`, async () => {
    const f = lifecycleReplayFixture();
    try {
      const accepted = await f.dispatch(kind, `terminal-${kind}`);
      assert.match(JSON.stringify(accepted), /"state":"succeeded"/);
      const operation = (accepted as { result: { operation: string } }).result.operation;
      // enabled->retired and stopped->retired are both legal desired moves
      // (store validDesiredTransition); the target's new state must not
      // re-judge what was durably accepted under this key.
      f.store.transaction(tx => tx.updateAgent({ name: "a", desired: "retired" }));
      const replay = await f.dispatch(kind, `terminal-${kind}`);
      assert.equal((replay as { result: { operation: string; state: string } }).result.operation, operation);
      assert.equal((replay as { result: { state: string } }).result.state, "succeeded",
        "the recorded terminal receipt wins over the retired target state; it is not re-judged");
      assert.equal(f.units.effects.length, 1, "a replay runs no new physical effect");
      // A fresh key on the same retired target is still refused by the fence.
      const fresh = await f.dispatch(kind, `fresh-${kind}`);
      assert.match(JSON.stringify(fresh), /AGENT_RETIRED/);
      assert.equal(f.store.getOperation("manager", `fresh-${kind}`), null, "a refused fresh request leaves no row");
      assert.equal(f.units.effects.length, 1);
      // D06: current management authority still precedes the replay -- a grant
      // revoked after acceptance does not read the terminal receipt back.
      f.capabilities.clear();
      const revoked = await f.dispatch(kind, `terminal-${kind}`);
      assert.match(JSON.stringify(revoked), /CAPABILITY_DENIED/);
      assert.equal(f.units.effects.length, 1);
    } finally { f.close(); }
  });
  test(`AV-20261003-27/P0 ${kind}: an unresolved same-key retry over a retired target reports unknown, not a refusal`, async () => {
    const f = lifecycleReplayFixture();
    try {
      const prior = f.seedPending(kind, `unresolved-${kind}`, "pending");
      f.store.transaction(tx => tx.updateAgent({ name: "a", desired: "retired" }));
      const replay = await f.dispatch(kind, `unresolved-${kind}`);
      assert.match(JSON.stringify(replay), /"state":"unknown"/,
        "an accepted intent superseded by retirement is reported, never reinterpreted as a new refusal");
      assert.equal(f.store.getOperationById(prior.id)?.state, "unknown");
      assert.equal(f.store.getOperationById(prior.id)?.planJson, prior.planJson);
      assert.deepEqual(f.units.effects, [], "retirement never authorizes the old intent a new effect");
    } finally { f.close(); }
  });
}

test("R25: no GOAL, provisioning, retired and unknown death retain their own rejection boundaries", async () => {
  const f = lifecycleReplayFixture();
  try {
    f.controls.hasGoal = false;
    assert.match(JSON.stringify(await f.dispatch("agent.start", "no-goal")), /GOAL_REQUIRED/);
    assert.equal(f.store.getOperation("manager", "no-goal"), null);
    f.controls.hasGoal = true;
    f.store.transaction(tx => {
      tx.insertAgent(makeValidAgent("notready", { desired: "provisioning", incarnation: 0, createdBy: "manager" }));
      tx.insertAgent(makeValidAgent("retired", { desired: "retired", createdBy: "manager" }));
    });
    assert.throws(() => f.lifecycle.start(f.auth, "notready", "provisioning"), { code: "AGENT_NOT_READY" });
    assert.throws(() => f.lifecycle.stop(f.auth, "retired", "retired"), { code: "AGENT_RETIRED" });
    f.units.deathKnown = false;
    assert.match(JSON.stringify(await f.dispatch("agent.start", "unknown-death")), /RUN_TERMINATION_UNKNOWN/);
    assert.equal(f.store.getOperation("manager", "unknown-death"), null);
    assert.deepEqual(f.units.effects, []);
  } finally { f.close(); }
});
