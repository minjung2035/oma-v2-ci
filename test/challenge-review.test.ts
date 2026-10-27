/** mail-v1 §7 (challenges): a Worker challenges an applied merge; the broker
 * prepares a revert commit on canonical main (merge-tree/commit-tree), publishes
 * it under the challenger's refs/oma/published ref before T, and the accepted
 * request reviews/votes/applies exactly like a merge request. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readDiagnosticSnapshot } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { applyRequestKeyFor } from "@oma/domain/identifiers";
import { inspectLedger } from "#oma-test/app/diagnostics/ledger";
import { inspectIntegrity } from "#oma-test/app/diagnostics/integrity";
import { NodeIntegrityFiles } from "#oma-test/app/diagnostics/files";
import { createCanonicalObserver } from "@oma/git/canonical-command";
import { mailInboxPathAt, mailWorkersPathAt } from "@oma/domain/paths";
import { fixture, messages, messageText } from "./fixtures/review-fixture.js";
import type { ReviewFact } from "@oma/contracts/attestation";

/** An applied LOW merge whose candidate adds `file` on top of current main. */
async function appliedMerge(f: ReturnType<typeof fixture>, content: string, key = "open-m") {
  const main = f.git(["rev-parse", "refs/heads/main"]);
  const candidate = f.candidateWith({ "file.txt": content }, main);
  await f.submit("alice", candidate, `sub-${key}`);
  await f.open("alice", { tier: "LOW", candidate, base: main, title: `add ${content}` }, key);
  return { name: f.requestName(key), candidate };
}
const openFact = (f: ReturnType<typeof fixture>, name: string): Extract<ReviewFact, { kind: "challenge.open" }> => {
  const row = f.store.attestations.all().find(r => "messages" in r.operation.plan &&
    (r.operation.plan.fact as { name?: string }).name === name);
  assert.ok(row !== undefined, `request ${name} exists`);
  const fact = row.operation.plan.fact;
  assert.equal(fact.kind, "challenge.open");
  return fact;
};
const publishedRefs = (f: ReturnType<typeof fixture>): string =>
  f.git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/oma/published/"]);

test("mail-v1: a challenge needs an applied merge and a HIGH target keeps HIGH", async () => {
  const f = fixture(); try {
    // Unknown name.
    await assert.rejects(f.challenge("bob", { merge: "merge-00000000-0000-4000-8000-000000000000", tier: "LOW" }),
      { code: "INVALID_REQUEST", message: "unknown request merge-00000000-0000-4000-8000-000000000000" });
    // A merge that never applied (peer-needed).
    const pending = f.candidateWith({ "a.txt": "a" }); await f.submit("alice", pending, "s-p");
    await f.open("alice", { tier: "MEDIUM", candidate: pending }, "open-p");
    const pendingName = f.requestName("open-p");
    await assert.rejects(f.challenge("bob", { merge: pendingName, tier: "LOW" }),
      { code: "INVALID_REQUEST", message: "a challenge needs an applied merge; cancel a request that is not applied yet" });
    // Applied LOW merge: challenge at LOW or HIGH is allowed.
    const { name } = await appliedMerge(f, "one");
    await f.challenge("bob", { merge: name, tier: "LOW" }, "ch-ok");
    assert.equal(f.requestName("ch-ok", "bob").startsWith("challenge-"), true);
    // A HIGH merge challenged at LOW refuses.
    const mainNow = f.git(["rev-parse", "refs/heads/main"]);
    const high = f.candidateWith({ "b.txt": "b" }, mainNow); await f.submit("alice", high, "s-h");
    await f.open("alice", { tier: "HIGH", candidate: high, base: mainNow }, "open-h");
    const highName = f.requestName("open-h");
    await f.vote("bob", highName, "approve", "ok", "vb");
    await f.vote("carol", highName, "approve", "ok", "vc");
    const approval = messages(f, "carol", "vc").find(m => m.review?.role === "approval")!;
    await f.vote("principal", highName, "approve", "fine", "pv", approval.id);
    assert.equal(f.stateOf(highName).display, "applied");
    await assert.rejects(f.challenge("bob", { merge: highName, tier: "LOW" }),
      { code: "INTEGRATION_CONDITIONS", message: "a HIGH merge can only be challenged at HIGH" });
    // A challenge cannot be a challenge target.
    await assert.rejects(f.challenge("bob", { merge: f.requestName("ch-ok", "bob"), tier: "LOW" }),
      { code: "INVALID_REQUEST", message: "a challenge needs an applied merge; cancel a request that is not applied yet" });
  } finally { f.close(); }
});

test("mail-v1: a prepared challenge of an applied merge reverts it by vote", async () => {
  const f = fixture(); try {
    const { name, candidate } = await appliedMerge(f, "target");
    const appliedMain = f.git(["rev-parse", "refs/heads/main"]);
    assert.equal(appliedMain, candidate);
    const receipt = await f.challenge("alice", { merge: name, tier: "LOW", title: "bad change", reason: "it broke the build" }, "ch-1");
    assert.equal(receipt.state, "succeeded");
    const chName = f.requestName("ch-1");
    assert.match(chName, /^challenge-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const fact = openFact(f, chName);
    assert.equal(fact.prepared, true);
    assert.deepEqual(fact.submitters, []);
    assert.equal(fact.identity.expectedBase, appliedMain);
    assert.equal(fact.target.name, name); assert.equal(fact.target.tier, "LOW");
    assert.equal(fact.target.request, f.store.getOperation("alice", "open-m")!.id);
    // The revert commit: parent is main, tree equals the merge's original base tree.
    const revert = fact.identity.candidate;
    assert.equal(f.git(["rev-parse", `${revert}^`]), appliedMain);
    assert.equal(f.git(["rev-parse", `${revert}^{tree}`]), f.git(["rev-parse", `${f.base}^{tree}`]));
    // The broker published it under the challenger's ref before T.
    assert.equal(f.git(["rev-parse", `refs/oma/published/alice/${receipt.operation}`]), revert);
    assert.deepEqual(publishedRefs(f).split("alice/").length - 1, 2, "submit + challenge refs");
    // Thread rev0 went to Workers only.
    const thread = messages(f, "alice", "ch-1")[0]!;
    assert.equal(thread.review?.role, "thread"); assert.equal(thread.audience, "workers");
    assert.equal(existsSync(join(f.root, "mail", "workers", "cur", `${thread.id}:2,`)), true);
    assert.equal(existsSync(join(f.root, "mail", "archive", "cur", `${thread.id}:2,`)), false);
    assert.equal(existsSync(mailInboxPathAt(f.root, "principal", thread.id, "new")), false);
    assert.equal(existsSync(mailInboxPathAt(f.root, "bob", thread.id, "new")), true);
    const body = messageText(f.root, thread.id);
    assert.match(body, /Target merge: merge-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/);
    assert.match(body, /oma_challenge diff name=challenge-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} view=revert\|original/);
    // One approval is not enough (highPeerFloor = 2); requester cannot vote.
    await assert.rejects(f.vote("alice", chName, "approve", "mine"), { code: "SELF_REVIEW" });
    await f.vote("bob", chName, "approve", "revert it", "v1");
    assert.equal(f.stateOf(chName).display, "peer-needed");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), appliedMain, "not applied after one approval");
    const applying = await f.vote("carol", chName, "approve", "revert it", "v2");
    assert.equal(applying.state, "succeeded");
    const main = f.git(["rev-parse", "refs/heads/main"]);
    assert.notEqual(main, appliedMain);
    assert.equal(f.git(["rev-parse", "refs/heads/main^"]), appliedMain, "the revert applied as a new commit");
    assert.equal(f.git(["rev-parse", "refs/heads/main^{tree}"]), f.git(["rev-parse", `${f.base}^{tree}`]));
    assert.equal(f.stateOf(chName).display, "applied");
    // The original merge stays applied.
    assert.equal(f.stateOf(name).display, "applied");
    const mergeStatus = f.reviews.status(f.auth("dave"), name, 64 * 1024, "s1");
    assert.ok("entries" in mergeStatus); assert.equal(mergeStatus.display, "applied");
    assert.equal(mergeStatus.entries.at(-1)?.kind, "challenge.open", "the challenge is an entry of its merge");
    // The completion notice: revert title, target line, revert diff.
    const applyOp = f.store.getOperation("alice", applyRequestKeyFor(f.store.getOperation("alice", "ch-1")!.id))!;
    assert.equal(applyOp.state, "succeeded");
    const notice = (applyOp.plan as { merge: { notice: { id: string }[] } }).merge.notice[0]!;
    const text = messageText(f.root, notice.id);
    assert.match(text, new RegExp(`OMA revert applied: ${chName}`));
    assert.match(text, new RegExp(`Reverts merge ${name} \\(integration ${f.applyOp("alice", "open-m")!.id}\\)`));
    assert.match(text, /deleted file mode/, "the notice carries the revert diff");
    assert.equal(existsSync(mailInboxPathAt(f.root, "principal", notice.id, "new")), true);
    assert.equal(existsSync(mailInboxPathAt(f.root, "dave", notice.id, "new")), true);
    // A same-key retry of the applying vote creates nothing.
    const retried = await f.vote("carol", chName, "approve", "revert it", "v2");
    assert.equal(retried.operation, applying.operation);
    assert.equal(f.store.attestations.all().filter(r => r.operation.actor === "carol").length, 1);
    const status = f.reviews.status(f.auth("dave"), chName, 64 * 1024, "s2");
    assert.ok("entries" in status);
    assert.deepEqual(status.target, { name, integration: f.applyOp("alice", "open-m")!.id,
      identity: openFact(f, chName).target.identity });
    const ledger = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" });
    assert.equal(ledger.report.status, "PASS", JSON.stringify(ledger.report.issues));
    const integrity = inspectIntegrity(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" },
      { files: new NodeIntegrityFiles(), git: createCanonicalObserver() });
    assert.equal(integrity.status, "PASS", JSON.stringify(integrity.issues));
  } finally { f.close(); }
});

test("mail-v1: a HIGH challenge asks the Principal before applying", async () => {
  const f = fixture(); try {
    const { name } = await appliedMerge(f, "risky");
    await f.challenge("alice", { merge: name, tier: "HIGH" }, "ch-hi");
    const chName = f.requestName("ch-hi");
    await f.vote("bob", chName, "approve", "yes", "v1");
    assert.equal(f.stateOf(chName).display, "peer-needed");
    await f.vote("carol", chName, "approve", "yes too", "v2");
    assert.equal(f.stateOf(chName).display, "principal-pending");
    const approval = messages(f, "carol", "v2").find(m => m.review?.role === "approval")!;
    const approvalText = messageText(f.root, approval.id);
    assert.match(approvalText, /bob:\n.*yes/s); assert.match(approvalText, /carol:\n.*yes too/s);
    await f.vote("principal", chName, "approve", "ship the revert", "pv", approval.id);
    assert.equal(f.stateOf(chName).display, "applied");
    const ledger = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" });
    assert.equal(ledger.report.status, "PASS", JSON.stringify(ledger.report.issues));
    const integrity = inspectIntegrity(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" },
      { files: new NodeIntegrityFiles(), git: createCanonicalObserver() });
    assert.equal(integrity.status, "PASS", JSON.stringify(integrity.issues));
  } finally { f.close(); }
});

test("mail-v1: a conflicting revert refuses with the path and leaves no ref", async () => {
  const f = fixture(); try {
    const { name } = await appliedMerge(f, "first");
    // main changes file.txt differently: the revert can no longer be clean.
    const mainNow = f.git(["rev-parse", "refs/heads/main"]);
    const post = f.candidateWith({ "file.txt": "changed later", "other.txt": "x" }, mainNow);
    await f.submit("alice", post, "s-post");
    await f.open("alice", { tier: "LOW", candidate: post, base: mainNow }, "open-post");
    await assert.rejects(f.challenge("alice", { merge: name, tier: "LOW" }, "ch-conflict"), (error: unknown) => {
      assert.ok(error instanceof StoreError); assert.equal(error.code, "REVERT_CONFLICT");
      assert.deepEqual((error as { details?: { paths?: string[] } }).details?.paths, ["file.txt"]);
      assert.equal((error as { details?: { artifact?: string } }).details?.artifact, "none");
      return true;
    });
    assert.equal(f.store.getOperation("alice", "ch-conflict"), null);
    assert.equal(publishedRefs(f).split("\n").filter(l => l.includes("alice/")).length, 2, "only submit refs remain");
  } finally { f.close(); }
});

test("mail-v1: a refused open never publishes; a crash before publication is repaired", async () => {
  const f = fixture(); try {
    const { name } = await appliedMerge(f, "clean");
    const aliceRefs = () => publishedRefs(f).split("\n").filter(l => l.includes("alice/"));
    assert.equal(aliceRefs().length, 1, "only the submit ref exists");
    // T-side refusal: the revert commit object exists but no ref ever did.
    const realClaim = f.store.claimKey.bind(f.store);
    let claims = 0;
    (f.store as { claimKey: typeof f.store.claimKey }).claimKey = (actor, key, hash) => {
      claims++;
      if (claims === 2) throw new StoreError("BROKER_UNAVAILABLE", "injected T failure");
      return realClaim(actor, key, hash);
    };
    await assert.rejects(f.challenge("alice", { merge: name, tier: "LOW" }, "ch-t"), { code: "BROKER_UNAVAILABLE" });
    (f.store as { claimKey: typeof f.store.claimKey }).claimKey = realClaim;
    assert.equal(f.store.getOperation("alice", "ch-t"), null);
    assert.equal(aliceRefs().length, 1, "the ref was never created");
    // Crash after T but before publication: the fact is accepted, the receipt
    // stands, and the sweep publishes the ref exactly once.
    // The failure stays armed through the eager advance: the whole broker is
    // "dead" until reopen swaps in a module with the real effects.
    const effects = (f.reviews as unknown as { effects: { publishCandidateRef: (r: string, c: string) => void } }).effects;
    const realPublish = effects.publishCandidateRef.bind(effects);
    effects.publishCandidateRef = () => { throw new StoreError("BROKER_UNAVAILABLE", "process died before publication"); };
    const receipt = await f.challenge("alice", { merge: name, tier: "LOW" }, "ch-crash");
    assert.equal(receipt.state, "succeeded", "a post-T publication failure keeps the receipt");
    assert.equal(aliceRefs().length, 1, "the crash left no published ref");
    f.reopen();   // the failed module is gone; recovery repairs
    await f.reviews.advanceAll();
    const now = aliceRefs();
    assert.equal(now.length, 2, "recovery published the challenge ref once");
    const chName = f.requestName("ch-crash");
    const fact = openFact(f, chName);
    const published = now.find(line => line.startsWith(`refs/oma/published/alice/${receipt.operation} `));
    assert.ok(published, `the challenge candidate ref was published: ${now}`);
    assert.equal(published.split(" ")[1], fact.identity.candidate);
    // A second sweep does not republish; the challenge still reviews/approves.
    await f.reviews.advanceAll();
    assert.equal(aliceRefs().length, 2);
    void realPublish;
    await f.vote("bob", chName, "approve", "ok", "v1");
    assert.equal(f.stateOf(chName).display, "peer-needed");
  } finally { f.close(); }
});

test("mail-v1: a prepared revert that touches a protected path refuses at open", async () => {
  const f = fixture(); try {
    const { name } = await appliedMerge(f, "guarded");
    // The path became protected after the merge applied (a rebound policy):
    // the prepared revert's own diff touches it, and the open refuses like a
    // caller candidate would.
    f.policy.protectedPaths.push("file.txt");
    f.reopen();
    await assert.rejects(f.challenge("bob", { merge: name, tier: "LOW" }, "ch-prot"),
      { code: "PROTECTED_PATH" });
    assert.equal(f.store.getOperation("bob", "ch-prot"), null);
    assert.equal(publishedRefs(f).split("\n").filter(l => l.includes("bob/")).length, 0);
  } finally { f.close(); }
});

test("UX-09: a broker-prepared revert carrying a gitlink refuses at open, naming the path", async () => {
  const f = fixture(); try {
    const { name } = await appliedMerge(f, "revert-me");
    // A seeded or mirrored canonical main may carry a gitlink (DR33 keeps
    // provisioning permissive). The prepared revert restores the merge's base
    // over that main — so its tree still carries the link, and the gate that
    // refuses a caller-built candidate refuses the broker's own revert the
    // same way, before any request row or published ref exists.
    const appliedMain = f.git(["rev-parse", "refs/heads/main"]);
    // mktree stores entries in input order; a tree's canonical order compares
    // entry names, so the gitlink line sorts in by path.
    const entries = f.git(["ls-tree", appliedMain]).split("\n").concat(`160000 commit ${f.base}\tdep`);
    const byPath = (line: string): string => line.slice(line.indexOf("\t") + 1);
    entries.sort((left, right) => byPath(left) < byPath(right) ? -1 : 1);
    const linkedTree = f.git(["mktree"], `${entries.join("\n")}\n`);
    f.git(["update-ref", "refs/heads/main",
      f.git(["commit-tree", linkedTree, "-p", appliedMain, "-m", "mirrored main carries a gitlink"])]);
    await assert.rejects(f.challenge("bob", { merge: name, tier: "LOW" }, "ch-gitlink"), (error: unknown) => {
      if (!(error instanceof StoreError) || error.code !== "UNSUPPORTED_PROFILE") return false;
      assert.match(error.message, /submodule gitlink/);
      assert.deepEqual((error as { details?: { paths?: string[] } }).details?.paths, ["dep"]);
      return true;
    });
    assert.equal(f.store.getOperation("bob", "ch-gitlink"), null);
    assert.equal(publishedRefs(f).split("\n").filter(l => l.includes("bob/")).length, 0,
      "the refused revert was never published");
  } finally { f.close(); }
});

test("mail-v1: a caller-provided revert candidate excludes its submitters from approval", async () => {
  const f = fixture(); try {
    const { name } = await appliedMerge(f, "supplied");
    const main = f.git(["rev-parse", "refs/heads/main"]);
    // bob hand-builds and submits the revert himself.
    const revertTree = f.git(["rev-parse", `${f.base}^{tree}`]);
    const revert = f.git(["commit-tree", revertTree, "-p", main, "-m", "hand revert"]);
    await f.submit("bob", revert, "s-rev");
    await f.challenge("bob", { merge: name, tier: "LOW", candidate: revert, base: main }, "ch-own");
    const chName = f.requestName("ch-own", "bob");
    assert.equal(openFact(f, chName).prepared, false);
    assert.deepEqual(openFact(f, chName).submitters, ["bob"]);
    // The challenger/submitter cannot approve; alice and carol apply it.
    await assert.rejects(f.vote("bob", chName, "approve", "self"), { code: "SELF_REVIEW" });
    await f.vote("alice", chName, "approve", "ok", "va");
    await f.vote("carol", chName, "approve", "ok", "vc");
    assert.equal(f.stateOf(chName).display, "applied");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), revert);
  } finally { f.close(); }
});

test("mail-v1: duplicate and stale challenges of one merge", async () => {
  const f = fixture(); try {
    const { name } = await appliedMerge(f, "dup");
    await f.challenge("alice", { merge: name, tier: "LOW", title: "first revert" }, "ch-a");
    const chA = f.requestName("ch-a");
    // A second challenge with a different identity is another live request.
    await f.challenge("bob", { merge: name, tier: "HIGH", title: "second revert" }, "ch-b");
    const chB = f.requestName("ch-b", "bob");
    // An identical revert identity is a duplicate while the first is live.
    const aliceRevert = openFact(f, chA).identity.candidate;
    await f.submit("carol", aliceRevert, "s-dupe");   // same candidate+base+tier+revision
    await assert.rejects(
      f.challenge("carol", { merge: name, tier: "LOW", candidate: aliceRevert, base: f.git(["rev-parse", "refs/heads/main"]) }, "ch-dup"),
      (error: unknown) => {
        assert.ok(error instanceof StoreError); assert.equal(error.code, "REQUEST_EXISTS");
        assert.equal((error as { details?: { name?: string } }).details?.name, chA);
        return true;
      });
    // The first challenge applies; the second goes stale by refresh.
    await f.vote("bob", chA, "approve", "ok", "a1");
    await f.vote("carol", chA, "approve", "ok", "a2");
    assert.equal(f.stateOf(chA).display, "applied");
    await f.reviews.advanceAll();
    assert.equal(f.stateOf(chB).display, "stale");
    await assert.rejects(f.vote("dave", chB, "approve", "late", "b1"), { code: "REQUEST_CLOSED" });
    // A new challenge after one applied names the applied one.
    await assert.rejects(f.challenge("dave", { merge: name, tier: "LOW" }, "ch-after"), (error: unknown) => {
      assert.ok(error instanceof StoreError); assert.equal(error.code, "REQUEST_EXISTS");
      assert.equal((error as { details?: { name?: string } }).details?.name, chA);
      return true;
    });
  } finally { f.close(); }
});

test("mail-v1: a revert with nothing to revert refuses", async () => {
  const f = fixture(); try {
    const { name } = await appliedMerge(f, "gone");
    await f.challenge("alice", { merge: name, tier: "LOW" }, "ch-first");
    const first = f.requestName("ch-first");
    await f.vote("bob", first, "approve", "ok", "v1");
    await f.vote("carol", first, "approve", "ok", "v2");
    assert.equal(f.stateOf(first).display, "applied");
    // A second challenge of the same merge is refused before any revert prep.
    await assert.rejects(f.challenge("bob", { merge: name, tier: "LOW" }, "ch-second"), { code: "REQUEST_EXISTS" });
    // A different merge whose change is already gone on main: apply a merge
    // that restores the pre-merge tree, then challenge the reverted one.
    const { name: name2 } = await appliedMerge(f, "other", "open-m2");
    const mainNow = f.git(["rev-parse", "refs/heads/main"]);
    const beforeTree = f.git(["rev-parse", `${mainNow}~^{tree}`]);
    const undo = f.git(["commit-tree", beforeTree, "-p", mainNow, "-m", "undo by hand"]);
    await f.submit("alice", undo, "s-undo");
    await f.open("alice", { tier: "LOW", candidate: undo, base: mainNow }, "open-undo");
    // Now main's tree is as if name2 never applied; challenging it must refuse.
    await assert.rejects(f.challenge("alice", { merge: name2, tier: "LOW" }, "ch-gone"), {
      code: "INVALID_REQUEST", message: "the merged change is no longer present on main" });
  } finally { f.close(); }
});
