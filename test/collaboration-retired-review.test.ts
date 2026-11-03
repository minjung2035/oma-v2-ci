/** DR72/MCS-S13: retired execution is not historical fact interpretation.
 * Direct Review calls use explicit auth fixtures, not authenticated peer proof. */
import test from "node:test";
import assert from "node:assert/strict";
import { decodePublicParams, UNBOUNDED_PUBLIC_LIMITS } from "@oma/protocol/methods";
import { decodeMutationPayload } from "@oma/protocol/request-codec";
import { reviewFactProblem, reviewInputProblem } from "@oma/domain/attestation";
import { fixture } from "./fixtures/review-fixture.js";
import { requestHash } from "@oma/domain/request-identity";
import { applyRequestKeyFor } from "@oma/domain/identifiers";
import { StoreError } from "@oma/domain/errors";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serializePlanIntent } from "./fixtures/plan.js";

const name = "merge-00000000-0000-4000-8000-000000000001";
const request = "op-00000000-0000-4000-8000-000000000001";
const payload = { kind: "review.adopt", name, reason: "\uFEFFOriginal reason\r\n" };
const identity = { repo: "project", targetRef: "refs/heads/main", expectedBase: "a".repeat(40), candidate: "b".repeat(40), policyRevision: "original-policy" };
const reviewPolicy = { maxWorkers: 6, highPeerFloor: 2, authorSlots: 1 };

test("001. Current attestation caller grammar refuses adoption while historical payload remains exact data", () => {
  assert.notEqual(reviewInputProblem(payload, UNBOUNDED_PUBLIC_LIMITS), null);
  assert.equal(decodePublicParams("attest.record", payload, { limits: UNBOUNDED_PUBLIC_LIMITS }), null);
  const original = JSON.stringify(payload);
  assert.deepEqual(decodeMutationPayload("attest.record", JSON.parse(original)), payload);
  assert.throws(() => decodeMutationPayload("attest.record", { ...payload, version: 3 }), TypeError);
  assert.throws(() => decodeMutationPayload("attest.record", { ...payload, authorize: true }), TypeError);
  assert.equal(JSON.stringify(payload), original);
});

for (const version of [2, 3]) test(`002. Adoption fact v${version} stays readable, closed and byte-preserving without becoming caller input`, () => {
  const fact = { kind: "review.adopt", version, request, reviewPolicy, reason: payload.reason,
    ...(version === 3 ? { revision: 0, attemptNumber: 1, identity, submitters: ["alice"] } : {}) };
  const original = JSON.stringify(fact);
  assert.equal(reviewFactProblem(JSON.parse(original)), null);
  assert.notEqual(reviewFactProblem({ ...fact, authorize: true }), null);
  assert.equal(decodePublicParams("attest.record", fact, { limits: UNBOUNDED_PUBLIC_LIMITS }), null);
  assert.equal(JSON.stringify(fact), original);
});

for (const host of [false, true]) test(`003. Collaboration retired review: ${host ? "host" : "requester"} cannot mint current-policy adoption or alter the original review`, async () => {
  let revision = "p1";
  const f = fixture({ reader: policy => ({ ...policy, policyRevision: revision }) });
  try {
    const candidate = f.candidateWith({ "change.txt": "original scope\n" });
    await f.submit("alice", candidate, "selected-source");
    await f.open("alice", { tier: "MEDIUM", candidate }, "selected-proposal");
    const original = f.store.getOperation("alice", "selected-proposal");
    const rows = f.store.attestations.all(), state = f.stateOf(f.requestName("selected-proposal"));
    const main = f.git(["rev-parse", "refs/heads/main"]);
    const auth = host ? { ...f.auth("principal"), channel: "host" as const } : f.auth("alice");
    revision = "p2";
    await assert.rejects(() => Reflect.apply(f.reviews.record, f.reviews,
      [auth, "retired-adoption", { ...payload, name: state.name }]), /unknown attestation|unsupported|retired/i);
    assert.equal(f.store.getOperation(auth.actor, "retired-adoption"), null);
    assert.deepEqual(f.store.getOperation("alice", "selected-proposal"), original);
    assert.deepEqual(f.store.attestations.all(), rows);
    assert.deepEqual(f.stateOf(state.name), state);
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), main);
  } finally { f.close(); }
});

for (const state of ["pending", "unknown", "succeeded"] as const) test(`004. Stored ${state} adoption reopens and replays only its original receipt, not current-policy execution`, async () => {
  let unavailable = false, reads = 0;
  const f = fixture({ reader: policy => { reads++; if (unavailable) throw new Error("current policy must not be consulted by original receipt replay"); return policy; } });
  try {
    const candidate = f.candidateWith({ "historical.txt": "original bytes\n" });
    await f.submit("alice", candidate, "historical-source");
    await f.open("alice", { tier: "MEDIUM", candidate }, "historical-open");
    const open = f.store.getOperation("alice", "historical-open")!;
    const input = { ...payload, name: f.requestName("historical-open") };
    const id = "op-00000000-0000-4000-8000-000000000009";
    const fact = { kind: "review.adopt", version: 3, request: open.id, revision: 0, attemptNumber: 1,
      identity: { ...identity, expectedBase: f.base, candidate, policyRevision: "original-adopted-policy" },
      submitters: ["alice"], reviewPolicy, reason: input.reason };
    const payloadJson = JSON.stringify(input, null, 2) + "\n";
    const planJson = serializePlanIntent({ kind: "attest.record", fact, messages: [] });
    // Explicit historical corpus, not a fresh adoption API or original-release
    // migration qualification. The original Store acceptance/index owner is used.
    f.store.transaction(tx => {
      tx.acceptOperation({ id, actor: "alice", requestKey: "historical-adoption", kind: "attest.record",
        requestHash: requestHash("attest.record", input), payloadJson, planJson });
      if (state === "unknown") tx.setOperationUnknown(id);
      if (state === "succeeded") tx.setOperationSucceeded(id, JSON.stringify({ kind: "attest.record", request: input.name, messages: [], recipientCount: 0 }));
    });
    const original = f.store.getOperationById(id)!;
    const rows = f.store.attestations.all();
    const objects = join(f.root, "mail", "objects");
    const bytes = () => readdirSync(objects).sort().map(file => [file, readFileSync(join(objects, file))]);
    const archive = bytes();
    assert.equal(original.payloadJson, payloadJson);
    assert.equal(original.planJson, planJson);
    assert.deepEqual(original.payload, input);
    assert.equal(original.state, state);
    unavailable = true;
    const before = reads;
    for (let reopen = 0; reopen < 2; reopen++) {
      f.reopen();
      const receipt = await Reflect.apply(f.reviews.record, f.reviews,
        [{ ...f.auth("alice"), capabilities: new Set() }, "historical-adoption", input,
          () => { throw new Error("historical lookup reached fresh acceptance"); }]);
      assert.deepEqual(receipt, { operation: id, state, ...(state === "succeeded" ? { result: { kind: "attest.record", request: input.name, messages: [], recipientCount: 0 } } : {}) });
      assert.deepEqual(f.store.getOperationById(id), original);
      assert.deepEqual(f.store.attestations.all(), rows);
      assert.deepEqual(bytes(), archive);
      assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
      await assert.rejects(() => Reflect.apply(f.reviews.record, f.reviews,
        [f.auth("alice"), "new-adoption", input]), { code: "INVALID_REQUEST" });
      assert.equal(f.store.getOperation("alice", "new-adoption"), null);
    }
    assert.equal(reads, before);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { Store } from "@oma/storage";
      import { join } from "node:path";
      const [root, id] = process.argv.slice(1);
      const store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
      try {
        const row = store.getOperationById(id);
        if (!row) throw new Error("original operation disappeared");
        process.stdout.write(JSON.stringify({ state: row.state, payloadJson: row.payloadJson,
          planJson: row.planJson, requestHash: row.requestHash, resultJson: row.resultJson }));
      } finally { store.close(); }
    `, f.root, id], { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { state, payloadJson, planJson,
      requestHash: original.requestHash, resultJson: original.resultJson });
    assert.deepEqual(f.store.getOperationById(id), original);
    assert.deepEqual(bytes(), archive);
  } finally { f.close(); }
});

async function adoptedHistoricalScope() {
  let revision = "p1", broken = true;
  const f = fixture({ reader: p => ({ ...p, policyRevision: revision }),
    checks: [{ id: "original-check", argv: ["/bin/true"], env: {} }],
    runCheck: () => { if (broken) throw new StoreError("CHECK_FAILED", "original failed check"); } });
  try {
    const candidate = f.candidateWith({ "old-scope.txt": "preserve original scope\n" });
    await f.submit("alice", candidate, "source");
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const open = f.store.getOperation("alice", "open")!, name = f.requestName("open");
    await f.vote("bob", name, "approve", "original qualified code vote", "vote");
    assert.equal(f.stateOf(name).integration?.state, "failed");
    revision = "p2";
    const input = { ...payload, name }, id = "op-00000000-0000-4000-8000-000000000009";
    const fact = { kind: "review.adopt", version: 3, request: open.id, revision: 0, attemptNumber: 1,
      identity: { ...identity, expectedBase: f.base, candidate, policyRevision: revision },
      submitters: ["alice"], reviewPolicy, reason: input.reason };
    // Synthetic original accepted facts, not a callable legacy implementation.
    f.store.transaction(tx => {
      tx.acceptOperation({ id, actor: "alice", requestKey: "historical-adopt", kind: "attest.record",
        requestHash: requestHash("attest.record", input), payloadJson: JSON.stringify(input),
        planJson: serializePlanIntent({ kind: "attest.record", fact, messages: [] }) });
      tx.setOperationSucceeded(id, JSON.stringify({ kind: "attest.record", request: name, messages: [], recipientCount: 0 }));
    });
    broken = false;
    assert.equal(f.stateOf(name).ready, true, "the original historical decision remains readable, not executable");
    return { f, open, name };
  } catch (error) { f.close(); throw error; }
}

for (const action of ["record", "advance"] as const) test(`005. Collaboration retired review: ${action} cannot turn an adopted historical scope into current execution even when policy and votes qualify`, async () => {
  const { f, open, name } = await adoptedHistoricalScope();
  try {
    const rows = f.store.attestations.all(), originalState = f.stateOf(name);
    const refs = f.git(["for-each-ref", "--format=%(refname) %(objectname)"]);
    if (action === "record") await assert.rejects(f.review("carol", name, "new-entry", "fresh authority must not attach to retired scope"), { code: "UNSUPPORTED_PROFILE" });
    else await assert.rejects(f.reviews.advance(open.id), { code: "UNSUPPORTED_PROFILE" });
    assert.equal(f.store.getOperation("carol", "new-entry"), null);
    assert.deepEqual(f.store.attestations.all(), rows);
    assert.deepEqual(f.stateOf(name), originalState);
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
    assert.equal(f.git(["for-each-ref", "--format=%(refname) %(objectname)"]), refs);
    assert.throws(() => f.reviews.assertApplicable(open.id), { code: "UNSUPPORTED_PROFILE" });
    await f.reviews.advanceAll();
    assert.deepEqual(f.store.attestations.all(), rows);
    assert.equal(f.store.getOperation("alice", applyRequestKeyFor(open.id, 1)), null);
    f.reopen();
    assert.deepEqual(f.store.attestations.all(), rows);
    assert.deepEqual(f.stateOf(name), originalState);
    assert.equal(f.git(["for-each-ref", "--format=%(refname) %(objectname)"]), refs);
  } finally { f.close(); }
});

for (const version of [1, 2]) test(`006. Original open v${version} is readable but cannot vote, advance, or enter a current CAS`, async () => {
  const f = fixture();
  try {
    const candidate = f.candidateWith({ "old-open.txt": "original candidate\n" });
    await f.submit("alice", candidate, "source");
    const input = { kind: "merge.open" as const, title: "Original request", reason: payload.reason, tier: "MEDIUM" as const, base: f.base, candidate };
    const fact = { kind: "merge.open", version, name, title: input.title, reason: input.reason, tier: input.tier,
      identity: { ...identity, expectedBase: f.base, candidate, policyRevision: "p1" }, submitters: ["alice"],
      ...(version === 2 ? { reviewPolicy } : {}) };
    const payloadJson = JSON.stringify(input, null, 2), planJson = serializePlanIntent({ kind: "attest.record", fact, messages: [] });
    f.store.transaction(tx => {
      tx.acceptOperation({ id: request, actor: "alice", requestKey: "old-open", kind: "attest.record",
        requestHash: requestHash("attest.record", input), payloadJson, planJson });
      tx.setOperationSucceeded(request, JSON.stringify({ kind: "attest.record", request: name, messages: [], recipientCount: 0 }));
    });
    const original = f.store.getOperationById(request)!, rows = f.store.attestations.all();
    assert.equal(original.planJson, planJson);
    assert.equal(original.payloadJson, payloadJson);
    for (let retry = 0; retry < 2; retry++) {
      f.reopen();
      assert.deepEqual(await f.reviews.record(f.auth("alice"), "old-open", input), { operation: request, state: "succeeded", result: { kind: "attest.record", request: name, messages: [], recipientCount: 0 } });
      await assert.rejects(f.vote("bob", name, "approve", "no current authority from old scope", "new-vote"), { code: "UNSUPPORTED_PROFILE" });
      await assert.rejects(f.reviews.advance(request), { code: "UNSUPPORTED_PROFILE" });
      assert.throws(() => f.reviews.assertApplicable(request), { code: "UNSUPPORTED_PROFILE" });
      await f.reviews.advanceAll();
      const records = f.reviews.observeRecords(f.auth("alice"));
      assert.equal(records.length, 1);
      assert.match(JSON.stringify(records[0]!.status), /original review scope is unsupported/);
      assert.deepEqual(f.store.attestations.all(), rows);
      assert.deepEqual(f.store.getOperationById(request), original);
      assert.equal(f.store.getOperation("bob", "new-vote"), null);
      assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
    }
  } finally { f.close(); }
});
