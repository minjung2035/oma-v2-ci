import test from "node:test";
import assert from "node:assert/strict";
import type { MessagePlan, MutationMethod, ResolvedAgentSpec } from "../implementation/contracts.js";
import { StoreError } from "../src/domain/errors.js";
import { resolvedSpecDigest } from "../src/domain/spec-identity.js";
import { requestHash } from "../src/hash.js";
import {
  decodeOperation, type OperationDecodeContext, type RawOperationRecord,
} from "../src/storage/operation-codec.js";

const OP = "op-00000000-0000-4000-8000-000000000001";
const OTHER = "op-00000000-0000-4000-8000-000000000002";
const MESSAGE = "m-00000000-0000-4000-8000-000000000001-0";
const ROOT = "/state/demo";
const BASE = "1".repeat(40);
const CANDIDATE = "2".repeat(40);
const DIGEST = "0123456789abcdef".repeat(4);
const KINDS = [
  "attest.record", "mail.send", "mail.ack", "route.follow", "route.unfollow", "agent.create",
  "society.set", "agent.start", "agent.stop", "agent.continue", "git.submit", "git.integrate", "context.publish",
] as const satisfies readonly MutationMethod[];

interface Fixture {
  readonly raw: RawOperationRecord;
  readonly context: OperationDecodeContext;
  readonly payload: Record<string, unknown>;
  readonly plan: Record<string, unknown>;
  readonly result: Record<string, unknown>;
  readonly deliveries: readonly Record<string, unknown>[];
}

function fixture(kind: MutationMethod): Fixture {
  const spec: ResolvedAgentSpec = {
    name: "alice", from: BASE, brief: "Accepted brief", profile: "p", capabilities: [], modelProfile: "md",
    resources: {
      memoryBytes: 3221225472, tasks: 128, cpuQuotaPercent: 200, tmpBytes: 1048576,
      workspaceBytes: 1048576, stagingBytes: 1048576, checkTimeoutSeconds: 30,
    },
  };
  const message: MessagePlan = {
    id: MESSAGE, objectPath: `mail/objects/${MESSAGE}.eml`, sha256: DIGEST,
    bytes: 1, dateMs: 1000, to: ["alice"], recipients: ["alice"], kind: "message",
    contextRevision: null, replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] },
  };
  const entries = [{ path: "GOAL.md", bytes: 1, sha256: DIGEST }];
  const fact = { kind: "peer", identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: BASE,
    candidate: CANDIDATE, policyRevision: "p1" }, verdict: "APPROVE", evidence: "Reviewed exact candidate" };
  const cases = {
    "society.set": { payload: { state: "closed" }, plan: { kind, state: "closed" }, result: { kind, state: "closed" } },
    "attest.record": { payload: fact, plan: { kind, fact, message: { ...message, kind: "result", to: ["commons"] } },
      result: { kind, message: MESSAGE, recipientCount: 1, archivePath: `${ROOT}/mail/archive/cur/${MESSAGE}:2,` } },
    "mail.send": {
      payload: { to: ["alice"], subject: "subject", kind: "message", body: "body" },
      plan: { kind, message },
      result: { kind, message: MESSAGE, recipientCount: 1, archivePath: `${ROOT}/mail/archive/cur/${MESSAGE}:2,` },
    },
    "agent.continue": {
      payload: { note: "Continue the accepted task" }, plan: { kind, message },
      result: { kind, message: MESSAGE, recipientCount: 1, archivePath: `${ROOT}/mail/archive/cur/${MESSAGE}:2,` },
    },
    "mail.ack": {
      payload: { message: MESSAGE }, plan: { kind, recipient: "alice", message: MESSAGE },
      result: { kind, message: MESSAGE, acknowledged: true },
    },
    "route.follow": {
      payload: { topic: "work" }, plan: { kind, topic: "work", agent: "alice" },
      result: { kind, topic: "work", subscribed: true },
    },
    "route.unfollow": {
      payload: { topic: "work" }, plan: { kind, topic: "work", agent: "alice" },
      result: { kind, topic: "work", subscribed: false },
    },
    "agent.create": {
      payload: { name: spec.name, from: spec.from, brief: spec.brief },
      plan: {
        kind, spec, specHash: resolvedSpecDigest(spec), parent: "principal",
        workspacePath: `${ROOT}/agents/alice/workspace`,
        unitNames: ["oma-demo-alice.service", "oma-demo-alice.path"], initialMessage: message, existingCreation: null,
      },
      result: { kind, agent: "alice", desired: "enabled", remainingOperations: [] },
    },
    "agent.start": {
      payload: { agent: "alice" },
      plan: { kind, agent: "alice", previousIncarnation: 0, desired: "enabled", remainingOperations: [] },
      result: { kind, agent: "alice", desired: "enabled", remainingOperations: [] },
    },
    "agent.stop": {
      payload: { agent: "alice" },
      plan: { kind, agent: "alice", previousIncarnation: 0, desired: "stopped", remainingOperations: [] },
      result: { kind, agent: "alice", desired: "stopped", remainingOperations: [] },
    },
    "git.submit": {
      payload: { candidate: CANDIDATE, exportRef: "refs/oma/export/fixture", prerequisites: [], to: ["alice"], subject: "s", body: "b", paths: [] },
      plan: {
        kind, candidate: CANDIDATE, exportRef: "refs/oma/export/fixture", prerequisites: [], bundle: null,
        publishedRef: `refs/oma/published/alice/${OP}`, message: { ...message, kind: "result" },
      },
      result: { kind, candidate: CANDIDATE, publishedRef: `refs/oma/published/alice/${OP}`, message: MESSAGE, recipientCount: 1 },
    },
    "git.integrate": {
      payload: { candidate: CANDIDATE, expected: BASE },
      plan: { kind, repo: "project", target: "refs/heads/main", base: BASE, candidate: CANDIDATE, policyRevision: "p1", checkProfileDigest: DIGEST },
      result: { kind, base: BASE, candidate: CANDIDATE, target: "refs/heads/main", policyRevision: "p1", changed: true },
    },
    "context.publish": {
      payload: { expected: null, entries, content: { bytes: 1, sha256: DIGEST, mediaType: "application/vnd.oma.context-v1" } },
      plan: {
        kind, base: null, candidate: CANDIDATE, target: "refs/heads/main", entries,
        stagingPath: `${ROOT}/staging/context-${OP}`,
        message: { ...message, kind: "context", to: ["residents"], contextRevision: CANDIDATE },
      },
      result: { kind, previous: null, revision: CANDIDATE, message: MESSAGE, recipientCount: 1 },
    },
  } satisfies Record<MutationMethod, { payload: Record<string, unknown>; plan: Record<string, unknown>; result: Record<string, unknown> }>;
  const selected = cases[kind];
  const ownedMessage = kind === "attest.record" || kind === "mail.send" || kind === "agent.continue" || kind === "agent.create" || kind === "git.submit" || kind === "context.publish";
  const deliveries = ownedMessage ? [{ operation_id: OP, message_id: MESSAGE, recipient: "alice" }] : [];
  const raw: RawOperationRecord = {
    id: OP, actor: kind === "society.set" || kind === "agent.create" || kind === "context.publish" ? "principal" : "alice",
    request_key: "accepted-fixture", request_hash: requestHash(kind, selected.payload), kind,
    payload_json: JSON.stringify(selected.payload), plan_json: JSON.stringify(selected.plan),
    state: "pending", result_json: null, error_code: null, created_at_ms: 1000, updated_at_ms: 1000,
  };
  const context: OperationDecodeContext = {
    stateRoot: ROOT, repositoryIdentity: { society: "demo" },
    relations: {
      attestation: id => id === OP && kind === "attest.record" ? { sequence: 1, operation_id: OP } : null,
      operation: () => null,
      agent: name => name === "alice" ? {
        name, profile: spec.profile, spec_hash: resolvedSpecDigest(spec), spec_json: JSON.stringify(spec),
        role: "resident", created_by: "principal", incarnation: 0,
      } : null,
      deliveries: id => id === OP ? deliveries : [],
    },
  };
  return { raw, context, deliveries, ...selected };
}

function corrupts(raw: unknown, context: OperationDecodeContext): void {
  assert.throws(() => decodeOperation(raw, context), (error: unknown) =>
    error instanceof StoreError && error.code === "STORE_CORRUPT");
}

for (const kind of KINDS) {
  test(`all states decode without rewriting supported ${kind} bytes`, () => {
    const f = fixture(kind);
    const original = JSON.stringify(f.raw);
    const pending = decodeOperation(f.raw, f.context);
    assert.equal(pending.kind, kind);
    assert.equal(pending.state, "pending");
    assert.equal(pending.planJson, f.raw.plan_json);
    assert.equal(pending.payloadJson, f.raw.payload_json);
    assert.equal(JSON.stringify(pending.plan), JSON.stringify(f.plan));
    assert.equal(Object.isFrozen(pending), true);
    assert.equal(Object.isFrozen(pending.plan), true);
    assert.equal(Object.isFrozen(pending.payload), true);
    assert.equal(decodeOperation({ ...f.raw, state: "unknown" }, f.context).state, "unknown");
    const failed = decodeOperation({ ...f.raw, state: "failed", error_code: "CHECK_FAILED" }, f.context);
    assert.equal(failed.state, "failed");
    assert.equal(failed.errorCode, "CHECK_FAILED");
    const resultJson = JSON.stringify(f.result, null, 1);
    const succeeded = decodeOperation({ ...f.raw, state: "succeeded", result_json: resultJson }, f.context);
    assert.equal(succeeded.state, "succeeded");
    assert.equal(succeeded.resultJson, resultJson);
    assert.deepEqual(succeeded.result, f.result);
    assert.equal(JSON.stringify(f.raw), original);
  });

  test(`single-field corruption is rejected for ${kind}`, () => {
    const f = fixture(kind);
    assert.equal(decodeOperation(f.raw, f.context).kind, kind, "positive control must pass before mutations");
    for (const damaged of [
      { ...f.raw, id: "not-an-operation" }, { ...f.raw, actor: "../alice" },
      { ...f.raw, request_hash: "0".repeat(64) }, { ...f.raw, request_key: "" },
      { ...f.raw, created_at_ms: "1000" }, { ...f.raw, updated_at_ms: 0.5 },
      { ...f.raw, payload_json: "{" }, { ...f.raw, plan_json: "{" },
      { ...f.raw, plan_json: JSON.stringify({ ...f.plan, unrecognized: true }) },
      { ...f.raw, state: "pending", result_json: JSON.stringify(f.result) },
      { ...f.raw, state: "unknown", error_code: "CHECK_FAILED" },
      { ...f.raw, state: "succeeded", result_json: null },
      { ...f.raw, state: "succeeded", result_json: JSON.stringify({ ...f.result, unrecognized: true }) },
      { ...f.raw, state: "failed", error_code: "STREAM_INVALID" },
      { ...f.raw, state: "failed", error_code: "STORAGE_FULL" },
      { ...f.raw, state: "failed", error_code: "LIMIT_EXCEEDED" },
    ]) corrupts(damaged, f.context);
  });
}

test("legacy integrate plan.result remains a read-compatible immutable representation", () => {
  const f = fixture("git.integrate");
  const planJson = JSON.stringify({ ...f.plan, result: f.result }, null, 2);
  const raw = { ...f.raw, plan_json: planJson, state: "succeeded", result_json: JSON.stringify(f.result) };
  const decoded = decodeOperation(raw, f.context);
  assert.equal(decoded.planJson, planJson);
  assert.equal(decoded.kind, "git.integrate");
  if (decoded.kind !== "git.integrate") assert.fail("wrong decoded kind");
  assert.deepEqual(decoded.plan.result, f.result);
  corrupts({ ...raw, result_json: JSON.stringify({ ...f.result, changed: false }) }, f.context);
});

test("delivery observations match the exact frozen message and recipient set", () => {
  const f = fixture("mail.send");
  assert.equal(decodeOperation(f.raw, f.context).kind, "mail.send");
  const delivery = { operation_id: OP, message_id: MESSAGE, recipient: "alice" };
  for (const rows of [
    [], [delivery, delivery], [{ ...delivery, recipient: "bob" }],
    [{ ...delivery, operation_id: OTHER }], [{ ...delivery, message_id: `${MESSAGE.slice(0, -1)}1` }],
  ]) {
    corrupts(f.raw, { ...f.context, relations: { ...f.context.relations, deliveries: () => rows } });
  }
  const route = fixture("route.follow");
  corrupts(route.raw, { ...route.context, relations: { ...route.context.relations, deliveries: () => [delivery] } });
});

test("create aliases require the original identity and reject cycles without recursion overflow", () => {
  const f = fixture("agent.create");
  const aliasPlan = { ...f.plan, initialMessage: null, existingCreation: OP };
  const alias = { ...f.raw, id: OTHER, request_key: "linked-fixture", plan_json: JSON.stringify(aliasPlan) };
  const context: OperationDecodeContext = {
    ...f.context,
    relations: { ...f.context.relations, operation: id => id === OP ? f.raw : null },
  };
  assert.equal(decodeOperation(alias, context).id, OTHER);
  corrupts(alias, { ...context, relations: { ...context.relations, operation: () => null } });
  corrupts(alias, { ...context, repositoryIdentity: null });
  corrupts(alias, { ...context, repositoryIdentity: { society: "other" } });
  const first = { ...f.raw, plan_json: JSON.stringify({ ...f.plan, initialMessage: null, existingCreation: OTHER }) };
  const cycle: OperationDecodeContext = {
    ...context,
    relations: { ...context.relations, deliveries: () => [], operation: id => id === OP ? first : id === OTHER ? alias : null },
  };
  corrupts(first, cycle);
  corrupts(alias, { ...context, relations: { ...context.relations, operation: () => fixture("route.follow").raw, deliveries: () => [] } });
});
