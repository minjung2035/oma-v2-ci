import test from "node:test";
import assert from "node:assert/strict";
import type { HostConfigV1 } from "../implementation/contracts.js";
import { StoreError } from "../src/domain/errors.js";
import {
  integrationPolicyFromConfig, snapshotIntegrationPolicy, assertSupportedIntegration,
  assertSameIntegrationPolicy, type IntegrationPolicy,
} from "../src/git/integration-policy.js";

const code = (expected: string) => (error: unknown): boolean => error instanceof StoreError && error.code === expected;
const profile: HostConfigV1["integration"] = {
  policyRevision: "revision-1", protectedPaths: ["secret/", "M secret.txt"],
  checks: [{ id: "check", argv: ["/usr/bin/check", "literal space", "$value"], env: { MODE: "strict" },
    resources: { memoryBytes: 4096, tasks: 4, cpuQuotaPercent: 10, tmpBytes: 512,
      workspaceBytes: 2048, stagingBytes: 1024, checkTimeoutSeconds: 3 } }],
};

test("R19: host check argv, environment and every resource correspond to the runtime snapshot", () => {
  const input = structuredClone(profile);
  const runtime = integrationPolicyFromConfig(input);
  assert.deepEqual(runtime, {
    policyRevision: "revision-1", protectedPaths: ["secret/", "M secret.txt"],
    checks: [{ id: "check", argv: ["/usr/bin/check", "literal space", "$value"], env: { MODE: "strict" },
      timeoutSeconds: 3, tmpBytes: 512,
      resources: { memoryBytes: 4096, tasks: 4, cpuQuotaPercent: 10, tmpBytes: 512,
        workspaceBytes: 2048, stagingBytes: 1024, checkTimeoutSeconds: 3 } }],
  });
  const snapshot = snapshotIntegrationPolicy(runtime);
  input.checks[0]!.argv[0] = "/evil"; input.checks[0]!.env.MODE = "relaxed";
  runtime.checks[0]!.resources!.workspaceBytes = 8192; runtime.protectedPaths.push("other/");
  assert.deepEqual(snapshot.checks[0]!.argv, ["/usr/bin/check", "literal space", "$value"]);
  assert.deepEqual(snapshot.checks[0]!.env, { MODE: "strict" });
  assert.equal(snapshot.checks[0]!.resources!.workspaceBytes, 2048);
  assert.deepEqual(snapshot.protectedPaths, ["secret/", "M secret.txt"]);
  for (const value of [snapshot, snapshot.checks, snapshot.protectedPaths, snapshot.checks[0],
    snapshot.checks[0]!.argv, snapshot.checks[0]!.env, snapshot.checks[0]!.resources]) assert.equal(Object.isFrozen(value), true);
});

test("R19: empty-check digest retains the independent historical SHA256 of []", () => {
  const snapshot = snapshotIntegrationPolicy({ policyRevision: "p1", protectedPaths: [], checks: [] });
  assert.equal(snapshot.checkProfileDigest, "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
  assert.doesNotThrow(() => assertSupportedIntegration(snapshot));
});

test("R19: policy freshness includes same-revision protected paths, argv, environment and resources", () => {
  const original = integrationPolicyFromConfig(structuredClone(profile));
  const before = snapshotIntegrationPolicy(original);
  assert.doesNotThrow(() => assertSameIntegrationPolicy(before, snapshotIntegrationPolicy(structuredClone(original))));
  const mutations: Array<(policy: IntegrationPolicy) => void> = [
    policy => { policy.protectedPaths.push("new/"); },
    policy => { policy.checks[0]!.argv.push("--unsafe"); },
    policy => { policy.checks[0]!.env.MODE = "other"; },
    policy => { policy.checks[0]!.resources!.memoryBytes *= 2; },
  ];
  for (const mutate of mutations) {
    const altered = structuredClone(original); mutate(altered);
    assert.throws(() => assertSameIntegrationPolicy(before, snapshotIntegrationPolicy(altered)), code("POLICY_CHANGED"));
  }
  // DR8: the revision is the host's current one, compared on its own; a
  // revision-only edit is not a change of the facts the broker holds.
  const revised = structuredClone(original); revised.policyRevision = "revision-2";
  assert.doesNotThrow(() => assertSameIntegrationPolicy(before, snapshotIntegrationPolicy(revised)));
});

test("R19: resource/runtime disagreement fails instead of silently rewriting a host profile", () => {
  for (const field of ["timeoutSeconds", "tmpBytes"] as const) {
    const altered = integrationPolicyFromConfig(structuredClone(profile));
    altered.checks[0]![field] = 99;
    assert.throws(() => snapshotIntegrationPolicy(altered), code("UNSUPPORTED_PROFILE"));
  }
  const duplicate = integrationPolicyFromConfig(structuredClone(profile));
  duplicate.checks.push(structuredClone(duplicate.checks[0]!));
  assert.throws(() => snapshotIntegrationPolicy(duplicate), code("UNSUPPORTED_PROFILE"));
});

test("R19: original nonempty check and root-path gates remain explicit", () => {
  const source = integrationPolicyFromConfig(structuredClone(profile));
  const before = JSON.stringify(source);
  assert.throws(() => assertSupportedIntegration(snapshotIntegrationPolicy(source)), code("SPIKE_UNRESOLVED"));
  assert.equal(JSON.stringify(source), before, "checks are not replaced with an empty list");
  assert.throws(() => assertSupportedIntegration(snapshotIntegrationPolicy({
    policyRevision: "p1", protectedPaths: ["/"], checks: [],
  })), code("SPIKE_UNRESOLVED"));
});
