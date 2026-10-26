import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
/** P0 replay-before-admission: a replay of an already-minted terminal receipt
 * is a read, not a new claim. The dispatcher looks up a key-required request's
 * durable receipt before the admission fence: a succeeded/failed row is
 * answered by the owning method (recorded receipt for an identical payload,
 * REQUEST_KEY_REUSED for a different one) even while admission is draining or
 * fenced corrupt -- neither answer mints acceptance, and the lookup itself is
 * a durable read needing no admission-held resource. Pending and unknown rows
 * are not minted receipts and keep the fence; so does every fresh key.
 * Real Store, MailModule, AdmissionGate and PublicDispatcher.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, ProtocolLimits, Request } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { PublicDispatcher } from "@oma/broker/public-dispatcher";
import { errorAnswer } from "@oma/broker/replies";
import { publicFailure, StoreError } from "@oma/domain/errors";
import { AdmissionGate } from "@oma/domain/admission";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { requestHash } from "@oma/domain/request-identity";
import { makeValidAgent, ALL_CAPS } from "./fixtures/spec.js";
import { makeValidMessagePlan } from "./fixtures/valid.js";
import { removeTree } from "./fixtures/cleanup.js";

const LIMITS: ProtocolLimits = {
  frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64,
  replyReferences: 64, contextFiles: 256, contextBytes: 8388608, bundleBytes: 268435456,
  logBytes: 1048576, batchMaxMessages: 24, idleStreamSeconds: 30, receiptWaitSeconds: 30,
};

const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };

type Answer = { ok: true; result: { operation?: string; state?: string } } | { ok: false; code: string | undefined };
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-replay-admission-"));
  const store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { try { store.close(); } finally { removeTree(root); } });
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" }));
    tx.insertAgent(makeValidAgent("bob", { createdBy: "principal" }));
  });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
  const admission = new AdmissionGate();
  const flags = { draining: false };
  const dispatcher = new PublicDispatcher({
    store: {
      listAgents: () => store.listAgents(),
      getAgent: actor => store.getAgent(actor),
      getReceipt: (actor, key) => { const operation = store.getOperation(actor, key); return operation ? receiptOfOperation(operation) : null; },
      hasOperation: (actor, key) => store.getOperation(actor, key) !== null,
    },
    mail,
    units: { statusSnapshot: () => Promise.reject(new Error("status is not part of this fixture")) },
    views: { status: () => { throw new Error("status is not part of this fixture"); } },
    lifecycle: {} as never,
    review: null,
git: null,
    limits: LIMITS,
    waitRun: () => { throw new Error("no live run in this fixture"); },
    isDraining: () => flags.draining,
    assertAdmission: () => admission.assertAdmission(),

    failureAnswer: (id, error) => errorAnswer(id, publicFailure(error)),
    refreshViews() {},
    readLogs: async () => { throw new Error("logs are not part of this fixture"); },
  });
  const call = async (envelope: Record<string, unknown>): Promise<Answer> => {
    const answer = await dispatcher.dispatch(auth, envelope as Request, null) as { ok: boolean; result?: { operation?: string; state?: string }; error?: { code?: string } };
    return answer.ok ? { ok: true, result: answer.result! } : { ok: false, code: answer.error?.code };
  };
  const corrupt = () => admission.observe(new StoreError("STORE_CORRUPT", "fixture corruption"));
  const drain = () => { flags.draining = true; admission.close(); };
  return { store, call, corrupt, drain };
}

const INPUT = { to: ["bob"], subject: "replay fence", kind: "message", body: "a body" };
const envelope = (key: string, params: unknown = INPUT) => ({ v: 1, id: key, method: "mail.send", request: key, params });

test("replay-before-admission: a terminal same-key replay answers the durable receipt under corrupt admission", async t => {
  const f = fixture(t);
  const accepted = await f.call(envelope("key-terminal"));
  assert.equal(accepted.ok && accepted.result.state, "succeeded");
  f.corrupt();
  const replay = await f.call(envelope("key-terminal"));
  assert.deepEqual(replay, accepted, "the minted receipt is a read: corruption cannot un-answer it");
  assert.equal(f.store.getOperation("alice", "key-terminal")?.id, accepted.ok ? accepted.result.operation : undefined,
    "no second operation was accepted");
});

test("replay-before-admission: a terminal same-key replay answers while admission is draining", async t => {
  const f = fixture(t);
  const accepted = await f.call(envelope("key-terminal"));
  assert.equal(accepted.ok && accepted.result.state, "succeeded");
  f.drain();
  assert.deepEqual(await f.call(envelope("key-terminal")), accepted);
});

test("replay-before-admission: a different payload under a terminal key is REQUEST_KEY_REUSED, not a claim", async t => {
  const f = fixture(t);
  assert.ok((await f.call(envelope("key-terminal"))).ok);
  f.corrupt();
  const reused = await f.call(envelope("key-terminal", { ...INPUT, body: "a different body" }));
  assert.deepEqual(reused, { ok: false, code: "REQUEST_KEY_REUSED" },
    "the ledger's own classification answers the refusal; no acceptance was minted");
});

test("replay-before-admission: pending and unknown rows are not minted receipts -- the fence still applies", async t => {
  const f = fixture(t);
  const pendingId = "op-00000000-0000-4000-8000-00000000a001";
  const unknownId = "op-00000000-0000-4000-8000-00000000a002";
  f.store.transaction(tx => {
    for (const [id, key] of [[pendingId, "key-pending"], [unknownId, "key-unknown"]] as const) {
      const message = makeValidMessagePlan(id, { recipient: "bob" });
      tx.acceptOperation({ id, actor: "alice", requestKey: key, requestHash: requestHash("mail.send", INPUT),
        kind: "mail.send", payloadJson: JSON.stringify(INPUT), planJson: serializePlanIntent({ kind: "mail.send", message }) });
      tx.insertDeliveries([{ messageId: message.id, recipient: "bob", operationId: id }]);
    }
    tx.setOperationUnknown(unknownId);
  });
  f.corrupt();
  assert.deepEqual(await f.call(envelope("key-pending")), { ok: false, code: "STORE_CORRUPT" },
    "a pending claim is unfinished work, not a read");
  assert.deepEqual(await f.call(envelope("key-unknown")), { ok: false, code: "STORE_CORRUPT" },
    "an unknown claim is unfinished work, not a read");
});

test("replay-before-admission: fresh keys keep the admission fence under corruption and drain", async t => {
  const f = fixture(t);
  f.corrupt();
  assert.deepEqual(await f.call(envelope("key-fresh")), { ok: false, code: "STORE_CORRUPT" });
  assert.equal(f.store.getOperation("alice", "key-fresh"), null, "a fenced fresh request leaves no row");

  const g = fixture(t);
  g.drain();
  assert.deepEqual(await g.call(envelope("key-fresh")), { ok: false, code: "BROKER_UNAVAILABLE" });
  assert.equal(g.store.getOperation("alice", "key-fresh"), null);
});

test("replay-before-admission: malformed params are refused before the receipt lookup, under corruption", async t => {
  const f = fixture(t);
  assert.ok((await f.call(envelope("key-terminal"))).ok);
  f.corrupt();
  for (const params of [{ ...INPUT, to: "bob" }, { ...INPUT, body: 42 }, "not-an-object"])
    assert.deepEqual(await f.call(envelope("key-terminal", params)), { ok: false, code: "INVALID_REQUEST" },
      `grammar failure precedes both admission and the durable lookup: ${JSON.stringify(params)}`);
});

test("replay-before-admission: reads are unchanged -- a receipt read answers under corruption but not drain", async t => {
  const f = fixture(t);
  assert.ok((await f.call(envelope("key-terminal"))).ok);
  const read = { v: 1, id: "r1", method: "operation.get", params: { key: "key-terminal" } };
  f.corrupt();
  const underCorrupt = await f.call(read);
  assert.equal(underCorrupt.ok && underCorrupt.result.state, "succeeded",
    "a plain read was never behind the acceptance fence");

  const g = fixture(t);
  assert.ok((await g.call(envelope("key-terminal"))).ok);
  g.drain();
  assert.deepEqual(await g.call(read), { ok: false, code: "BROKER_UNAVAILABLE" },
    "drain keeps its read policy; only the minted-receipt replay is exempted");
});
