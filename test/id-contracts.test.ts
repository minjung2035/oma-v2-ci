import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isValidBatchId,
  isValidMessageId,
  isValidOperationId,
  parseMessageId,
} from "../src/ids.js";
import { mailAckParamsCheck, messagePlanCheck } from "../src/validate.js";
import { operationPlanCheck } from "../src/durable.js";
import { readBatchView } from "../src/pi-extension.js";

const UUID = "00000000-0000-4000-8000-000000000001";
const OP = `op-${UUID}`;
const MESSAGE = `m-${UUID}-0`;
const BATCH = `b-${UUID}`;
const BAD_VERSION = "00000000-0000-1000-8000-000000000001";
const BAD_VARIANT = "00000000-0000-4000-7000-000000000001";

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

  const plan = {
    id: MESSAGE,
    objectPath: `mail/objects/${MESSAGE}.eml`,
    sha256: "a".repeat(64),
    bytes: 1,
    dateMs: 1,
    to: ["alice"],
    recipients: ["alice"],
    kind: "message",
    contextRevision: null,
    replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] },
  };
  assert.equal(messagePlanCheck(plan), null);
  assert.notEqual(
    messagePlanCheck({
      ...plan,
      id: `m-${BAD_VERSION}-0`,
      objectPath: `mail/objects/m-${BAD_VERSION}-0.eml`,
    }),
    null,
  );
});

test("DB-009/ID-002: durable lifecycle operation references require UUIDv4", () => {
  const check = operationPlanCheck("agent.start", {
    operationId: OP,
    actor: "alice",
    stateRoot: "/tmp/state",
    repositoryIdentity: { society: "demo" },
  });
  assert.equal(
    check({
      kind: "agent.start",
      agent: "alice",
      previousIncarnation: 0,
      desired: "enabled",
      remainingOperations: [],
    }),
    null,
  );
  assert.notEqual(
    check({
      kind: "agent.start",
      agent: "alice",
      previousIncarnation: 0,
      desired: "enabled",
      remainingOperations: [`op-${BAD_VERSION}`],
    }),
    null,
  );
  assert.notEqual(
    operationPlanCheck("agent.start", {
      operationId: `op-${BAD_VERSION}`,
      actor: "alice",
      stateRoot: "/tmp/state",
      repositoryIdentity: { society: "demo" },
    })({
      kind: "agent.start",
      agent: "alice",
      previousIncarnation: 0,
      desired: "enabled",
      remainingOperations: [],
    }),
    null,
  );
});

test("PI-002/M-003: batch view rejects non-v4 batch and message identities", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-id-batch-"));
  try {
    const valid = {
      id: BATCH,
      agent: "alice",
      incarnation: 1,
      deliveryMode: "followUp",
      notice: "mail",
      messageIds: [MESSAGE],
    };
    writeFileSync(join(root, `batch-${BATCH}.json`), JSON.stringify(valid));
    assert.deepEqual(readBatchView(BATCH, root), valid);

    const badBatch = `b-${BAD_VERSION}`;
    writeFileSync(
      join(root, `batch-${badBatch}.json`),
      JSON.stringify({ ...valid, id: badBatch }),
    );
    assert.equal(readBatchView(badBatch, root), null);

    writeFileSync(
      join(root, `batch-${BATCH}.json`),
      JSON.stringify({ ...valid, messageIds: [`m-${BAD_VARIANT}-0`] }),
    );
    assert.equal(readBatchView(BATCH, root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
