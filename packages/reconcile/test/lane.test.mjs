import test from "node:test";
import assert from "node:assert/strict";
import { ReconcileLane } from "../dist/lane.js";
import { ReconcileModule } from "../dist/index.js";
import { StoreError } from "@oma/domain/errors";

const settledTurn = () => new Promise(resolve => setImmediate(resolve));

test("001. Late join and shutdown retain a settled recovery observation failure", async () => {
  const workFailure = new Error("recovery failed");
  const observationFailure = new Error("store admission fenced");
  let failures = 0;
  const lane = new ReconcileLane(async () => { throw workFailure; }, error => {
    assert.equal(error, workFailure);
    failures++;
    throw observationFailure;
  });

  lane.request();
  await settledTurn();
  await assert.rejects(lane.join(), error => error === observationFailure);
  await assert.rejects(lane.close(), error => error === observationFailure);
  assert.equal(failures, 1);
});

test("002. A handled recovery failure permits a subsequent successful pass", async () => {
  const failure = new Error("temporary observation failure");
  const completed = [];
  let failures = 0;
  let ready = false;
  const lane = new ReconcileLane(async () => {
    if (!ready) throw failure;
    completed.push("recovered");
  }, error => {
    assert.equal(error, failure);
    failures++;
  });

  lane.request();
  await settledTurn();
  await lane.join();
  ready = true;
  lane.request();
  await lane.join();
  await lane.close();
  assert.equal(failures, 1);
  assert.deepEqual(completed, ["recovered"]);
});

test("003. Requests during an active pass coalesce and shutdown forbids later work", async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let passes = 0;
  const lane = new ReconcileLane(async () => {
    passes++;
    if (passes === 1) await held;
  }, error => { throw error; });

  lane.request();
  await Promise.resolve();
  lane.request();
  lane.request();
  release();
  await lane.join();
  assert.equal(passes, 2);
  await lane.close();
  lane.request();
  await settledTurn();
  assert.equal(passes, 2);
});

test("004. A settled recovery fence does not skip Resident shutdown or hide its failure", async () => {
  const cleanupFailure = new Error("Resident termination remains unknown");
  let quiesced = 0;
  const owner = new ReconcileModule({
    recoverableOperations: () => [], getOperationById: () => null,
    listAgents: () => [], societyOpen: () => true,
  }, {}, {}, {
    advanceAll: async () => { throw new StoreError("STORE_CORRUPT", "observed corrupt accepted evidence"); },
  }, {}, {}, { stateRoot: "/state", hasGoal: () => true, activationAllowed: () => true }, {
    observeStoreFailure: error => { throw error; },
    quiesceResidents: async () => { quiesced++; throw cleanupFailure; },
  });

  owner.pulse();
  await settledTurn();
  await assert.rejects(owner.quiesceForShutdown(), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0].code, "STORE_CORRUPT");
    assert.equal(error.errors[0].message, "observed corrupt accepted evidence");
    assert.equal(error.errors[1], cleanupFailure);
    return true;
  });
  assert.equal(quiesced, 1);
});
