import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, Capability, HostConfig } from "@oma/contracts";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { LineageSnapshot } from "@oma/domain/lineage";
import { assertActorIdentity, assertCurrentActor, currentAuthorityGuard, capabilitiesOf } from "@oma/domain/authority";
import { createChildSpecResolver } from "@oma/config/policy";
import { resolveChildSpec } from "@oma/domain/child-policy";
import { makeValidAgent } from "./fixtures/spec.js";

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

test("R13: current guards re-read lease revocation, incarnation and desired state after a wait", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-live-authority-"));
  const store = new Store(join(root, "runtime.sqlite"));
  let granted: ReadonlySet<Capability> = new Set(["agent.create"]);
  const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
    get capabilities() { return granted; }, peer: { pid: 1, uid: 1000, gid: 1000 } };
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

function config(): HostConfig {
  return {
    schemaVersion: 4, society: "demo", installation: { node: "/node", libdir: "/lib",  deploymentDigest: "a".repeat(64) },
    modelProfiles: { md: { provider: "none", model: "none", inferenceTimeoutSeconds: 1 } },
    agentProfiles: { p: { modelProfile: "md", capabilities: ["agent.create", "mail.send"], delegable: ["mail.send"], childProfile: "p" } },
    principalProfile: "p", initialResidents: [],
    integration: { policyRevision: "v1", protectedPaths: [], checks: [] },
    limits: { frameBytes: 1000, mailBodyBytes: 1000, subjectBytes: 512, addresses: 64, replyReferences: 64, contextFiles: 10, contextBytes: 1000, bundleBytes: 1000, logBytes: 1000, batchMaxMessages: 10, idleStreamSeconds: 30, receiptWaitSeconds: 30 }
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
