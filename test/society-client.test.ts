import assert from "node:assert/strict";
import test from "node:test";
import type { FramedPeer } from "#oma-test/app/platform/rpc";
import { requestSociety } from "#oma-test/app/platform/society-client";
import { societyResultProblem } from "@oma/protocol/host-api";
const projectId = "8f14e45f-ceea-4e7a-9f6b-1b1a2c3d4e5f";
const peer = (result: Record<string, unknown>): Pick<FramedPeer, "request"> => ({ request: async () => result });

test("DR40: Society client refuses malformed nested answers before exposing a typed result", async () => {
  const identity = { projectId, society: "demo", file: "saved.jsonl", sessionId: "saved" };
  const row = { identity, created: "2026-10-10T00:00:00Z", modified: "2026-10-10T00:00:00Z", messageCount: 1, firstMessage: "hello" };
  const valid = { sessions: [row], after: null };
  assert.equal((await requestSociety(peer(valid), "session.list", { projectId, society: "demo" })).sessions[0]!.identity.sessionId, "saved");
  for (const result of [
    { ...valid, sessions: [{ ...row, identity: { ...identity, file: "../escape.jsonl" } }] },
    { ...valid, sessions: [{ ...row, messageCount: -1 }] },
    { ...valid, sessions: [{ ...row, identity: { ...identity, society: "elsewhere" } }] },
  ]) await assert.rejects(requestSociety(peer(result), "session.list", { projectId, society: "demo" }), { code: "BROKER_UNAVAILABLE" });
  await assert.rejects(requestSociety(peer({ mode: "society", sessionId: "other" }), "session.inspect", identity), { code: "BROKER_UNAVAILABLE" });
});
test("DR40: Society client keeps refusal and durable request-key semantics", async () => {
  const refusal = new Error("guest refused");
  await assert.rejects(requestSociety({ request: async () => { throw refusal; } }, "society.list", {}), error => error === refusal);
  const result = { head: "a".repeat(40), ref: "refs/heads/main", objectFormat: "sha1", notCarried: [] };
  let calls = 0;
  await requestSociety({ request: async (method, params, key) => {
    calls++; assert.equal(method, "project.import"); assert.equal(key, "saved-request"); assert.equal(params.projectId, projectId); return result;
  } }, "project.import", { projectId, branch: "main", bundle: { bytes: 1, sha256: "b".repeat(64) } }, "saved-request");
  assert.equal(calls, 1);
  assert.equal(societyResultProblem("project.import", { ...result, objectFormat: "sha256" }), "invalid project.import fields");
  assert.equal(societyResultProblem("society.close", { state: "unknown" }), null);
  assert.equal(societyResultProblem("archive.create", { files: 1, bytes: Infinity, sha256: "b".repeat(64) }), "invalid archive.create fields");
});
