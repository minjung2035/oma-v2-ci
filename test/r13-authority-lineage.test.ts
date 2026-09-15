import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, Capability, HostConfigV1 } from "../implementation/contracts.js";
import { Store, StoreError } from "../src/store.js";
import { LineageSnapshot, assertCreateCapacity } from "../src/domain/lineage.js";
import { sumUsage, permitsReservation } from "../src/domain/usage-budget.js";
import { assertActorIdentity, assertCurrentActor, currentAuthorityGuard, capabilitiesOf } from "../src/authority.js";
import { createChildSpecResolver } from "../src/config/policy.js";
import { resolveChildSpec } from "../src/domain/child-policy.js";
import { makeValidAgent, TEST_RESOURCES } from "./fixtures/spec.js";

/* R13 method-specific authentication/replay ordering (not a generic bypass):
| Method | Before lookup/replay | New effect / reservation | Stopped/retired actor |
| ack/follow/unfollow/create | identity, role, incarnation, frozen spec | enabled; create also live ∩ durable agent.create | identity-only replay; new effect STALE_RUN |
| start/stop | identity then management capability, lineage, target state; start also GOAL | same current management check inside T | STALE_RUN before replay |
| inference.open | identity then usage owner; existing usage never calls provider | enabled + frozen model + budgets after slot wait in T | existing usage is REQUEST_KEY_REUSED; new reservation STALE_RUN |
| inference.cancel | identity then call/usage owner | cancellation only, no new provider call | ownership-checked cancellation permitted |
Missing actor/role mismatch is AUTH_FAILED; stale incarnation is STALE_RUN.
Missing/cyclic frozen lineage is STORE_CORRUPT. Broker transport authentication
and method capability preflight still precede all these module entrypoints.
*/
const code = (expected: string) => (error: unknown) => error instanceof StoreError && error.code === expected;

test("R13: cycles, self-parent, missing parents and unknown actors never become partial trees", () => {
  const corruptGraphs: Array<Array<{ name: string; createdBy: string | null }>> = [
    [{ name: "alice", createdBy: "bob" }, { name: "bob", createdBy: "alice" }],
    [{ name: "alice", createdBy: "alice" }], [{ name: "alice", createdBy: "missing" }],
    [{ name: "alice", createdBy: null }, { name: "alice", createdBy: null }],
  ];
  for (const rows of corruptGraphs) assert.throws(() => new LineageSnapshot(rows), code("STORE_CORRUPT"));
  const graph = new LineageSnapshot([{ name: "alice", createdBy: null }]);
  assert.throws(() => graph.ancestors("missing"), code("STORE_CORRUPT"));
  assert.throws(() => graph.descendants("missing"), code("STORE_CORRUPT"));
});

test("R13: deep and wide trees have no invented depth or argument-count policy", () => {
  const deep = Array.from({ length: 10000 }, (_, index) => ({ name: `n-${index}`, createdBy: index === 0 ? null : `n-${index - 1}` }));
  const graph = new LineageSnapshot(deep);
  assert.equal(graph.ancestors("n-9999").length, 10000);
  assert.equal(graph.descendants("n-0").length, 10000);
  const wide = new LineageSnapshot([{ name: "root", createdBy: null }, ...Array.from({ length: 10000 }, (_, index) => ({ name: `w-${index}`, createdBy: "root" }))]);
  assert.equal(wide.descendants("root", false).length, 10000);
  assert.equal(wide.isDescendant("root", "root"), false);
  assert.equal(wide.isDescendant("root", "root", true), true);
});

test("R13: every resident desired state counts; budgets include all ancestors and unknown commitments", () => {
  const rows = [makeValidAgent("principal"), makeValidAgent("alice", { createdBy: "principal" }),
    makeValidAgent("bob", { createdBy: "alice", desired: "stopped" }),
    makeValidAgent("carol", { createdBy: "alice", desired: "retired" }),
    makeValidAgent("dave", { createdBy: "bob", desired: "provisioning" })];
  const graph = new LineageSnapshot(rows);
  assert.throws(() => assertCreateCapacity(graph, "bob", { societyAgents: 4, lineageAgents: 100 }), code("QUOTA_EXCEEDED"));
  assert.throws(() => assertCreateCapacity(graph, "bob", { societyAgents: 5, lineageAgents: 3 }), code("QUOTA_EXCEEDED"));
  assert.doesNotThrow(() => assertCreateCapacity(graph, "bob", { societyAgents: 5, lineageAgents: 4 }));
  const usage = [
    { actor: "alice", outcome: "completed" as const, reservedUnits: 10, reportedUnits: 2 },
    { actor: "bob", outcome: "unknown" as const, reservedUnits: 4, reportedUnits: null },
    { actor: "principal", outcome: "reserved" as const, reservedUnits: 1, reportedUnits: null },
  ];
  assert.equal(sumUsage(graph, usage, "alice"), 6);
  assert.equal(sumUsage(graph, usage, null), 7);
  assert.equal(sumUsage(graph, usage, null, true), 6);
  assert.equal(permitsReservation(graph, usage, { societyUnits: 20, principalReservedUnits: 2, lineageUnits: 7 }, "dave", 1, false), false,
    "creating a fresh grandchild cannot erase the principal ancestor's commitment");
});

test("R13: two candidates cannot consume the same final society slot", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-lineage-quota-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(tx => tx.insertAgent(makeValidAgent("alice")));
    const results = await Promise.allSettled(["bob", "carol"].map(async name => {
      await Promise.resolve();
      store.transaction(tx => {
        assertCreateCapacity(new LineageSnapshot(store.listAgents()), "alice", { societyAgents: 2, lineageAgents: 2 });
        tx.insertAgent(makeValidAgent(name, { createdBy: "alice" }));
      });
    }));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(store.listAgents().length, 2);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("R13: current guards re-read lease revocation, incarnation and desired state after a wait", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-live-authority-"));
  const store = new Store(join(root, "runtime.sqlite"));
  let granted: ReadonlySet<Capability> = new Set(["agent.create"]);
  const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
    get capabilities() { return granted; }, peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null } };
  try {
    store.transaction(tx => tx.insertAgent(makeValidAgent("alice", { capabilities: ["agent.create"] })));
    const guard = currentAuthorityGuard(store, auth);
    assert.equal(guard("agent.create").name, "alice");
    await Promise.resolve(); granted = new Set();
    assert.throws(() => guard("agent.create"), code("CAPABILITY_DENIED"));
    granted = new Set(["agent.create"]);
    store.transaction(tx => tx.updateAgent({ name: "alice", desired: "stopped" }));
    assert.equal(assertActorIdentity(store, auth).name, "alice", "identity is not effect authority");
    assert.throws(() => assertCurrentActor(store, auth), code("STALE_RUN"));
    store.transaction(tx => tx.updateAgent({ name: "alice", incarnation: 2 }));
    assert.throws(() => guard(), code("STALE_RUN"));
    assert.throws(() => capabilitiesOf({ specJson: "{}" }), code("STORE_CORRUPT"));
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

function config(): HostConfigV1 {
  return {
    schemaVersion: 1, society: "demo", installation: { node: "/node", libdir: "/lib", rootfs: "/rootfs", deploymentDigest: "a".repeat(64) },
    modelProfiles: { md: { provider: "none", model: "none", credentialRef: "none", codecRevision: "none", pricingRevision: "v1", maxInputTokens: 1, maxOutputTokens: 1, inferenceTimeoutSeconds: 1 } },
    agentProfiles: { p: { modelProfile: "md", capabilities: ["agent.create", "mail.send"], delegable: ["mail.send"], childProfile: "p", resources: { ...TEST_RESOURCES } } },
    principalProfile: "p", initialResidents: [],
    quota: { societyAgents: 10, lineageAgents: 10, societyUnits: 10, lineageUnits: 10, principalReservedUnits: 0, inferenceSlots: 1, principalReservedSlots: 0, storageBytes: 1000 },
    integration: { policyRevision: "v1", protectedPaths: [], checks: [] },
    limits: { frameBytes: 1000, mailBodyBytes: 1000, subjectBytes: 512, addresses: 64, replyReferences: 64, contextFiles: 10, contextBytes: 1000, bundleBytes: 1000, logBytes: 1000, batchMaxMessages: 10, idleStreamSeconds: 30, receiptWaitSeconds: 30 },
    features: { notmuch: false, reflinkSeed: false, formalApproval: false, egress: false },
  };
}

test("R13: pure delegation never expands Principal; refresh fails closed and never reads inside T", () => {
  let cfg = config(); let inTransaction = false; let reads = 0; let fail = false;
  const resolve = createChildSpecResolver(() => { reads++; if (fail) throw new Error("policy read failed"); return cfg; }, () => inTransaction);
  const parent = { name: "principal", profile: "p", capabilities: ["agent.create", "mail.send"] as const };
  const input = { name: "child", from: "0".repeat(40), brief: "brief" };
  const before = resolve.revision();
  assert.deepEqual(resolveChildSpec(cfg, parent, input)?.spec.capabilities, ["mail.send"]);
  assert.deepEqual(resolve(parent, input)?.capabilities, ["mail.send"]);
  assert.equal(reads, 1, "resolution is pure");
  inTransaction = true;
  assert.throws(() => resolve.refresh(), code("INTERNAL_ERROR"));
  assert.equal(reads, 1);
  inTransaction = false;
  cfg = config(); cfg.agentProfiles.p!.delegable = [];
  resolve.refresh();
  assert.notEqual(resolve.revision(), before);
  assert.deepEqual(resolve(parent, input)?.capabilities, []);
  fail = true;
  assert.throws(() => resolve.refresh(), /policy read failed/);
  assert.throws(() => resolve(parent, input), code("UNSUPPORTED_PROFILE"));
});
