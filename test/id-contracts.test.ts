import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidBatchId, isValidMessageId, isValidOperationId, parseMessageId } from "@oma/domain/identifiers";
import { mailAckParamsCheck, messagePlanCheck } from "@oma/domain/validation";
import { operationPlanCheck } from "@oma/domain/durable";
import { readBatchView } from "@oma/tool-runtime/batch-view";
import { decodeBatchViewText as hostDecode, encodeBatchView } from "@oma/protocol/batch-view";

const UUID = "00000000-0000-4000-8000-000000000001";
const OP = `op-${UUID}`;
const MESSAGE = `m-${UUID}-0`;
const BATCH = `b-${UUID}`;
const BAD_VERSION = "00000000-0000-1000-8000-000000000001";
const BAD_VARIANT = "00000000-0000-4000-7000-000000000001";
const VIEW_LIMITS = { frameBytes: 4096, batchMaxMessages: 24 };

test("ID-002: operation/message/batch ids require canonical lowercase UUIDv4", () => {
  assert.equal(isValidOperationId(OP), true);
  assert.equal(isValidMessageId(MESSAGE), true);
  assert.equal(isValidBatchId(BATCH), true);
  assert.deepEqual(parseMessageId(MESSAGE), { operationId: OP, ordinal: 0 });
  for (const uuid of [BAD_VERSION, BAD_VARIANT]) {
    assert.equal(isValidOperationId(`op-${uuid}`), false);
    assert.equal(isValidMessageId(`m-${uuid}-0`), false);
    assert.equal(isValidBatchId(`b-${uuid}`), false);
    assert.equal(parseMessageId(`m-${uuid}-0`), null);
  }
  assert.equal(isValidOperationId("op-00000000000040008000000000000001"), false);
  assert.equal(isValidMessageId(`m-${UUID}-9007199254740992`), false);
  assert.equal(isValidOperationId(OP.toUpperCase()), false);
});

test("M-003/ID-002: public and persisted message boundaries reject pseudo UUIDs", () => {
  assert.equal(mailAckParamsCheck({ message: MESSAGE }), null);
  assert.notEqual(mailAckParamsCheck({ message: `m-${BAD_VERSION}-0` }), null);
  const plan = { id: MESSAGE, objectPath: `mail/objects/${MESSAGE}.eml`, sha256: "a".repeat(64), bytes: 1,
    dateMs: 1, to: ["alice"], recipients: ["alice"], kind: "message", contextRevision: null,
    replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] } };
  assert.equal(messagePlanCheck(plan), null);
  assert.notEqual(messagePlanCheck({ ...plan, id: `m-${BAD_VERSION}-0`, objectPath: `mail/objects/m-${BAD_VERSION}-0.eml` }), null);
});

test("DB-009/ID-002: durable lifecycle operation references require UUIDv4", () => {
  const check = operationPlanCheck("agent.start", { operationId: OP, actor: "alice", stateRoot: "/tmp/state", repositoryIdentity: { society: "demo" } });
  const plan = { kind: "agent.start", agent: "alice", previousIncarnation: 0, desired: "enabled", remainingOperations: [] };
  assert.equal(check(plan), null);
  assert.notEqual(check({ ...plan, remainingOperations: [`op-${BAD_VERSION}`] }), null);
  assert.notEqual(operationPlanCheck("agent.start", { operationId: `op-${BAD_VERSION}`, actor: "alice", stateRoot: "/tmp/state", repositoryIdentity: { society: "demo" } })(plan), null);
});

test("PI-002/M-003: batch view rejects non-v4 batch and message identities", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-id-batch-"));
  try {
    const valid = { id: BATCH, agent: "alice", incarnation: 1, deliveryMode: "followUp", notice: "mail", messageIds: [MESSAGE] };
    writeFileSync(join(root, `batch-${BATCH}.json`), JSON.stringify(valid));
    assert.deepEqual(readBatchView(BATCH, root, VIEW_LIMITS), valid);
    const badBatch = `b-${BAD_VERSION}`;
    writeFileSync(join(root, `batch-${badBatch}.json`), JSON.stringify({ ...valid, id: badBatch }));
    assert.equal(readBatchView(badBatch, root, VIEW_LIMITS), null);
    writeFileSync(join(root, `batch-${BATCH}.json`), JSON.stringify({ ...valid, messageIds: [`m-${BAD_VARIANT}-0`] }));
    assert.equal(readBatchView(BATCH, root, VIEW_LIMITS), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("R28: the protocol codec and isolated file reader preserve the six-field schema and reject invalid input", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-batch-codec-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const valid = { id: BATCH, agent: "alice", incarnation: 1, deliveryMode: "followUp" as const, notice: "새 메일 🙂", messageIds: [MESSAGE] };
  const raw = encodeBatchView({ ...valid, sessionPath: "/private/session", indexPath: "/inbox.md" }, VIEW_LIMITS);
  assert.deepEqual(JSON.parse(raw), valid);
  assert.equal(raw.includes("/private/session"), false);
  assert.deepEqual(hostDecode(raw, BATCH, VIEW_LIMITS), valid);
  // PR-002: the Principal receives batches too, and both sides agree on it.
  const principal = { ...valid, agent: "principal" };
  const principalText = JSON.stringify(principal);
  assert.deepEqual(hostDecode(principalText, BATCH, VIEW_LIMITS), principal);
  // Ordinal spellings both sides accept decode to the same id on both sides.
  for (const ordinal of ["0", "01", "1", "007"]) {
    const text = JSON.stringify({ ...valid, messageIds: [`m-${UUID}-${ordinal}`] });
    assert.deepEqual(hostDecode(text, BATCH, VIEW_LIMITS), { ...valid, messageIds: [`m-${UUID}-${ordinal}`] }, ordinal);
  }
  const invalid: unknown[] = [null, [], { ...valid, id: `b-${BAD_VERSION}` }, { ...valid, id: `b-${BAD_VARIANT}` },
    // Every reserved name except the Principal is an address, never a
    // recipient of a delivery (PR-002).
    { ...valid, agent: "commons" }, { ...valid, agent: "residents" }, { ...valid, agent: "topic" },
    { ...valid, agent: "broker" }, { ...valid, agent: "principal-relay" }, { ...valid, agent: "reconcile" },
    { ...valid, agent: "topic-test" }, { ...valid, agent: "Alice" }, { ...valid, agent: "Principal" },
    { ...valid, incarnation: "1" }, { ...valid, incarnation: -1 }, { ...valid, incarnation: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, deliveryMode: "prompt" }, { ...valid, notice: 1 }, { ...valid, notice: "🙂".repeat(4096) },
    { ...valid, messageIds: [MESSAGE, MESSAGE] }, { ...valid, messageIds: [`m-${BAD_VERSION}-0`] },
    { ...valid, messageIds: [`m-${BAD_VARIANT}-0`] }, { ...valid, messageIds: [`m-${UUID}-9007199254740992`] },
    // These independent malformed spellings reach the codec and actual file reader.
    { ...valid, messageIds: [`m-${UUID}-+1`] }, { ...valid, messageIds: [`m-${UUID}- 1`] },
    { ...valid, messageIds: [`m-${UUID}-0e1`] }, { ...valid, messageIds: [`m-${UUID}-1.0`] },
    { ...valid, sessionPath: "/private/session" }, { ...valid, extra: true }];
  for (const value of invalid) {
    const text = JSON.stringify(value);
    assert.equal(hostDecode(text, BATCH, VIEW_LIMITS), null);
    writeFileSync(join(root, `batch-${BATCH}.json`), text);
    assert.equal(readBatchView(BATCH, root, VIEW_LIMITS), null);
  }
  const bytes = Buffer.byteLength(raw);
  for (const decode of [hostDecode]) {
    assert.deepEqual(decode(raw, BATCH, { frameBytes: bytes, batchMaxMessages: 1 }), valid);
    assert.equal(decode(raw, BATCH, { frameBytes: bytes - 1, batchMaxMessages: 1 }), null);
    assert.equal(decode(raw, BATCH, { frameBytes: bytes, batchMaxMessages: 0 }), null);
    assert.equal(decode("{", BATCH, VIEW_LIMITS), null);
    assert.equal(decode(JSON.stringify({ ...valid, notice: undefined }), BATCH, VIEW_LIMITS), null);
  }
});
