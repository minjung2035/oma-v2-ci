import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { resolvedSpecCheck } from "@oma/domain/durable";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { messagePlanCheck } from "@oma/domain/validation";
import { parseBatchId } from "@oma/domain/identifiers";
import { RequestCache } from "#oma-test/app/request-cache";
import { sha256Hex } from "@oma/domain/canonical-json";
import { makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { makeValidOperation, makeValidMessagePlan, makeValidBatch, makeValidFrozenRequest } from "./fixtures/valid.js";
import { corruptOperationForTest, corruptValueForTest, mutateRawRowAfterClose } from "./fixtures/corruption.js";

const OP = "op-00000000-0000-4000-8000-000000000001";

test("R32: normal primitive fixtures have valid shapes, hashes and owned identities", () => {
  const spec = makeValidResolvedSpec();
  const agent = makeValidAgent();
  assert.equal(resolvedSpecCheck(spec), null);
  assert.equal(agent.specHash, resolvedSpecDigest(spec));
  assert.deepEqual(JSON.parse(agent.specJson), spec);
  const bytes = Buffer.from("fixture\n");
  const message = makeValidMessagePlan(OP, { bytes });
  assert.equal(messagePlanCheck(message), null);
  assert.equal(message.id, "m-00000000-0000-4000-8000-000000000001-0");
  assert.equal(message.sha256, sha256Hex(bytes));
  assert.equal(message.bytes, bytes.length);
  const batch = makeValidBatch("alice", [message.id]);
  assert.ok(parseBatchId(batch.id));
  assert.deepEqual(JSON.parse(batch.messageIdsJson), [message.id]);
});

test("R32: valid ledger control decodes before exactly one raw field is corrupted", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-valid-fixture-"));
  const path = join(root, "runtime.sqlite");
  const valid = makeValidOperation({ stateRoot: root, id: OP });
  const store = new Store(path);
  try {
    store.transaction(() => { store.insertAgent(makeValidAgent()); store.insertOperation(valid); });
    assert.equal(store.getOperationById(OP)?.requestHash, valid.requestHash);
  } finally { store.close(); }
  try {
    corruptOperationForTest(path, OP, "request_hash", "deliberately-invalid");
    mutateRawRowAfterClose(path, raw => {
      const row = raw.prepare("SELECT id, payload_json, plan_json, request_key FROM operations WHERE id=?").get(OP);
      assert.equal(row?.id, valid.id);
      assert.equal(row?.payload_json, valid.payloadJson);
      assert.equal(row?.plan_json, valid.planJson);
      assert.equal(row?.request_key, valid.requestKey);
    });
    const reopened = new Store(path);
    try { assert.throws(() => reopened.getOperationById(OP), (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT"); }
    finally { reopened.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("R32: cache normal factory round-trips; corrupt-value helper does not mutate its control", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-valid-cache-"));
  try {
    const input = makeValidFrozenRequest();
    const cache = new RequestCache(root);
    assert.equal(cache.freeze(input, Buffer.from("hello")).kind, "created");
    assert.equal(cache.read(input.key).kind, "present");
    const damaged = corruptValueForTest(input, "method", "invalid.method");
    assert.equal(input.method, "context.publish");
    assert.equal(damaged.key, input.key);
    assert.deepEqual(damaged.params, input.params);
    assert.deepEqual(damaged.digest, input.digest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
