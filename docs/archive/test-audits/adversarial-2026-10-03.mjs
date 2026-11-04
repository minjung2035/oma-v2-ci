import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createGitModule } from "#oma-test/app/broker/git-composition";
/** Standalone adversarial contract oracles for checkpoint a75c299.
 * Intentionally outside the normal test runner's root-level inventory.
 * These assert the REQUIRED behavior and fail while the reported bugs exist.
 * Every fixture owns a temporary SQLite database and canonical Git repository.
 * No user manager, VM, credentials, provider, or network service is invoked.
 * Run after npm run build; see docs/priority-0-audit.md for scope and results.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fixture, messageText } from "../../dist/test/fixtures/review-fixture.js";
import { GitModule } from "@oma/git";
import { ReconcileModule } from "@oma/reconcile";
import { StoreError } from "../../dist/src/domain/errors.js";
import { canonicalMergeDiff } from "@oma/git/canonical-command";
import { readCode } from "#oma-test/app/cli/effects/code";
import { GIT_ENV } from "../../dist/src/process/policies.js";
import { defaultHostConfig } from "../../dist/src/config/defaults.js";
import { validateConfig } from "../../dist/src/config.js";
import { StorageAdmission } from "../../dist/src/storage/quota.js";

const pathsOf = f => ({ stateRoot: f.root, projectGit: f.projectGit,
  contextGit: join(f.root, "context.git"), worldDir: join(f.root, "world"),
  society: "demo", quarantineTmpBytes: 1024 * 1024 });
const inputOf = (f, candidate, reason = "needs to land") => ({
  kind: "merge.open", tier: "MEDIUM", title: "the change", reason,
  candidate, base: f.base,
});

test("AV-20261003-01: a quota refusal must prevent a sweep from accepting a new integration", async t => {
  const f = fixture();
  let releaseWriter;
  let held;
  try {
    const candidate = f.candidateWith({ "a.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const hold = new Promise(resolve => { releaseWriter = resolve; });
    // Use the actual writer exclusion seam: the vote lands while another
    // writer is busy, and its automatic advance is deferred to the sweep.
    held = f.module.withWriter(async () => { entered(); await hold; });
    await started;
    await f.vote("bob", name, "approve", "ok", "vote");
    releaseWriter();
    await held;
    assert.equal(f.stateOf(name).ready, true);
    assert.equal(f.stateOf(name).integration, null);
    const admissions = [];
    // A real owned-tree quota scan now refuses admission. The quota is an
    // isolated fixture setting; it changes no actual filesystem limits.
    const storage = new StorageAdmission(f.root, 1, 0);
    assert.throws(() => storage.admit("admit"), { code: "QUOTA_EXCEEDED" });
    const units = { observeAsync: async () => ({ activeState: "inactive" }), confirmDead: () => true };
    const reconcile = createReconcileModule(f.store, f.mail, f.module, null, units, {}, {
      projectGit: f.projectGit, hasGoal: () => false, activationAllowed: () => false,
      resourceGate: category => {
        admissions.push(category);
        return storage.admit(category);
      },
    });
    await reconcile.sweep();
    t.diagnostic(JSON.stringify({ admissions, integration: f.stateOf(name).integration?.state }));
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base,
      "a sweep must consult storage admission before creating and applying a new integration");
  } finally {
    releaseWriter?.();
    await held?.catch(() => {});
    f.close();
  }
});

test("AV-20261003-02: a shortened request-name collision must never route a vote to another candidate", async t => {
  const f = fixture();
  const realUUID = crypto.randomUUID;
  try {
    const first = f.candidateWith({ "first.txt": "first" });
    const second = f.candidateWith({ "second.txt": "second" });
    await f.submit("alice", first, "submit-first");
    await f.submit("alice", second, "submit-second");
    // Both UUIDs are valid and distinct. Only the eight-hex display prefixes
    // collide; no operation primary key or accepted row is corrupted.
    const uuids = ["12345678-1111-4111-8111-111111111111", "12345678-2222-4222-8222-222222222222"];
    for (const [index, candidate] of [first, second].entries()) {
      let used = false;
      crypto.randomUUID = () => { if (used) return realUUID(); used = true; return uuids[index]; };
      syncBuiltinESMExports();
      await f.open("alice", { tier: "MEDIUM", candidate }, `open-${index}`);
    }
    crypto.randomUUID = realUUID;
    syncBuiltinESMExports();
    const firstName = f.requestName("open-0");
    const secondName = f.requestName("open-1");
    await f.vote("bob", secondName, "approve", "approve the second request", "vote-second");
    t.diagnostic(JSON.stringify({ firstName, secondName,
      firstApplied: f.applyOp("alice", "open-0")?.state,
      secondApplied: f.applyOp("alice", "open-1")?.state ?? null }));
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), second,
      "the name returned by the second open must identify its own candidate");
  } finally {
    crypto.randomUUID = realUUID;
    syncBuiltinESMExports();
    f.close();
  }
});

test("AV-20261003-03a: same-key terminal review replay must survive a review-mode change", async t => {
  const f = fixture();
  try {
    const candidate = f.candidateWith({ "a.txt": "a" });
    await f.submit("alice", candidate);
    const input = inputOf(f, candidate);
    const accepted = await f.module.attestations.record(f.auth("alice"), "open", input);
    assert.equal(accepted.state, "succeeded");
    f.reopen();
    const policy = { ...f.policy, tiered: { ...f.policy.tiered } };
    delete policy.tiered.review;
    const next = createGitModule(pathsOf(f), f.store, f.mail, policy, () => policy);
    t.diagnostic(`historical operation remains ${f.store.getOperation("alice", "open").state}`);
    const replay = await next.attestations.record(f.auth("alice"), "open", input);
    assert.deepEqual(replay, accepted);
  } finally { f.close(); }
});

test("AV-20261003-03b: same-key terminal review replay must survive lower current input bounds", async t => {
  const f = fixture();
  try {
    const candidate = f.candidateWith({ "a.txt": "a" });
    await f.submit("alice", candidate);
    const input = inputOf(f, candidate, "x".repeat(600));
    const accepted = await f.module.attestations.record(f.auth("alice"), "open", input);
    assert.equal(accepted.state, "succeeded");
    f.reopen();
    const next = createGitModule(pathsOf(f), f.store, f.mail, f.policy, () => f.policy, null,
      { mailBodyBytes: 2000, subjectBytes: 512, bundleBytes: 256 * 1024 });
    t.diagnostic(`historical operation remains ${f.store.getOperation("alice", "open").state}`);
    const replay = await next.attestations.record(f.auth("alice"), "open", input);
    assert.deepEqual(replay, accepted);
  } finally { f.close(); }
});

test("AV-20261003-04: a failure freezing the second emission must release the first unaccepted object", async t => {
  const f = fixture();
  try {
    const candidate = f.candidateWith({ "a.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open");
    const name = f.requestName("open");
    await f.vote("bob", name, "approve", "ok", "bob-vote");
    const directory = join(f.root, "mail", "objects");
    const before = readdirSync(directory).sort();
    const real = f.mail.freezeReviewMessage.bind(f.mail);
    let calls = 0;
    f.mail.freezeReviewMessage = async (...args) => {
      if (++calls === 2) throw new StoreError("BROKER_UNAVAILABLE", "injected second-emission freeze failure");
      return real(...args);
    };
    await assert.rejects(f.vote("carol", name, "approve", "ok", "carol-vote"), { code: "BROKER_UNAVAILABLE" });
    assert.equal(f.store.getOperation("carol", "carol-vote"), null);
    const after = readdirSync(directory).sort();
    t.diagnostic(JSON.stringify({ unacceptedObjects: after.filter(name => !before.includes(name)) }));
    assert.deepEqual(after, before, "a definitive preaccept refusal must clean the objects it prepared");
  } finally { f.close(); }
});

test("AV-20261003-05: an applied completion diff must preserve a non-UTF-8 blob byte for byte", async t => {
  const f = fixture();
  try {
    const blob = execFileSync("/usr/bin/git", ["--git-dir", f.projectGit, "hash-object", "-w", "--stdin"],
      { env: GIT_ENV, input: Buffer.from([0xff, 0x0a]) }).toString("ascii").trim();
    const tree = f.git(["mktree"], `100644 blob ${blob}\tlatin.txt\n`);
    const candidate = f.git(["commit-tree", tree, "-p", f.base, "-m", "non-UTF-8 blob"]);
    await f.submit("alice", candidate);
    const raw = execFileSync("/usr/bin/git",
      ["--git-dir", f.projectGit, "diff", "--binary", "--full-index", f.base, candidate], { env: GIT_ENV });
    const rendered = canonicalMergeDiff(f.projectGit, f.base, candidate, 256 * 1024);
    let reviewError = null;
    try { readCode(f.projectGit, { action: "merge-diff", revision: candidate, base: f.base }); }
    catch (error) { reviewError = error.code; }
    await f.open("alice", { tier: "LOW", candidate }, "open");
    const applied = f.applyOp("alice", "open");
    assert.equal(applied.state, "succeeded");
    const notice = messageText(f.root, applied.plan.merge.notice[0].id);
    t.diagnostic(JSON.stringify({ reviewError, rawContainsFF: raw.includes(0xff),
      renderedContainsReplacement: rendered.includes("\ufffd"), noticeContainsReplacement: notice.includes("\ufffd") }));
    assert.deepEqual(Buffer.from(rendered, "utf8"), raw,
      "Buffer.toString must not silently substitute the bytes of an authoritative diff");
  } finally { f.close(); }
});

test("AV-20261003-06: a vote updated during notice preparation must appear in the applied notice", async t => {
  const f = fixture();
  let releaseNotice;
  let firstVote;
  try {
    const candidate = f.candidateWith({ "a.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const hold = new Promise(resolve => { releaseNotice = resolve; });
    const real = f.mail.freezeReviewMessage.bind(f.mail);
    let paused = false;
    f.mail.freezeReviewMessage = async (...args) => {
      if (args[3].review.role === "notice" && !paused) {
        paused = true;
        entered();
        await hold;
      }
      return real(...args);
    };
    firstVote = f.vote("bob", name, "approve", "first review", "vote-first");
    await started;
    const update = "UPDATED review must appear";
    await f.vote("bob", name, "approve", update, "vote-update");
    releaseNotice();
    await firstVote;
    const applied = f.applyOp("alice", "open");
    assert.equal(applied.state, "succeeded");
    assert.equal(f.stateOf(name).latestVotes.get("bob").fact.body, update);
    const notice = messageText(f.root, applied.plan.merge.notice[0].id);
    t.diagnostic(JSON.stringify({ integration: applied.state, latestVote: update, noticeIncludesLatestVote: notice.includes(update) }));
    assert.ok(notice.includes(update), "completion evidence must reflect the review state accepted before integration");
  } finally {
    releaseNotice?.();
    await firstVote?.catch(() => {});
    f.close();
  }
});

test("AV-20261003-07: a validated 4096-byte mail bound must allow a small LOW merge to progress", async t => {
  const config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: "/opt/oma",
    rootfs: "/tmp/oma-audit-rootfs", deploymentDigest: "a".repeat(64) });
  config.limits.mailBodyBytes = 4096;
  assert.equal(validateConfig(config).limits.mailBodyBytes, 4096);
  const f = fixture({ mailBodyBytes: 4096 });
  try {
    const candidate = f.candidateWith({ "a.txt": "a" });
    await f.submit("alice", candidate);
    const accepted = await f.open("alice", { tier: "LOW", candidate }, "open");
    assert.equal(accepted.state, "succeeded");
    const name = f.requestName("open");
    // Repeat the normal recovery owner to distinguish a deferred application
    // from a permanent bound mismatch.
    await f.reviews.advanceAll();
    t.diagnostic(JSON.stringify({ validatedMailBodyBytes: 4096,
      display: f.stateOf(name).display, integration: f.applyOp("alice", "open")?.state ?? null }));
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate,
      "a supported configuration must not strand every merge before integration acceptance");
  } finally { f.close(); }
});
