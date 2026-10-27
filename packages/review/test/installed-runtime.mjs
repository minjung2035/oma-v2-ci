import assert from "node:assert/strict";
import { ReviewModule } from "@oma/review";
import { ReviewAuthorityReader } from "@oma/review/authority";
import { reviewRequestNameFor } from "@oma/domain/identifiers";

assert.equal(typeof ReviewModule, "function");
const id = "op-00000000-0000-4000-8000-000000000001";
const fact = { kind: "merge.open", version: 1, name: reviewRequestNameFor("merge", id),
  title: "the change", reason: "review before CAS", tier: "MEDIUM", submitters: ["alice"],
  identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: "1".repeat(40),
    candidate: "2".repeat(40), policyRevision: "installed-policy" } };
const entry = (sequence, actor, fact, operationId) => ({ sequence, operation: {
  id: operationId, actor, kind: "attest.record", state: "succeeded",
  plan: { kind: "attest.record", fact, messages: [] },
} });
const facts = [entry(1, "alice", fact, id)];
const bob = { name: "bob", role: "resident", desired: "enabled" };
const reader = new ReviewAuthorityReader({
  attestationFacts: () => facts,
  getOperation: () => null,
  listAgents: () => [{ name: "alice", role: "resident", desired: "enabled" }, bob],
}, 2);
assert.equal(reader.openRequests()[0].operation.id, id);
assert.throws(() => reader.assertApplicable(id), { code: "INTEGRATION_CONDITIONS" });
facts.push(entry(2, "bob", { kind: "vote", version: 1, request: id,
  verdict: "approve", body: "checked", approval: null }, "op-00000000-0000-4000-8000-000000000002"));
reader.assertApplicable(id);
const oldProjection = reader.projection();
assert.equal(oldProjection[0].input.eligible.has("bob"), true);
await Promise.resolve();
bob.desired = "stopped";
assert.throws(() => reader.assertApplicable(id), { code: "INTEGRATION_CONDITIONS" });
bob.desired = "enabled";
reader.assertApplicable(id);
facts.push(entry(3, "alice", { kind: "cancel", version: 1, request: id, reason: "withdrawn" },
  "op-00000000-0000-4000-8000-000000000003"));
assert.throws(() => reader.assertApplicable(id), { code: "CANCELLED_BEFORE_COMMIT" });
assert.throws(() => reader.assertApplicable("missing"), { code: "STORE_CORRUPT" });
