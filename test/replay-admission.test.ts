import { replayFixture } from "./fixtures/replay.js";
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

import { StoreError } from "@oma/domain/errors";
import { AdmissionGate } from "@oma/domain/admission";
import { requestHash } from "@oma/domain/request-identity";
import { makeValidMessagePlan } from "./fixtures/valid.js";

function fixture(t: TestContext) {
  const admission = new AdmissionGate();
  let draining = false;
  return { ...replayFixture(t, { isDraining: () => draining, assertAdmission: () => admission.assertAdmission() }),
    corrupt: () => admission.observe(new StoreError("STORE_CORRUPT", "fixture corruption")),
    drain: () => { draining = true; admission.close(); } };
}

const INPUT = { to: ["bob"], subject: "replay fence", kind: "message", body: "a body" };
const envelope = (key: string, params: unknown = INPUT) => ({ v: 1, id: key, method: "mail.send", request: key, params });

test("001. Replay-before-admission: a terminal same-key replay answers the durable receipt under corrupt admission", async t => {
  const f = fixture(t);
  const accepted = await f.call(envelope("key-terminal"));
  assert.equal(accepted.ok && accepted.result.state, "succeeded");
  f.corrupt();
  const replay = await f.call(envelope("key-terminal"));
  assert.deepEqual(replay, accepted, "the minted receipt is a read: corruption cannot un-answer it");
  assert.equal(f.store.getOperation("alice", "key-terminal")?.id, accepted.ok ? accepted.result.operation : undefined,
    "no second operation was accepted");
});

test("002. Replay-before-admission: a terminal same-key replay answers while admission is draining", async t => {
  const f = fixture(t);
  const accepted = await f.call(envelope("key-terminal"));
  assert.equal(accepted.ok && accepted.result.state, "succeeded");
  f.drain();
  assert.deepEqual(await f.call(envelope("key-terminal")), accepted);
});

test("003. Replay-before-admission: a different payload under a terminal key is REQUEST_KEY_REUSED, not a claim", async t => {
  const f = fixture(t);
  assert.ok((await f.call(envelope("key-terminal"))).ok);
  f.corrupt();
  const reused = await f.call(envelope("key-terminal", { ...INPUT, body: "a different body" }));
  assert.deepEqual(reused, { ok: false, code: "REQUEST_KEY_REUSED" },
    "the ledger's own classification answers the refusal; no acceptance was minted");
});

test("004. Replay-before-admission: pending and unknown rows are not minted receipts -- the fence still applies", async t => {
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

test("005. Replay-before-admission: fresh keys keep the admission fence under corruption and drain", async t => {
  const f = fixture(t);
  f.corrupt();
  assert.deepEqual(await f.call(envelope("key-fresh")), { ok: false, code: "STORE_CORRUPT" });
  assert.equal(f.store.getOperation("alice", "key-fresh"), null, "a fenced fresh request leaves no row");

  const g = fixture(t);
  g.drain();
  assert.deepEqual(await g.call(envelope("key-fresh")), { ok: false, code: "BROKER_UNAVAILABLE" });
  assert.equal(g.store.getOperation("alice", "key-fresh"), null);
});

test("006. Replay-before-admission: malformed params are refused before the receipt lookup, under corruption", async t => {
  const f = fixture(t);
  assert.ok((await f.call(envelope("key-terminal"))).ok);
  f.corrupt();
  for (const params of [{ ...INPUT, to: "bob" }, { ...INPUT, body: 42 }, "not-an-object"])
    assert.deepEqual(await f.call(envelope("key-terminal", params)), { ok: false, code: "INVALID_REQUEST" },
      `grammar failure precedes both admission and the durable lookup: ${JSON.stringify(params)}`);
});

test("007. Replay-before-admission: reads are unchanged -- a receipt read answers under corruption but not drain", async t => {
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
