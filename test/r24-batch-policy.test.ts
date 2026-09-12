import test from "node:test";
import assert from "node:assert/strict";
import { selectBatch, batchViewOf } from "../src/mail/batch-policy.js";
import type { PreparedBatch } from "../implementation/contracts.js";

const pending = [
  { value: "public-old", publicList: true },
  { value: "direct-old", publicList: false },
  { value: "public-new", publicList: true },
  { value: "direct-new", publicList: false },
  { value: "public-last", publicList: true },
];

test("R24: the existing two-class policy preserves oldest order and direct/public alternation", () => {
  assert.deepEqual(selectBatch(pending, 4), ["direct-old", "public-old", "direct-new", "public-new"]);
  assert.deepEqual(selectBatch(pending, 5), ["direct-old", "public-old", "direct-new", "public-new", "public-last"]);
  assert.deepEqual(selectBatch(pending.filter(value => value.publicList), 2), ["public-old", "public-new"]);
  assert.deepEqual(selectBatch([], 2), []);
  assert.throws(() => selectBatch(pending, 1), { code: "UNSUPPORTED_PROFILE" });
  assert.deepEqual(pending.map(value => value.value), ["public-old", "direct-old", "public-new", "direct-new", "public-last"]);
});

test("R24: the extension projection has six fields and never publishes host session or index paths", () => {
  const batch: PreparedBatch = {
    id: "12345678-1234-4234-8234-123456789abc", agent: "alice", incarnation: 1,
    messageIds: ["m-12345678-1234-4234-8234-123456789abc-0"],
    sessionPath: "/private/session.jsonl", indexPath: "/inbox.md", deliveryMode: "followUp", notice: "notice",
  };
  const view = batchViewOf(batch);
  assert.deepEqual(Object.keys(view), ["id", "agent", "incarnation", "deliveryMode", "notice", "messageIds"]);
  assert.equal("sessionPath" in view, false);
  assert.equal("indexPath" in view, false);
  assert.equal(JSON.stringify(view).includes("/private"), false);
  assert.deepEqual(view.messageIds, batch.messageIds);
  assert.notEqual(view.messageIds, batch.messageIds);
  view.messageIds.length = 0;
  assert.equal(batch.messageIds.length, 1);
});
