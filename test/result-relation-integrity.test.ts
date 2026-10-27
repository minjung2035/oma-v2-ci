import { serializePlanIntent } from "./fixtures/plan.js";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { requestHash } from "@oma/domain/request-identity";
import { ALL_CAPS, resolvedSpec, storedSpec } from "./fixtures/spec.js";

const OP = "op-00000000-0000-4000-8000-000000000081";

function seed(path: string): Store {
  const store = new Store(path);
  store.transaction(() => {
    store.insertAgent({
      name: "alice",
      ...storedSpec(ALL_CAPS, "p", "alice"),
      role: "resident",
      profile: "p",
      desired: "enabled",
      incarnation: 0,
      createdBy: null,
    });
    store.insertOperation({
      id: OP,
      actor: "alice",
      requestKey: "result-relation",
      requestHash: requestHash("route.follow", { topic: "dev" }),
      kind: "route.follow",
      payloadJson: JSON.stringify({ topic: "dev" }),
      planJson: serializePlanIntent({
        kind: "route.follow",
        topic: "dev",
        agent: "alice",
      }),
    });
  });
  return store;
}

const wrongButClosedResult = JSON.stringify({
  kind: "route.follow",
  topic: "other",
  subscribed: true,
});

test("DB-009: closed but semantically wrong success result is rejected before commit", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-result-relation-write-"));
  const store = seed(join(root, "runtime.sqlite"));
  try {
    assert.throws(
      () =>
        store.transaction(() =>
          store.setOperationSucceeded(OP as never, wrongButClosedResult),
        ),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
    assert.equal(store.getOperationById(OP as never)?.state, "pending");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("DB-009: persisted closed result that disagrees with plan fails at read boundary", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-result-relation-read-"));
  const path = join(root, "runtime.sqlite");
  let store = seed(path);
  store.close();

  const raw = new DatabaseSync(path);
  raw.prepare(
    "UPDATE operations SET state='succeeded', result_json=?, error_code=NULL WHERE id=?",
  ).run(wrongButClosedResult, OP);
  raw.close();

  store = new Store(path);
  try {
    assert.throws(
      () => store.getOperationById(OP as never),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
