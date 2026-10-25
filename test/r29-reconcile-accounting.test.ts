import test from "node:test";
import assert from "node:assert/strict";
import { OperationRecovery, type RecoveryRow } from "@oma/reconcile/operations";
import { StoreError } from "@oma/domain/errors";
import { generateOperationId } from "@oma/native/identity";

function rows() {
  const mail: RecoveryRow = { id: generateOperationId(), kind: "mail.send", state: "pending" };
  const git: RecoveryRow = { id: generateOperationId(), kind: "git.submit", state: "unknown" };
  return new Map<string, RecoveryRow>([[mail.id, mail], [git.id, git]]);
}
function fatalOnly(error: unknown): void { if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error; }

test("R29: concurrent sweeps join one Promise, examine distinct initial IDs and count terminal failures", async () => {
  const table = rows(); const initial = [...table.keys()]; let calls = 0;
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  const engine = new OperationRecovery({ snapshot: () => [...table.keys(), initial[0]!], read: id => table.get(id) ?? null,
    recover: async row => {
      calls++; await wait;
      table.set(row.id, { ...row, state: row.kind === "mail.send" ? "succeeded" : "failed" });
      const added: RecoveryRow = { id: generateOperationId(), kind: "agent.create", state: "pending" }; table.set(added.id, added);
    }, failure: fatalOnly });
  const first = engine.sweep(); const second = engine.sweep(); assert.equal(first, second); release();
  assert.deepEqual(await first, { examined: 2, repaired: 2, remaining: 0 });
  assert.deepEqual(await second, { examined: 2, repaired: 2, remaining: 0 });
  assert.equal(calls, 2);
  assert.deepEqual(engine.lastOutcomes.map(value => value.state), ["succeeded", "failed-terminal"]);
});

test("R29: already-terminal snapshot entries are excluded, not counted twice", async () => {
  const table = rows(); const ids = [...table.keys()];
  const engine = new OperationRecovery({ snapshot: () => ids, read: id => table.get(id) ?? null,
    recover: async row => { for (const [id, value] of table) table.set(id, { ...value, state: "succeeded" }); }, failure: fatalOnly });
  assert.deepEqual(await engine.sweep(), { examined: 1, repaired: 1, remaining: 0 });
  assert.equal(engine.lastOutcomes[1]?.state, "skipped-already-terminal");
  assert.deepEqual(await engine.sweep(), { examined: 0, repaired: 0, remaining: 0 });
});

test("R29: pending/unknown reasons survive no-progress backoff and later retry", async () => {
  const table = rows(); let now = 0; let calls = 0;
  const engine = new OperationRecovery({ snapshot: () => [...table.keys()], read: id => table.get(id) ?? null,
    recover: async row => { calls++; if (row.kind === "git.submit") throw new StoreError("REF_STATE_UNKNOWN", "private raw output"); },
    failure: fatalOnly, budgetSeconds: 1, clock: () => now });
  assert.deepEqual(await engine.sweep(), { examined: 2, repaired: 0, remaining: 2 });
  assert.equal(engine.lastOutcomes[0]?.reason, "no-progress");
  assert.equal(engine.lastOutcomes[1]?.reason, "REF_STATE_UNKNOWN");
  assert.equal(JSON.stringify(engine.lastOutcomes).includes("private raw output"), false);
  assert.deepEqual(await engine.sweep(), { examined: 0, repaired: 0, remaining: 0 });
  assert.ok(engine.lastOutcomes.every(value => value.reason === "no-progress-backoff"));
  assert.equal(calls, 2); now = 1000;
  assert.deepEqual(await engine.sweep(), { examined: 2, repaired: 0, remaining: 2 }); assert.equal(calls, 4);
});

test("R29: a wall-budget boundary resumes from authoritative IDs, with no durable cursor", async () => {
  const table = rows(); let now = 0; const visited: string[] = [];
  const engine = new OperationRecovery({ snapshot: () => [...table.keys()], read: id => table.get(id) ?? null,
    recover: async row => { visited.push(row.id); table.set(row.id, { ...row, state: "succeeded" }); now += 1000; },
    failure: fatalOnly, budgetSeconds: 1, clock: () => now });
  assert.deepEqual(await engine.sweep(), { examined: 1, repaired: 1, remaining: 0 });
  assert.equal(engine.lastOutcomes[1]?.reason, "sweep-budget-exhausted");
  assert.deepEqual(await engine.sweep(), { examined: 1, repaired: 1, remaining: 0 });
  assert.equal(new Set(visited).size, 2);
});

test("R29: recursive self-await fails immediately; corruption never returns partial healthy counts", async () => {
  const table = rows(); const first = [...table.keys()][0]!;
  let engine: OperationRecovery;
  engine = new OperationRecovery({ snapshot: () => [first], read: id => table.get(id) ?? null,
    recover: async () => { await assert.rejects(engine.sweep(), { code: "INTERNAL_ERROR" }); }, failure: fatalOnly });
  assert.deepEqual(await engine.sweep(), { examined: 1, repaired: 0, remaining: 1 });
  let fenced = false;
  const corrupt = new OperationRecovery({ snapshot: () => [first], read: id => table.get(id) ?? null,
    recover: async () => { throw new StoreError("STORE_CORRUPT", "bad immutable relation"); },
    failure: error => { fenced = true; throw error; } });
  await assert.rejects(corrupt.sweep(), { code: "STORE_CORRUPT" });
  assert.equal(fenced, true); assert.equal(corrupt.lastOutcomes[0]?.state, "corrupt");
  assert.equal(corrupt.running, false);
});
