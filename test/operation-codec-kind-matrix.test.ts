import test from "node:test";
import assert from "node:assert/strict";
import type { Json, MessagePlan, MutationMethod, ResolvedAgentSpec } from "../implementation/contracts.js";
import { decodeOperation, type RawOperationRecord, type OperationDecodeContext } from "../src/storage/operation-codec.js";
import { StoreError } from "../src/domain/errors.js";
import { requestHash } from "../src/hash.js";
import { resolvedSpecDigest } from "../src/domain/spec-identity.js";

// Fixed independent identities/paths. The hash builder supplies valid controls;
// deliberately corrupted hashes below are never recomputed into a passing oracle.
const id = "op-11111111-1111-4111-8111-111111111111";
const messageId = "m-11111111-1111-4111-8111-111111111111-0";
const base = "a".repeat(40);
const candidate = "b".repeat(40);
const digest = "c".repeat(64);
const stateRoot = "/srv/oma/demo";
const spec: ResolvedAgentSpec = {
  name: "alice", from: base, brief: "Frozen brief", profile: "resident", modelProfile: "model",
  capabilities: ["mail.send"],
  resources: { memoryBytes: 1073741824, tasks: 64, cpuQuotaPercent: 100, tmpBytes: 16777216,
    workspaceBytes: 1073741824, stagingBytes: 16777216, checkTimeoutSeconds: 30 },
};
const specHash = resolvedSpecDigest(spec);
const agent = { name: "alice", profile: spec.profile, spec_hash: specHash, spec_json: JSON.stringify(spec),
  role: "resident", created_by: "alice", incarnation: 3 };
const message = (kind: MessagePlan["kind"] = "message", to = ["alice"], revision: string | null = null): MessagePlan => ({
  id: messageId, objectPath: `mail/objects/${messageId}.eml`, sha256: digest, bytes: 100, dateMs: 1000,
  to, recipients: ["alice"], kind, contextRevision: revision,
  replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] },
});
interface Fixture {
  kind: MutationMethod;
  payload: Json;
  plan: unknown;
  result: unknown;
  owned?: MessagePlan;
}
const mail = message();
const resultMail = message("result", ["commons"]);
const contextMail = message("context", ["residents"], candidate);
const entries = [{ path: "GOAL.md", bytes: 4, sha256: digest }];
const integrateResult = { kind: "git.integrate", base, candidate, target: "refs/heads/main", policyRevision: "p1", changed: true };
const fixtures: Fixture[] = [
  { kind: "mail.send", payload: { to: ["alice"], subject: "subject", kind: "message", body: "body" },
    plan: { kind: "mail.send", message: mail }, owned: mail,
    result: { kind: "mail.send", message: messageId, recipientCount: 1, archivePath: `${stateRoot}/mail/archive/cur/${messageId}:2,` } },
  { kind: "agent.continue", payload: { note: "continue" }, plan: { kind: "agent.continue", message: mail }, owned: mail,
    result: { kind: "agent.continue", message: messageId, recipientCount: 1, archivePath: `${stateRoot}/mail/archive/cur/${messageId}:2,` } },
  { kind: "mail.ack", payload: { message: messageId }, plan: { kind: "mail.ack", recipient: "alice", message: messageId },
    result: { kind: "mail.ack", message: messageId, acknowledged: true } },
  ...(["route.follow", "route.unfollow"] as const).map(kind => ({ kind, payload: { topic: "work" },
    plan: { kind, agent: "alice", topic: "work" }, result: { kind, topic: "work", subscribed: kind === "route.follow" } })),
  { kind: "agent.create", payload: { name: spec.name, from: base, brief: spec.brief },
    plan: { kind: "agent.create", spec, specHash, parent: "alice", workspacePath: `${stateRoot}/agents/alice/workspace`,
      unitNames: ["oma-demo-alice.service", "oma-demo-alice.path"], initialMessage: mail, existingCreation: null }, owned: mail,
    result: { kind: "agent.create", agent: "alice", desired: "enabled", remainingOperations: [] } },
  ...(["agent.start", "agent.stop"] as const).map(kind => ({ kind, payload: { agent: "alice" },
    plan: { kind, agent: "alice", previousIncarnation: 2, desired: kind === "agent.start" ? "enabled" : "stopped", remainingOperations: [] },
    result: { kind, agent: "alice", desired: kind === "agent.start" ? "enabled" : "stopped", remainingOperations: [] } })),
  { kind: "git.submit", payload: { candidate, exportRef: "refs/oma/export/frozen", prerequisites: [base], to: ["commons"], subject: "s", body: "b", paths: [] },
    plan: { kind: "git.submit", candidate, exportRef: "refs/oma/export/frozen", prerequisites: [base], bundle: null,
      publishedRef: `refs/oma/published/alice/${id}`, message: resultMail }, owned: resultMail,
    result: { kind: "git.submit", candidate, publishedRef: `refs/oma/published/alice/${id}`, message: messageId, recipientCount: 1 } },
  { kind: "git.integrate", payload: { candidate, expected: base },
    plan: { kind: "git.integrate", repo: "project", target: "refs/heads/main", base, candidate, policyRevision: "p1", checkProfileDigest: digest },
    result: integrateResult },
  { kind: "context.publish", payload: { expected: null, entries, content: { bytes: 4, sha256: digest, mediaType: "application/vnd.oma.context-v1" } },
    plan: { kind: "context.publish", base: null, candidate, target: "refs/heads/main", entries,
      stagingPath: `${stateRoot}/staging/context-${id}`, message: contextMail }, owned: contextMail,
    result: { kind: "context.publish", previous: null, revision: candidate, message: messageId, recipientCount: 1 } },
];
function raw(fixture: Fixture): RawOperationRecord {
  return { id, actor: "alice", request_key: "frozen", request_hash: requestHash(fixture.kind, fixture.payload), kind: fixture.kind,
    payload_json: JSON.stringify(fixture.payload), plan_json: JSON.stringify(fixture.plan), state: "pending",
    result_json: null, error_code: null, created_at_ms: 1, updated_at_ms: 1 };
}
function context(fixture: Fixture): OperationDecodeContext {
  return { stateRoot, repositoryIdentity: { society: "demo" }, relations: {
    operation: () => null, agent: name => name === "alice" ? agent : null,
    deliveries: () => fixture.owned ? [{ operation_id: id, message_id: fixture.owned.id, recipient: "alice" }] : [],
  } };
}
const isCorrupt = (error: unknown): boolean => error instanceof StoreError && error.code === "STORE_CORRUPT";

test("all eleven kinds preserve raw bytes and decode consistent state-specific values", () => {
  assert.equal(new Set(fixtures.map(fixture => fixture.kind)).size, 11);
  for (const fixture of fixtures) {
    const input = raw(fixture);
    const before = JSON.stringify(input);
    const pending = decodeOperation(input, context(fixture));
    assert.equal(pending.kind, fixture.kind);
    assert.equal(pending.planJson, input.plan_json);
    assert.equal(pending.payloadJson, input.payload_json);
    assert.equal(pending.result, null);
    assert.ok(Object.isFrozen(pending));
    assert.ok(Object.isFrozen(pending.plan));
    assert.equal(JSON.stringify(input), before);
    const succeeded = decodeOperation({ ...input, state: "succeeded", result_json: JSON.stringify(fixture.result) }, context(fixture));
    assert.equal(succeeded.state, "succeeded");
    assert.deepEqual(succeeded.result, fixture.result);
    assert.equal(decodeOperation({ ...input, state: "unknown" }, context(fixture)).state, "unknown");
    assert.equal(decodeOperation({ ...input, state: "failed", error_code: "CHECK_FAILED" }, context(fixture)).state, "failed");
    for (const damage of [
      { request_hash: "0".repeat(64) }, { id: "not-an-operation" }, { actor: "../alice" },
      { plan_json: "{}" }, { state: "pending", result_json: "{}" },
      { state: "failed", error_code: "STREAM_INVALID" }, { state: "succeeded", result_json: "{}" },
    ]) assert.throws(() => decodeOperation({ ...input, ...damage }, context(fixture)), isCorrupt, `${fixture.kind}: ${JSON.stringify(damage)}`);
    if (fixture.owned) {
      const ctx = context(fixture);
      assert.throws(() => decodeOperation(input, { ...ctx, relations: { ...ctx.relations, deliveries: () => [] } }), isCorrupt);
    }
  }
});

test("legacy integrate result is accepted without rewriting and its relation is checked", () => {
  const fixture = fixtures.find(entry => entry.kind === "git.integrate");
  assert.ok(fixture);
  const input = raw(fixture);
  const legacy = { ...JSON.parse(String(input.plan_json)), result: integrateResult };
  const plan_json = JSON.stringify(legacy, null, 2);
  assert.equal(decodeOperation({ ...input, plan_json }, context(fixture)).planJson, plan_json);
  assert.throws(() => decodeOperation({ ...input, plan_json: JSON.stringify({ ...legacy, result: { ...integrateResult, candidate: base } }) }, context(fixture)), isCorrupt);
});

test("create unit ownership cannot be inferred from a plan without trusted society identity", () => {
  const fixture = fixtures.find(entry => entry.kind === "agent.create");
  assert.ok(fixture);
  assert.throws(() => decodeOperation(raw(fixture), { ...context(fixture), repositoryIdentity: null }), isCorrupt);
  assert.throws(() => decodeOperation(raw(fixture), { ...context(fixture), repositoryIdentity: { society: "other" } }), isCorrupt);
});
