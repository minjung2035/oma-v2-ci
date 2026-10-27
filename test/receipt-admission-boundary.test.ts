import test from "node:test";
import assert from "node:assert/strict";
import { StoreError } from "@oma/domain/errors";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { receiptExit, isRequestNotFound, receiptNotFound } from "@oma/protocol/receipts";
import { receiptOperation, receiptOperationRecord } from "./fixtures/receipt-operation.js";

const pending = receiptOperation();

test("admitted receipts reject preaccept-only errors without changing the source row", () => {
  assert.deepEqual(receiptOfOperation(pending), { operation: pending.id, state: "pending" });
  for (const errorCode of ["STREAM_INVALID", "LIMIT_EXCEEDED", "STORAGE_FULL"] as const) {
    const row = Object.freeze({ ...receiptOperationRecord, state: "failed", error_code: errorCode });
    const original = JSON.stringify(row);
    assert.throws(() => receiptOfOperation(receiptOperation(row)), (error: unknown) =>
      error instanceof StoreError && error.code === "STORE_CORRUPT");
    assert.equal(JSON.stringify(row), original);
  }
});

test("terminal failure and uncertain effects never authorize frozen resend", () => {
  const failed = receiptOfOperation(receiptOperation({ state: "failed", error_code: "CHECK_FAILED" }));
  assert.deepEqual(failed, {
    operation: pending.id, state: "failed",
    error: { code: "CHECK_FAILED", message: "CHECK_FAILED", retry: "never" },
  });
  assert.equal(isRequestNotFound(failed), false);
  assert.equal(receiptExit(failed), 2);
  const unknown = receiptOfOperation(receiptOperation({ state: "unknown" }));
  assert.deepEqual(unknown, { operation: pending.id, state: "unknown" });
  assert.equal(isRequestNotFound(unknown), false);
  assert.equal(receiptExit(unknown), 3);
  assert.equal(isRequestNotFound(receiptNotFound), true);
});

test("successful legacy JSON is projected without rewriting frozen serialized bytes", () => {
  const resultJson = '{"subscribed":true, "topic":"work", "kind":"route.follow"}';
  const row = receiptOperation({ state: "succeeded", result_json: resultJson });
  const receipt = receiptOfOperation(row);
  assert.deepEqual(receipt.result, { kind: "route.follow", topic: "work", subscribed: true });
  assert.equal(receiptExit(receipt), 0);
  assert.equal(row.resultJson, resultJson);
  assert.deepEqual(receiptOfOperation(row), receipt);
});
