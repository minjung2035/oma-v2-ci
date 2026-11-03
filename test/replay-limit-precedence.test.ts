import { replayFixture, REPLAY_LIMITS } from "./fixtures/replay.js";
/** P0 durable-lookup precedence: the wire's params limit checks bound only new
 * work. A same-key request the ledger already accepted is classified by wire
 * grammar plus its durable record -- the recorded receipt for a true replay,
 * REQUEST_KEY_REUSED for a different payload under that key -- never by the
 * deployment's current (here: tightened) numeric bounds. Malformed params are
 * refused before the ledger is read, and read/ephemeral methods have no such
 * lookup. Real Store, MailModule and PublicDispatcher; the limit profile is
 * swapped between acceptance and replay.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { ProtocolLimits } from "@oma/contracts";

const TIGHT: ProtocolLimits = { ...REPLAY_LIMITS, mailBodyBytes: 8, subjectBytes: 8, addresses: 1, replyReferences: 1 };
function fixture(t: TestContext) {
  let limits = REPLAY_LIMITS;
  return { ...replayFixture(t, { limits: () => limits }), tighten: () => { limits = TIGHT; } };
}

const INPUT = { to: ["bob"], subject: "a subject past the tightened bound", kind: "message", body: "a body past the tightened bound" };
const envelope = (key: string, params: unknown) => ({ v: 1, id: key, method: "mail.send", request: key, params });

test("001. Replay precedence: a same-key replay returns its durable receipt under tightened limits", async t => {
  const f = fixture(t);
  const accepted = await f.call(envelope("key-accepted", INPUT));
  assert.ok(accepted.ok, JSON.stringify(accepted));
  assert.equal(accepted.result.state, "succeeded");
  f.tighten();
  // The frozen params now exceed subjectBytes/mailBodyBytes; the durable
  // receipt still answers -- INVALID_REQUEST would re-judge an accepted fact.
  const replay = await f.call(envelope("key-accepted", INPUT));
  assert.deepEqual(replay, accepted, "the recorded receipt is returned byte-identically under tightened limits");
  assert.equal(f.store.getOperation("alice", "key-accepted")?.id, accepted.result.operation, "no second operation was accepted");
});

test("002. Replay precedence: a fresh key under tightened limits is still refused", async t => {
  const f = fixture(t);
  assert.ok((await f.call(envelope("key-accepted", INPUT))).ok);
  f.tighten();
  const fresh = await f.call(envelope("key-fresh", INPUT));
  assert.deepEqual(fresh, { ok: false, code: "INVALID_REQUEST" });
  assert.equal(f.store.getOperation("alice", "key-fresh"), null, "a refused fresh request leaves no row");
});

test("003. Replay precedence: a different payload under the accepted key is REQUEST_KEY_REUSED, not a silent replay", async t => {
  const f = fixture(t);
  assert.ok((await f.call(envelope("key-accepted", INPUT))).ok);
  f.tighten();
  const reused = await f.call(envelope("key-accepted", { ...INPUT, body: "a different body past the tightened bound" }));
  assert.deepEqual(reused, { ok: false, code: "REQUEST_KEY_REUSED" },
    "the ledger's own classification answers; the tightened bound cannot launder a reuse into INVALID_REQUEST");
});

test("004. Replay precedence: malformed wire shape is refused before the durable lookup", async t => {
  const f = fixture(t);
  assert.ok((await f.call(envelope("key-accepted", INPUT))).ok);
  f.tighten();
  for (const params of [
    { ...INPUT, to: "bob" },            // address list is not an array
    { ...INPUT, body: 42 },             // body is not a string
    { ...INPUT, unknownField: true },   // unknown field
    "not-an-object",
  ]) {
    const refused = await f.call(envelope("key-accepted", params));
    assert.deepEqual(refused, { ok: false, code: "INVALID_REQUEST" },
      `malformed params never reach the receipt lookup: ${JSON.stringify(params)}`);
  }
});

test("005. Replay precedence: non-keyed methods under tightened limits keep their refusal, no lookup is offered", async t => {
  const f = fixture(t);
  f.tighten();
  // Reads/ephemeral calls forbid a request key and have no durable record to
  // consult; invalid params stay INVALID_REQUEST for them.
  assert.deepEqual(await f.call({ v: 1, id: "r1", method: "status.get", params: { agent: 7 } }),
    { ok: false, code: "INVALID_REQUEST" });
  assert.deepEqual(await f.call({ v: 1, id: "r2", method: "logs.read", params: { agent: "bob", sinceSeconds: 0 } }),
    { ok: false, code: "INVALID_REQUEST" });
  // A keyed method without a valid request key is refused before params too.
  assert.deepEqual(await f.call({ v: 1, id: "r3", method: "mail.send", params: INPUT }),
    { ok: false, code: "INVALID_REQUEST" });
});
