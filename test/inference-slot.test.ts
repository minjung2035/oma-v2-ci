import { test } from "node:test";
import assert from "node:assert/strict";
import { InferenceSlot } from "../src/inference.js";

test("INF-002: queued residents keep FIFO without consuming Principal reserve", async () => {
  const slot = new InferenceSlot(3, 1, a => a === "principal");
  assert.equal(await slot.waitForSlot("principal"), true);
  assert.equal(slot.availableFor("a"), 2);
  assert.equal(await slot.waitForSlot("a"), true);
  assert.equal(await slot.waitForSlot("b"), true);
  const order: string[] = [];
  const c = slot.waitForSlot("c").then(ok => { assert.equal(ok, true); order.push("c"); });
  const d = slot.waitForSlot("d").then(ok => { assert.equal(ok, true); order.push("d"); });
  const principal = slot.waitForSlot("principal");
  slot.release("principal");
  assert.equal(await principal, true);
  assert.deepEqual(order, []);
  slot.release("a");
  await c;
  assert.deepEqual(order, ["c"]);
  slot.release("b");
  await d;
  assert.deepEqual(order, ["c", "d"]);
  for (const actor of ["c", "d", "principal"]) slot.release(actor);
  slot.release("missing");
  assert.equal(slot.availableFor("principal"), 3);
});

test("RUN-002: aborted and timed-out slot waits settle independently", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const slot = new InferenceSlot(1, 0, () => false);
  assert.equal(await slot.waitForSlot("already-aborted", AbortSignal.abort()), false);
  assert.equal(slot.acquire("busy"), true);
  const controller = new AbortController();
  const first = slot.waitForSlot("first", controller.signal);
  t.mock.timers.tick(100);
  let settled = false;
  const second = slot.waitForSlot("second").then(ok => { settled = true; return ok; });
  controller.abort();
  assert.equal(await first, false);
  t.mock.timers.tick(299900);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(100);
  assert.equal(await second, false);
  slot.release("busy");
  assert.equal(slot.availableFor("next"), 1);
});

test("INF-002: invalid slot limits fail closed", () => {
  for (const [total, reserve] of [[0, 0], [Infinity, 1], [2, -1], [2, 3], [2, 0.5]])
    assert.throws(() => new InferenceSlot(total!, reserve!, () => false), RangeError);
});
