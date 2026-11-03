import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures/review-fixture.js";
import { StoreError } from "@oma/domain/errors";
import { applyRequestKeyFor } from "@oma/domain/identifiers";

test("001. Explicit same-request retry preserves votes and the first failure; concurrent replay has one successor", async () => {
  let fail = true, checks = 0;
  const f = fixture({ checks: [{ id: "verify", argv: ["/usr/bin/true"], env: {} }], runCheck: async () => {
    checks++; if (fail) throw new StoreError("CHECK_FAILED", "controlled first failure");
  } });
  try {
    const candidate = f.candidateWith({ "one.txt": "a\n" });
    await f.submit("alice", candidate); await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open"); await f.vote("bob", name, "approve", "reviewed", "vote");
    const failed = f.applyOp("alice", "open")!, vote = f.store.getOperation("bob", "vote")!;
    assert.equal(failed.state, "failed"); assert.equal(f.stateOf(name).display, "blocked");
    fail = false; await f.reviews.advanceAll(); assert.equal(checks, 1, "no automatic failed-check replay");
    const input = { kind: "review.retry" as const, name, expectedAttempt: failed.id, reason: "retry verified transient check failure" };
    const answers = await Promise.all([f.reviews.record(f.auth("alice"), "retry", input), f.reviews.record(f.auth("alice"), "retry", input)]);
    assert.equal(answers[0]!.operation, answers[1]!.operation);
    assert.equal(f.stateOf(name).attemptNumber, 1); assert.equal(f.stateOf(name).display, "applied");
    assert.equal(checks, 2); assert.equal(f.store.getOperationById(failed.id)!.state, "failed");
    assert.equal(f.store.getOperationById(failed.id)!.planJson, failed.planJson);
    assert.equal(f.store.getOperationById(vote.id)!.planJson, vote.planJson);
    const open = f.store.getOperation("alice", "open")!;
    assert.equal(f.store.getOperation("alice", applyRequestKeyFor(open.id, 1))!.state, "succeeded");
    await f.reviews.record(f.auth("alice"), "retry", input); assert.equal(checks, 2);
    f.reopen(); assert.equal(f.stateOf(name).display, "applied");
  } finally { f.close(); }
});

test("002. Notice preparation failure survives restart as blocked and explicit retry succeeds", async () => {
  const f = fixture();
  try {
    const candidate = f.candidateWith({ "one.txt": "a\n" }); await f.submit("alice", candidate);
    f.mail.freezeReviewMessage = async () => { throw new StoreError("BROKER_UNAVAILABLE", "controlled notice write failure"); };
    await f.open("alice", { tier: "LOW", candidate }, "open");
    const name = f.requestName("open");
    assert.equal(f.stateOf(name).display, "blocked"); assert.equal(f.applyOp("alice", "open"), null);
    assert.ok(f.stateOf(name).missing.some(reason => reason.includes("notice preparation")));
    f.reopen(); assert.equal(f.stateOf(name).display, "blocked");
    await f.reviews.advanceAll(); assert.equal(f.applyOp("alice", "open"), null);
    await f.reviews.record(f.auth("alice"), "retry-notice", { kind: "review.retry", name, expectedAttempt: null, reason: "storage recovered" });
    assert.equal(f.stateOf(name).display, "applied");
  } finally { f.close(); }
});

test("003. An unknown check scope cannot be retried into a second attempt", async () => {
  const f = fixture({ checks: [{ id: "verify", argv: ["/usr/bin/true"], env: {} }], runCheck: async () => {
    throw new StoreError("RUN_TERMINATION_UNKNOWN", "controlled unconfirmed death");
  } });
  try {
    const candidate = f.candidateWith({ "one.txt": "a\n" }); await f.submit("alice", candidate);
    await f.open("alice", { tier: "LOW", candidate }, "open");
    const operation = f.applyOp("alice", "open")!, name = f.requestName("open");
    assert.equal(operation.state, "unknown");
    await assert.rejects(f.reviews.record(f.auth("alice"), "retry", { kind: "review.retry", name, expectedAttempt: operation.id, reason: "unsafe retry" }), { code: "REF_STATE_UNKNOWN" });
    assert.equal(f.stateOf(name).attemptNumber, 0);
  } finally { f.close(); }
});

test("004. Withdrawing an accepted peer vote while checks run wins the final CAS gate", async () => {
  let entered!: () => void, finish!: () => void;
  const running = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { finish = resolve; });
  const f = fixture({ checks: [{ id: "held", argv: ["/usr/bin/true"], env: {} }], runCheck: async (_candidate, _check, signal) => {
    entered(); signal?.addEventListener("abort", finish, { once: true }); await held;
  } });
  let voting: Promise<unknown> | undefined;
  try {
    const candidate = f.candidateWith({ "one.txt": "a\n" }); await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open"); const name = f.requestName("open");
    voting = f.vote("bob", name, "approve", "reviewed", "vote"); await running;
    const vote = f.store.getOperation("bob", "vote")!;
    await f.reviews.record(f.auth("bob"), "withdraw", { kind: "review.withdraw", name, vote: vote.id, reason: "found a defect" });
    await voting; assert.equal(f.applyOp("alice", "open")!.state, "failed");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
    assert.equal(f.store.getOperationById(vote.id)!.planJson, vote.planJson);
  } finally { finish(); await voting; f.close(); }
});

test("005. A held notice preparation is preparing, not an executing check", async () => {
  const f = fixture(); let entered!: () => void, finish!: () => void;
  const running = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { finish = resolve; });
  let opening: Promise<unknown> | undefined;
  try {
    const candidate = f.candidateWith({ "one.txt": "a\n" }); await f.submit("alice", candidate);
    const original = f.mail.freezeReviewMessage.bind(f.mail);
    f.mail.freezeReviewMessage = async (...args) => { entered(); await held; return original(...args); };
    opening = f.open("alice", { tier: "LOW", candidate }, "open"); await running;
    const status = f.reviews.status(f.auth("alice"), { name: f.requestName("open") }, 65536, "test");
    assert.ok("integrationPhase" in status); assert.equal(status.integrationPhase, "preparing"); assert.equal(status.display, "preparing");
    assert.equal(f.applyOp("alice", "open"), null);
    finish(); await opening;
  } finally { finish(); await opening; f.close(); }
});
