import test from "node:test";
import assert from "node:assert/strict";
import fs, { existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { PreparedBatch } from "@oma/contracts";
import { generateBatchId, generateOperationId } from "@oma/native/identity";
import { messageIdForOperation } from "@oma/domain/derived";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import { publishDeliveryReceipt, readDeliveryReceipt } from "@oma/storage/delivery-receipt";
import { type DeliveryBoundary } from "@oma/contracts";
import { DurabilityFaultError, type DurabilityFault, type DurabilityObserver } from "@oma/storage/durable-fs";
import { runnerReceiptPathAt, runnerSessionDirPathAt } from "@oma/domain/paths";
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
  // DR11: a receipt is published only for a boundary the session holds.
  const entry = (id: string) => JSON.stringify({ type: "custom", customType: "oma-delivery-boundary", id, parentId: null,
    timestamp: "2026-09-25T00:00:00.000Z", data: { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id,
      incarnation: batch.incarnation, messageIds: batch.messageIds, sessionPath } });
  writeFileSync(sessionPath, `{"type":"session","version":3}\n${entry("0123abcd")}\n${entry("89abcdef")}\n`);
  const boundary = (entryId: string, path = sessionPath): DeliveryBoundary => ({
    adapterRevision: PI_ADAPTER_REVISION,
    batchId: batch.id,
    incarnation: batch.incarnation,
    sessionPath: path,
    entryId,
  });
  return { root, batch, sessionPath, boundary, entry, close: () => rmSync(root, { recursive: true, force: true }) };
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
    writeFileSync(secondSession, `{"type":"session","version":3}\n${f.entry("89abcdef")}\n`);
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

test("V05A: the receipt file itself is flushed before it is published, and its directory after", () => {
  // The fault seams name where a flush belongs; this watches the flushes
  // themselves, so a seam that fires without its fsync is caught.
  const f = fixture();
  const real = fs.fsyncSync;
  const flushes: string[] = [];
  fs.fsyncSync = (fd: number) => { flushes.push(fstatSync(fd).isFile() ? "file" : "directory"); return real(fd); };
  syncBuiltinESMExports();
  try {
    const order: string[] = [];
    let temporary = 0;
    publishWithFaults(f.root, f.batch, f.boundary("0123abcd"), TEST_VIEW_LIMITS.frameBytes, event => {
      // Only flushes after the receipt's own temporary exists are the receipt's:
      // the session evidence is flushed before it (DR11).
      if (event.point === "file-create" && event.phase === "after-visible") temporary = flushes.length;
      if (event.point === "publication-link" && event.phase === "before") order.push(`link after ${flushes.slice(temporary).join(",")}`);
    });
    assert.equal(order.length, 1);
    assert.match(order[0]!, /file/, `nothing flushed the receipt file before publication: ${order[0]}`);
    const link = temporary + order[0]!.replace("link after ", "").split(",").filter(Boolean).length;
    assert.ok(flushes.slice(link).includes("directory"), `the receipt directory was not flushed after publication: ${flushes.join(",")}`);
  } finally { fs.fsyncSync = real; syncBuiltinESMExports(); f.close(); }
});

test("DR11: no receipt is published for a boundary the session file does not hold", () => {
  const f = fixture();
  try {
    const path = runnerReceiptPathAt(f.root, "alice", f.batch.id);
    for (const [label, entryId, bytes] of [
      ["an unknown entry id", "fedcba98", null],
      ["another batch's entry", "0123abcd", f.entry("0123abcd").replace(f.batch.id, "b-00000000-0000-4000-8000-000000000000")],
      ["an entry cut off past the bounded window", "0123abcd", `${f.entry("0123abcd")}\n${"x".repeat(TEST_VIEW_LIMITS.frameBytes)}\n`],
    ] as const) {
      if (bytes !== null) writeFileSync(f.sessionPath, `{"type":"session","version":3}\n${bytes}\n`);
      assert.throws(() => publishDeliveryReceipt(f.root, f.batch, f.boundary(entryId), TEST_VIEW_LIMITS.frameBytes),
        { code: "SESSION_BOUNDARY_UNCONFIRMED" }, label);
      assert.equal(existsSync(path), false, `${label}: no receipt name exists`);
    }
  } finally { f.close(); }
});

test("DR11: the session file and its directory are flushed before the receipt's name exists", () => {
  const f = fixture();
  const real = fs.fsyncSync;
  const flushed: string[] = [];
  const session = fstatSync(fs.openSync(f.sessionPath, "r"));
  const directory = fstatSync(fs.openSync(dirname(f.sessionPath), "r"));
  fs.fsyncSync = (fd: number) => {
    const stat = fstatSync(fd);
    if (stat.ino === session.ino) flushed.push("session");
    else if (stat.ino === directory.ino) flushed.push("session-directory");
    return real(fd);
  };
  syncBuiltinESMExports();
  try {
    let atLink: string[] | null = null;
    publishWithFaults(f.root, f.batch, f.boundary("0123abcd"), TEST_VIEW_LIMITS.frameBytes, event => {
      if (event.point === "publication-link" && event.phase === "before") atLink = [...flushed];
    });
    assert.deepEqual(atLink, ["session", "session-directory"]);
  } finally { fs.fsyncSync = real; syncBuiltinESMExports(); f.close(); }
});

test("DR11: a crash after the session flush and before the receipt leaves no receipt, and the retry publishes it", () => {
  const f = fixture();
  try {
    const path = runnerReceiptPathAt(f.root, "alice", f.batch.id);
    assert.throws(() => publishWithFaults(f.root, f.batch, f.boundary("0123abcd"), TEST_VIEW_LIMITS.frameBytes, event => {
      if (event.point === "evidence-fsync" && event.phase === "after-visible") throw new DurabilityFaultError(event);
    }), DurabilityFaultError);
    assert.equal(existsSync(path), false, "the evidence is durable but the receipt was not published");
    const receipt = publishDeliveryReceipt(f.root, f.batch, f.boundary("0123abcd"), TEST_VIEW_LIMITS.frameBytes);
    assert.deepEqual(readDeliveryReceipt(f.root, f.batch, TEST_VIEW_LIMITS.frameBytes), receipt);
  } finally { f.close(); }
});
