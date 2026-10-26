import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { InternalMethods, MutationMethod, PublicMethod, ProtocolLimits } from "@oma/contracts";
import {
  PUBLIC_METHODS, INTERNAL_METHODS, isPublicMethod, isInternalMethod, decodePublicParams,
} from "@oma/protocol/methods";
import { loadConfig } from "@oma/config";

import { MIN_LOG_FRAME_BYTES } from "@oma/protocol/log-response";

// Both directions matter: a table cannot omit a union member or add a wire method.
type Equal<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Assert<T extends true> = T;
export type PublicExhaustive = Assert<Equal<keyof typeof PUBLIC_METHODS, PublicMethod>>;
export type InternalExhaustive = Assert<Equal<keyof typeof INTERNAL_METHODS, keyof InternalMethods>>;
type DescriptorMutation = {
  [M in PublicMethod]: typeof PUBLIC_METHODS[M]["mode"] extends "mutation" ? M : never
}[PublicMethod];
export type MutationsExhaustive = Assert<Equal<DescriptorMutation, MutationMethod>>;

// mailBodyBytes sits above the AV-07 floor for subjectBytes=64 (the smallest
// servable bound, mail/review-bounds.ts minimumMailBodyBytes); under it the
// configuration is refused before the checks these tests exercise run.
const limits: ProtocolLimits = {
  frameBytes: 4096, mailBodyBytes: 4096, subjectBytes: 64, addresses: 8,
  replyReferences: 8, contextFiles: 8, contextBytes: 4096, bundleBytes: 8192,
  logBytes: 1024, batchMaxMessages: 8, idleStreamSeconds: 1, receiptWaitSeconds: 1,
};
const context = { limits };

test("public/internal registries are closed, disjoint, and classify all 13 mutations", () => {
  assert.equal(Object.keys(PUBLIC_METHODS).length, 20);
  assert.deepEqual(PUBLIC_METHODS["operation.read"].authority, ["current-actor", "own-operation"]);
  assert.equal(Object.keys(INTERNAL_METHODS).length, 9);
  assert.equal(Object.values(PUBLIC_METHODS).filter(d => d.mode === "mutation").length, 13);
  for (const [method, descriptor] of Object.entries(PUBLIC_METHODS)) {
    assert.equal(isInternalMethod(method), false);
    assert.equal(descriptor.key, descriptor.mode === "mutation" ? "required" : "forbidden");
    assert.notEqual(descriptor.paramsCheck(context)({ extra: true }), null);
  }
  for (const [method, descriptor] of Object.entries(INTERNAL_METHODS)) {
    assert.equal(isPublicMethod(method), false);
    assert.equal(descriptor.stream, "none");
    assert.equal(descriptor.key, "forbidden");
    assert.notEqual(descriptor.paramsCheck({ extra: true }), null);
  }
  for (const name of ["constructor", "__proto__", "toString", "mail.forward", ""]) {
    assert.equal(isPublicMethod(name), false);
    assert.equal(isInternalMethod(name), false);
  }
});

test("conditional authority and stream policy are not replaced with capability-only admission", () => {
  assert.deepEqual(PUBLIC_METHODS["mail.ack"].authority, ["current-actor", "own-delivery"]);
  assert.deepEqual(PUBLIC_METHODS["agent.stop"].authority, ["current-actor", "self-or-descendant"]);
  assert.equal(PUBLIC_METHODS["git.submit"].stream, "optional-bundle");
  assert.equal(PUBLIC_METHODS["context.publish"].stream, "required-content");
  assert.equal(INTERNAL_METHODS["batch.complete"].evidence, "boundary");
  assert.equal(INTERNAL_METHODS["principal.attach"].channel, "extension");
  assert.equal(INTERNAL_METHODS["host.principalRelay"].lease, "host-unit");
});

test("the shared params decoder is closed and consumes the caller's host limits", () => {
  assert.deepEqual(decodePublicParams("agent.wait", {}, context), {});
  assert.deepEqual(decodePublicParams("agent.wait", { observe: true }, context), { observe: true });
  for (const observe of [false, null, 1, "true"])
    assert.equal(decodePublicParams("agent.wait", { observe }, context), null);
  assert.equal(decodePublicParams("agent.wait", { request: "extra" }, context), null);
  const mail = { to: ["alice"], subject: "subject", kind: "message", body: "body" };
  assert.deepEqual(decodePublicParams("mail.send", mail, context), mail);
  assert.equal(decodePublicParams("mail.send", { ...mail, extra: 1 }, context), null);
  assert.equal(decodePublicParams("mail.send", mail, {
    ...context, limits: { ...limits, subjectBytes: 1 },
  }), null);
  assert.equal(decodePublicParams("agent.create", {
    name: "alice", from: "a".repeat(40), brief: "brief", capabilities: [],
  }, context), null);
});

function configFixture() {
  return {
    schemaVersion: 3,
    society: "example",
    installation: { node: "/usr/bin/node", libdir: "/opt/oma", rootfs: "/opt/rootfs", deploymentDigest: "a".repeat(64) },
    modelProfiles: { model: { provider: "test", model: "test", inferenceTimeoutSeconds: 1 } },
    agentProfiles: { resident: { modelProfile: "model", capabilities: [], delegable: [], childProfile: null } },
    principalProfile: "resident",
    initialResidents: [{ name: "alice", profile: "resident", brief: "brief" }],
    integration: { policyRevision: "test", protectedPaths: [], checks: [] },
    limits
};
}

test("integration rejects unknown keys and initial residents reject a repeated name", () => {
  const directory = mkdtempSync(join(tmpdir(), "oma-r04-"));
  const path = join(directory, "host.json");
  try {
    const valid = configFixture();
    writeFileSync(path, JSON.stringify(valid));
    assert.equal(loadConfig(path).initialResidents.length, 1);
    writeFileSync(path, JSON.stringify({ ...valid, integration: { ...valid.integration, extra: true } }));
    assert.throws(() => loadConfig(path), /integration\.extra unknown/);
    writeFileSync(path, JSON.stringify({ ...valid, initialResidents: [...valid.initialResidents, ...valid.initialResidents] }));
    assert.throws(() => loadConfig(path), /initialResidents\.name duplicate/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("F3: host configuration rejects frame limits without room for the minimal log response", () => {
  const directory = mkdtempSync(join(tmpdir(), "oma-log-config-"));
  const path = join(directory, "host.json");
  try {
    const config = configFixture();
    for (const frameBytes of [MIN_LOG_FRAME_BYTES - 1, 0x100000000]) {
      writeFileSync(path, JSON.stringify({ ...config, limits: { ...limits, frameBytes } }));
      assert.throws(() => loadConfig(path), /limits\.frameBytes/);
    }
    writeFileSync(path, JSON.stringify({ ...config, limits: { ...limits, frameBytes: MIN_LOG_FRAME_BYTES } }));
    assert.equal(loadConfig(path).limits.frameBytes, MIN_LOG_FRAME_BYTES);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
