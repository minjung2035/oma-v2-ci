import { lifecycleLedger } from "#oma-test/app/broker/lifecycle-ledger";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AuthContext, MailInput } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { operationMessage } from "@oma/mail/materializer";
import { RegistryOperations } from "@oma/lifecycle/registry-operations";
import { PublicDispatcher } from "@oma/broker/public-dispatcher";
import { errorAnswer } from "@oma/broker/replies";
import { publicFailure } from "@oma/domain/errors";
import { AdmissionGate, bindAdmissionGate } from "@oma/domain/admission";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { residentUnitsFor } from "@oma/domain/derived";
import { generateOperationId } from "@oma/native/identity";
import { messageIdForOperation as generateMessageId } from "@oma/domain/derived";
import { requestHash } from "@oma/domain/request-identity";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import {
  ALL_CAPS,
  makeValidAgent,
  makeValidResolvedSpec,
} from "./fixtures/spec.js";
const limits = {
  frameBytes: 262144,
  mailBodyBytes: 262144,
  subjectBytes: 512,
  addresses: 64,
  replyReferences: 64,
  contextFiles: 256,
  contextBytes: 8388608,
  bundleBytes: 268435456,
  logBytes: 1048576,
  batchMaxMessages: 24,
  idleStreamSeconds: 30,
  receiptWaitSeconds: 30,
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-reply-boundary-"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction((tx) => {
    tx.insertAgent(makeValidAgent("alice"));
    tx.insertAgent(makeValidAgent("bob", { createdBy: "alice" }));
  });
  const mail = createMailModule(
    { stateRoot: root, society: "fixture" },
    store,
    64,
  );
  const gate = new AdmissionGate();
  bindAdmissionGate(store, gate);
  const auth: AuthContext = {
    actor: "alice",
    incarnation: 1,
    role: "resident",
    channel: "actor",
    capabilities: new Set(ALL_CAPS),
    peer: { pid: process.pid, uid: 1000, gid: 1000 },
  };
  const unused = (): never => {
    throw new Error("unrelated fixture effect");
  };
  const dispatcher = new PublicDispatcher({ waitRun: () => { throw new Error("no live run in this fixture"); },
    store: {
      listAgents: () => store.listAgents(),
      getAgent: (actor) => store.getAgent(actor),
      getReceipt: (actor, key) => {
        const row = store.getOperation(actor, key);
        return row ? receiptOfOperation(row) : null;
      },
      hasOperation: (actor, key) => store.getOperation(actor, key) !== null,
    },
    mail,
    units: { statusSnapshot: unused },
    views: { status: unused },
    review: null,
git: null,
    lifecycle: {
      create: async () => unused(),
      start: unused,
      stop: unused,
      ack: unused,
      follow: unused,
    },
    limits,
    isDraining: () => false,
    assertAdmission: () => gate.assertAdmission(),

    refreshViews() {},
    readLogs: async () => unused(),
    failureAnswer: (id, error) => {
      gate.observe(error);
      return errorAnswer(id, publicFailure(error));
    },
  });
  const input: MailInput = {
    to: ["bob"],
    subject: "test",
    body: "ordinary body",
    kind: "message",
  };
  return {
    root,
    store,
    mail,
    gate,
    auth,
    dispatch: (key: string, replyToMessage?: string) =>
      dispatcher.dispatch(
        auth,
        {
          v: 1,
          id: key,
          method: "mail.send",
          request: key,
          params: { ...input, ...(replyToMessage ? { replyToMessage } : {}) },
        },
        null,
      ),
    async creation() {
      const original = generateOperationId();
      const linked = generateOperationId();
      const spec = makeValidResolvedSpec("bob");
      const { message } = await mail.freezeCreateInitial(
        auth,
        original,
        "bob",
        spec.brief,
      );
      const payload = { name: "bob", from: spec.from, brief: spec.brief };
      const plan = {
        kind: "agent.create",
        spec,
        specHash: resolvedSpecDigest(spec),
        parent: "alice",
        workspacePath: join(root, "agents/bob/workspace"),
        unitNames: residentUnitsFor("fixture", "bob"),
        existingCreation: null,
        initialMessage: message,
      };
      store.transaction((tx) => {
        tx.acceptOperation({
          id: original,
          kind: "agent.create",
          actor: "alice",
          requestKey: "original-create",
          requestHash: requestHash("agent.create", payload),
          payloadJson: JSON.stringify(payload),
          planJson: serializePlanIntent(plan),
        });
        tx.insertDeliveries([
          { operationId: original, messageId: message.id, recipient: "bob" },
        ]);
        tx.acceptOperation({
          id: linked,
          kind: "agent.create",
          actor: "alice",
          requestKey: "linked-create",
          requestHash: requestHash("agent.create", payload),
          payloadJson: JSON.stringify(payload),
          planJson: serializePlanIntent({
            ...plan,
            existingCreation: original,
            initialMessage: null,
          }),
        });
      });
      return { original, linked };
    },
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("F1: semantic reply errors leave admission healthy and later mail is accepted", async () => {
  const f = fixture();
  try {
    const follow = new RegistryOperations(lifecycleLedger(f.store), { nextOperationId: generateOperationId }).follow(
      f.auth,
      "work",
      true,
      "follow",
    );
    const creation = await f.creation();
    // Internal publication invariants are still strict; only caller selection differs.
    assert.throws(
      () => operationMessage(f.store.getOperationById(follow.operation)!),
      { code: "STORE_CORRUPT" },
    );
    assert.throws(
      () => operationMessage(f.store.getOperationById(creation.linked)!),
      { code: "STORE_CORRUPT" },
    );
    const targets = [
      generateMessageId(follow.operation, 0),
      generateMessageId(creation.linked, 0),
      generateMessageId(creation.original, 1),
      generateMessageId(generateOperationId(), 0),
    ];
    for (const [i, target] of targets.entries()) {
      const key = `invalid-${i}`;
      const reply = await f.dispatch(key, target);
      assert.equal("ok" in reply && reply.ok, false);
      assert.equal(
        "error" in reply && (reply.error as { code: string }).code,
        "INVALID_REQUEST",
      );
      assert.equal(f.store.getOperation("alice", key), null);
      assert.equal(f.gate.state, "healthy");
    }
    const accepted = await f.dispatch(
      "valid-reply",
      generateMessageId(creation.original, 0),
    );
    assert.equal("ok" in accepted && accepted.ok, true);
    assert.equal(
      f.store.getOperation("alice", "valid-reply")?.state,
      "succeeded",
    );
  } finally {
    f.close();
  }
});

test("F1: corrupt accepted message bytes still fence subsequent new acceptance", async () => {
  const f = fixture();
  try {
    await f.dispatch("original-mail");
    const row = f.store.getOperation("alice", "original-mail")!;
    const message = operationMessage(row);
    const path = f.mail.objectPath(message.id);
    chmodSync(path, 0o600);
    writeFileSync(path, "corrupt fixture bytes");
    const reply = await f.dispatch("corrupt-reply", message.id);
    assert.equal(
      "error" in reply && (reply.error as { code: string }).code,
      "STORE_CORRUPT",
    );
    assert.equal(f.gate.state, "corrupt");
    assert.equal(f.store.getOperation("alice", "corrupt-reply"), null);
    const blocked = await f.dispatch("after-corruption");
    assert.equal(
      "error" in blocked && (blocked.error as { code: string }).code,
      "STORE_CORRUPT",
    );
    assert.equal(f.store.getOperation("alice", "after-corruption"), null);
  } finally {
    f.close();
  }
});
