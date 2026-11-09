import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { PreparedBatch, ProtocolLimits } from "@oma/contracts";
import { runnerReceiptPathAt } from "@oma/domain/paths";
import { generateBatchId } from "@oma/native/identity";
import { RunnerModule } from "#oma-test/app/runner";

test("001. Failed proxy teardown still closes the inference relay and retains delivery failure", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-runner-cleanup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const batch = { id: generateBatchId(), agent: "alice", incarnation: 1, messageIds: [] } as unknown as PreparedBatch;
  mkdirSync(dirname(runnerReceiptPathAt(root, batch.agent, batch.id)), { recursive: true });
  const limits = { frameBytes: 262144, idleStreamSeconds: 60, receiptWaitSeconds: 60 } as ProtocolLimits;
  const runner = new RunnerModule({ runRoot: root, stateRoot: root }, batch.agent, "a".repeat(32), limits);
  const deliveryFailure = new Error("delivery failed"), proxyFailure = new Error("proxy close failed");
  const closed: string[] = [];
  Reflect.set(runner, "openRelay", async () => ({ inference: {}, connectDial: {}, relay: { async close() { closed.push("relay"); } } }));
  Reflect.set(runner, "openConnectProxy", async () => ({ socketPath: "/proxy", async close() { closed.push("proxy"); throw proxyFailure; } }));
  Reflect.set(runner, "adapter", () => ({ async deliver() { throw deliveryFailure; } }));
  const consume = Reflect.get(runner, "consume") as (batch: PreparedBatch) => Promise<void>;
  let failure: unknown;
  try { await consume.call(runner, batch); } catch (error) { failure = error; }
  assert.deepEqual(closed, ["proxy", "relay"]);
  assert.ok(failure instanceof AggregateError);
  assert.deepEqual(failure.errors, [deliveryFailure, proxyFailure]);
});
