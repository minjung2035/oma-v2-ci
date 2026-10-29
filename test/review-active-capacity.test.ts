/** Production Store/Lifecycle/Review smoke. Only the execution port is controlled:
 * no native Worker launch, sandbox qualification, provider or live society. */
import test from "node:test";
import assert from "node:assert/strict";
import type { ExecutionObservation, Receipt } from "@oma/contracts";
import type { Store } from "@oma/storage";
import type { MailModule } from "@oma/mail";
import type { IntegrationPolicy } from "@oma/domain/integration-policy";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { fixture, messages } from "./fixtures/review-fixture.js";
import { PolicyExecution } from "./fixtures/execution.js";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec, withWorkerCapacity } from "./fixtures/spec.js";

interface CapacityFixture {
  readonly store: Store;
  readonly mail: MailModule;
  readonly policy: IntegrationPolicy;
  readonly root: string;
  readonly projectGit: string;
  readonly base: string;
  candidateWith(files: Record<string, string>, parent?: string): string;
  submit(actor: string, candidate: string, key?: string): Promise<Receipt>;
  open(actor: string, input: { tier: "LOW" | "MEDIUM" | "HIGH"; candidate: string }, key?: string): Promise<Receipt>;
  requestName(key: string, actor?: string): string;
}
interface CapacityCandidate {
  readonly candidate: string;
  readonly base: string;
  readonly target: string | undefined;
}
class ReviewCapacityExecution extends PolicyExecution {
  readonly active = new Set<string>();
  override observe(actor: string): ExecutionObservation {
    const active = this.active.has(actor);
    return { activeState: active ? "active" : "inactive", subState: active ? "running" : "dead",
      result: "success", execMainStatus: 0, invocationId: active ? "1".repeat(32) : "",
      scope: active ? `/controlled/${actor}` : "" };
  }
  override start(actor: string, _repair: boolean, authorize?: () => void): void {
    authorize?.();
    this.active.add(actor);
  }
  override stop(actor: string, _incarnation: number): ExecutionObservation {
    this.active.delete(actor);
    return this.observe(actor);
  }
}
function lifecycleFor(f: CapacityFixture) {
  const units = new ReviewCapacityExecution();
  for (const agent of f.store.listAgents())
    if (agent.role === "resident" && agent.desired === "enabled") units.active.add(agent.name);
  const lifecycle = createLifecycleModule(f.store, units, {
    stateRoot: f.root, projectGit: f.projectGit, society: "demo",
    hasGoal: () => true, activationAllowed: () => true,
  }, withWorkerCapacity((_parent, input) =>
    makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), f.policy.maxWorkers), f.mail);
  return { lifecycle, units };
}
function addHistoricalAuthorAndPeer(f: CapacityFixture) {
  f.store.transaction(tx => {
    tx.insertAgent(makeValidAgent("bob", { createdBy: "alice" }));
    tx.insertAgent(makeValidAgent("carol", { desired: "stopped", createdBy: "alice" }));
  });
}
async function candidateFor(f: CapacityFixture, kind: "merge" | "challenge"): Promise<CapacityCandidate> {
  let base = f.base;
  let target: string | undefined;
  if (kind === "challenge") {
    const original = f.candidateWith({ "original.txt": "applied original\n" });
    await f.submit("alice", original, "target-submit");
    await f.open("alice", { tier: "LOW", candidate: original }, "target-open");
    target = f.requestName("target-open");
    base = original;
  }
  const candidate = f.candidateWith({ "replacement.txt": "independently review this\n" }, base);
  await f.submit("alice", candidate, "alice-submit");
  await f.submit("bob", candidate, "bob-submit");
  return { candidate, base, target };
}
function openInput(kind: "merge" | "challenge", prepared: CapacityCandidate) {
  return kind === "merge"
    ? { kind: "merge.open" as const, title: "active capacity", reason: "independent review",
        tier: "MEDIUM" as const, candidate: prepared.candidate, base: prepared.base }
    : { kind: "challenge.open" as const, title: "active capacity", reason: "independent review",
        merge: prepared.target!, tier: "LOW" as const, candidate: prepared.candidate, base: prepared.base };
}

for (const kind of ["merge", "challenge"] as const)
  for (const desired of ["stopped", "retired"] as const) test(
    `active-capacity production smoke: ${kind} excludes ${desired} historical author without consuming its slot`, async () => {
      const f = fixture({ maxWorkers: 2, workers: ["alice"] });
      try {
        addHistoricalAuthorAndPeer(f);
        const { lifecycle } = lifecycleFor(f);
        const prepared = await candidateFor(f, kind);
        assert.equal((await lifecycle.stop(f.auth("bob"), "bob", "stop-author")).state, "succeeded");
        if (desired !== "stopped") f.store.transaction(() => f.store.updateAgent({ name: "bob", desired }));
        await f.reviews.record(f.auth("alice"), "open", openInput(kind, prepared));
        const name = f.requestName("open");
        const waiting = f.stateOf(name);
        assert.deepEqual(waiting.authors, ["alice", "bob"]);
        assert.equal(waiting.required, 1, "cap2 with one active author still requires one independent peer");
        assert.equal(waiting.normalRequired, kind === "merge" ? 1 : 2);
        assert.equal(waiting.capacityFallback, kind === "challenge");
        assert.equal(waiting.approval, null, "no zero-peer approval may be emitted for historical author occupancy");
        assert.equal(f.git(["rev-parse", "refs/heads/main"]), prepared.base);
        const view = f.reviews.status(f.auth("alice"), { name }, 262144, "capacity-status");
        assert.ok("reviewers" in view);
        assert.deepEqual(view.reviewers.items.find(row => row.name === "bob")?.exclusions, ["author", "not-enabled"]);
        await assert.rejects(f.vote("bob", name, "approve", "historical author's vote", "historical-vote"));
        assert.equal(f.store.getOperation("bob", "historical-vote"), null);
        assert.deepEqual(f.stateOf(name).approvers, []);
        assert.equal((await lifecycle.start(f.auth("alice"), "carol", "activate-peer")).state, "succeeded");
        const peer = await f.vote("carol", name, "approve", "independent current review", "peer-vote");
        if (kind === "challenge") {
          assert.equal(f.stateOf(name).display, "principal-pending", "challenge retains its explicit capacity escalation");
          const approval = messages(f, "carol", "peer-vote").find(message => message.review?.role === "approval")!;
          assert.deepEqual(approval.review?.role === "approval" ? approval.review.votes : null, [peer.operation]);
          await f.vote("principal", name, "approve", "approve bounded challenge", "principal-vote", approval.id);
        }
        assert.equal(f.stateOf(name).display, "applied");
        assert.equal(f.git(["rev-parse", "refs/heads/main"]), prepared.candidate);
      } finally { f.close(); }
    });

for (const kind of ["merge", "challenge"] as const)
  for (const action of ["stop", "start"] as const) test(
  `active-capacity production smoke: ${kind} opening refuses author ${action} during frozen mail`,
  { timeout: 10_000 }, async () => {
    const f = fixture({ maxWorkers: 2, workers: ["alice"] });
    const frozen = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const freeze = f.mail.freezeReviewMessage.bind(f.mail);
    let pending: Promise<unknown> | undefined;
    try {
      addHistoricalAuthorAndPeer(f);
      const { lifecycle } = lifecycleFor(f);
      const prepared = await candidateFor(f, kind);
      if (action === "start") await lifecycle.stop(f.auth("bob"), "bob", "initial-stop");
      let paused = false;
      f.mail.freezeReviewMessage = async (...args) => {
        const result = await freeze(...args);
        if (!paused && result.message.review?.role === "thread") {
          paused = true;
          frozen.resolve();
          await resume.promise;
        }
        return result;
      };
      pending = f.reviews.record(f.auth("alice"), "drifting-open", openInput(kind, prepared));
      const refused = assert.rejects(pending, { code: "BROKER_UNAVAILABLE" });
      await frozen.promise;
      if (action === "stop") await lifecycle.stop(f.auth("bob"), "bob", "release-author-slot");
      else await lifecycle.start(f.auth("alice"), "bob", "occupy-author-slot");
      resume.resolve();
      await refused;
      assert.equal(f.store.getOperation("alice", "drifting-open"), null, "stale capacity authority was not accepted");
      f.mail.freezeReviewMessage = freeze;
      await f.reviews.record(f.auth("alice"), "drifting-open", openInput(kind, prepared));
      const name = f.requestName("drifting-open");
      assert.equal(f.stateOf(name).required, action === "stop" ? 1 : 0);
      if (action === "stop") assert.equal(f.stateOf(name).approval, null);
      else assert.equal(f.stateOf(name).approvalValid, true);
      assert.equal(f.git(["rev-parse", "refs/heads/main"]), prepared.base);
    } finally {
      resume.resolve();
      await pending?.catch(() => {});
      f.mail.freezeReviewMessage = freeze;
      f.close();
    }
  });

test("active-capacity production smoke: author stop/start invalidates and replaces existing HIGH approval bundles", async () => {
  const f = fixture({ maxWorkers: 2, workers: ["alice"] });
  try {
    addHistoricalAuthorAndPeer(f);
    const { lifecycle } = lifecycleFor(f);
    const prepared = await candidateFor(f, "merge");
    await f.open("alice", { tier: "HIGH", candidate: prepared.candidate }, "high-open");
    const name = f.requestName("high-open");
    const oldApproval = f.stateOf(name).approval!.id;
    assert.equal(f.stateOf(name).required, 0);
    assert.equal(f.stateOf(name).approvalValid, true);
    await lifecycle.stop(f.auth("bob"), "bob", "stop-author");
    assert.equal(f.stateOf(name).required, 1);
    assert.equal(f.stateOf(name).approvalValid, false);
    await assert.rejects(f.vote("principal", name, "approve", "stale zero-peer decision", "stale-decision", oldApproval),
      { code: "APPROVAL_STALE" });
    await f.reviews.advanceAll();
    assert.equal(f.stateOf(name).approval, null);
    const withdrawn = f.store.attestations.all().flatMap(row => "messages" in row.operation.plan ? row.operation.plan.messages : [])
      .find(message => message.review?.role === "withdrawn" && message.review.approval === oldApproval);
    assert.ok(withdrawn, "a durable withdrawal informs the Principal of changed author occupancy");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), prepared.base);
    await lifecycle.start(f.auth("alice"), "carol", "activate-peer");
    await f.vote("carol", name, "approve", "independent HIGH review", "fresh-peer");
    const current = f.stateOf(name).approval!.id;
    assert.notEqual(current, oldApproval);
    await assert.rejects(f.vote("principal", name, "approve", "old approval", "old-again", oldApproval),
      { code: "APPROVAL_STALE" });
    await lifecycle.stop(f.auth("carol"), "carol", "stop-independent-peer");
    await lifecycle.start(f.auth("alice"), "bob", "reactivate-author");
    assert.equal(f.stateOf(name).required, 0);
    assert.equal(f.stateOf(name).approvalValid, false, "the old one-peer bundle no longer matches active capacity");
    await assert.rejects(f.vote("bob", name, "approve", "reactivated author", "self-vote"), { code: "SELF_REVIEW" });
    await assert.rejects(f.vote("principal", name, "approve", "superseded one-peer approval", "stale-peer-decision", current),
      { code: "APPROVAL_STALE" });
    await f.reviews.advanceAll();
    const replacement = f.stateOf(name).approval!;
    assert.notEqual(replacement.id, current);
    assert.deepEqual(replacement.votes, []);
    assert.equal(f.stateOf(name).approvalValid, true);
    await f.vote("principal", name, "approve", "fresh active-capacity decision", "current-decision", replacement.id);
    assert.equal(f.stateOf(name).display, "applied");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), prepared.candidate);
  } finally { f.close(); }
});

test("active-capacity production smoke: cap1 active requester preserves valid zero-peer Principal escalation", async () => {
  const f = fixture({ maxWorkers: 1, workers: ["alice"] });
  try {
    const candidate = f.candidateWith({ "single.txt": "Principal decision required\n" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "single-open");
    const name = f.requestName("single-open");
    const state = f.stateOf(name);
    assert.equal(state.required, 0);
    assert.equal(state.capacityFallback, true);
    assert.equal(state.approvalValid, true);
    assert.deepEqual(state.approval?.votes, []);
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
    await f.vote("principal", name, "approve", "accept zero-peer escalation", "single-decision", state.approval!.id);
    assert.equal(f.stateOf(name).display, "applied");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
  } finally { f.close(); }
});

test("active-capacity production smoke: absent or stopped non-author reviewers never create fallback", async () => {
  const f = fixture({ maxWorkers: 3, workers: ["alice", "bob"] });
  try {
    const { lifecycle } = lifecycleFor(f);
    const candidate = f.candidateWith({ "waiting.txt": "wait for two independent reviewers\n" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "waiting-open");
    const name = f.requestName("waiting-open");
    await f.vote("bob", name, "reject", "requires correction", "reject");
    await lifecycle.stop(f.auth("bob"), "bob", "stop-reviewer");
    await f.reviews.advanceAll();
    const state = f.stateOf(name);
    assert.equal(state.required, 2);
    assert.equal(state.capacityFallback, false);
    assert.equal(state.approval, null);
    assert.deepEqual(state.rejectors, ["bob"], "stopping a rejecting reviewer cannot erase its verdict");
    assert.equal(state.display, "blocked");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
  } finally { f.close(); }
});

test("active-capacity production smoke: Principal decision frozen before author departure cannot pass acceptance or apply authority",
  { timeout: 10_000 }, async () => {
    const f = fixture({ maxWorkers: 2, workers: ["alice"] });
    const frozen = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const freeze = f.mail.freezeReviewMessage.bind(f.mail);
    let pending: Promise<unknown> | undefined;
    try {
      addHistoricalAuthorAndPeer(f);
      const { lifecycle } = lifecycleFor(f);
      const prepared = await candidateFor(f, "merge");
      await f.open("alice", { tier: "HIGH", candidate: prepared.candidate }, "race-open");
      const name = f.requestName("race-open");
      const approval = f.stateOf(name).approval!.id;
      let paused = false;
      f.mail.freezeReviewMessage = async (...args) => {
        const result = await freeze(...args);
        if (!paused && result.message.review?.role === "decision") {
          paused = true;
          frozen.resolve();
          await resume.promise;
        }
        return result;
      };
      pending = f.vote("principal", name, "approve", "frozen zero-peer decision", "racing-decision", approval);
      const refused = assert.rejects(pending, { code: "BROKER_UNAVAILABLE" });
      await frozen.promise;
      await lifecycle.stop(f.auth("bob"), "bob", "stop-during-decision");
      resume.resolve();
      await refused;
      assert.equal(f.store.getOperation("principal", "racing-decision"), null);
      assert.equal(f.stateOf(name).approvalValid, false);
      assert.equal(f.stateOf(name).required, 1);
      assert.throws(() => f.reviews.assertApplicable(f.store.getOperation("alice", "race-open")!.id),
        { code: "INTEGRATION_CONDITIONS" });
      assert.equal(f.git(["rev-parse", "refs/heads/main"]), prepared.base);
    } finally {
      resume.resolve();
      await pending?.catch(() => {});
      f.mail.freezeReviewMessage = freeze;
      f.close();
    }
  });
