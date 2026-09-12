import test from "node:test";
import assert from "node:assert/strict";
import { StoreError } from "../src/domain/errors.js";
import {
  receiptOfOperation, receiptExit, isRequestNotFound, receiptNotFound,
  type ReceiptOperation,
} from "../src/protocol/receipts.js";

const pending: ReceiptOperation = Object.freeze({
  id: "op-00000000-0000-4000-8000-000000000001",
  kind: "route.follow", state: "pending", resultJson: null, errorCode: null,
});

test("admitted receipts reject preaccept-only errors without changing the source row", () => {
  assert.deepEqual(receiptOfOperation(pending), { operation: pending.id, state: "pending" });
  for (const errorCode of ["STREAM_INVALID", "LIMIT_EXCEEDED", "STORAGE_FULL"] as const) {
    const row: ReceiptOperation = Object.freeze({ ...pending, state: "failed", errorCode });
    const original = JSON.stringify(row);
    assert.throws(() => receiptOfOperation(row), (error: unknown) =>
      error instanceof StoreError && error.code === "STORE_CORRUPT");
    assert.equal(JSON.stringify(row), original);
  }
});

test("terminal failure and uncertain effects never authorize frozen resend", () => {
  const failed = receiptOfOperation({ ...pending, state: "failed", errorCode: "CHECK_FAILED" });
  assert.deepEqual(failed, {
    operation: pending.id, state: "failed",
    error: { code: "CHECK_FAILED", message: "CHECK_FAILED", retry: "never" },
  });
  assert.equal(isRequestNotFound(failed), false);
  assert.equal(receiptExit(failed), 2);
  const unknown = receiptOfOperation({ ...pending, state: "unknown" });
  assert.deepEqual(unknown, { operation: pending.id, state: "unknown" });
  assert.equal(isRequestNotFound(unknown), false);
  assert.equal(receiptExit(unknown), 3);
  assert.equal(isRequestNotFound(receiptNotFound), true);
});

test("successful legacy JSON is projected without rewriting frozen serialized bytes", () => {
  const row: ReceiptOperation = Object.freeze({
    ...pending, state: "succeeded",
    resultJson: '{"subscribed":true, "topic":"work", "kind":"route.follow"}',
  });
  const before = row.resultJson;
  const receipt = receiptOfOperation(row);
  assert.deepEqual(receipt.result, { kind: "route.follow", topic: "work", subscribed: true });
  assert.equal(receiptExit(receipt), 0);
  assert.equal(row.resultJson, before);
  assert.deepEqual(receiptOfOperation(row), receipt);
});
