import test from "node:test";
import assert from "node:assert/strict";
import { StoreError } from "@oma/domain/errors";
import { integrationPolicyFromConfig, snapshotIntegrationPolicy, assertSupportedIntegration, assertSameIntegrationPolicy, } from "@oma/domain/integration-policy";
const code = (expected) => (error) => error instanceof StoreError && error.code === expected;
const profile = {
    policyRevision: "revision-1", protectedPaths: ["secret/", "M secret.txt"],
    checks: [{ id: "check", argv: ["/usr/bin/check", "literal space", "$value"], env: { MODE: "strict" } }],
};
test("R19: host check argv and environment correspond to the runtime snapshot", () => {
    const input = structuredClone(profile);
    const runtime = integrationPolicyFromConfig(input);
    assert.deepEqual(runtime, {
        policyRevision: "revision-1", protectedPaths: ["secret/", "M secret.txt"],
        checks: [{ id: "check", argv: ["/usr/bin/check", "literal space", "$value"], env: { MODE: "strict" },
            }],
    });
    const snapshot = snapshotIntegrationPolicy(runtime);
    input.checks[0].argv[0] = "/evil";
    input.checks[0].env.MODE = "relaxed";
    runtime.checks[0].argv.push("later");
    runtime.protectedPaths.push("other/");
    assert.deepEqual(snapshot.checks[0].argv, ["/usr/bin/check", "literal space", "$value"]);
    assert.deepEqual(snapshot.checks[0].env, { MODE: "strict" });
    assert.deepEqual(snapshot.protectedPaths, ["secret/", "M secret.txt"]);
    for (const value of [snapshot, snapshot.checks, snapshot.protectedPaths, snapshot.checks[0],
        snapshot.checks[0].argv, snapshot.checks[0].env])
        assert.equal(Object.isFrozen(value), true);
});
test("R19: empty-check digest retains the independent historical SHA256 of []", () => {
    const snapshot = snapshotIntegrationPolicy({ policyRevision: "p1", protectedPaths: [], checks: [] });
    assert.equal(snapshot.checkProfileDigest, "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
    assert.doesNotThrow(() => assertSupportedIntegration(snapshot));
});
test("R19: policy freshness includes same-revision protected paths, argv and environment", () => {
    const original = integrationPolicyFromConfig(structuredClone(profile));
    const before = snapshotIntegrationPolicy(original);
    assert.doesNotThrow(() => assertSameIntegrationPolicy(before, snapshotIntegrationPolicy(structuredClone(original))));
    const mutations = [
        policy => { policy.protectedPaths.push("new/"); },
        policy => { policy.checks[0].argv.push("--unsafe"); },
        policy => { policy.checks[0].env.MODE = "other"; },
    ];
    for (const mutate of mutations) {
        const altered = structuredClone(original);
        mutate(altered);
        assert.throws(() => assertSameIntegrationPolicy(before, snapshotIntegrationPolicy(altered)), code("POLICY_CHANGED"));
    }
    // DR8: the revision is the host's current one, compared on its own; a
    // revision-only edit is not a change of the facts the broker holds.
    const revised = structuredClone(original);
    revised.policyRevision = "revision-2";
    assert.doesNotThrow(() => assertSameIntegrationPolicy(before, snapshotIntegrationPolicy(revised)));
});
test("DR46 current tier policy: fewer than two HIGH peers refuses before freezing a snapshot", () => {
    const policy = { policyRevision: "p1", protectedPaths: [], checks: [],
        tiered: { repositoryFloor: "LOW", highPeerFloor: 1, principalDelegated: true, rules: [] } };
    assert.throws(() => snapshotIntegrationPolicy(policy), code("UNSUPPORTED_PROFILE"));
    policy.tiered.highPeerFloor = 2;
    const accepted = snapshotIntegrationPolicy(policy);
    policy.tiered.highPeerFloor = 3;
    assert.equal(accepted.tiered.highPeerFloor, 2);
    assert.throws(() => assertSameIntegrationPolicy(accepted, snapshotIntegrationPolicy(policy)), code("POLICY_CHANGED"));
});
