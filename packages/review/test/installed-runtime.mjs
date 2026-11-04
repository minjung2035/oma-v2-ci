import assert from "node:assert/strict";
import { ReviewModule } from "@oma/review";
import { ReviewAuthorityReader } from "@oma/review/authority";
import { reviewRequestNameFor } from "@oma/domain/identifiers";
import { reviewFactProblem } from "@oma/domain/attestation";
import { decodeAgentSpec } from "@oma/domain/agent-spec";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";

// Read-only ledger stand-ins, not Store, peer, Git CAS or provider qualification.
// The retired version-1 execution-positive body and observed FAIL are retained in
// docs/archive/retired-review-installed-scope-oracle.md, not relabelled as PASS.
assert.equal(typeof ReviewModule, "function");
const entry = (sequence, actor, fact, id) => {
  assert.equal(reviewFactProblem(fact), null);
  return { sequence, operation: { id, actor, kind: "attest.record", state: "succeeded",
    plan: { kind: "attest.record", fact, messages: [] } } };
};
const member = name => {
  const spec = decodeAgentSpec(JSON.stringify({ name, from: "3".repeat(40), brief: "Installed read-only scope fixture",
    profile: "installed-resident", capabilities: ["mail.send", "git.submit"], modelProfile: "installed-model" }));
  return { name, role: "resident", desired: "enabled", specJson: JSON.stringify(spec) };
};
const alice = member("alice"), bob = member("bob");
const agents = () => [alice, bob];
const readerFor = facts => new ReviewAuthorityReader({ attestationFacts: () => facts,
  getOperation: () => null, listAgents: agents }, 2, 6);

// Original historical facts remain data, including their old quorum semantics.
const historicalId = "op-00000000-0000-4000-8000-000000000001";
const historical = [entry(1, "alice", { kind: "merge.open", version: 1,
  name: reviewRequestNameFor("merge", historicalId), title: "the change", reason: "review before CAS",
  tier: "MEDIUM", submitters: ["alice"], identity: { repo: "project", targetRef: "refs/heads/main",
    expectedBase: "1".repeat(40), candidate: "2".repeat(40), policyRevision: "installed-policy" } }, historicalId)];
const oldReader = readerFor(historical);
assert.equal(oldReader.openRequests()[0].operation.id, historicalId);
assert.throws(() => oldReader.assertApplicable(historicalId), { code: "UNSUPPORTED_PROFILE" });
historical.push(entry(2, "bob", { kind: "vote", version: 1, request: historicalId,
  verdict: "approve", body: "checked", approval: null }, "op-00000000-0000-4000-8000-000000000002"));
const originalHistoricalBytes = JSON.stringify(historical);
assert.equal(oldReader.projection()[0].input.entries[0].fact.version, 1);
assert.throws(() => oldReader.assertApplicable(historicalId), { code: "UNSUPPORTED_PROFILE" });
assert.equal(JSON.stringify(historical), originalHistoricalBytes);

// A separately authored current scope, not a version/default upgrade of old data.
const id = "op-00000000-0000-4000-8000-000000000010";
const facts = [entry(1, "alice", { kind: "merge.open", version: 3, name: reviewRequestNameFor("merge", id),
  title: "current change", reason: "qualified review before CAS", tier: "MEDIUM", submitters: ["alice"],
  reviewPolicy: { maxWorkers: 6, highPeerFloor: 2, authorSlots: 1 },
  identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: "3".repeat(40),
    candidate: "4".repeat(40), policyRevision: "current-installed-policy" } }, id)];
const reader = readerFor(facts);
assert.equal(reader.openRequests()[0].operation.id, id);
assert.throws(() => reader.assertApplicable(id), { code: "INTEGRATION_CONDITIONS" });
const qualifiedVote = entry(2, "bob", { kind: "vote", version: 3, request: id,
  verdict: "approve", body: "checked the current source", approval: null, revision: 0, scope: null,
  qualification: { role: "resident", incarnation: 1, specHash: resolvedSpecDigest(decodeAgentSpec(bob.specJson)), capability: "mail.send" } },
  "op-00000000-0000-4000-8000-000000000011");
facts.push(qualifiedVote);
const originalVoteBytes = JSON.stringify(qualifiedVote);
reader.assertApplicable(id);
const oldProjection = reader.projection();
assert.equal(oldProjection[0].input.eligible.has("bob"), true);
await Promise.resolve();
bob.desired = "stopped";
assert.equal(reader.projection()[0].input.eligible.has("bob"), false, "new roster observation must be live");
assert.equal(oldProjection[0].input.eligible.has("bob"), true, "old observation is not mutated");
reader.assertApplicable(id); // DR66: accepted qualified approval is not live-roster authority.
assert.equal(JSON.stringify(qualifiedVote), originalVoteBytes);
assert.throws(() => oldReader.assertApplicable(historicalId), { code: "UNSUPPORTED_PROFILE" });
assert.equal(JSON.stringify(historical), originalHistoricalBytes);
bob.desired = "enabled";
reader.assertApplicable(id);
facts.push(entry(3, "alice", { kind: "cancel", version: 1, request: id, reason: "withdrawn" },
  "op-00000000-0000-4000-8000-000000000012"));
assert.throws(() => reader.assertApplicable(id), { code: "CANCELLED_BEFORE_COMMIT" });
assert.throws(() => reader.assertApplicable("missing"), { code: "STORE_CORRUPT" });
assert.equal(JSON.stringify(qualifiedVote), originalVoteBytes);
assert.equal(JSON.stringify(historical), originalHistoricalBytes);
