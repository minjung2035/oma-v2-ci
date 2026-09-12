import { test } from "node:test";
import assert from "node:assert/strict";
import { InferenceSlot, type SlotLease } from "../src/inference.js";

async function take(slot: InferenceSlot, actor: string): Promise<SlotLease> {
  const result = await slot.waitForSlot(actor);
  assert.equal(result.state, "acquired");
  if (result.state !== "acquired") throw new Error("expected a slot lease");
  return result.lease;
}

test("INF-002: queued residents keep FIFO without consuming Principal reserve", async () => {
  const slot = new InferenceSlot(3, 1, actor => actor === "principal");
  const firstPrincipal = await take(slot, "principal");
  assert.equal(slot.availableFor("a"), 2);
  const a = await take(slot, "a"); const b = await take(slot, "b");
  const order: string[] = [];
  const c = take(slot, "c").then(lease => { order.push("c"); return lease; });
  const d = take(slot, "d").then(lease => { order.push("d"); return lease; });
  const principal = take(slot, "principal");
  firstPrincipal.release();
  const secondPrincipal = await principal;
  assert.deepEqual(order, []);
  a.release(); const cLease = await c;
  assert.deepEqual(order, ["c"]);
  b.release(); const dLease = await d;
  assert.deepEqual(order, ["c", "d"]);
  for (const lease of [cLease, dLease, secondPrincipal]) lease.release();
  firstPrincipal.release();
  assert.equal(slot.availableFor("principal"), 3);
});

test("RUN-002: aborted and timed-out slot waits settle independently", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const slot = new InferenceSlot(1, 0, () => false);
  assert.deepEqual(await slot.waitForSlot("already-aborted", AbortSignal.abort()), { state: "cancelled" });
  const busy = slot.acquire("busy"); assert.ok(busy);
  const controller = new AbortController();
  const first = slot.waitForSlot("first", controller.signal);
  t.mock.timers.tick(100);
  let settled = false;
  const second = slot.waitForSlot("second").then(result => { settled = true; return result; });
  controller.abort();
  assert.deepEqual(await first, { state: "cancelled" });
  t.mock.timers.tick(299900); await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(100);
  assert.deepEqual(await second, { state: "timedOut" });
  busy.release();
  assert.equal(slot.availableFor("next"), 1);
});

test("R27: a repeated release cannot take another request from the same actor", () => {
  const slot = new InferenceSlot(2, 0, () => false);
  const first = slot.acquire("alice"); const second = slot.acquire("alice");
  assert.ok(first); assert.ok(second);
  first.release(); first.release(); slot.release(first);
  assert.equal(slot.availableFor("alice"), 1);
  const third = slot.acquire("alice"); assert.ok(third);
  first.release();
  assert.equal(slot.availableFor("alice"), 0);
  second.release(); third.release();
  assert.equal(slot.availableFor("alice"), 2);
});

test("R27: shutdown cancels queued waiters but does not forge active provider termination", async () => {
  const slot = new InferenceSlot(1, 0, () => false);
  const held = slot.acquire("alice"); assert.ok(held);
  const queued = slot.waitForSlot("bob");
  slot.close(); slot.close();
  assert.deepEqual(await queued, { state: "cancelled" });
  assert.equal(slot.acquire("next"), null);
  held.release(); held.release();
  assert.equal(slot.availableFor("next"), 0);
});

test("INF-002: invalid slot limits fail closed", () => {
  for (const [total, reserve] of [[0, 0], [Infinity, 1], [2, -1], [2, 3], [2, 0.5]])
    assert.throws(() => new InferenceSlot(total!, reserve!, () => false), RangeError);
});
