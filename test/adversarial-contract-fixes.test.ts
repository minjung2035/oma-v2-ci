import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
import { readableBody } from "@oma/mail/display";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEml, MailModule } from "@oma/mail";
import {
  messagePlanCheck,
  operationResultCheck,
} from "@oma/domain/validation";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { LineageSnapshot } from "@oma/domain/lineage";
import { ALL_CAPS, makeValidAgent, storedSpec } from "./fixtures/spec.js";
import { requestHash } from "@oma/domain/request-identity";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { readBatchView } from "@oma/tool-runtime/batch-view";
import type { MessagePlan } from "@oma/contracts";

const MESSAGE_ID = "m-00000000-0000-4000-8000-000000000000-0";

function tempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("adversarial: EML header casing never rewrites collision text in the body", async () => {
  const eml = await buildEml({
    from: "alice@demo.oma.invalid",
    to: ["principal@demo.oma.invalid"],
    replyTo: [],
    subject: "collision",
    kind: "message",
    contextRevision: null,
    inReplyTo: null,
    references: [],
    messageId: `${MESSAGE_ID}@demo.oma.invalid`,
    body: "first X-Oma-Kind: marker\nX-Oma-Context: marker",
  });
  const body = readableBody(eml.text);
  assert.equal(body, "first X-Oma-Kind: marker\nX-Oma-Context: marker");
  assert.match(body, /X-Oma-Kind: marker/);
  assert.match(body, /X-Oma-Context: marker/);
});

test("adversarial: persisted MessagePlan accepts logical addresses only", () => {
  const plan: MessagePlan = {
    id: MESSAGE_ID,
    objectPath: `mail/objects/${MESSAGE_ID}.eml`,
    sha256: "0".repeat(64),
    bytes: 1,
    dateMs: 1,
    to: ["commons"],
    recipients: ["alice"],
    kind: "message",
    contextRevision: null,
    replyHeaders: {
      replyTo: ["topic/dev"],
      inReplyTo: null,
      references: [],
    },
  };
  assert.equal(messagePlanCheck(plan), null);
  assert.notEqual(messagePlanCheck({ ...plan, bytes: 0 }), null);
  assert.notEqual(
    messagePlanCheck({ ...plan, to: ["commons@demo.oma.invalid"] }),
    null,
  );
  assert.notEqual(
    messagePlanCheck({ ...plan, to: ["garbage-not-an-address!"] }),
    null,
  );
  assert.notEqual(
    messagePlanCheck({
      ...plan,
      replyHeaders: {
        ...plan.replyHeaders,
        replyTo: ["alice@demo.oma.invalid"],
      },
    }),
    null,
  );
});

test("adversarial: approval plan and immutable EML headers must be identical", async () => {
  const root = tempRoot("oma-approval-");
  const store = new Store(join(root, "runtime.sqlite"));
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 8);
  const actual = {
    repo: "project" as const,
    targetRef: "refs/heads/main" as const,
    expectedBase: "1".repeat(40),
    candidate: "2".repeat(40),
    policyRevision: "정책-v1",
  };
  try {
    const eml = await buildEml({
      from: "alice@demo.oma.invalid",
      to: ["principal@demo.oma.invalid"],
      replyTo: ["alice@demo.oma.invalid"],
      subject: "approval",
      kind: "approval_required",
      approvalFor: actual,
      contextRevision: null,
      inReplyTo: null,
      references: [],
      messageId: `${MESSAGE_ID}@demo.oma.invalid`,
      body: "review",
    });
    mail.freezeObject(MESSAGE_ID, eml);
    const plan: MessagePlan = {
      id: MESSAGE_ID,
      objectPath: `mail/objects/${MESSAGE_ID}.eml`,
      sha256: eml.sha256,
      bytes: eml.bytes,
      dateMs: 1,
      to: ["principal"],
      recipients: ["principal"],
      kind: "approval_required",
      approvalFor: { ...actual, candidate: "3".repeat(40) },
      contextRevision: null,
      replyHeaders: {
        replyTo: ["alice"],
        inReplyTo: null,
        references: [],
      },
    };
    const internal = mail as unknown as {
      materializer: { headers(message: MessagePlan): unknown };
    };
    assert.throws(
      () => internal.materializer.headers(plan),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("adversarial: operation results are closed and kind-specific", () => {
  const valid = {
    kind: "route.follow",
    topic: "dev",
    subscribed: true,
  };
  assert.equal(operationResultCheck("route.follow")(valid), null);
  assert.notEqual(
    operationResultCheck("route.follow")({ ...valid, extra: true }),
    null,
  );
  assert.notEqual(
    operationResultCheck("route.follow")({ ...valid, kind: "route.unfollow" }),
    null,
  );
});

test("adversarial: freezeObject is immutable and collision checked", () => {
  const root = tempRoot("oma-freeze-");
  const store = new Store(join(root, "runtime.sqlite"));
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 8);
  try {
    mail.freezeObject(MESSAGE_ID, { text: "same" });
    mail.freezeObject(MESSAGE_ID, { text: "same" });
    assert.throws(
      () => mail.freezeObject(MESSAGE_ID, { text: "different" }),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
    assert.equal(readFileSync(mail.objectPath(MESSAGE_ID), "utf8"), "same");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("adversarial: terminal operation state cannot be rewritten", () => {
  const root = tempRoot("oma-terminal-");
  const store = new Store(join(root, "runtime.sqlite"));
  const operation = "op-00000000-0000-4000-8000-000000000001";
  try {
    store.transaction(() => {
      store.insertAgent({
        name: "alice",
        ...storedSpec(ALL_CAPS, "resident", "alice"),
        role: "resident",
        desired: "enabled",
        incarnation: 0,
        profile: "resident",
        createdBy: null,
      });
      store.insertOperation({
        id: operation,
        actor: "alice",
        requestKey: "terminal-key",
        requestHash: requestHash("route.follow", { topic: "dev" }),
        kind: "route.follow",
        payloadJson: JSON.stringify({ topic: "dev" }),
        planJson: serializePlanIntent({
          kind: "route.follow",
          topic: "dev",
          agent: "alice",
        }),
      });
      store.setOperationSucceeded(
        operation,
        JSON.stringify({
          kind: "route.follow",
          topic: "dev",
          subscribed: true,
        }),
      );
    });
    assert.throws(
      () => store.transaction(() => store.setOperationUnknown(operation)),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
    assert.throws(
      () =>
        store.transaction(() =>
          store.setOperationFailed(operation, "INTERNAL_ERROR"),
        ),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
    assert.equal(store.getOperationById(operation)?.state, "succeeded");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});



test("adversarial: trusted Pi batch view is a closed runtime DTO", () => {
  const root = tempRoot("oma-batch-view-");
  const batchId = "b-00000000-0000-4000-8000-000000000001";
  const file = join(root, `batch-${batchId}.json`);
  const valid = {
    id: batchId,
    agent: "alice",
    incarnation: 1,
    deliveryMode: "followUp",
    notice: "mail",
    messageIds: [MESSAGE_ID],
  };
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(file, JSON.stringify(valid));
    assert.deepEqual(readBatchView(batchId, root, TEST_VIEW_LIMITS), valid);
    writeFileSync(file, JSON.stringify({ ...valid, extra: true }));
    assert.equal(readBatchView(batchId, root, TEST_VIEW_LIMITS), null);
    writeFileSync(file, JSON.stringify({ ...valid, messageIds: [7] }));
    assert.equal(readBatchView(batchId, root, TEST_VIEW_LIMITS), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
