import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { PreparedBatch } from "../implementation/contracts.js";
import { generateBatchId, generateOperationId } from "../src/ids.js";
import { messageIdForOperation } from "../src/domain/derived.js";
import {
  PI_ADAPTER_REVISION,
  publishDeliveryReceipt,
  readDeliveryReceipt,
  type DeliveryBoundary,
} from "../src/storage/delivery-receipt.js";
import { DurabilityFaultError, type DurabilityFault, type DurabilityObserver } from "../src/storage/durable-fs.js";
import { runnerReceiptPathAt, runnerSessionDirPathAt } from "../src/storage/paths.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-receipt-publication-"));
  const operationId = generateOperationId();
  const batch: PreparedBatch = {
    id: generateBatchId(),
    agent: "alice",
    incarnation: 1,
    messageIds: [messageIdForOperation(operationId, 0)],
    sessionPath: null,
    deliveryMode: "steer",
    notice: "fixture",
    indexPath: "/inbox.md",
  };
  const sessions = runnerSessionDirPathAt(root, "alice");
  mkdirSync(sessions, { recursive: true, mode: 0o700 });
  const sessionPath = join(sessions, "session.jsonl");
  writeFileSync(sessionPath, '{"type":"session","version":3}\n');
  const boundary = (entryId: string, path = sessionPath): DeliveryBoundary => ({
    adapterRevision: PI_ADAPTER_REVISION,
    batchId: batch.id,
    incarnation: batch.incarnation,
    sessionPath: path,
    entryId,
  });
  return { root, batch, sessionPath, boundary, close: () => rmSync(root, { recursive: true, force: true }) };
}

const publishWithFaults = publishDeliveryReceipt as typeof publishDeliveryReceipt &
  ((stateRoot: string, batch: PreparedBatch, boundary: DeliveryBoundary, maximum: number, faults?: DurabilityObserver) => ReturnType<typeof publishDeliveryReceipt>);

test("V05A: receipt success follows temp fsync, no-replace publication, validation and parent fsync", () => {
  const f = fixture();
  try {
    const events: DurabilityFault[] = [];
    const receipt = publishWithFaults(f.root, f.batch, f.boundary("0123abcd"), TEST_VIEW_LIMITS.frameBytes,
      event => events.push(event));
    const path = runnerReceiptPathAt(f.root, "alice", f.batch.id);
    assert.equal(receipt.entryId, "0123abcd");
    assert.equal(lstatSync(path).mode & 0o777, 0o600);
    const names = events.map(event => `${event.point}:${event.phase}`);
    const at = (value: string) => {
      const index = names.indexOf(value);
      assert.notEqual(index, -1, `missing ${value}`);
      return index;
    };
    assert.ok(at("file-fsync:after-visible") < at("publication-link:after-visible"));
    assert.ok(at("publication-link:after-visible") < at("destination-validate:after-visible"));
    const parentFlush = names.lastIndexOf("directory-fsync:after-visible");
    assert.notEqual(parentFlush, -1, "missing final parent fsync");
    assert.ok(at("destination-validate:after-visible") < parentFlush);
    assert.deepEqual(readDeliveryReceipt(f.root, f.batch, TEST_VIEW_LIMITS.frameBytes), receipt);
  } finally { f.close(); }
});

test("V05A: invalid boundary is rejected before a final name exists", () => {
  const f = fixture();
  try {
    const invalid = { ...f.boundary("0123abcd"), batchId: generateBatchId() };
    assert.throws(() => publishDeliveryReceipt(f.root, f.batch, invalid, TEST_VIEW_LIMITS.frameBytes), /does not match/);
    assert.equal(existsSync(runnerReceiptPathAt(f.root, "alice", f.batch.id)), false);
  } finally { f.close(); }
});

test("V05A: a crash at temp write never leaves partial bytes under the final name", () => {
  const f = fixture();
  try {
    const fail: DurabilityObserver = event => {
      if (event.point === "file-write" && event.phase === "ambiguous") throw new DurabilityFaultError(event);
    };
    assert.throws(() => publishWithFaults(f.root, f.batch, f.boundary("0123abcd"), TEST_VIEW_LIMITS.frameBytes, fail),
      error => error instanceof DurabilityFaultError);
    assert.equal(existsSync(runnerReceiptPathAt(f.root, "alice", f.batch.id)), false);
  } finally { f.close(); }
});

test("V05A: final publication followed by parent-fsync uncertainty preserves the valid final receipt", () => {
  const f = fixture();
  try {
    let validated = false;
    const fail: DurabilityObserver = event => {
      if (event.point === "destination-validate" && event.phase === "after-visible") validated = true;
      if (validated && event.point === "directory-fsync" && event.phase === "ambiguous")
        throw new DurabilityFaultError(event);
    };
    assert.throws(() => publishWithFaults(f.root, f.batch, f.boundary("0123abcd"), TEST_VIEW_LIMITS.frameBytes, fail),
      error => error instanceof DurabilityFaultError);
    const receipt = readDeliveryReceipt(f.root, f.batch, TEST_VIEW_LIMITS.frameBytes);
    assert.equal(receipt.entryId, "0123abcd");
  } finally { f.close(); }
});

test("V05B: EEXIST returns the first valid private receipt and never overwrites it", () => {
  const f = fixture();
  try {
    const first = publishDeliveryReceipt(f.root, f.batch, f.boundary("0123abcd"), TEST_VIEW_LIMITS.frameBytes);
    const path = runnerReceiptPathAt(f.root, "alice", f.batch.id);
    const bytes = readFileSync(path);
    const secondSession = join(runnerSessionDirPathAt(f.root, "alice"), "second.jsonl");
    writeFileSync(secondSession, '{"type":"session","version":3}\n');
    const repeated = publishDeliveryReceipt(f.root, f.batch, f.boundary("89abcdef", secondSession), TEST_VIEW_LIMITS.frameBytes);
    assert.deepEqual(repeated, first);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(lstatSync(path).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dirname(path)).sort(), [basename(path)]);
  } finally { f.close(); }
});

test("V05B: conflicting existing receipt is preserved and never converted to success", () => {
  const f = fixture();
  try {
    const path = runnerReceiptPathAt(f.root, "alice", f.batch.id);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const conflicting = `${JSON.stringify({
      schemaVersion: 1,
      actor: "mallory",
      messageIds: f.batch.messageIds,
      ...f.boundary("0123abcd"),
    })}\n`;
    writeFileSync(path, conflicting, { mode: 0o600 });
    assert.throws(() => publishDeliveryReceipt(f.root, f.batch, f.boundary("89abcdef"), TEST_VIEW_LIMITS.frameBytes),
      /does not match/);
    assert.equal(readFileSync(path, "utf8"), conflicting);
    assert.deepEqual(readdirSync(dirname(path)).sort(), [basename(path)]);
  } finally { f.close(); }
});
