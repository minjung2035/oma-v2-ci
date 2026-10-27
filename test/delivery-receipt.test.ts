import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext } from "@oma/contracts";
import { MailModule } from "@oma/mail";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import { publishDeliveryReceipt } from "@oma/storage/delivery-receipt";
import { Store } from "@oma/storage";
import {
  runnerReceiptPathAt,
  runnerSessionDirPathAt,
} from "@oma/domain/paths";
import { ALL_CAPS, storedSpec } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { writeBoundarySession } from "./fixtures/delivery-receipt.js";

function auth(): AuthContext {
  return {
    actor: "alice",
    incarnation: 1,
    role: "resident",
    channel: "actor",
    capabilities: new Set(["mail.send"]),
    peer: { pid: 1, uid: 1, gid: 1 },
  };
}
test("S-03: only the pinned durable Pi boundary receipt completes a prepared batch", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oma-receipt-"));
  mkdirSync(root, { recursive: true });
  const store = new Store(join(root, "runtime.sqlite"));
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  store.transaction(() =>
    store.insertAgent({
      name: "alice",
      ...storedSpec(ALL_CAPS, "p", "alice"),
      role: "resident",
      desired: "enabled",
      incarnation: 1,
      profile: "p",
      createdBy: null,
    }),
  );
  const mail = createMailModule(
    { stateRoot: root, society: "demo" },
    store,
    64,
    TEST_VIEW_LIMITS.batchMaxMessages,
    TEST_VIEW_LIMITS,
  );
  await mail.send(auth(), "self", {
    to: ["alice"],
    subject: "hello",
    kind: "message",
    body: "body",
  });
  const batch = await mail.prepare(auth());
  assert.ok(batch);
  await assert.rejects(
    mail.complete(auth(), {
      batchId: batch.id,
      incarnation: 1,
      sessionPath: "/tmp/forged",
      adapterRevision: PI_ADAPTER_REVISION,
      receiptPath: runnerReceiptPathAt(root, "alice", batch.id),
    }),
    // No receipt exists yet: insufficient evidence, not an ownership conflict.
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "SESSION_BOUNDARY_UNCONFIRMED",
  );
  assert.equal(store.getDelivery(batch.messageIds[0]!, "alice")?.presented, 0);
  const sessions = runnerSessionDirPathAt(root, "alice");
  mkdirSync(sessions, { recursive: true });
  const sessionPath = join(sessions, "settled.jsonl");
  writeBoundarySession(sessionPath, batch, "0123abcd");
  const receipt = publishDeliveryReceipt(
    root,
    batch,
    {
      adapterRevision: PI_ADAPTER_REVISION,
      batchId: batch.id,
      incarnation: batch.incarnation,
      sessionPath,
      entryId: "0123abcd",
    },
    TEST_VIEW_LIMITS.frameBytes,
  );
  await mail.complete(auth(), {
    batchId: batch.id,
    incarnation: batch.incarnation,
    sessionPath: receipt.sessionPath,
    adapterRevision: PI_ADAPTER_REVISION,
    receiptPath: runnerReceiptPathAt(root, "alice", batch.id),
  });
  assert.equal(store.getBatch(batch.id)?.state, "completed");
  assert.equal(store.getBatch(batch.id)?.sessionPath, sessionPath);
  assert.equal(store.getDelivery(batch.messageIds[0]!, "alice")?.presented, 1);
  await mail.complete(auth(), {
    batchId: batch.id,
    incarnation: batch.incarnation,
    sessionPath: receipt.sessionPath,
    adapterRevision: PI_ADAPTER_REVISION,
    receiptPath: runnerReceiptPathAt(root, "alice", batch.id),
  });
});
