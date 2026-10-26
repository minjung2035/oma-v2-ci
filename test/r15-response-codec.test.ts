import test from "node:test";
import assert from "node:assert/strict";
import { decodeRpcReply } from "@oma/protocol/response-codec";

const id = "correlated-id";
const operation = "op-00000000-0000-4000-8000-000000000015";
const batch = "b-00000000-0000-4000-8000-000000000015";
const message = "m-00000000-0000-4000-8000-000000000015-0";
const envelope = (result: unknown) => ({ v: 1, id, ok: true, result });

test("R15: complete public and internal responses are decoded by the requested method", () => {
  assert.deepEqual(decodeRpcReply("runner.open", envelope({ actor: "alice", incarnation: 3, socketHostPath: "/run/test" }), id, { agent: "alice" }),
    { ok: true, result: { actor: "alice", incarnation: 3, socketHostPath: "/run/test" } });
  assert.deepEqual(decodeRpcReply("batch.prepare", envelope(null), id, {}), { ok: true, result: null });
  const prepared = { id: batch, agent: "alice", incarnation: 3, messageIds: [message], sessionPath: null, deliveryMode: "followUp", notice: "mail", indexPath: "/inbox.md" };
  assert.deepEqual(decodeRpcReply("batch.read", envelope(prepared), id, { batchId: batch }), { ok: true, result: prepared });
  assert.deepEqual(decodeRpcReply("principal.detach", envelope({ detached: true }), id, {}),
    { ok: true, result: { detached: true } });
  const receipt = { operation, state: "pending" };
  assert.deepEqual(decodeRpcReply("mail.send", envelope(receipt), id, {}), { ok: true, result: receipt });
  const failed = { v: 1, id, ok: false, error: { code: "DB_BUSY", message: "DB_BUSY", retry: "same-key" } };
  assert.deepEqual(decodeRpcReply("operation.get", failed, id, { key: "key" }), { ok: false, error: failed.error });
});

test("R15: envelope version ID discriminator and field mismatches never produce a normal result", () => {
  const valid = envelope(null);
  assert.doesNotThrow(() => decodeRpcReply("batch.prepare", valid, id, {}));
  for (const raw of [null, [], {}, { id, ok: true, result: null }, { ...valid, v: 2 }, { ...valid, id: "other" },
    { ...valid, ok: "true" }, { ...valid, error: {} }, { v: 1, id, ok: true }, { ...valid, injected: true },
    { v: 1, id, ok: false, error: { code: "MISSING_CODE", message: "wrong", retry: "never" } },
    { v: 1, id, ok: false, error: { code: "DB_BUSY", message: "wrong", retry: "always" } },
  ]) assert.throws(() => decodeRpcReply("batch.prepare", raw, id, {}), { code: "BROKER_UNAVAILABLE" });
});

test("R15: valid-looking foreign method results and unsafe facts are rejected", () => {
  const prepared = { id: batch, agent: "alice", incarnation: 3, messageIds: [message], sessionPath: null, deliveryMode: "followUp", notice: "mail", indexPath: "/inbox.md" };
  assert.throws(() => decodeRpcReply("batch.read", envelope(prepared), id, { batchId: "b-00000000-0000-4000-8000-000000000016" }), { code: "BROKER_UNAVAILABLE" });
  assert.throws(() => decodeRpcReply("batch.prepare", envelope({ ...prepared, messageIds: [message, message] }), id, {}), { code: "BROKER_UNAVAILABLE" });
  assert.throws(() => decodeRpcReply("runner.open", envelope({ actor: "bob", incarnation: 3, socketHostPath: "/run/test" }), id, { agent: "alice" }), { code: "BROKER_UNAVAILABLE" });
  assert.throws(() => decodeRpcReply("runner.pending", envelope({ pending: Number.MAX_SAFE_INTEGER + 1, recoverableBatchIds: [] }), id, {}), { code: "BROKER_UNAVAILABLE" });
  assert.throws(() => decodeRpcReply("status.get", envelope([]), id, {}), { code: "BROKER_UNAVAILABLE" });
  assert.throws(() => decodeRpcReply("principal.detach", envelope({ detached: true, authority: true }), id, {}), { code: "BROKER_UNAVAILABLE" });
  assert.throws(() => decodeRpcReply("mail.send", envelope({ operation, state: "succeeded", result: { kind: "route.follow", topic: "work", subscribed: true } }), id, {}), { code: "BROKER_UNAVAILABLE" });
});

test("R15: lookup absence remains distinct from an accepted failed receipt", () => {
  const absent = { operation: "", state: "failed", error: { code: "REQUEST_NOT_FOUND", message: "absent", retry: "same-key" } };
  const reply = decodeRpcReply("operation.get", envelope(absent), id, { key: "key" });
  assert.ok(reply.ok); assert.equal(reply.result.operation, "");
  assert.throws(() => decodeRpcReply("mail.send", envelope(absent), id, {}), { code: "BROKER_UNAVAILABLE" });
  const accepted = { operation, state: "failed", error: { code: "REQUEST_NOT_FOUND", message: "terminal", retry: "never" } };
  const terminal = decodeRpcReply("operation.get", envelope(accepted), id, { key: "key" });
  assert.ok(terminal.ok); assert.equal(terminal.result.operation, operation);
});
