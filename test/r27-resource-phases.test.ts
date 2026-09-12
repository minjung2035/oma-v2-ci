import test from "node:test";
import assert from "node:assert/strict";
import { InferenceSlot } from "../src/inference/slots.js";
import { InferenceCall, reportedUnits, accountingDetails } from "../src/inference/call.js";

// Domain-only oracles: these do not attest provider codecs or billing bounds.
test("R27: releasing one request twice cannot steal the same actor's other slot", () => {
  const slots = new InferenceSlot(2, 0, actor => actor === "principal");
  const first = slots.acquire("alice");
  const second = slots.acquire("alice");
  assert.ok(first); assert.ok(second);
  assert.equal(slots.availableFor("alice"), 0);
  first.release(); first.release(); slots.release(first);
  assert.equal(slots.availableFor("alice"), 1);
  second.release();
  assert.equal(slots.availableFor("alice"), 2);
  slots.close();
});

test("R27: a foreign allocator cannot release an owned lease", () => {
  const owner = new InferenceSlot(1, 0, () => false);
  const other = new InferenceSlot(1, 0, () => false);
  const lease = owner.acquire("alice");
  assert.ok(lease);
  other.release(lease);
  assert.equal(owner.availableFor("alice"), 0);
  lease.release();
  assert.equal(owner.availableFor("alice"), 1);
  owner.close(); other.close();
});

test("R27: eligible FIFO preserves the Principal reserve and queued cancellation", async () => {
  const slots = new InferenceSlot(2, 1, actor => actor === "principal");
  const resident = slots.acquire("alice");
  assert.ok(resident);
  const abort = new AbortController();
  const cancelled = slots.waitForSlot("bob", abort.signal);
  const next = slots.waitForSlot("carol");
  const principal = await slots.waitForSlot("principal");
  assert.equal(principal.state, "acquired");
  abort.abort();
  assert.deepEqual(await cancelled, { state: "cancelled" });
  resident.release();
  const acquired = await next;
  assert.equal(acquired.state, "acquired");
  if (acquired.state === "acquired") acquired.lease.release();
  if (principal.state === "acquired") principal.lease.release();
  assert.equal(slots.availableFor("alice"), 1);
  slots.close();
});

test("R27: close settles every queued owner and never grants a late lease", async () => {
  const slots = new InferenceSlot(1, 0, () => false);
  const held = slots.acquire("alice");
  assert.ok(held);
  const waiting = [slots.waitForSlot("alice"), slots.waitForSlot("bob")];
  slots.close(); slots.close();
  assert.deepEqual(await Promise.all(waiting), [{ state: "cancelled" }, { state: "cancelled" }]);
  held.release(); held.release();
  assert.equal(slots.acquire("carol"), null);
  assert.deepEqual(await slots.waitForSlot("carol"), { state: "cancelled" });
});

test("R27: an already aborted waiter consumes no capacity", async () => {
  const slots = new InferenceSlot(1, 0, () => false);
  const abort = new AbortController(); abort.abort();
  assert.deepEqual(await slots.waitForSlot("alice", abort.signal), { state: "cancelled" });
  assert.equal(slots.availableFor("alice"), 1);
  slots.close();
});

test("R27: contact requires reservation; unknown remains distinct from settled", () => {
  const call = new InferenceCall("request", "alice", 1);
  assert.equal(call.phase, "waiting");
  assert.equal(call.ownsReservation, false);
  assert.throws(() => call.beginContact());
  call.reserve();
  assert.equal(call.ownsReservation, true);
  assert.throws(() => call.reserve());
  call.beginContact();
  call.controller.abort();
  assert.equal(call.phase, "provider-contact-started");
  call.settle("unknown");
  assert.equal(call.phase, "unknown");
  assert.throws(() => call.settle("cancelled"));
  assert.throws(() => call.beginContact());
});

test("R27: absent or malformed provider cost is not synthesized as zero", () => {
  for (const value of [undefined, null, "0", -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1,
    {}, { reportedUnits: "0" }, { reportedUnits: -1 }, { reportedUnits: null }]) {
    assert.equal(reportedUnits(value), null);
  }
  assert.equal(reportedUnits(0), 0);
  assert.equal(reportedUnits({ reportedUnits: 12 }), 12);
  assert.equal(reportedUnits(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  const privatePayload = { payload: "DO_NOT_PERSIST", tokens: ["DO_NOT_PERSIST"], reportedUnits: 12 };
  assert.equal(JSON.stringify(accountingDetails(privatePayload)).includes("DO_NOT_PERSIST"), false);
});
