import { createMailModule } from "#oma-test/app/broker/mail-composition";
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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, ProtocolLimits, Request } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { PublicDispatcher } from "@oma/broker/public-dispatcher";
import { errorAnswer } from "@oma/broker/replies";
import { publicFailure } from "@oma/domain/errors";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { makeValidAgent, ALL_CAPS } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";

const LOOSE: ProtocolLimits = {
  frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64,
  replyReferences: 64, contextFiles: 256, contextBytes: 8388608, bundleBytes: 268435456,
  logBytes: 1048576, batchMaxMessages: 24, idleStreamSeconds: 30, receiptWaitSeconds: 30,
};
const TIGHT: ProtocolLimits = { ...LOOSE, mailBodyBytes: 8, subjectBytes: 8, addresses: 1, replyReferences: 1 };

const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };

type Answer = { ok: true; result: { operation?: string; state?: string } } | { ok: false; code: string | undefined };
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-replay-limits-"));
  const store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { try { store.close(); } finally { removeTree(root); } });
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" }));
    tx.insertAgent(makeValidAgent("bob", { createdBy: "principal" }));
  });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
  const profile = { current: LOOSE };
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
    get limits() { return profile.current; },
    waitRun: () => { throw new Error("no live run in this fixture"); },
    isDraining: () => false,
    assertAdmission() {},

    failureAnswer: (id, error) => errorAnswer(id, publicFailure(error)),
    refreshViews() {},
    readLogs: async () => { throw new Error("logs are not part of this fixture"); },
  });
  const call = async (envelope: Record<string, unknown>): Promise<Answer> => {
    const answer = await dispatcher.dispatch(auth, envelope as Request, null) as { ok: boolean; result?: { operation?: string; state?: string }; error?: { code?: string } };
    return answer.ok ? { ok: true, result: answer.result! } : { ok: false, code: answer.error?.code };
  };
  return { root, store, call, tighten: () => { profile.current = TIGHT; } };
}

const INPUT = { to: ["bob"], subject: "a subject past the tightened bound", kind: "message", body: "a body past the tightened bound" };
const envelope = (key: string, params: unknown) => ({ v: 1, id: key, method: "mail.send", request: key, params });

test("P0 replay precedence: a same-key replay returns its durable receipt under tightened limits", async t => {
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

test("P0 replay precedence: a fresh key under tightened limits is still refused", async t => {
  const f = fixture(t);
  assert.ok((await f.call(envelope("key-accepted", INPUT))).ok);
  f.tighten();
  const fresh = await f.call(envelope("key-fresh", INPUT));
  assert.deepEqual(fresh, { ok: false, code: "INVALID_REQUEST" });
  assert.equal(f.store.getOperation("alice", "key-fresh"), null, "a refused fresh request leaves no row");
});

test("P0 replay precedence: a different payload under the accepted key is REQUEST_KEY_REUSED, not a silent replay", async t => {
  const f = fixture(t);
  assert.ok((await f.call(envelope("key-accepted", INPUT))).ok);
  f.tighten();
  const reused = await f.call(envelope("key-accepted", { ...INPUT, body: "a different body past the tightened bound" }));
  assert.deepEqual(reused, { ok: false, code: "REQUEST_KEY_REUSED" },
    "the ledger's own classification answers; the tightened bound cannot launder a reuse into INVALID_REQUEST");
});

test("P0 replay precedence: malformed wire shape is refused before the durable lookup", async t => {
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

test("P0 replay precedence: non-keyed methods under tightened limits keep their refusal, no lookup is offered", async t => {
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
