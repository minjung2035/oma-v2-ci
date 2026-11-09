import test from "node:test";
import assert from "node:assert/strict";
import { ReviewAuthorityReader } from "@oma/review/authority";
test("001. Review public API rechecks current eligible votes and cancellation before CAS", async () => {
  await import("./installed-runtime.mjs");
});

for (const kind of ["merge.open", "challenge.open"])
  test(`002. Duplicate ${kind} discovery follows revised source identity and tier`, () => {
    const id = "op-00000000-0000-4000-8000-000000000001";
    const identity = { repo: "project", targetRef: "refs/heads/main", expectedBase: "1".repeat(40),
      candidate: "2".repeat(40), policyRevision: "p1" };
    const reviewPolicy = { maxWorkers: 6, highPeerFloor: 2, authorSlots: 1 };
    const fact = { kind, version: 3, name: `${kind.split('.')[0]}-00000000-0000-4000-8000-000000000001`,
      title: "original", reason: "original", tier: "LOW", identity, submitters: ["alice"], reviewPolicy,
      ...(kind === "challenge.open" ? { prepared: false, target: { name: "merge-target", request: "target",
        integration: "applied", identity, tier: "LOW" } } : {}) };
    const revised = { ...identity, candidate: "3".repeat(40), policyRevision: "p2" };
    const rows = [
      { sequence: 1, operation: { id, actor: "alice", plan: { fact, messages: [] } } },
      { sequence: 2, operation: { id: "op-00000000-0000-4000-8000-000000000002", actor: "alice", plan: {
        fact: { kind: "review.revise", version: 3, request: id, revision: 1, attemptNumber: 1,
          identity: revised, submitters: ["alice"], tier: "HIGH", reviewPolicy, reason: "replacement" }, messages: [] } } },
    ];
    const reader = new ReviewAuthorityReader({ attestationFacts: () => rows, getOperation: () => null,
      listAgents: () => [{ name: "alice", role: "resident", desired: "enabled" }] }, 2, 6);
    const duplicate = input => kind === "merge.open" ? reader.duplicateName(input) : reader.duplicateChallenge(input);
    assert.equal(duplicate({ ...fact, identity: revised, tier: "HIGH" }), fact.name);
    assert.equal(duplicate(fact), null, "a superseded original no longer covers that source");
    assert.equal(duplicate({ ...fact, identity: revised, tier: "LOW" }), null, "tiers remain distinct");
  });
