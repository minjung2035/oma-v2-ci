import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Broker, boundedLogOutput } from "@oma/broker";
import { Store } from "@oma/storage";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { ResidentLogStore } from "@oma/storage/resident-logs";
import { residentLogView } from "@oma/process/resident-logs";
import { ExecutionRuntime } from "#oma-test/app/runtime/execution-runtime";
import { createNativeResidents } from "#oma-test/app/runtime/native-residents";
import { defaultHostConfig } from "@oma/config/defaults";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { makeValidAgent } from "./fixtures/spec.js";

/** Fresh, explicitly initialized fixture state. No process is launched here;
 * these tests constrain incarnation binding, not arbitrary-descendant death. */
async function nativeOwner(t: import("node:test").TestContext, incarnation: number) {
  const root = mkdtempSync(join(tmpdir(), "oma-native-binding-"));
  ExecutionJournal.initialize(root);
  const executions = new ExecutionRuntime(root); await executions.recover();
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction(tx => tx.insertAgent(makeValidAgent("alice", { incarnation })));
  const config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: process.cwd(),
     deploymentDigest: "a".repeat(64) });
  const units = createNativeResidents(store, executions, { stateRoot: root, runRoot: join(root, "run"), society: "demo", configPath: join(root, "config.json") },
    config, () => { throw new Error("binding test must never attach an execution"); }, () => {}, () => null);
  t.after(async () => { await withAsyncCleanup(() => units.close(), () => executions.close()); store.close(); rmSync(root, { recursive: true, force: true }); });
  return { units, store };
}

test("RUN-001: confirmDead is fenced by the durable monotonic incarnation", async t => {
  const { units } = await nativeOwner(t, 7);
  assert.equal(units.confirmDead("alice", 6), true, "the recovered owner has no execution of a historical incarnation");
  assert.equal(units.confirmDead("alice", 7), true);
  assert.equal(units.confirmDead("alice", 8), false, "future incarnation cannot borrow an earlier observation");
  units.bindIncarnationReader(() => null);
  assert.equal(units.confirmDead("alice", 7), false, "unobserved incarnation fails closed despite a recovered empty journal");
});

test("RUN-001: authoritative incarnation binding replaces a stale reader", async t => {
  const { units, store } = await nativeOwner(t, 3);
  units.bindIncarnationReader(() => 99);
  assert.equal(units.confirmDead("alice", 4), true);
  units.bindIncarnationReader(actor => store.getAgent(actor)?.incarnation ?? null);
  assert.equal(units.confirmDead("alice", 3), true);
  assert.equal(units.confirmDead("alice", 4), false, "the Store binding must replace an older callback");
});

test("VIEW-003: bounded UTF-8 log prefix never exceeds byte limit", () => {
  const exact = boundedLogOutput(Buffer.from("abc"), 3);
  assert.deepEqual(exact, { text: "abc", truncated: false });

  const multi = boundedLogOutput(Buffer.from("가나다라마바사", "utf8"), 8);
  assert.equal(multi.truncated, true);
  assert.ok(Buffer.byteLength(multi.text, "utf8") <= 8);

  const forced = boundedLogOutput(Buffer.from("short"), 32, true);
  assert.equal(forced.truncated, true);
});

test("VIEW-003: real native log spool remains complete while Broker returns a bounded view", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-log-bound-"));
  try {
    const logs = new ResidentLogStore(root), invocationId = "a".repeat(32), now = Date.now();
    const writer = logs.open("alice", invocationId, now);
    writer.append({ actor: "alice", invocationId, incarnation: 1, atMs: now, stream: "stderr", bytes: Buffer.alloc(4096, 0x61) });
    writer.close();
    const broker = Object.create(Broker.prototype) as Broker;
    Object.assign(broker, { limits: { logBytes: 64 }, units: {
      readLogs: async (actor: string, since: number, limit: number) => residentLogView(logs.read(actor), since, limit),
    } });
    const readLogs = Reflect.get(broker, "readLogs") as (actor: string, since: number) => Promise<{ text: string; truncated: boolean; observedAtMs: number }>;
    const result = await readLogs.call(broker, "alice", 60);
    assert.equal(result.truncated, true); assert.ok(Buffer.byteLength(result.text) <= 64);
    assert.ok(result.text.length > 0); assert.ok(Number.isSafeInteger(result.observedAtMs));
    const complete = [...logs.read("alice")]; assert.equal(complete.length, 1);
    assert.equal(complete[0]!.kind, "entry");
    if (complete[0]!.kind === "entry") assert.equal(complete[0]!.entry.bytes.byteLength, 4096);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
