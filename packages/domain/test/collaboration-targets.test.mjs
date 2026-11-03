import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalCollaborationJson as canonical, encodeCollaborationTarget as encode, decodeCollaborationTarget as decode } from "../dist/collaboration-targets.js";
const request = "op-11111111-1111-4111-8111-111111111111", vote = "op-22222222-2222-4222-8222-222222222222";
const common = { version: "collaboration-v1", societyBirth: "birth-1", request, requestName: "merge-11111111-1111-4111-8111-111111111111", revision: 1, policyRevision: "policy-1" };
const source = { base: "a".repeat(40), candidate: "b".repeat(40) }, approval = "m-33333333-3333-4333-8333-333333333333-0";
const cases = [
  { ...common, kind: "proposal", requester: "alice", source, tier: "LOW", attemptNumber: 0, expectedAttempt: null, settledFailure: null },
  { ...common, kind: "review", scope: "source", source, preparation: null, actor: "alice", expectedOwnVote: null, approval: null },
  { ...common, kind: "review", scope: "integration", source, preparation: vote, actor: "principal", expectedOwnVote: null, approval },
  { ...common, kind: "submission", requester: "alice", submission: request, source, attemptNumber: 0, expectedAttempt: null },
  { ...common, kind: "vote", actor: "alice", vote, scope: null, approval: null, expectedCurrentVote: vote },
  { ...common, kind: "applied", integration: vote, expectedBase: source.base, candidate: source.candidate, manifestSha256: "c".repeat(64), sourceRevision: 1 },
];
test("001. Targets: every closed kind has exact canonical bytes and a deeply frozen independent decode", () => {
  for (const value of cases) {
    const result = encode(value), decoded = decode(result.bytes, result.name, value.kind);
    assert.deepEqual(decoded, value); assert.notEqual(decoded, value); assert.equal(Object.isFrozen(decoded), true);
    if (decoded.source) assert.equal(Object.isFrozen(decoded.source), true);
    assert.equal(result.sha256, createHash("sha256").update(result.bytes).digest("hex"));
    assert.equal(result.name, `${value.kind}-${result.sha256}.json`); assert.equal(result.bytes.toString().endsWith("\n"), false);
    assert.deepEqual(encode(Object.fromEntries(Object.entries(value).reverse())), result);
  }
});
test("002. Targets: Unicode codepoint key order and exact arrays/strings are not UTF-16 order or normalization", () => {
  assert.equal(canonical({ "\u{10000}": 1, "\ue000": 2, a: [3, 1, 2] }), '{"a":[3,1,2],"\ue000":2,"\u{10000}":1}');
  assert.notEqual(canonical({ text: "é" }), canonical({ text: "e\u0301" }));
  assert.equal(canonical({ number: -7 }), '{"number":-7}');
  for (const value of [NaN, Infinity, -Infinity, -0, Number.MAX_SAFE_INTEGER + 1, 1.1, undefined, "\ud800", [undefined], Array(1), new Date()])
    assert.throws(() => canonical(value), { code: "INVALID_REQUEST" });
  let accessorCalls = 0;
  assert.throws(() => canonical({ get secret() { accessorCalls++; return 1; } }), { code: "INVALID_REQUEST" });
  assert.equal(accessorCalls, 0);
  const cycle = {}; cycle.self = cycle; assert.throws(() => canonical(cycle), { code: "INVALID_REQUEST" });
  let deep = {}; for (let n = 0; n < 65; n++) deep = { deep }; assert.throws(() => canonical(deep), { code: "INVALID_REQUEST" });
});
test("003. Targets: wrong kind/digest/bytes, hidden fields, noncanonical encodings and forged relations refuse", () => {
  const target = cases[0], original = encode(target);
  assert.throws(() => decode(original.bytes, original.name, "applied"), { code: "INVALID_REQUEST" });
  assert.throws(() => decode(Buffer.concat([original.bytes, Buffer.from("\n")]), original.name), { code: "INVALID_REQUEST" });
  assert.throws(() => decode(Buffer.from(JSON.stringify(target)), original.name), { code: "INVALID_REQUEST" });
  assert.throws(() => decode(original.bytes, original.name.replace("proposal-", "review-")), { code: "INVALID_REQUEST" });
  for (const patch of [{ extra: true }, { requestName: "merge-22222222-2222-4222-8222-222222222222" }, { revision: -0 },
    { revision: -1 }, { expectedAttempt: "latest" }, { requester: "principal" }, { source: { ...source, base: "a".repeat(64) } },
    { settledFailure: { kind: "integration", operation: vote, evidenceSha256: "c".repeat(64) } },
    { settledFailure: { kind: "preparation", operation: vote, evidenceSha256: "unknown" } }])
    assert.throws(() => encode({ ...target, ...patch }), { code: "INVALID_REQUEST" });
  const hidden = { ...target }; Object.defineProperty(hidden, "hidden", { value: true }); assert.throws(() => encode(hidden), { code: "INVALID_REQUEST" });
  assert.throws(() => encode({ ...cases[1], actor: "principal" }), { code: "INVALID_REQUEST" });
  assert.throws(() => encode({ ...cases[2], approval: null }), { code: "INVALID_REQUEST" });
  assert.throws(() => encode({ ...cases[4], expectedCurrentVote: request }), { code: "INVALID_REQUEST" });
});
test("004. Targets: null failure binds no future failure and settled failure identity changes the address", () => {
  const original = cases[0], a = encode(original);
  const failed = { ...original, expectedAttempt: vote, settledFailure: { kind: "integration", operation: vote, evidenceSha256: "c".repeat(64) } };
  const b = encode(failed); assert.notEqual(a.sha256, b.sha256);
  assert.notEqual(b.sha256, encode({ ...failed, settledFailure: { ...failed.settledFailure, evidenceSha256: "d".repeat(64) } }).sha256);
  assert.equal(decode(a.bytes, a.name).settledFailure, null);
  // A byte decoder deliberately provides no assertion of authority, liveness,
  // successful execution or current ledger correspondence.
});
