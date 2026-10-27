import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AuthContext } from "@oma/contracts";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { MailModule } from "@oma/mail";
import { assertCurrentActor } from "@oma/domain/authority";
import { makeValidAgent, ALL_CAPS } from "./fixtures/spec.js";
import { sendWithStop, StopSignal } from "./fixtures/mail-faults.js";
import { assertGlobalInvariants, type LedgerSnapshot } from "./invariants/index.js";
import { advance, initialModel, generateActions, MODEL_CORPUS, type Action, type Expected } from "./model/ledger-model.js";
import { Seeded, PRNG_REVISION, integerParameter, minimizeSequence, replayMetadata, recordExplorationFailure } from "./model/reproducible.js";

const limits = { frameBytes: 256 * 1024, batchMaxMessages: 24 };
const key = (slot: number) => `r36-${slot}`;

async function replay(sequence: readonly Action[]): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "oma-r36-model-"));
  const databasePath = join(root, "runtime.sqlite");
  let store = new Store(databasePath, 5, { society: "demo" });
  let mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64, limits.batchMaxMessages, limits);
  let revoked = false;
  store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); });
  const model = initialModel();
  let previous: LedgerSnapshot | undefined;
  const auth = (): AuthContext => ({ actor: "alice", incarnation: store.getAgent("alice")!.incarnation, role: "resident", channel: "actor",
    get capabilities() { return new Set(revoked ? [] : ALL_CAPS); }, peer: { pid: process.pid, uid: 1000, gid: 1000 } });
  // This harness exercises current writer admission plus actual ledger/file phases.
  // Direct desired/incarnation writes below model state, NOT successful systemd execution.
  async function execute(action: Action): Promise<Expected> {
    try {
      switch (action.kind) {
        case "stop": store.transaction(tx => { tx.updateAgent({ name: "alice", desired: "stopped" }); }); revoked = true; break;
        case "start": {
          const incarnation = store.getAgent("alice")!.incarnation + 1;
          store.transaction(tx => { tx.updateAgent({ name: "alice", desired: "enabled", incarnation }); });
          revoked = false; break;
        }
        case "revoke": revoked = true; break;
        case "restart":
          // DB connection restart; primitive SIGKILL remains in the existing crash lane.
          store.close(); store = new Store(databasePath, 5, { society: "demo" });
          mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64, limits.batchMaxMessages, limits);
          revoked = true; break;
        case "reconcile": await mail.reconcilePending(); break;
        case "request": {
          const currentAuth = auth(); assertCurrentActor(store, currentAuth, "mail.send");
          const input = { to: ["alice"], kind: "message" as const, subject: `slot ${action.slot}`, body: `variant ${action.variant}` };
          if (action.boundary === "accepted" && store.getOperation("alice", key(action.slot)) === null) {
            await assert.rejects(sendWithStop(mail, store, currentAuth, key(action.slot), input, "accepted"),
              error => error instanceof StopSignal && error.point === "accepted");
          } else await mail.send(currentAuth, key(action.slot), input);
          break;
        }
        case "unknown": case "fail": {
          const operation = store.getOperation("alice", key(action.slot));
          if (!operation || (action.kind === "unknown" ? operation.state !== "pending" : operation.state !== "pending" && operation.state !== "unknown")) return "noop";
          store.transaction(tx => { if (action.kind === "unknown") tx.setOperationUnknown(operation.id); else tx.setOperationFailed(operation.id, "INTERNAL_ERROR"); });
          break;
        }
        case "ack": {
          assertCurrentActor(store, auth(), "mail.send");
          const operation = store.getOperation("alice", key(action.slot)); if (!operation) return "noop";
          assert.equal(operation.kind, "mail.send");
          if (operation.kind !== "mail.send") throw new Error("MODEL_OPERATION_KIND");
          store.transaction(tx => { tx.markAcknowledged(operation.plan.message.id, "alice"); }); break;
        }
        case "prepare": { const currentAuth = auth(); assertCurrentActor(store, currentAuth, "mail.send"); await mail.prepare(currentAuth); break; }
      }
      return "ok";
    } catch (error) {
      if (error instanceof StoreError && (error.code === "STALE_RUN" || error.code === "CAPABILITY_DENIED" || error.code === "REQUEST_KEY_REUSED" || error.code === "STORE_CORRUPT")) return error.code;
      throw error;
    }
  }
  try {
    for (const [index, action] of sequence.entries()) {
      const expected = advance(model, action);
      assert.equal(await execute(action), expected, `MODEL_RESULT action=${index} kind=${action.kind}`);
      const checked = assertGlobalInvariants(store, { phase: "unknown-external", stateRoot: root, society: "demo", viewLimits: limits,
        ...(previous ? { before: previous } : {}) });
      const ledger = checked.ledger; previous = ledger;
      assert.equal(ledger.agents[0]!.desired, model.desired, "MODEL_DESIRED");
      assert.equal(ledger.agents[0]!.incarnation, model.incarnation, "MODEL_INCARNATION");
      assert.equal(revoked, model.revoked, "MODEL_LIVE_LEASE");
      assert.equal(ledger.operations.length, model.operations.size, "MODEL_OPERATION_COUNT");
      const slotByMessage = new Map<string, number>();
      for (const [slot, expectedOperation] of model.operations) {
        const operation = ledger.operations.find(row => row.requestKey === key(slot));
        assert.ok(operation?.kind === "mail.send", "MODEL_OPERATION_MISSING");
        assert.equal(operation.state, expectedOperation.state, "MODEL_OPERATION_STATE");
        const delivery = ledger.deliveries.find(row => row.operationId === operation.id)!;
        assert.equal(delivery.materialized, expectedOperation.published ? 1 : 0, "MODEL_PUBLICATION");
        assert.equal(delivery.acknowledged, expectedOperation.acknowledged ? 1 : 0, "MODEL_ACK");
        assert.equal(delivery.presented, 0, "MODEL_S03_GATE");
        slotByMessage.set(delivery.messageId, slot);
      }
      assert.equal(ledger.batches.length, model.batchMembers === null ? 0 : 1, "MODEL_BATCH_COUNT");
      if (model.batchMembers !== null) {
        const batch = ledger.batches[0]!;
        assert.equal(batch.state, "prepared"); assert.equal(batch.incarnation, model.batchIncarnation, "DR9: the batch keeps the run it was created in");
        assert.deepEqual(ledger.deliveries.filter(row => row.batchId === batch.id).map(row => slotByMessage.get(row.messageId)).sort((a, b) => a! - b!), model.batchMembers, "MODEL_BATCH_MEMBERS");
      }
    }
  } finally { try { store.close(); } finally { rmSync(root, { recursive: true, force: true }); } }
}

const defaultSeed = integerParameter("OMA_TEST_SEED", 0x36c0ffee, 0xffffffff);
const count = integerParameter("OMA_TEST_ACTIONS", 64, 10000);
for (const seed of [defaultSeed, 0, 1, 0xffffffff]) {
  test(`R36 model seed=${seed} actions=${count} prng=${PRNG_REVISION}`, { timeout: 300000 }, async t => {
    const sequence = generateActions(seed, count), metadata = replayMetadata(seed, { actions: count });
    assert.deepEqual(sequence, generateActions(seed, count), "recorded seed must regenerate identical actions");
    try { await replay(sequence); }
    catch (original) {
      const signature = original instanceof Error ? original.message.split("\n")[0] : String(original);
      const reduced = await minimizeSequence(sequence, async candidate => {
        try { await replay(candidate); return false; }
        catch (error) { return (error instanceof Error ? error.message.split("\n")[0] : String(error)) === signature; }
      }, 64);
      t.diagnostic(`replay artifact: ${recordExplorationFailure("model", { ...metadata, sequence, reduced, signature })}`);
      throw original;
    }
  });
}
for (const [index, sequence] of MODEL_CORPUS.entries()) test(`R36 model authored corpus ${index}`, () => replay(sequence));

test("R36 minimizer and corpus rediscover injected unknown-recovery loss without a provider", async () => {
  const sequence = MODEL_CORPUS[2]!;
  const buggy = async (actions: readonly Action[]) => {
    const model = initialModel();
    for (const action of actions) {
      const recoverable = action.kind === "reconcile" &&
        [...model.operations.values()].some(operation => operation.state === "unknown");
      advance(model, action);
      if (recoverable) return true;
    }
    return false;
  };
  const result = await minimizeSequence(sequence, buggy);
  assert.equal(result.oneMinimal, true);
  assert.deepEqual(result.sequence, [
    { kind: "request", slot: 0, variant: 0, boundary: "accepted" }, { kind: "unknown", slot: 0 }, { kind: "reconcile" }]);
  assert.equal(await buggy(result.sequence), true, "the injected unknown-recovery regression remains reproducible");
  const random = new Seeded(1);
  assert.deepEqual([random.next(), random.next(), random.next()], [1015568748, 1586005467, 2165703038], "independent PRNG golden vector");
});
