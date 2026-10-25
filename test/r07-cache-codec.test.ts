import test from "node:test";
import assert from "node:assert/strict";
import { decodeCachedRequest } from "#oma-test/app/cli/cache-codec";
import { decodeReceipt } from "@oma/protocol/receipt-codec";

const operation = "op-12345678-1234-4234-8234-123456789abc";
const good = {
  key: "r07-codec", method: "mail.send",
  params: { to: ["alice"], subject: "subject", kind: "message", body: "frozen" },
  createdAtMs: 1, lastReceipt: null,
};

test("closed caller DTOs have a valid control and reject one changed condition", () => {
  const control = decodeCachedRequest(good, good.key);
  assert.equal(control.ok, true);
  if (control.ok) assert.deepEqual(control.value, good);
  for (const changed of [
    { ...good, method: "runner.open" },
    { ...good, method: "status.get" },
    { ...good, params: { ...good.params, extra: "no" } },
    { ...good, params: { ...good.params, to: ["../alice"] } },
    { ...good, createdAtMs: Number.MAX_SAFE_INTEGER + 1 },
    { ...good, lastReceipt: undefined },
    { ...good, lastReceipt: { operation, state: "pending", result: {} } },
    { ...good, digest: { bytes: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" } },
  ]) assert.equal(decodeCachedRequest(changed, good.key).ok, false);
});

test("null remains only a cache sentinel and cannot satisfy the receipt predicate", () => {
  assert.equal(decodeReceipt(null).ok, false);
  for (const receipt of [
    { operation, state: "pending" },
    { operation, state: "unknown", reason: "observation incomplete" },
    { operation, state: "failed", error: { code: "CHECK_FAILED", message: "failed", retry: "never" } },
  ]) {
    assert.equal(decodeReceipt(receipt).ok, true);
    assert.equal(decodeCachedRequest({ ...good, lastReceipt: receipt }, good.key).ok, true);
  }
  const notFound = { operation: "", state: "failed", error: { code: "REQUEST_NOT_FOUND", message: "absent", retry: "same-key" } };
  assert.equal(decodeReceipt(notFound, { allowNotFound: true }).ok, true);
  assert.equal(decodeReceipt(notFound).ok, false);
  assert.equal(decodeCachedRequest({ ...good, lastReceipt: notFound }, good.key).ok, false);
  assert.equal(decodeReceipt({ ...notFound, error: { ...notFound.error, code: "INTERNAL_ERROR" } }, { allowNotFound: true }).ok, false);
});
