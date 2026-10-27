/** runner.observe: the internal channel existed write-only -- the broker
 * stored each call and nobody read it. These tests pin both ends of the
 * wired channel: the adapter reports what an engine event says at face
 * value (runnerObservationOf + the DeliveryHooks seam), the runner sends it
 * coalesced on its one channel, the dispatcher keeps it memory-only tagged
 * with the authenticated run, and the status projection shows only its
 * timestamp for the run it came from -- never authority, never durable.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runnerObservationOf } from "@oma/engine/pi-adapter";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import { InternalDispatcher } from "@oma/broker/internal-dispatcher";
import { ViewsModule } from "#oma-test/app/views";
import { RunnerModule } from "#oma-test/app/runner";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { makeValidAgent } from "./fixtures/spec.js";
import type { PreparedBatch } from "@oma/contracts";

const batch = Object.freeze({
  id: "batch-1", agent: "alice", incarnation: 1, messageIds: [],
  sessionPath: null, deliveryMode: "steer", notice: "", indexPath: "/inbox.md",
}) as PreparedBatch;

const waitNotice = (incarnation = 1, batchId = "batch-1") => ({
  type: "extension_ui_request", method: "notify",
  message: `OMA_PI_WAIT_V1 ${JSON.stringify({ adapterRevision: PI_ADAPTER_REVISION, batchId, incarnation })}`,
});

test("runnerObservationOf: an event reports only the engine activity it names", () => {
  assert.deepEqual(runnerObservationOf({ type: "tool_execution_start", toolCallId: "c1", toolName: "ls" }, batch),
    { reason: "tool", toolName: "ls" });
  assert.deepEqual(runnerObservationOf({ type: "tool_execution_start", toolCallId: "c1" }, batch), { reason: "tool" });
  assert.deepEqual(runnerObservationOf({ type: "turn_start" }, batch), { reason: "inference" });
  assert.deepEqual(runnerObservationOf({ type: "compaction_start" }, batch), { reason: "compaction" });
  assert.deepEqual(runnerObservationOf(waitNotice(), batch), { reason: "waiting" });
  // A wait notice for another batch or a prior run is not this delivery's report.
  assert.equal(runnerObservationOf(waitNotice(2), batch), null);
  assert.equal(runnerObservationOf(waitNotice(1, "other-batch"), batch), null);
  assert.equal(runnerObservationOf({ type: "tool_execution_end", toolCallId: "c1" }, batch), null);
  assert.equal(runnerObservationOf({ type: "message_end" }, batch), null);
});

/** Deps the way p0-review6 builds them: every port stubbed, the runner
 * authenticated as the ledger's current incarnation. */
function dispatcherWith(incarnation: number) {
  const peer = { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), alive: () => true, sameSender: () => false,
    retainForExecution: () => () => undefined, releaseConnection: () => undefined };
  const dispatcher = new InternalDispatcher({
    store: { getAgentIdentity: () => ({ incarnation }), pendingDeliveryCount: () => 0,
      getBatchAgent: () => null, preparedBatchIds: () => [] },
    mail: { prepare: async () => null, complete: async () => {}, moveToCur: () => 0 } as never,
    peers: { requireRunnerPeer: () => {}, runnerActor: () => "alice",
      runnerAuth: () => ({} as never) },
    isDraining: () => false, assertAdmission: () => {},
    failureAnswer: (id: string, error: unknown) => ({ id, ok: false,
      code: (error as { code?: string }).code, message: (error as Error).message }),
    refreshViews: () => {}, openRun: () => { throw new Error("no run is opened here"); },
  });
  return { dispatcher, peer };
}

test("runner.observe: the dispatcher keeps the latest report tagged with the run it came from", async () => {
  const { dispatcher, peer } = dispatcherWith(7);
  const answer = await dispatcher.dispatch(
    { v: 1, id: "o1", method: "runner.observe", params: { reason: "tool", toolName: "ls", observedAtMs: 1234 } },
    peer as never, null, "runner") as { ok: boolean; result?: { accepted: boolean } };
  assert.deepEqual(answer.result, { accepted: true });
  assert.deepEqual(dispatcher.runnerObservation("alice"),
    { incarnation: 7, reason: "tool", toolName: "ls", observedAtMs: 1234 });
  await dispatcher.dispatch(
    { v: 1, id: "o2", method: "runner.observe", params: { reason: "inference", observedAtMs: 2000 } },
    peer as never, null, "runner");
  assert.deepEqual(dispatcher.runnerObservation("alice"),
    { incarnation: 7, reason: "inference", observedAtMs: 2000 }, "memory-only: the newest report replaces the last");
  assert.equal(dispatcher.runnerObservation("bob"), null);
});

test("runner.observe: status shows the report's timestamp for its own run, and nothing for a superseded one", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-observe-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, "runtime.sqlite"));
  t.after(() => store.close());
  store.transaction(tx => { tx.insertAgent(makeValidAgent("alice", { desired: "enabled", incarnation: 3 })); });
  const { dispatcher, peer } = dispatcherWith(3);
  const views = new ViewsModule(store, dir, "demo", "p");
  views.observeRunnerSource(agent => dispatcher.runnerObservation(agent));
  assert.equal(views.status("alice")[0]!.runnerObservedAtMs, null, "no observation yet");
  const observedAtMs = Date.now();
  void dispatcher.dispatch(
    { v: 1, id: "o1", method: "runner.observe", params: { reason: "tool", toolName: "ls", observedAtMs } },
    peer as never, null, "runner");
  return dispatcher.dispatch(
    { v: 1, id: "o2", method: "runner.observe", params: { reason: "tool", toolName: "ls", observedAtMs } },
    peer as never, null, "runner").then(() => {
    assert.equal(views.status("alice")[0]!.runnerObservedAtMs, observedAtMs,
      "the current run's report reaches the view");
    // The run moved on (the ledger says incarnation 4 now): the older run's
    // report is a fact about that run, so the view shows nothing rather than
    // stale evidence.
    store.transaction(tx => { tx.updateAgent({ name: "alice", incarnation: 4 }); });
    assert.equal(views.status("alice")[0]!.runnerObservedAtMs, null);
    const { dispatcher: older, peer: olderPeer } = dispatcherWith(3);
    views.observeRunnerSource(agent => older.runnerObservation(agent));
    assert.equal(views.status("alice")[0]!.runnerObservedAtMs, null,
      "a stale incarnation's report is never this run's");
    void olderPeer;
  });
});

/** A RunnerModule with its channel and connect() stubbed, so the send loop
 * can be watched without a broker. */
function runnerWithChannel(call: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
  const runner = new RunnerModule({ runRoot: "/nonexistent" }, "alice", "a".repeat(32));
  Reflect.set(runner, "channel", { call, close: () => {} });
  let reconnects = 0;
  Reflect.set(runner, "connect", async () => { reconnects++; });
  const note = (observation: { reason: string; toolName?: string }) =>
    (Reflect.get(runner, "noteObservation") as (o: typeof observation) => void).call(runner, observation);
  const flush = () => Reflect.get(runner, "observationFlush") as Promise<void> | null;
  return { note, flush, reconnects: () => reconnects };
}

test("runner.observe producer: the runner sends the engine's report, stamped at send time", async () => {
  const calls: Record<string, unknown>[] = [];
  const { note, flush } = runnerWithChannel(async (_method, params) => { calls.push(params); return { ok: true, result: { accepted: true } }; });
  note({ reason: "tool", toolName: "ls" });
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.reason, "tool");
  assert.equal(calls[0]!.toolName, "ls");
  assert.ok(Number.isSafeInteger(calls[0]!.observedAtMs) && (calls[0]!.observedAtMs as number) > 0);
});

test("runner.observe producer: reports coalesce to the newest while one is in flight", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: Record<string, unknown>[] = [];
  const { note, flush } = runnerWithChannel(async (_method, params) => { await gate; calls.push(params); return { ok: true, result: { accepted: true } }; });
  note({ reason: "inference" });
  note({ reason: "tool", toolName: "a" });
  note({ reason: "tool", toolName: "b" });
  release();
  await flush();
  assert.equal(calls.length, 2, "the queued middle report never reached the wire");
  assert.equal(calls[0]!.reason, "inference");
  assert.equal(calls[1]!.toolName, "b", "the newest queued report won");
});

test("runner.observe producer: a dropped channel reconnects once; a refusal is dropped, never fatal", async () => {
  const calls: Record<string, unknown>[] = [];
  let unavailable = true;
  const { note, flush, reconnects } = runnerWithChannel(async (_method, params) => {
    if (unavailable) { unavailable = false; throw new StoreError("BROKER_UNAVAILABLE", "broker channel is not connected"); }
    calls.push(params); return { ok: true, result: { accepted: true } };
  });
  note({ reason: "tool", toolName: "ls" });
  await flush();
  assert.equal(reconnects(), 1, "an unavailable channel earns exactly one reconnect");
  assert.equal(calls.length, 1);
  let refused = 0;
  const refusing = runnerWithChannel(async (_method, _params) => { refused++; return { ok: false, error: { code: "AUTH_FAILED", message: "no" } }; });
  refusing.note({ reason: "tool" });
  refusing.note({ reason: "tool" });
  await refusing.flush();
  assert.ok(refused >= 1, "the refusal was attempted");
  // The queue is abandoned on refusal rather than replayed: no unbounded retry.
});
