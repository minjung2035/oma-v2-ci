/** Execution slot ownership for the modules that must tell live contention
 * from unproven death: a live peer is retryable busy, a retained owner after a
 * failed cleanup keeps the unknown reading. */
import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionCoordinator } from "../dist/owned-execution.js";

function fakeJournal() {
  const entries = [];
  let counter = 0;
  return {
    entries: () => entries.map(entry => ({ ...entry })),
    reserve(slot) {
      const row = { slot, execution: `execution-${++counter}`, witness: null };
      entries.push(row);
      return { execution: row.execution,
        publish: witness => { row.witness = witness; },
        retire: () => { const at = entries.indexOf(row); if (at >= 0) entries.splice(at, 1); } };
    },
    retire: (slot, execution) => {
      const at = entries.findIndex(entry => entry.slot === slot && entry.execution === execution);
      if (at >= 0) entries.splice(at, 1);
    },
  };
}
/** A controlled execution scope: the test decides when it is observable. The
 * result promise stays pending; these tests own termination explicitly. */
function blockedExecution(state) {
  let settleClosed;
  const closed = new Promise(resolve => { settleClosed = resolve; });
  let released = 0, terminated = 0, closes = 0;
  return { witness: { pid: 4242 }, result: new Promise(() => {}), closed,
    population: () => state.population,
    release: () => { released++; },
    terminate: () => { terminated++; if (state.population === "populated") state.population = "empty"; settleClosed(); },
    close: () => { closes++; },
    observations: () => ({ released, terminated, closed: closes }),
  };
}
const begin = (owner, slot, state) => owner.begin({ slot, launch: async () => blockedExecution(state), authorize: () => {} });

test("001. Slot state separates an idle slot, the recovery fence and a live owner", async () => {
  const journal = fakeJournal();
  const owner = new ExecutionCoordinator(journal, () => ({ kind: "unavailable" }));
  assert.equal(owner.slotState("quarantine"), "dead");
  assert.equal(owner.confirmDead("quarantine"), true);
  const fence = journal.reserve("quarantine");
  assert.equal(owner.slotState("quarantine"), "unknown");
  assert.equal(owner.confirmDead("quarantine"), false);
  fence.retire();
  assert.equal(owner.slotState("quarantine"), "dead");

  const winner = blockedExecution({ population: "populated" });
  const first = await owner.begin({ slot: "quarantine", launch: async () => winner, authorize: () => {} });
  assert.equal(owner.slotState("quarantine"), "busy");
  assert.equal(owner.confirmDead("quarantine"), false);
  const lost = await begin(owner, "quarantine", { population: "populated" }).then(() => null, error => error);
  assert.equal(lost?.code, "BROKER_UNAVAILABLE");
  assert.equal(lost?.details?.reason, "busy");
  assert.deepEqual(winner.observations(), { released: 1, terminated: 0, closed: 0 }, "the busy refusal must not disturb the live winner");
  assert.deepEqual(journal.entries().map(entry => entry.slot), ["quarantine"]);

  await first.stop();
  assert.equal(owner.slotState("quarantine"), "dead");
  assert.deepEqual(journal.entries(), []);

  const next = await begin(owner, "quarantine", { population: "populated" });
  assert.equal(owner.slotState("quarantine"), "busy");
  await next.stop();
  assert.equal(owner.confirmDead("quarantine"), true);
});

test("002. An unproven cleanup retains the unknown reading instead of busy", async () => {
  const journal = fakeJournal();
  const owner = new ExecutionCoordinator(journal, () => ({ kind: "unavailable" }));
  const state = { population: "populated" };
  const first = await begin(owner, "quarantine", state);
  state.population = "unknown";
  await assert.rejects(first.stop(), { code: "RUN_TERMINATION_UNKNOWN" });
  assert.equal(owner.slotState("quarantine"), "unknown");
  assert.equal(owner.confirmDead("quarantine"), false);
  const lost = await begin(owner, "quarantine", { population: "populated" }).then(() => null, error => error);
  assert.equal(lost?.code, "RUN_TERMINATION_UNKNOWN");
  assert.notEqual(lost?.details?.reason, "busy");
});

test("003. A drained coordinator reports every slot dead", async () => {
  const journal = fakeJournal();
  const owner = new ExecutionCoordinator(journal, () => ({ kind: "unavailable" }));
  await owner.drain();
  assert.equal(owner.slotState("quarantine"), "dead");
  journal.reserve("quarantine");
  assert.equal(owner.slotState("quarantine"), "dead");
});
