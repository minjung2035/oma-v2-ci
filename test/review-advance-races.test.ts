/** Current no-adopt race regressions, and the original AUD-13 host boundary.
 * The retired AUD-01 adoption-positive bodies and their meanings are preserved
 * in docs/archive/retired-review-adoption-oracles.md, not relabelled as PASS.
 * Real Store/Mail/Git/Review; publication is delayed, not mocked or bypassed. */
import test from "node:test";
import assert from "node:assert/strict";
import type { Receipt } from "@oma/contracts";
import { AdmissionGate, bindAdmissionGate } from "@oma/domain/admission";
import { applyRequestKeyFor } from "@oma/domain/identifiers";
import { fixture } from "./fixtures/review-fixture.js";

test("001. Race: a changed provenance during the completion notice cannot adopt scope or apply a cancelled proposal", { timeout: 60_000 }, async () => {
  const f = fixture();
  const gate = new AdmissionGate();
  bindAdmissionGate(f.store, gate);
  const noticeHeld = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let heldOnce = false;
  const freeze = f.mail.freezeReviewMessage.bind(f.mail);
  f.mail.freezeReviewMessage = async (...args) => {
    if (!heldOnce && args[3]?.review?.role === "notice") { heldOnce = true; noticeHeld.resolve(); await release.promise; }
    return freeze(...args);
  };
  let voting: Promise<Receipt> | undefined;
  try {
    const candidate = f.candidateWith({ "a.txt": "raced change\n" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open"), original = f.store.getOperation("alice", "open")!;
    voting = f.vote("bob", name, "approve", "code checked", "bob-vote");
    await noticeHeld.promise;
    const vote = f.store.getOperation("bob", "bob-vote");
    await f.submit("carol", candidate, "carol-submit");
    await assert.rejects(() => Reflect.apply(f.reviews.record, f.reviews,
      [f.auth("alice"), "adopt", { kind: "review.adopt", name, reason: "current provenance" }]), { code: "INVALID_REQUEST" });
    assert.equal(f.store.getOperation("alice", "adopt"), null);
    await f.cancel("alice", name, "cancel-stale-scope");
    release.resolve();
    assert.equal((await voting).state, "succeeded");
    assert.deepEqual(f.store.getOperation("alice", "open"), original);
    assert.deepEqual(f.store.getOperation("bob", "bob-vote"), vote);
    for (const attempt of [0, 1]) assert.equal(f.store.getOperation("alice", applyRequestKeyFor(original.id, attempt)), null);
    assert.equal(f.stateOf(name).display, "cancelled");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
    assert.equal(gate.state, "healthy");

    await f.open("alice", { tier: "MEDIUM", candidate }, "fresh-open");
    const freshName = f.requestName("fresh-open"), fresh = f.store.getOperation("alice", "fresh-open")!;
    assert.notEqual(fresh.id, original.id);
    assert.deepEqual(f.stateOf(freshName).approvers, [], "the original vote is not transferred");
    await f.vote("bob", freshName, "approve", "checked the explicit fresh source", "fresh-vote");
    const row = f.store.getOperation("alice", applyRequestKeyFor(fresh.id, 0));
    assert.ok(row?.kind === "git.integrate");
    assert.equal(row.plan.merge?.version, 3);
    assert.equal(row.plan.merge?.attemptNumber, 0);
    assert.equal(row.plan.merge?.request, fresh.id);
    assert.equal(row.plan.candidate, candidate);
    assert.equal(row.state, "succeeded");
    assert.equal(f.stateOf(freshName).display, "applied");
    assert.deepEqual(f.store.getOperation("bob", "bob-vote"), vote);
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
    assert.equal(gate.state, "healthy");
    const next = f.candidateWith({ "b.txt": "after the race\n" }, candidate);
    await f.submit("alice", next, "next-submit");
    assert.equal((await f.open("alice", { tier: "LOW", candidate: next, base: candidate }, "next-open")).state, "succeeded");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), next);
  } finally { release.resolve(); await voting?.catch(() => {}); f.close(); }
});

test("002. Race: a policy change after prepared-context acceptance cannot rebind it; a fresh proposal needs a fresh vote and context", { timeout: 60_000 }, async () => {
  let revision = "p1";
  const f = fixture({ reader: policy => ({ ...policy, policyRevision: revision }) });
  const gate = new AdmissionGate();
  bindAdmissionGate(f.store, gate);
  const preparationHeld = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let heldOnce = false, preparedId: string | undefined;
  const materialize = f.mail.materialize.bind(f.mail);
  f.mail.materialize = async id => {
    const operation = f.store.getOperationById(id);
    if (!heldOnce && operation?.kind === "attest.record" && operation.plan.fact.kind === "review.integration") {
      heldOnce = true; preparedId = id; preparationHeld.resolve(); await release.promise;
    }
    return materialize(id);
  };
  let voting: Promise<Receipt> | undefined;
  try {
    const candidate = f.candidateWith({ "a.txt": "policy change\n" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open"), original = f.store.getOperation("alice", "open")!;
    voting = f.vote("bob", name, "approve", "code checked", "bob-vote");
    await preparationHeld.promise;
    const vote = f.store.getOperation("bob", "bob-vote");
    assert.ok(preparedId);
    const prepared = f.store.getOperationById(preparedId);
    assert.ok(prepared?.kind === "attest.record" && prepared.plan.fact.kind === "review.integration");
    assert.equal(prepared.plan.fact.identity.policyRevision, "p1");
    revision = "p2";
    await assert.rejects(() => Reflect.apply(f.reviews.record, f.reviews,
      [f.auth("alice"), "adopt", { kind: "review.adopt", name, reason: "adopt current policy" }]), { code: "INVALID_REQUEST" });
    await f.cancel("alice", name, "cancel-old-policy");
    release.resolve();
    assert.equal((await voting).state, "succeeded");
    const settled = f.store.getOperationById(preparedId)!;
    assert.equal(settled.planJson, prepared.planJson);
    assert.equal(settled.payloadJson, prepared.payloadJson);
    assert.equal(settled.requestHash, prepared.requestHash);
    assert.deepEqual(f.store.getOperation("alice", "open"), original);
    assert.deepEqual(f.store.getOperation("bob", "bob-vote"), vote);
    assert.equal(f.stateOf(name).sourceIdentity.policyRevision, "p1");
    assert.equal(f.stateOf(name).display, "cancelled");
    assert.equal(f.stateOf(name).integration, null);
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
    assert.equal(gate.state, "healthy");

    await f.open("alice", { tier: "MEDIUM", candidate }, "fresh-open");
    const freshName = f.requestName("fresh-open"), fresh = f.store.getOperation("alice", "fresh-open")!;
    assert.deepEqual(f.stateOf(freshName).approvers, []);
    await f.vote("bob", freshName, "approve", "checked under p2", "fresh-vote");
    const row = f.store.getOperation("alice", applyRequestKeyFor(fresh.id, 0));
    assert.ok(row?.kind === "git.integrate");
    assert.equal(row.plan.merge?.version, 3);
    assert.equal(row.plan.merge?.attemptNumber, 0);
    assert.equal(row.plan.policyRevision, "p2");
    assert.ok(row.plan.merge?.version === 3 && row.plan.merge.preparation);
    const context = f.store.getOperationById(row.plan.merge.preparation);
    assert.ok(context?.kind === "attest.record" && context.plan.fact.kind === "review.integration");
    assert.notEqual(context.id, preparedId);
    assert.equal(context.plan.fact.sourceOperation, fresh.id);
    assert.equal(context.plan.fact.identity.policyRevision, "p2");
    assert.equal(row.state, "succeeded");
    assert.equal(f.stateOf(freshName).display, "applied");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
    assert.equal(gate.state, "healthy");
    const next = f.candidateWith({ "b.txt": "after the race\n" }, candidate);
    await f.submit("alice", next, "next-submit");
    assert.equal((await f.open("alice", { tier: "LOW", candidate: next, base: candidate }, "next-open")).state, "succeeded");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), next);
  } finally { release.resolve(); await voting?.catch(() => {}); f.close(); }
});

test("003. Vote invalidation stays host authority, never an ordinary actor's", async () => {
  const f = fixture();
  try {
    const candidate = f.candidateWith({ "a.txt": "invalidate\n" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open");
    const name = f.requestName("open");
    await f.vote("bob", name, "approve", "bob checked the code", "bob-vote");
    const vote = f.store.getOperation("bob", "bob-vote");
    assert.ok(vote?.kind === "attest.record");
    assert.deepEqual(f.stateOf(name).approvers, ["bob"]);
    // A Worker cannot invalidate another actor's vote through its own
    // authority...
    await assert.rejects(f.reviews.record(f.auth("carol"), "carol-invalidate",
      { kind: "review.invalidate", name, vote: vote.id, reason: "not mine to withdraw" }),
      { code: "CAPABILITY_DENIED" });
    // ...and the host channel is not a grant that other actors receive.
    await assert.rejects(f.reviews.record({ ...f.auth("carol"), channel: "host" }, "carol-host-invalidate",
      { kind: "review.invalidate", name, vote: vote.id, reason: "still not mine" }),
      { code: "CAPABILITY_DENIED" });
    // Host invalidation/recovery does not become an ordinary Principal
    // authority either: the Principal's actor context is refused.
    await assert.rejects(f.reviews.record(f.auth("principal"), "principal-actor-invalidate",
      { kind: "review.invalidate", name, vote: vote.id, reason: "ordinary principal context" }),
      { code: "CAPABILITY_DENIED" });
    // The host channel carrying the Principal remains the module's
    // invalidation authority (whether the product exposes a reachable host
    // route for it is a separate, parent-owned investigation).
    const receipt = await f.reviews.record({ ...f.auth("principal"), channel: "host" }, "principal-host-invalidate",
      { kind: "review.invalidate", name, vote: vote.id, reason: "host withdraws the vote" });
    assert.equal(receipt.state, "succeeded");
    const state = f.stateOf(name);
    assert.deepEqual(state.approvers, []);
    assert.equal(state.ready, false);
  } finally { f.close(); }
});
