import test from "node:test";
import assert from "node:assert/strict";
import { lifecycleReplayFixture, type ActionKind } from "./fixtures/lifecycle-replay.js";
import { Seeded, PRNG_REVISION, integerParameter, minimizeSequence, replayMetadata, recordExplorationFailure } from "./model/reproducible.js";

interface Scenario {
  kind: ActionKind;
  later: "unchanged" | "opposite-intent" | "new-epoch" | "new-enabled-epoch";
  entry: "normal" | "recovery";
}
const corpus: readonly Scenario[] = [
  { kind: "agent.start", later: "opposite-intent", entry: "normal" },
  { kind: "agent.stop", later: "new-enabled-epoch", entry: "normal" },
  { kind: "agent.stop", later: "new-epoch", entry: "recovery" },
  { kind: "agent.start", later: "unchanged", entry: "recovery" },
  { kind: "agent.stop", later: "unchanged", entry: "normal" },
];
function generate(seed: number, count: number): Scenario[] {
  const random = new Seeded(seed);
  const changes = ["unchanged", "opposite-intent", "new-epoch", "new-enabled-epoch"] as const;
  return Array.from({ length: count }, () => ({
    kind: random.index(2) === 0 ? "agent.start" : "agent.stop",
    later: changes[random.index(changes.length)]!,
    entry: random.index(2) === 0 ? "normal" : "recovery",
  }));
}
/** An independent expected trace, not an invocation of the production fence.
 * Every start/stop below uses public dispatch -> LifecycleModule -> actions.
 * Only the external runner's issuance of a new incarnation is represented by
 * an explicit Store event. This is not kernel/cgroup or SIGKILL certification.
 */
async function replay(sequence: readonly Scenario[]): Promise<void> {
  for (const scenario of sequence) {
    const f = lifecycleReplayFixture();
    try {
      f.units.failEffect = true;
      await f.dispatch(scenario.kind, "original");
      const accepted = f.store.getOperation("manager", "original");
      assert.ok(accepted, "LIFECYCLE_REPLAY_ACCEPTANCE");
      assert.equal(accepted.state, "unknown", "LIFECYCLE_REPLAY_UNCERTAIN_EFFECT");
      assert.equal(f.units.effects.length, 1, "LIFECYCLE_REPLAY_PHYSICAL_BOUNDARY_REACHED");
      const planBytes = accepted.planJson;
      f.units.failEffect = false;
      let expectedDesired = scenario.kind === "agent.start" ? "enabled" : "stopped";
      let expectedEpoch = 1;
      if (scenario.later === "opposite-intent") {
        const opposite = scenario.kind === "agent.start" ? "agent.stop" : "agent.start";
        await f.dispatch(opposite, "new-intent");
        assert.equal(f.store.getOperation("manager", "new-intent")?.state, "succeeded", "LIFECYCLE_REPLAY_NEW_INTENT");
        expectedDesired = opposite === "agent.start" ? "enabled" : "stopped";
      } else if (scenario.later === "new-epoch" || scenario.later === "new-enabled-epoch") {
        await f.dispatch("agent.start", "new-run-start");
        assert.equal(f.store.getOperation("manager", "new-run-start")?.state, "succeeded");
        // Explicit external event, never the implementation of start/stop itself.
        f.store.transaction(tx => tx.updateAgent({ name: "a", incarnation: 2 }));
        expectedEpoch = 2;
        expectedDesired = "enabled";
        if (scenario.later === "new-epoch" && scenario.kind === "agent.stop") {
          await f.dispatch("agent.stop", "new-run-stop");
          assert.equal(f.store.getOperation("manager", "new-run-stop")?.state, "succeeded");
          expectedDesired = "stopped";
        }
        if (scenario.later === "new-enabled-epoch") assert.equal(f.units.active, true, "C02 latest run must remain alive");
      }
      assert.equal(f.store.getAgent("a")?.desired, expectedDesired);
      assert.equal(f.store.getAgent("a")?.incarnation, expectedEpoch);
      const before = f.units.effects.length;
      const targetBefore = f.store.getAgent("a");
      const physicalBefore = f.units.active;
      if (scenario.entry === "normal") await f.dispatch(scenario.kind, "original");
      else f.lifecycle.reconcileAction(accepted.id);
      const after = f.store.getOperationById(accepted.id)!;
      assert.equal(after.planJson, planBytes, "LIFECYCLE_REPLAY_FROZEN_PLAN");
      assert.equal(after.requestHash, accepted.requestHash);
      assert.deepEqual(f.store.getAgent("a"), targetBefore, "LIFECYCLE_REPLAY_NO_DESIRED_REWRITE");
      if (scenario.later === "unchanged") {
        assert.equal(after.state, "succeeded", "LIFECYCLE_REPLAY_CONTROL_SETTLED");
        assert.equal(f.units.effects.length, before + 1, "LIFECYCLE_REPLAY_CONTROL_EFFECT");
        if (scenario.kind === "agent.stop") assert.equal(f.units.effects.at(-1)?.incarnation, 1);
        const terminalBytes = after.resultJson;
        await f.dispatch(scenario.kind, "original");
        f.lifecycle.reconcileAction(accepted.id);
        assert.equal(f.units.effects.length, before + 1, "LIFECYCLE_REPLAY_TERMINAL_NO_EFFECT");
        assert.equal(f.store.getOperationById(accepted.id)?.resultJson, terminalBytes);
      } else {
        assert.equal(after.state, "unknown", "LIFECYCLE_REPLAY_SUPERSEDED_UNCONFIRMED");
        assert.equal(f.units.effects.length, before, "LIFECYCLE_REPLAY_SUPERSEDED_NO_EFFECT");
        assert.equal(f.units.active, physicalBefore, "LIFECYCLE_REPLAY_NEW_RUN_UNTOUCHED");
      }
    } finally { f.close(); }
  }
}
for (const [index, scenario] of corpus.entries())
  test(`R36 lifecycle replay C01/C02 corpus ${index}`, () => replay([scenario]));
const count = integerParameter("OMA_TEST_ACTIONS", 32, 10000);
const selectedSeed = integerParameter("OMA_TEST_SEED", 0x2536cafe, 0xffffffff);
for (const seed of [selectedSeed, 0, 1, 0xffffffff]) {
  test(`R36 lifecycle replay seed=${seed} actions=${count} prng=${PRNG_REVISION}`, { timeout: 300000 }, async t => {
    const sequence = generate(seed, count);
    assert.deepEqual(generate(seed, count), sequence);
    try { await replay(sequence); }
    catch (original) {
      const signature = original instanceof Error ? original.message.split("\n")[0] : String(original);
      const reduced = await minimizeSequence(sequence, async candidate => {
        try { await replay(candidate); return false; }
        catch (error) { return (error instanceof Error ? error.message.split("\n")[0] : String(error)) === signature; }
      }, 32);
      t.diagnostic(`replay artifact: ${recordExplorationFailure("model", {
        ...replayMetadata(seed, { actions: count, driver: "actual-lifecycle-public-dispatch", scenarioRevision: "v2" }), sequence, reduced, signature,
      })}`);
      throw original;
    }
  });
}
