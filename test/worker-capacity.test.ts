import test from "node:test";
import assert from "node:assert/strict";
import { defaultHostConfig } from "@oma/config/defaults";
import { validateConfig } from "@oma/config";
import { fixture, messages, messageText } from "./fixtures/review-fixture.js";
import { activeCapacityFixture } from "./fixtures/active-worker-capacity.js";
import { WorkspaceCoordinator } from "@oma/git/workspace";

const defaults = () => defaultHostConfig({ society: "demo", node: process.execPath, libdir: process.cwd(), deploymentDigest: "a".repeat(64) });

test("001. Worker capacity config: defaults, closed numeric bounds, seeds and capacity-bounded approval mail", () => {
  const config = defaults();
  assert.equal(config.maxWorkers, 6);
  assert.deepEqual(config.initialResidents.map(worker => worker.name), ["worker-1", "worker-2", "worker-3"]);
  const { maxWorkers: _omitted, ...authored } = config;
  assert.equal(validateConfig(authored).maxWorkers, 6);
  for (const maxWorkers of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "6"])
    assert.throws(() => validateConfig({ ...config, maxWorkers }), { code: "INVALID_REQUEST" });
  assert.throws(() => validateConfig({ ...config, maxWorkers: 2 }), { code: "INVALID_REQUEST" });
  const small = validateConfig({ ...config, maxWorkers: 2, initialResidents: config.initialResidents.slice(0, 2),
    integration: { ...config.integration, tiered: { ...config.integration.tiered!, highPeerFloor: 8 } } });
  assert.equal(small.integration.tiered!.highPeerFloor, 8);
});

test("002. MEDIUM capacity fallback: zero peers emits durable approval at opening, survives restart and applies only on the current Principal vote", async () => {
  const f = fixture({ maxWorkers: 1, workers: ["alice"] });
  try {
    const candidate = f.candidateWith({ "feature.txt": "reviewed by the Principal\n" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open"), before = f.stateOf(name);
    assert.equal(before.normalRequired, 1);
    assert.equal(before.required, 0);
    assert.equal(before.capacityFallback, true);
    assert.equal(before.display, "principal-pending");
    assert.equal(f.git(["rev-parse", "main"]), f.base);
    const approval = messages(f, "alice", "open").find(message => message.review?.role === "approval")!;
    assert.deepEqual(approval.review?.role === "approval" ? approval.review.votes : null, []);
    assert.match(messageText(f.root, approval.id), /maxWorkers=1/);
    const principalView = f.reviews.status(f.auth("principal"), { name }, 262144, "principal");
    assert.equal("approval" in principalView && principalView.approval, approval.id);
    assert.equal("reviewers" in principalView, false);
    const workerView = f.reviews.status(f.auth("alice"), { name }, 262144, "worker");
    assert.equal("principal" in workerView && workerView.principal.sent, true);
    f.reopen();
    await f.reviews.advanceAll();
    assert.equal(f.stateOf(name).approval?.id, approval.id);
    await assert.rejects(f.vote("principal", name, "approve", "stale", "stale", "m-11111111-1111-4111-8111-111111111111-0"), { code: "APPROVAL_STALE" });
    await f.vote("principal", name, "approve", "Inspected the exact candidate", "decision", approval.id);
    assert.equal(f.stateOf(name).display, "applied");
    assert.equal(f.git(["rev-parse", "main"]), candidate);
    await f.challenge("alice", { merge: name, tier: "LOW" }, "challenge");
    const correction = f.requestName("challenge"), pending = f.stateOf(correction);
    assert.equal(pending.required, 0);
    assert.equal(pending.display, "principal-pending");
    await f.vote("principal", correction, "approve", "Inspected the revert", "revert", pending.approval!.id);
    assert.equal(f.stateOf(correction).display, "applied");
    assert.equal(f.git(["rev-parse", "main^{tree}"]), f.git(["rev-parse", `${f.base}^{tree}`]));
  } finally { f.close(); }
});

for (const tier of ["LOW", "HIGH"] as const) test(`003. Worker capacity: ${tier} challenge capacity fallback retains the peer that fits before Principal approval`, async () => {
  const f = fixture({ maxWorkers: 2, workers: ["alice", "bob"] });
  try {
    const candidate = f.candidateWith({ "defect.txt": "incorrect\n" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "LOW", candidate }, "merge");
    assert.equal(f.stateOf(f.requestName("merge")).display, "applied");
    await f.challenge("alice", { merge: f.requestName("merge"), tier }, "challenge");
    const name = f.requestName("challenge");
    assert.equal(f.stateOf(name).required, 1);
    assert.equal(f.stateOf(name).normalRequired, 2);
    assert.equal(f.stateOf(name).approval, null);
    await f.vote("bob", name, "reject", "Unresolved concern", "reject");
    assert.equal(f.stateOf(name).display, "blocked");
    assert.equal(f.stateOf(name).approval, null);
    await f.vote("bob", name, "approve", "Concern resolved; inspected the revert", "approve");
    const ready = f.stateOf(name);
    assert.equal(ready.display, "principal-pending");
    assert.equal(f.git(["rev-parse", "main"]), candidate);
    await f.vote("principal", name, "approve", "Verified correction and original diff", "decision", ready.approval!.id);
    assert.equal(f.stateOf(name).display, "applied");
    assert.equal(f.git(["rev-parse", "main^{tree}"]), f.git(["rev-parse", `${f.base}^{tree}`]));
  } finally { f.close(); }
});

test("004. Capacity fallback excludes every submitter and cannot override disabled Principal delegation", async () => {
  const f = fixture({ maxWorkers: 2, workers: ["alice", "bob"], principalDelegated: false });
  try {
    const candidate = f.candidateWith({ "joint.txt": "joint implementation\n" });
    await f.submit("alice", candidate, "alice-submit");
    await f.submit("bob", candidate, "bob-submit");
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open"), state = f.stateOf(name);
    assert.deepEqual(state.authors, ["alice", "bob"]);
    assert.equal(state.required, 0);
    await assert.rejects(f.vote("bob", name, "approve", "author", "self"), { code: "SELF_REVIEW" });
    await assert.rejects(f.vote("principal", name, "approve", "not delegated", "decision", state.approval!.id), { code: "CAPABILITY_DENIED" });
    assert.equal(f.git(["rev-parse", "main"]), f.base);
  } finally { f.close(); }
});

test("005. Temporary peer shortage and restart do not rewrite the accepted capacity snapshot", async () => {
  const f = fixture({ maxWorkers: 6, workers: ["alice"] });
  try {
    const candidate = f.candidateWith({ "change.txt": "await independent review\n" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    assert.equal(f.stateOf(name).capacityFallback, false);
    assert.equal(f.stateOf(name).required, 1);
    await f.reviews.advanceAll();
    assert.equal(f.stateOf(name).approval, null);
    f.policy.maxWorkers = 1;
    f.reopen();
    await f.reviews.advanceAll();
    assert.equal(f.stateOf(name).display, "peer-needed");
    assert.equal(f.stateOf(name).required, 1);
    assert.equal(f.git(["rev-parse", "main"]), f.base);
  } finally { f.close(); }
});

test("006. HIGH merge capacity fallback preserves a stopped peer approval", async () => {
  const f = fixture({ maxWorkers: 2, workers: ["alice", "bob"] });
  try {
    const candidate = f.candidateWith({ "critical.txt": "requires scrutiny\n" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open");
    const name = f.requestName("open");
    assert.equal(f.stateOf(name).required, 1);
    assert.equal(f.stateOf(name).approval, null);
    await f.vote("bob", name, "approve", "Independent review", "peer");
    const oldApproval = f.stateOf(name).approval!.id;
    f.stop("bob", "stopped");
    await f.reviews.advanceAll();
    assert.equal(f.stateOf(name).required, 1);
    assert.equal(f.stateOf(name).approval?.id, oldApproval);
    await f.vote("principal", name, "approve", "Review evidence is unchanged", "decision", oldApproval);
    assert.equal(f.git(["rev-parse", "main"]), candidate);
  } finally { f.close(); }
});

test("007. Active Worker capacity: stopped and retired history returns slots without limiting lifetime names", async t => {
  const f = await activeCapacityFixture(); t.after(() => f.close());
  for (let index = 1; index <= 5; index++) {
    const name = `history-${index}`;
    assert.equal((await f.create(name)).state, "succeeded");
    assert.equal(f.lifecycle.creation(f.auth()).workerCount, 2);
    assert.equal((await f.stop(name)).state, "succeeded");
    if (index % 2 === 0) f.store.transaction(tx => tx.updateAgent({ name, desired: "retired" }));
    assert.equal(f.lifecycle.creation(f.auth()).workerCount, 1);
  }
  assert.equal(f.store.listAgents().filter(row => row.role === "resident").length, 6);
  assert.equal((await f.create("fresh-after-history")).state, "succeeded");
  assert.equal(f.lifecycle.creation(f.auth()).workerCount, 2);
  assert.equal(f.lifecycle.creation(f.auth()).maxWorkers, 2);
  await assert.rejects(f.create("full-cap-refused"), { code: "LIMIT_EXCEEDED" });
  assert.equal(f.store.getAgent("full-cap-refused"), null);
  assert.equal(f.store.getOperation("worker-1", "full-cap-refused"), null);
});

test("008. Active Worker capacity: an accepted creation losing a slot to start stays pending and recovers after release and restart", async t => {
  const f = await activeCapacityFixture(); t.after(() => f.close());
  await f.create("occupant"); await f.stop("occupant");
  let competingStart: Promise<unknown> | undefined;
  f.units.onEnsure = actor => {
    if (actor !== "waiting") return;
    f.units.onEnsure = undefined;
    competingStart = f.start("occupant", "competing-start");
  };
  const pending = await f.create("waiting"); await competingStart;
  assert.equal(pending.state, "pending");
  assert.equal(f.store.getAgent("waiting")?.desired, "provisioning");
  assert.equal(f.store.pendingDeliveries("waiting").length, 0, "capacity-blocked provisioning has no successful readiness publication");
  assert.equal(f.lifecycle.creation(f.auth()).workerCount, 2);
  assert.deepEqual(await f.create("waiting"), pending, "same key observes accepted intent even at full capacity");
  await f.stop("occupant", "release-competing-start");
  f.reopen();
  await f.reconcile.sweep();
  assert.equal(f.store.getOperationById(pending.operation)?.state, "succeeded");
  assert.equal(f.store.getAgent("waiting")?.desired, "enabled");
  assert.equal(f.store.pendingDeliveries("waiting").length, 1);
  assert.equal(f.lifecycle.creation(f.auth()).workerCount, 2);
  assert.ok(f.units.starts.includes("waiting"));
  await assert.rejects(f.start("occupant", "creation-won"), { code: "LIMIT_EXCEEDED" });
  assert.equal(f.store.getOperation("principal", "creation-won"), null);
});

test("009. Active Worker capacity: full-cap stopped start has no durable acceptance, enabled start and terminal same-key replay need no extra slot", async t => {
  const f = await activeCapacityFixture(); t.after(() => f.close());
  await f.create("stopped"); await f.stop("stopped");
  await f.create("enabled");
  await assert.rejects(f.start("stopped", "refused-start"),
    { code: "LIMIT_EXCEEDED", details: { resource: "workers", maxWorkers: 2, workerCount: 2 } });
  assert.equal(f.store.getOperation("principal", "refused-start"), null);
  assert.equal(f.store.getAgent("stopped")?.desired, "stopped");
  const before = f.units.starts.length;
  const started = await f.start("enabled", "idempotent-start");
  assert.equal(started.state, "succeeded");
  assert.equal(f.units.starts.length, before);
  await f.stop("enabled");
  f.store.transaction(tx => tx.updateAgent({ name: "enabled", desired: "retired" }));
  assert.deepEqual(await f.start("enabled", "idempotent-start"), started);
  assert.equal(f.store.getAgent("enabled")?.desired, "retired");
});

test("010. Active Worker capacity: concurrent creation publications share atomic last-slot admission", { timeout: 30000 }, async t => {
  const f = await activeCapacityFixture(); t.after(() => f.close());
  const competing = f.competingLifecycle();
  const ensure = WorkspaceCoordinator.prototype.ensure;
  const prepared = Promise.withResolvers<void>();
  t.after(() => prepared.resolve());
  let arrivals = 0;
  t.mock.method(WorkspaceCoordinator.prototype, "ensure", async function(this: WorkspaceCoordinator, ...args: Parameters<WorkspaceCoordinator["ensure"]>) {
    await ensure.apply(this, args);
    if (++arrivals === 2) prepared.resolve();
    await prepared.promise;
  });
  const names = ["concurrent-a", "concurrent-b"];
  await Promise.all([
    f.create(names[0]!),
    competing.create(f.auth(), { name: names[1]!, from: f.from, brief: `Independent assignment for ${names[1]!}` }, names[1]!),
  ]);
  t.mock.restoreAll();
  const enabled = names.filter(name => f.store.getAgent(name)?.desired === "enabled");
  const provisioning = names.filter(name => f.store.getAgent(name)?.desired === "provisioning");
  assert.equal(enabled.length, 1); assert.equal(provisioning.length, 1);
  assert.equal(f.lifecycle.creation(f.auth()).workerCount, 2);
  assert.ok(names.every(name => f.store.getOperation("worker-1", name)), "both accepted physical intentions remain durable");
  await f.stop(enabled[0]!);
  await f.reconcile.sweep();
  assert.equal(f.store.getAgent(provisioning[0]!)?.desired, "enabled");
  assert.equal(f.lifecycle.creation(f.auth()).workerCount, 2);
});

test("011. Active Worker capacity: an unknown physical stop cannot fabricate a reusable slot", async t => {
  const f = await activeCapacityFixture(); t.after(() => f.close());
  await f.create("unconfirmed");
  f.units.stubborn.add("unconfirmed");
  const stopped = await f.stop("unconfirmed");
  assert.equal(stopped.state, "unknown");
  assert.equal(f.lifecycle.creation(f.auth()).workerCount, 1, "stopped intent is not an active identity");
  const waiting = await f.create("wait-for-death");
  assert.equal(waiting.state, "pending");
  assert.equal(f.store.getAgent("wait-for-death")?.desired, "provisioning");
  assert.equal(f.units.starts.includes("wait-for-death"), false);
  f.units.stubborn.delete("unconfirmed");
  await f.lifecycle.reconcileAction(stopped.operation);
  await f.lifecycle.reconcileCreate(waiting.operation);
  assert.equal(f.store.getAgent("wait-for-death")?.desired, "enabled");
  assert.equal(f.store.getOperationById(waiting.operation)?.state, "succeeded");
});

test("012. Active Worker capacity: death proofs stay outside SQLite and are fenced to current released identity", async t => {
  const f = await activeCapacityFixture(); t.after(() => f.close());
  await f.create("released"); await f.stop("released");
  f.units.onDeathObservation = actor => {
    if (actor !== "released") return;
    f.units.onDeathObservation = undefined;
    const current = f.store.getAgent(actor)!;
    f.store.transaction(tx => tx.updateAgent({ name: actor, incarnation: current.incarnation + 1 }));
  };
  const waiting = await f.create("proof-raced");
  assert.equal(waiting.state, "pending");
  assert.equal(f.store.getAgent("proof-raced")?.desired, "provisioning");
  await f.lifecycle.reconcileCreate(waiting.operation);
  assert.equal(f.store.getAgent("proof-raced")?.desired, "enabled");
  assert.equal(f.lifecycle.creation(f.auth()).workerCount, 2);
});

test("013. Active Worker capacity: reduced-cap enabled overflow fails closed without rewriting history while safety stops remain available", async t => {
  const f = await activeCapacityFixture(); t.after(() => f.close());
  await f.create("existing");
  const before = f.store.listAgents();
  f.config.maxWorkers = 1; f.reopen();
  assert.throws(() => f.lifecycle.assertActiveCapacity(), { code: "UNSUPPORTED_PROFILE" });
  assert.equal(f.lifecycle.creation(f.auth()).workerCount, 2);
  assert.equal(f.lifecycle.creation(f.auth()).error?.code, "UNSUPPORTED_PROFILE");
  await assert.rejects(f.create("not-accepted"), { code: "UNSUPPORTED_PROFILE" });
  assert.equal(f.store.getOperation("worker-1", "not-accepted"), null);
  assert.deepEqual(f.store.listAgents(), before);
  assert.equal((await f.stop("existing")).state, "succeeded");
  assert.doesNotThrow(() => f.lifecycle.assertActiveCapacity());
  assert.equal(f.lifecycle.creation(f.auth()).workerCount, 1);
});

test("014. Active Worker capacity: edited capacity refuses fresh starts before restart but preserves terminal replay and safety stop", async t => {
  const f = await activeCapacityFixture(); t.after(() => f.close());
  await f.create("existing");
  const accepted = await f.start("existing", "accepted-before-edit");
  await f.stop("existing");
  f.config.maxWorkers = 3;
  await assert.rejects(f.start("existing", "edited-capacity-start"), { code: "POLICY_CHANGED" });
  assert.equal(f.store.getOperation("principal", "edited-capacity-start"), null);
  assert.equal(f.store.getAgent("existing")?.desired, "stopped");
  assert.deepEqual(await f.start("existing", "accepted-before-edit"), accepted);
  assert.equal((await f.stop("existing", "safety-after-edit")).state, "succeeded");
  f.reopen();
  assert.equal((await f.start("existing", "after-restart")).state, "succeeded");
  assert.equal(f.lifecycle.creation(f.auth()).maxWorkers, 3);
});
