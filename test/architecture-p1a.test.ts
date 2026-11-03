import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { ReconcileModule } from "@oma/reconcile";
import type { ReconcileLedger } from "@oma/reconcile/ports";
import { fixture } from "./fixtures/review-fixture.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { validateConfig } from "@oma/config";
import { defaultHostConfig } from "@oma/config/defaults";

for (const desired of ["stopped", "retired"] as const)
  test(`001. Accepted reviewer evidence survives ${desired} and restart`, async () => {
    const f = fixture();
    try {
      const candidate = f.candidateWith({ "one.txt": "a\n" });
      await f.submit("alice", candidate); await f.open("alice", { tier: "HIGH", candidate }, "open");
      const name = f.requestName("open");
      await f.vote("bob", name, "approve", "reviewed", "bob-vote");
      await f.vote("carol", name, "approve", "reviewed", "carol-vote");
      const before = f.stateOf(name), bytes = f.store.getOperation("bob", "bob-vote")!.planJson;
      assert.ok(before.approvalValid); f.stop("bob", desired); f.reopen();
      assert.equal(f.stateOf(name).approval?.id, before.approval?.id);
      assert.equal(f.stateOf(name).approvalValid, true);
      assert.equal(f.store.getOperation("bob", "bob-vote")!.planJson, bytes);
      await f.vote("principal", name, "approve", "bound evidence", "principal-vote", before.approval!.id);
      assert.equal(f.stateOf(name).display, "applied");
    } finally { f.close(); }
  });

test("002. Explicit withdrawal changes approval; another Worker cannot invalidate", async () => {
  const f = fixture();
  try {
    const candidate = f.candidateWith({ "one.txt": "a\n" });
    await f.submit("alice", candidate); await f.open("alice", { tier: "HIGH", candidate }, "open");
    const name = f.requestName("open");
    await f.vote("bob", name, "approve", "reviewed", "bob-vote");
    await f.vote("carol", name, "approve", "reviewed", "carol-vote");
    const vote = f.store.getOperation("bob", "bob-vote")!.id;
    await assert.rejects(f.reviews.record(f.auth("carol"), "bad", { kind: "review.invalidate", name, vote, reason: "not host" }), { code: "CAPABILITY_DENIED" });
    await f.reviews.record(f.auth("bob"), "withdraw", { kind: "review.withdraw", name, vote, reason: "found issue" });
    assert.equal(f.stateOf(name).approvalValid, false);
    assert.equal(f.stateOf(name).approvers.includes("bob"), false);
  } finally { f.close(); }
});

test("003. Author stop cannot change frozen quorum and requester stop still fences main", async () => {
  const f = fixture({ maxWorkers: 2, workers: ["alice", "bob"] });
  try {
    const candidate = f.candidateWith({ "one.txt": "a\n" });
    await f.submit("alice", candidate); await f.open("alice", { tier: "HIGH", candidate }, "open");
    const name = f.requestName("open"); await f.vote("bob", name, "approve", "reviewed");
    const before = f.stateOf(name); assert.equal(before.required, 1);
    f.stop("alice", "stopped"); assert.equal(f.stateOf(name).required, 1);
    await f.vote("principal", name, "approve", "reviewed", "pv", before.approval!.id);
    assert.equal(f.git(["rev-parse", "main"]), f.base);
    assert.equal(f.applyOp("alice", "open")?.state, "failed");
  } finally { f.close(); }
});

test("004. Held recovery and one held unit do not block independent wake; hints coalesce", async () => {
  const recovery = Promise.withResolvers<void>(), slowUnit = Promise.withResolvers<void>();
  const agents = [makeValidAgent("alpha"), makeValidAgent("beta")];
  let recovering = 0, observedAlpha = 0, startedBeta = 0, reviews = 0, terminal = false;
  const idle = { activeState: "inactive", subState: "dead", invocationId: "", result: "success", execMainStatus: 0, scope: "" };
  const ledger = { recoverableOperations: () => terminal ? [] : ["held"],
    getOperationById: () => ({ id: "held", kind: "git.submit", state: terminal ? "succeeded" : "pending" }),
    listAgents: () => agents, getAgent: (name: string) => agents.find(agent => agent.name === name) ?? null,
    societyOpen: () => true } as unknown as ReconcileLedger;
  const owner = new ReconcileModule(ledger, { reconcileOperation: async () => {} },
    { reconcile: async () => { recovering++; await recovery.promise; terminal = true; } },
    { advanceAll: async () => { reviews++; } }, {
      observeAsync: async name => { if (name === "alpha") { observedAlpha++; await slowUnit.promise; } return idle; },
      observe: name => name === "beta" && startedBeta ? { ...idle, activeState: "active" } : idle,
      confirmDead: () => true, stop: () => idle, start: name => { if (name === "beta") startedBeta++; }, startLimitStatus: () => null,
    }, { reconcileCreate: async () => {}, reconcileAction: async () => {}, reconcileSociety: async () => {} },
    { stateRoot: "/unused", hasGoal: () => true, activationAllowed: () => true }, {
      observeStoreFailure: error => { throw error; }, quiesceResidents: async () => {},
      collectUnacceptedArtifacts: () => ({}) as never, canonicalMain: () => ({ kind: "absent", evidence: { status: 1, signal: null, stdout: null, stderr: null } }),
      assertCanonicalHealthy: async () => {}, pendingWork: () => new Set(["fresh"]),
    });
  const pass = owner.sweep(); await nextTurn();
  for (let i = 0; i < 100; i++) owner.pulse();
  await nextTurn();
  assert.equal(startedBeta, 1, "wake must finish before releasing either held effect");
  assert.ok(reviews > 0); assert.equal(recovering, 1); assert.equal(observedAlpha, 1);
  assert.equal(owner.sweep(), pass);
  recovery.resolve(); slowUnit.resolve(); await pass; await owner.quiesceForShutdown();
  assert.equal(recovering, 1);
});

test("005. Current zero seed config rejects; legacy zero remains readable", () => {
  const config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: process.cwd(), deploymentDigest: "a".repeat(64) });
  assert.throws(() => validateConfig({ ...config, initialResidents: [] }), /at least one/);
  assert.equal(validateConfig({ ...config, schemaVersion: 4, initialResidents: [] }).initialResidents.length, 0);
});

test("006. Version gate preserves accepted bytes and creates a complete legacy backup", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readdirSync } = await import("node:fs");
  const f = fixture();
  try {
    const candidate = f.candidateWith({ "one.txt": "a\n" });
    await f.submit("alice", candidate);
    const operation = f.store.getOperation("alice", "submit-0")!;
    const path = `${f.root}/runtime.sqlite`;
    // Model the prior writer's schema gate without modifying any accepted row.
    f.store.close();
    const legacy = new DatabaseSync(path); legacy.exec("PRAGMA user_version = 4"); legacy.close();
    // The fixture's reopen closes its handle first, so instantiate the new Store
    // directly and make cleanup tolerate the already closed fixture connection.
    const { Store } = await import("@oma/storage");
    const migrated = new Store(path, 0, { society: "demo" });
    assert.equal(migrated.getOperationById(operation.id)!.planJson, operation.planJson);
    assert.equal(migrated.getOperationById(operation.id)!.resultJson, operation.resultJson);
    migrated.close();
    const backups = readdirSync(f.root).filter(name => name.startsWith("runtime.sqlite.before-v5-"));
    assert.equal(backups.length, 1);
    const backup = new DatabaseSync(`${f.root}/${backups[0]}`, { readOnly: true });
    assert.equal((backup.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 4);
    assert.equal((backup.prepare("SELECT plan_json FROM operations WHERE id = ?").get(operation.id) as { plan_json: string }).plan_json, operation.planJson);
    backup.close();
    const again = new Store(path, 0, { society: "demo" }); again.close();
    assert.equal(readdirSync(f.root).filter(name => name.startsWith("runtime.sqlite.before-v5-")).length, 1);
  } finally {
    // A closed Store has no live transaction or handle. Remove the fixture only.
    const { rmSync } = await import("node:fs"); rmSync(f.root, { recursive: true, force: true });
  }
});
