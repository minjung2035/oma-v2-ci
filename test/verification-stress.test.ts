import test from "node:test";
import assert from "node:assert/strict";
import { InferenceSlot } from "../src/inference/slots.js";
import { JsonlReader } from "../src/protocol/jsonl.js";

test("R35 stress: 256 same-actor lease waiters retain exact request ownership", async () => {
  const slots = new InferenceSlot(1, 0, () => false);
  const held = slots.acquire("alice"); assert.ok(held);
  let completed = 0;
  const jobs = Array.from({ length: 256 }, async () => {
    const result = await slots.waitForSlot("alice");
    assert.equal(result.state, "acquired");
    if (result.state === "acquired") { completed++; result.lease.release(); result.lease.release(); }
  });
  held.release(); await Promise.all(jobs);
  assert.equal(completed, 256); assert.equal(slots.availableFor("alice"), 1); slots.close();
});

test("R35 stress: 10000 bounded JSONL events dispatch without a retained event queue", () => {
  const reader = new JsonlReader(128); let events = 0;
  const line = Buffer.from('{"type":"notification","text":"bounded"}\n');
  for (let index = 0; index < 10000; index++) {
    reader.feed(line, () => { events++; }); assert.equal(reader.pendingBytes, 0);
  }
  reader.finish(); assert.equal(events, 10000);
});
