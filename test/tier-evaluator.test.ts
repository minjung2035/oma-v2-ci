import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTier, maximumTier, type ReviewFact, type TierSnapshot } from "../src/git/approval.js";
import type { ExactCandidateIdentity, RiskTier } from "../implementation/contracts/values.js";

const identity: ExactCandidateIdentity = { repo: "project", targetRef: "refs/heads/main", expectedBase: "a".repeat(40),
  candidate: "b".repeat(40), policyRevision: "policy-1" };
const fact = (id: string, sequence: number, actor: string, value: ReviewFact["value"], patch: Partial<ReviewFact> = {}): ReviewFact =>
  ({ id, sequence, actor, value, identity, revoked: false, ...patch });
const snapshot = (patch: Partial<TierSnapshot> = {}): TierSnapshot => ({ identity, requester: "author", requested: "LOW",
  deterministic: { tier: "LOW", reasons: [] }, repositoryFloor: "LOW", floors: [], scopeAssessments: [], submitters: ["author"],
  eligibleResidents: ["author", "child", "peer"], reviews: [], highPeerFloor: 1, principalDelegated: true, ...patch });

test("DR27/TIER-001: every floor and the Worker's requested tier can only raise the result", () => {
  const tiers: RiskTier[] = ["LOW", "MEDIUM", "HIGH"];
  for (const deterministic of tiers) for (const repositoryFloor of tiers) for (const requested of tiers) {
    const got = evaluateTier(snapshot({ deterministic: { tier: deterministic, reasons: [] }, repositoryFloor, requested }));
    assert.equal(got.effectiveTier, tiers[Math.max(tiers.indexOf(deterministic), tiers.indexOf(repositoryFloor), tiers.indexOf(requested))]);
  }
  assert.throws(() => maximumTier(), /not observed/);
  for (const name of ["floors", "scopeAssessments", "submitters", "eligibleResidents", "reviews"] as const)
    assert.throws(() => evaluateTier(snapshot({ [name]: null })), /incomplete/);
});
test("DR27/TIER-005: LOW needs no assigned reviewer, but does not ignore an active objection", () => {
  assert.deepEqual(evaluateTier(snapshot()).missing, []);
  const object = fact("object", 1, "author", "OBJECT");
  assert.ok(evaluateTier(snapshot({ reviews: [object] })).missing.length > 0);
  assert.deepEqual(evaluateTier(snapshot({ reviews: [{ ...object, revoked: true }] })).missing, []);
  assert.deepEqual(evaluateTier(snapshot({ reviews: [{ ...object, identity: { ...identity, candidate: "c".repeat(40) } }] })).missing, []);
});
test("DR27/POL-004: a distinct child can approve; authenticated submitters and duplicate votes cannot", () => {
  const self = fact("self", 1, "author", "APPROVE");
  const child = fact("child", 2, "child", "APPROVE");
  const duplicate = fact("duplicate", 3, "child", "APPROVE");
  const medium = snapshot({ requested: "MEDIUM", reviews: [self, child, duplicate] });
  assert.deepEqual(evaluateTier(medium).approvers, ["child"]);
  assert.deepEqual(evaluateTier(medium).missing, []);
  const republished = evaluateTier({ ...medium, submitters: ["author", "child"] });
  assert.deepEqual(republished.approvers, []); assert.ok(republished.missing.length > 0);
  assert.ok(evaluateTier({ ...medium, requested: "HIGH", highPeerFloor: 2 }).missing.some(item => item.startsWith("2 distinct")));
});
test("DR27/TIER-006: HIGH requires delegated latest exact ACCEPT, not a prior decision resurrected by revoke", () => {
  const peer = fact("peer", 1, "peer", "APPROVE");
  const accept = fact("accept", 2, "principal", "ACCEPT");
  const reject = fact("reject", 3, "principal", "REJECT");
  const high = snapshot({ requested: "HIGH", reviews: [peer, accept] });
  assert.deepEqual(evaluateTier(high).missing, []);
  assert.ok(evaluateTier({ ...high, principalDelegated: false }).missing.length > 0);
  for (const last of [reject, { ...reject, revoked: true }])
    assert.ok(evaluateTier({ ...high, reviews: [last, peer, accept] }).missing.includes("current exact Principal ACCEPT"));
  for (const changed of ["expectedBase", "candidate", "policyRevision"] as const)
    assert.ok(evaluateTier({ ...high, reviews: [peer, { ...accept, identity: { ...identity, [changed]: "different" } }] }).missing.length > 0);
});
test("DR27/CHAL-005: a floor requires an exact scope assessment for each new candidate identity", () => {
  const floor = { finding: "finding", minimum: "MEDIUM", scope: "credential handling in authentication" } as const;
  const pending = snapshot({ floors: [floor] });
  assert.ok(evaluateTier(pending).missing.some(item => item.includes("scope assessment")));
  const assessment = { finding: floor.finding, identity, applies: false, attestation: "not-in-scope" };
  assert.equal(evaluateTier({ ...pending, scopeAssessments: [assessment] }).effectiveTier, "LOW");
  assert.equal(evaluateTier({ ...pending, scopeAssessments: [{ ...assessment, applies: true }] }).effectiveTier, "MEDIUM");
  const changed = { ...identity, candidate: "c".repeat(40) };
  assert.ok(evaluateTier({ ...pending, identity: changed, scopeAssessments: [assessment] }).missing.length > 0);
  assert.notEqual(evaluateTier(pending).digest, evaluateTier({ ...pending, scopeAssessments: [assessment] }).digest);
});
