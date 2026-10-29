import test from "node:test";
import assert from "node:assert/strict";
import { defaultHostConfig } from "@oma/config/defaults";
import { validateConfig } from "@oma/config";
import { fixture, messages, messageText } from "./fixtures/review-fixture.js";

const defaults = () => defaultHostConfig({ society: "demo", node: process.execPath, libdir: process.cwd(), deploymentDigest: "a".repeat(64) });

test("Worker capacity config: defaults, closed numeric bounds, seeds and capacity-bounded approval mail", () => {
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

test("MEDIUM capacity fallback: zero peers emits durable approval at opening, survives restart and applies only on the current Principal vote", async () => {
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

for (const tier of ["LOW", "HIGH"] as const) test(`${tier} challenge capacity fallback retains the peer that fits before Principal approval`, async () => {
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

test("Capacity fallback excludes every submitter and cannot override disabled Principal delegation", async () => {
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

test("Temporary peer shortage never enables capacity fallback; restart can apply a new configured cap", async () => {
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
    assert.equal(f.stateOf(name).display, "principal-pending");
    assert.equal(f.stateOf(name).required, 0);
    assert.equal(f.git(["rev-parse", "main"]), f.base);
  } finally { f.close(); }
});

test("HIGH merge capacity fallback cannot bypass a stopped peer or reuse a withdrawn approval", async () => {
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
    assert.equal(f.stateOf(name).approval, null);
    await assert.rejects(f.vote("principal", name, "approve", "Cannot bypass stopped peer", "stale", oldApproval),
      { code: "APPROVAL_STALE" });
    assert.equal(f.git(["rev-parse", "main"]), f.base);
  } finally { f.close(); }
});
