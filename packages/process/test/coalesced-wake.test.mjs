import test from "node:test";
import assert from "node:assert/strict";
import { CoalescedWake } from "../dist/coalesced-wake.js";
import { AsyncLocalStorage } from "node:async_hooks";

test("wake hints before dispatch share one task and one callback", async () => {
  let calls = 0;
  const wake = new CoalescedWake(async () => { calls++; });
  const task = wake.request();
  for (let i = 0; i < 10_000; i++) assert.equal(wake.request(), task);
  await task;
  assert.equal(calls, 1);
});

test("hints during an active callback request exactly one fresh pass", async () => {
  const first = Promise.withResolvers(); let calls = 0;
  const wake = new CoalescedWake(async () => { if (++calls === 1) await first.promise; });
  const task = wake.request(); await Promise.resolve();
  assert.equal(calls, 1);
  for (let i = 0; i < 10_000; i++) assert.equal(wake.request(), task);
  first.resolve(); await task;
  assert.equal(calls, 2);
});

test("close cancels queued dispatch before any callback runs", async () => {
  let calls = 0;
  const wake = new CoalescedWake(async () => { calls++; });
  const task = wake.request(); wake.close(); await task; await wake.request();
  assert.equal(calls, 0);
});

test("close leaves the active callback owned until settlement and cancels its pending hint", async () => {
  const first = Promise.withResolvers(); let calls = 0, settled = false;
  const wake = new CoalescedWake(async () => { calls++; await first.promise; });
  const task = wake.request(); void task.then(() => { settled = true; });
  await Promise.resolve(); wake.request(); wake.close(); await wake.request();
  assert.equal(settled, false);
  first.resolve(); await task;
  assert.equal(calls, 1); assert.equal(settled, true);
});

test("a failed callback retains its failure and a later hint starts fresh work", async () => {
  const failure = new Error("observation unavailable"); let calls = 0;
  const wake = new CoalescedWake(async () => { if (++calls === 1) throw failure; });
  await assert.rejects(wake.request(), error => error === failure);
  await wake.request(); assert.equal(calls, 2);
});

test("a reentrant hint is retained for a fresh callback", async () => {
  let calls = 0;
  const wake = new CoalescedWake(async () => { if (++calls === 1) wake.request(); });
  await wake.request(); assert.equal(calls, 2);
});

test("a hint cannot lend its request or recovery context to the owner's callback", async () => {
  const context = new AsyncLocalStorage();
  let calls = 0;
  const wake = new CoalescedWake(async () => { calls++; assert.equal(context.getStore(), undefined); });
  await context.run("caller-recovery", () => wake.request());
  assert.equal(calls, 1);
});
