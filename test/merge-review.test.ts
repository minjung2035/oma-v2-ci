import { reviewLedger, reviewRuntime } from "#oma-test/app/broker/review-composition";
/** mail-v1 (merge requests): ReviewModule accepts opens/reviews/votes/cancels
 * as attest.record facts and owns their mail; the Principal decides by mail on
 * a bound approval, and worker mail never reaches it. A request this module
 * accepts only reaches `ready`; integration is a later owner. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Store, readDiagnosticSnapshot } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { inspectLedger } from "#oma-test/app/diagnostics/ledger";
import { inspectIntegrity } from "#oma-test/app/diagnostics/integrity";
import { NodeIntegrityFiles } from "#oma-test/app/diagnostics/files";
import { createCanonicalObserver } from "@oma/git/canonical-command";
import { mailWorkersPathAt, mailArchivePathAt, mailInboxPathAt } from "@oma/domain/paths";
import type { ReviewState as RS } from "@oma/domain/review-evaluation";
import type { ReviewFact } from "@oma/contracts/attestation";
import { applyRequestKeyFor } from "@oma/domain/identifiers";
import { StoreError, publicFailure } from "@oma/domain/errors";
import { runGitText } from "@oma/process/policies";
import { PublicDispatcher } from "@oma/broker/public-dispatcher";
import { decodeRpcReply } from "@oma/protocol/response-codec";
import { ReviewModule } from "@oma/review";
import { snapshotIntegrationPolicy } from "@oma/domain/integration-policy";
import { sha256Hex } from "@oma/domain/canonical-json";
import { fixture, empty, messages, inboxCount, messageText, workerFile,
  type FixtureOptions } from "./fixtures/review-fixture.js";
import type { AuthContext, MessagePlan } from "@oma/contracts";
import type { IntegrationPolicy } from "@oma/domain/integration-policy";
import type { OperationOf } from "@oma/protocol/operation-codec";
import { PreacceptScope } from "@oma/storage/preaccept-artifact";

test("mail-v1: a LOW merge request applies itself and mails the completion notice", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    const receipt = await f.open("alice", { tier: "LOW", candidate, reason: "needs to land now" }, "open-low");
    assert.equal(receipt.state, "succeeded");
    const op = f.store.getOperation("alice", "open-low")!;
    assert.equal(op.kind, "attest.record");
    assert.deepEqual((op.plan as { messages: unknown[] }).messages, [], "the open owns no mail");
    const name = f.requestName("open-low");
    assert.match(name, /^merge-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const state = f.stateOf(name);
    assert.equal(state.display, "applied"); assert.equal(state.integration?.state, "succeeded");
    // The one integration moved main and published the notice.
    const integration = f.store.getOperation("alice", applyRequestKeyFor(op.id))!;
    assert.equal(integration.kind, "git.integrate"); assert.equal(integration.state, "succeeded");
    const merge = (integration.plan as { merge: { request: string; name: string; notice: MessagePlan[] } }).merge;
    assert.equal(merge.request, op.id); assert.equal(merge.name, name);
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate, "main is the candidate");
    const notice = merge.notice;
    assert.equal(notice.length, 1, "a small document is one part");
    const part = notice[0]!;
    assert.equal(f.store.integrationNoticeRequester(part.id), "alice");
    assert.equal(f.store.integrationNoticeRequester(`m-${op.id.slice(3)}-0`), null);
    const { publishMailNoticeView } = await import("#oma-test/app/views/mail-notices");
    const { readSocietyMail } = await import("#oma-test/app/application/mail");
    publishMailNoticeView(f.store, f.root);
    const displayed = readSocietyMail(f.root).rows.find(row => row.id === `${part.id}:2,`)!;
    assert.ok(displayed);
    assert.equal(displayed.from, "OMA");
    assert.equal(displayed.kind, "notice");
    assert.equal(displayed.requester, "alice");
    assert.equal(part.kind, "result"); assert.deepEqual(part.to, ["commons", "principal"]);
    assert.equal(part.review?.role, "notice"); assert.equal(part.audience, undefined);
    assert.equal(existsSync(mailArchivePathAt(f.root, part.id)), true, "notice is in the public archive");
    assert.equal(existsSync(workerFile(f.root, part.id)), false, "never the worker archive");
    // Delivered to the Principal and every non-retired Worker (stopped included).
    for (const actor of ["principal", "alice", "bob", "carol", "dave", "ellen"])
      assert.equal(existsSync(mailInboxPathAt(f.root, actor, part.id, "new")), true, `${actor} got the notice`);
    assert.equal(existsSync(mailInboxPathAt(f.root, "frank", part.id, "new")), false, "retired Worker did not");
    const text = messageText(f.root, part.id);
    assert.match(text, new RegExp(`OMA merge applied: ${name}`));
    assert.match(text, new RegExp(`Integration operation: ${integration.id}`));
    assert.match(text, /needs to land now/);
    assert.match(text, /none — LOW is applied without prior review/);
    assert.match(text, new RegExp(`Previous main: ${f.base}`));
    assert.match(text, new RegExp(`New main: ${candidate}`));
    assert.match(text, /diff --git a\/one\.txt b\/one\.txt/, "the notice carries the full binary-mode diff");
    assert.match(text, /sha256 [0-9a-f]{64}/, "the part header names the document digest");
    // The status read model reflects the applied request.
    const status = f.reviews.status(f.auth("bob"), name, 64 * 1024, "s1");
    assert.ok("entries" in status);
    assert.equal(status.display, "applied");
    assert.equal(status.integration?.operation, integration.id);
    assert.equal(status.integration?.state, "succeeded");
    assert.equal(status.integration?.error, null);
    assert.deepEqual(status.entries, []); assert.deepEqual(status.missing, []);
    assert.deepEqual(status.principal, { approval: null, sent: false, decision: null, decisionApproval: null });
    assert.deepEqual(status.main, { oid: candidate, observedAtMs: status.main.observedAtMs });
    assert.equal(status.tier, "LOW"); assert.equal(status.requester, "alice");
    // No thread or approval mail exists for a LOW request.
    assert.equal(f.store.attestations.all()
      .flatMap(row => "messages" in row.operation.plan ? row.operation.plan.messages : [])
      .filter(message => message.review?.role === "thread" || message.review?.role === "approval").length, 0);
    // Applied requests are closed: votes/reviews/cancels refuse.
    await assert.rejects(f.vote("bob", name, "approve", "ok"), { code: "REQUEST_CLOSED" });
    await assert.rejects(f.review("bob", name), { code: "REQUEST_CLOSED" });
    await assert.rejects(f.cancel("alice", name), { code: "REQUEST_CLOSED" });
    // Same-key retry of the open returns the same receipt and creates nothing.
    const retried = await f.open("alice", { tier: "LOW", candidate, reason: "needs to land now" }, "open-low");
    assert.equal(retried.state, "succeeded");
    assert.equal(retried.operation, receipt.operation);
  } finally { f.close(); }
});

test("mail-v1: merge request opens observe live Git facts and refuse bad ones", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await assert.rejects(f.open("alice", { tier: "LOW", candidate, reason: "   " }), { code: "INVALID_REQUEST" });
    assert.equal(f.store.getOperation("alice", "open-low-bad"), null);
    const moved = f.candidateWith({ "moved.txt": "x" });
    await f.submit("alice", moved, "submit-moved");
    f.git(["update-ref", "refs/heads/main", moved]);
    const stale = f.candidateWith({ "stale.txt": "y" }, moved);
    await f.submit("alice", stale, "submit-stale");
    await assert.rejects(f.open("alice", { tier: "LOW", candidate: stale, base: f.base }, "stale"),
      (error: unknown) => error instanceof Object && (error as { code: string }).code === "STALE_BASE" &&
        (error as { details?: { actual?: string } }).details?.actual === moved);
    const orphan = (() => { const tree = f.git(["mktree"], ""); return f.git(["commit-tree", tree, "-m", "orphan"]); })();
    await f.submit("alice", orphan, "submit-orphan");
    await assert.rejects(f.open("alice", { tier: "LOW", candidate: orphan, base: moved }, "orphan"), { code: "NOT_DESCENDANT" });
    const unpublished = f.candidateWith({ "never.txt": "z" }, moved);
    await assert.rejects(f.open("alice", { tier: "LOW", candidate: unpublished, base: moved }, "unpub"),
      { code: "CANDIDATE_NOT_PUBLISHED" });
    await assert.rejects(f.open("alice", { tier: "LOW", candidate: moved, base: moved }, "same"),
      { code: "INVALID_REQUEST" });
    const receipt = await f.open("alice", { tier: "MEDIUM", candidate: stale, base: moved }, "ok");
    assert.equal(receipt.state, "succeeded");
    await assert.rejects(f.open("alice", { tier: "MEDIUM", candidate: stale, base: moved }, "dup"), { code: "REQUEST_EXISTS" });
  } finally { f.close(); }
});

test("UX-09: merge.open refuses a candidate whose tree still carries gitlinks, naming every path", async () => {
  const f = fixture(); try {
    // Whole-tree gating: main already carries the gitlinks, so the diff names
    // only one.txt — the links this candidate inherited verbatim are still
    // refused, and every one is named in details that survive the wire.
    const vendor = f.git(["mktree"], `160000 commit ${f.base}\tnested\n`);
    const linkedTree = f.git(["mktree"], `160000 commit ${f.base}\tdep\n040000 tree ${vendor}\tvendor\n`);
    const linked = f.git(["commit-tree", linkedTree, "-p", f.base, "-m", "linked base"]);
    f.git(["update-ref", "refs/heads/main", linked]);
    const blob = f.git(["hash-object", "-w", "--stdin"], "a");
    const tree = f.git(["mktree"], `100644 blob ${blob}\tone.txt\n160000 commit ${f.base}\tdep\n040000 tree ${vendor}\tvendor\n`);
    const candidate = f.git(["commit-tree", tree, "-p", linked, "-m", "gitlink candidate"]);
    assert.deepEqual(f.git(["diff-tree", "-r", "--name-only", "--no-commit-id", linked, candidate]).split("\n"), ["one.txt"],
      "the diff carries no gitlink path — only the whole-tree observation sees them");
    await f.submit("alice", candidate);
    await assert.rejects(f.open("alice", { tier: "LOW", candidate, base: linked }, "open-gitlink"), (error: unknown) => {
      if (!(error instanceof StoreError) || error.code !== "UNSUPPORTED_PROFILE") return false;
      assert.match(error.message, /submodule gitlink/);
      assert.deepEqual(publicFailure(error).details, { paths: ["dep", "vendor/nested"] });
      return true;
    });
    assert.equal(f.store.getOperation("alice", "open-gitlink"), null, "the refusal precedes the accepted fact");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), linked, "main never moved");
  } finally { f.close(); }
});

test("UX-09: a candidate that removes a gitlink from a gitlink-bearing main applies", async () => {
  const f = fixture(); try {
    // The removal path must work — a main carrying gitlinks refuses every
    // merge until a candidate's tree drops them, and this one does.
    const linked = f.git(["commit-tree", f.git(["mktree"], `160000 commit ${f.base}\tdep\n`), "-p", f.base, "-m", "linked"]);
    f.git(["update-ref", "refs/heads/main", linked]);
    const clean = f.candidateWith({ "one.txt": "a" }, linked);
    await f.submit("alice", clean);
    const receipt = await f.open("alice", { tier: "LOW", candidate: clean, base: linked }, "open-clean");
    assert.equal(receipt.state, "succeeded");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), clean, "main is the gitlink-free candidate");
  } finally { f.close(); }
});

test("UX-09: a caller-built challenge candidate carrying gitlinks refuses the same way", async () => {
  const f = fixture(); try {
    const merged = f.candidateWith({ "merged.txt": "m" });
    await f.submit("alice", merged);
    const opened = await f.open("alice", { tier: "LOW", candidate: merged }, "open-applied");
    assert.equal(opened.state, "succeeded");
    const name = f.requestName("open-applied");
    const main = f.git(["rev-parse", "refs/heads/main"]);
    const tree = f.git(["mktree"], `160000 commit ${f.base}\tdep\n`);
    const revert = f.git(["commit-tree", tree, "-p", main, "-m", "caller revert"]);
    await f.submit("bob", revert, "submit-revert");
    await assert.rejects(f.challenge("bob", { merge: name, tier: "LOW", candidate: revert, base: main }, "ch-gitlink"),
      (error: unknown) => {
        if (!(error instanceof StoreError) || error.code !== "UNSUPPORTED_PROFILE") return false;
        assert.deepEqual(publicFailure(error).details, { paths: ["dep"] });
        return true;
      });
    assert.equal(f.store.getOperation("bob", "ch-gitlink"), null);
  } finally { f.close(); }
});

test("mail-v1: protected paths and the host tier floor refuse an under-tiered open", async () => {
  const f = fixture({ protectedPaths: ["protected.txt"],
    rules: [{ path: "prod.flag", tier: "HIGH", statuses: ["A", "M"] }] });
  try {
    const protectedCandidate = f.candidateWith({ "protected.txt": "no" });
    await f.submit("alice", protectedCandidate, "s1");
    await assert.rejects(f.open("alice", { tier: "LOW", candidate: protectedCandidate }, "prot"), { code: "PROTECTED_PATH" });
    const flagged = f.candidateWith({ "prod.flag": "on" });
    await f.submit("alice", flagged, "s2");
    await assert.rejects(f.open("alice", { tier: "MEDIUM", candidate: flagged }, "low-tier"), { code: "INTEGRATION_CONDITIONS" });
    const receipt = await f.open("alice", { tier: "HIGH", candidate: flagged }, "high-ok");
    assert.equal(receipt.state, "succeeded");
  } finally { f.close(); }
});

test("mail-v1: MEDIUM review thread revisions stay in the worker archive and reach Workers only", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    const receipt = await f.open("alice", { tier: "MEDIUM", candidate }, "open-med");
    assert.equal(receipt.state, "succeeded");
    const name = f.requestName("open-med");
    const rev0 = messages(f, "alice", "open-med")[0]!;
    assert.equal(rev0.review?.role, "thread"); assert.equal(rev0.review?.role === "thread" ? rev0.review.revision : -1, 0);
    assert.equal(rev0.audience, "workers");
    assert.equal(existsSync(workerFile(f.root, rev0.id)), true);
    assert.equal(existsSync(mailArchivePathAt(f.root, rev0.id)), false);
    for (const actor of ["alice", "bob", "carol", "dave", "ellen"])
      assert.equal(existsSync(mailInboxPathAt(f.root, actor, rev0.id, "new")), true, `${actor} got rev0`);
    for (const actor of ["principal", "frank"])
      assert.equal(existsSync(mailInboxPathAt(f.root, actor, rev0.id, "new")), false, `${actor} did not`);
    assert.match(messageText(f.root, rev0.id), /Status: peer-needed/);
    assert.match(messageText(f.root, rev0.id), /\(rev 0\)/);
    const before = f.stateOf(name);
    assert.equal(before.ready, false); assert.equal(before.display, "peer-needed");
    const reviewed = await f.review("bob", name, "rev-1");
    assert.equal(reviewed.state, "succeeded");
    const rev1 = messages(f, "bob", "rev-1")[0]!;
    assert.equal(rev1.review?.role === "thread" ? rev1.review.revision : -1, 1);
    assert.match(messageText(f.root, rev1.id), new RegExp(`In-Reply-To: <${rev0.id}@`));
    assert.match(messageText(f.root, rev1.id), /\[1\] bob review:\nbob looked/);
    assert.equal(f.stateOf(name).approvers.length, 0, "a review never counts");
    // The requester and a submitter may not vote on their own change.
    await assert.rejects(f.vote("alice", name, "approve", "self"), { code: "SELF_REVIEW" });
    const submitted = f.candidateWith({ "bob.txt": "b" });
    await f.submit("bob", submitted, "submit-by-bob");
    await f.open("alice", { tier: "MEDIUM", candidate: submitted }, "open-med2");
    const name2 = f.requestName("open-med2", "alice");
    await assert.rejects(f.vote("bob", name2, "approve", "self"), { code: "SELF_REVIEW" });
    // A Worker vote never names an approval.
    await assert.rejects(f.vote("bob", name, "approve", "sneaky", "v-sneaky", rev0.id), { code: "INVALID_REQUEST" });
    const open2_status = f.reviews.status(f.auth("carol"), name2, 64 * 1024, "s2");
    assert.ok("entries" in open2_status); assert.equal(open2_status.display, "peer-needed");
    const beforeVote = f.reviews.status(f.auth("carol"), name, 64 * 1024, "s3");
    assert.ok("entries" in beforeVote);
    assert.equal(beforeVote.display, "peer-needed");
    assert.deepEqual(beforeVote.entries.map(e => [e.index, e.actor, e.kind]),
      [[1, "bob", "review"]], "the review entry is request-local index 1");
    const voted = await f.vote("bob", name, "approve", "bob approves", "v-bob");
    assert.equal(voted.state, "succeeded");
    const rev2 = messages(f, "bob", "v-bob")[0]!;
    assert.equal(rev2.review?.role === "thread" ? rev2.review.revision : -1, 2);
    // One approving vote applies a MEDIUM request at once.
    const after = f.stateOf(name);
    assert.equal(after.display, "applied"); assert.equal(after.integration?.state, "succeeded");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
    const applyOp = f.store.getOperation("alice", applyRequestKeyFor(messages0Id(f, "open-med")))!;
    assert.equal(applyOp.state, "succeeded");
    const notice = (applyOp.plan as { merge: { notice: MessagePlan[] } }).merge.notice[0]!;
    assert.match(messageText(f.root, notice.id), /bob approves/, "the notice lists the approving vote");
    assert.equal(existsSync(workerFile(f.root, notice.id)), false);
    assert.equal(existsSync(mailArchivePathAt(f.root, notice.id)), true);
    assert.equal(existsSync(mailInboxPathAt(f.root, "principal", notice.id, "new")), true,
      "the Principal receives only the completion notice");
    // The same-key retry of the vote returns the same receipt and creates nothing.
    const retry = await f.vote("bob", name, "approve", "bob approves", "v-bob");
    assert.equal(retry.state, "succeeded"); assert.equal(retry.operation, voted.operation);
    assert.equal(messages(f, "bob", "v-bob").length, 1);
    const afterVote = f.reviews.status(f.auth("carol"), name, 64 * 1024, "s4");
    assert.ok("entries" in afterVote);
    assert.equal(afterVote.display, "applied");
    assert.deepEqual(afterVote.entries.map(e => [e.index, e.actor, e.kind, e.verdict]),
      [[1, "bob", "review", undefined], [2, "bob", "vote", "approve"]]);
    assert.deepEqual(afterVote.approvers, ["bob"]);
  } finally { f.close(); }
});
const messages0Id = (f: ReturnType<typeof fixture>, key: string): string =>
  f.store.getOperation("alice", key)!.id;

test("FJ-5: an approval request over the mail body bound is refused at emission, never frozen", async () => {
  // 3439 is the audited floor for subjectBytes 512 (the thread revision and
  // the notice part alone): every thread revision fits it, but an approval
  // request carrying the reason and two maximal bound votes does not. The
  // audited emission froze that body anyway; configuration validation now
  // refuses this bound for highPeerFloor 2, and the emission refuses it too.
  const mailBodyBytes = 3439;
  const quarter = Math.floor(mailBodyBytes / 4);
  const f = fixture({ mailBodyBytes }); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate, title: "t".repeat(512), reason: "r".repeat(quarter) }, "open-wide");
    const name = f.requestName("open-wide");
    await f.vote("bob", name, "approve", "b".repeat(quarter), "v-bob");
    assert.deepEqual(messages(f, "bob", "v-bob").map(m => m.review?.role), ["thread"],
      "a maximal thread revision still fits this bound");
    await assert.rejects(f.vote("carol", name, "approve", "c".repeat(quarter), "v-carol"),
      (error: unknown) => error instanceof StoreError && error.code === "INTERNAL_ERROR" &&
        /approval request exceeds the mail body bound/.test(error.message),
      "the over-bound approval request is a bounds bug, not mail the Principal cannot read");
    assert.equal(inboxCount(f, "principal"), 0, "no approval_required body was delivered");
    assert.equal(f.store.getOperation("carol", "v-carol"), null, "the vote was not accepted with an unreadable emission");
  } finally { f.close(); }
});

test("mail-v1: a HIGH request asks the Principal only for a still-valid quorum, decides by bound approval", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    const otherCandidate = f.candidateWith({ "two.txt": "b" });
    await f.submit("alice", otherCandidate, "submit-two");
    const thirdCandidate = f.candidateWith({ "three.txt": "c" });
    await f.submit("alice", thirdCandidate, "submit-three");
    await f.open("alice", { tier: "HIGH", candidate }, "open-hi");
    const name = f.requestName("open-hi");
    await f.vote("bob", name, "approve", "bob approves", "v-bob");
    assert.deepEqual(messages(f, "bob", "v-bob").map(m => m.review?.role), ["thread"], "quorum not met: no Principal mail");
    // The Principal sees nothing until the approval mail reaches it — an
    // unseen request and an unknown name get the same refusal.
    assert.throws(() => f.reviews.status(f.auth("principal"), name, 64 * 1024, "p0"),
      { code: "CAPABILITY_DENIED", message: `no request ${name} is visible to the Principal` });
    await f.vote("carol", name, "approve", "carol approves", "v-carol");
    const approval = messages(f, "carol", "v-carol").find(m => m.review?.role === "approval")!;
    assert.equal(approval.kind, "approval_required");
    assert.deepEqual(approval.to, ["principal"]);
    assert.deepEqual(approval.recipients, ["principal"]);
    assert.equal(existsSync(workerFile(f.root, approval.id)), false, "the Principal's mail is public");
    assert.equal(existsSync(mailArchivePathAt(f.root, approval.id)), true);
    const approvalText = messageText(f.root, approval.id);
    assert.match(approvalText, /bob approves/); assert.match(approvalText, /carol approves/);
    assert.match(approvalText, new RegExp(`approval=${approval.id}`));
    assert.match(approvalText, /no inline diff/);
    assert.equal(approval.approvalFor?.candidate, candidate);
    // Same-key retry returns the receipt and sends nothing again.
    const again = await f.vote("carol", name, "approve", "carol approves", "v-carol");
    assert.equal(again.state, "succeeded");
    const principalInbox = () => inboxCount(f, "principal");
    assert.equal(principalInbox(), 1);
    assert.equal(f.stateOf(name).display, "principal-pending");
    // A third approval leaves the bound quorum alone.
    await f.vote("dave", name, "approve", "dave approves", "v-dave");
    assert.equal(principalInbox(), 1, "no second approval mail");
    // A reject by a bundled voter withdraws the approval.
    await f.vote("bob", name, "reject", "bob objects", "v-bob-reject");
    const withdrawn = messages(f, "bob", "v-bob-reject").find(m => m.review?.role === "withdrawn")!;
    assert.equal(withdrawn.review?.role === "withdrawn" ? withdrawn.review.approval : null, approval.id);
    assert.match(messageText(f.root, withdrawn.id), /rejected by bob/);
    assert.equal(f.stateOf(name).display, "blocked");
    // Re-approval emits a fresh approval id.
    await f.vote("bob", name, "approve", "bob approves again", "v-bob2");
    const approval2 = messages(f, "bob", "v-bob2").find(m => m.review?.role === "approval")!;
    assert.notEqual(approval2.id, approval.id);
    await assert.rejects(f.vote("principal", name, "approve", "yes", "p-stale", approval.id),
      (error: unknown) => (error as { code: string }).code === "APPROVAL_STALE" &&
        (error as { details?: { current?: string } }).details?.current === approval2.id);
    // While the request is still live: the Principal may only vote, and a
    // refresh is never a caller input.
    await assert.rejects(f.open("principal", { tier: "LOW", candidate }, "p-open"), { code: "CAPABILITY_DENIED" });
    await assert.rejects(f.review("principal", name), { code: "CAPABILITY_DENIED" });
    await assert.rejects(f.cancel("principal", name, "p-cancel"), { code: "CAPABILITY_DENIED" });
    await assert.rejects(f.reviews.record(f.auth("alice"), "ref", { kind: "refresh", name } as never),
      { code: "INVALID_REQUEST" });
    const pending = f.reviews.status(f.auth("bob"), name, 64 * 1024, "s5");
    assert.ok("entries" in pending); assert.equal(pending.display, "principal-pending");
    assert.equal(pending.principal.approval, approval2.id);
    assert.equal(pending.principal.sent, true); assert.equal(pending.principal.decision, null);
    const principalView = f.reviews.status(f.auth("principal"), name, 64 * 1024, "p2");
    assert.deepEqual(Object.keys(principalView).sort(),
      ["approval", "display", "identity", "kind", "name", "tier", "title"],
      "the Principal's view is the minimal shape");
    assert.ok(!("entries" in principalView) && !("requests" in principalView));
    assert.equal(principalView.approval, approval2.id);
    assert.equal(principalView.display, "principal-pending");
    // A second HIGH request on the same base: the Principal rejects it outright.
    await f.open("alice", { tier: "HIGH", candidate: otherCandidate }, "open-hi2");
    const name2 = f.requestName("open-hi2");
    await f.vote("bob", name2, "approve", "bob ok", "v2-bob");
    await f.vote("carol", name2, "approve", "carol ok", "v2-carol");
    const approval3 = messages(f, "carol", "v2-carol").find(m => m.review?.role === "approval")!;
    await f.vote("principal", name2, "reject", "no", "p-rej", approval3.id);
    assert.equal(f.stateOf(name2).terminal, "rejected");
    const rejected = f.reviews.status(f.auth("dave"), name2, 64 * 1024, "s6");
    assert.ok("entries" in rejected); assert.equal(rejected.display, "rejected");
    // The reject's own op withdrew the approval; the verdict is still the
    // latest Principal vote, and names the approval it decided.
    assert.equal(rejected.principal.approval, null);
    assert.equal(rejected.principal.sent, true);
    assert.equal(rejected.principal.decision, "reject");
    assert.equal(rejected.principal.decisionApproval, approval3.id);
    assert.equal(rejected.entries.at(-1)?.actor, "principal");
    assert.equal(rejected.entries.at(-1)?.verdict, "reject");
    await assert.rejects(f.vote("dave", name2, "approve", "late", "v2-dave"), { code: "REQUEST_CLOSED" });
    // A third HIGH request: only the requester cancels; a sent approval is withdrawn.
    await f.open("alice", { tier: "HIGH", candidate: thirdCandidate }, "open-hi3");
    const name3 = f.requestName("open-hi3");
    await f.vote("bob", name3, "approve", "ok", "v3-bob");
    await f.vote("carol", name3, "approve", "ok", "v3-carol");
    const approval4 = messages(f, "carol", "v3-carol").find(m => m.review?.role === "approval")!;
    await assert.rejects(f.cancel("bob", name3, "c-bob"), { code: "CAPABILITY_DENIED" });
    const cancelled = await f.cancel("alice", name3, "c-alice");
    assert.equal(cancelled.state, "succeeded");
    const withdrawn2 = messages(f, "alice", "c-alice").find(m => m.review?.role === "withdrawn")!;
    assert.equal(withdrawn2.review?.role === "withdrawn" ? withdrawn2.review.approval : null, approval4.id);
    assert.equal(f.stateOf(name3).terminal, "cancelled");
    await assert.rejects(f.vote("bob", name3, "approve", "late", "v3-late"), { code: "REQUEST_CLOSED" });
    const cancelledView = f.reviews.status(f.auth("dave"), name3, 64 * 1024, "s7");
    assert.ok("entries" in cancelledView); assert.equal(cancelledView.display, "cancelled");
    // The Principal's approve on the still-valid approval applies the request.
    const decided = await f.vote("principal", name, "approve", "the Principal approves", "p-ok", approval2.id);
    assert.equal(decided.state, "succeeded");
    const decision = messages(f, "principal", "p-ok").find(m => m.review?.role === "decision")!;
    assert.equal(decision.kind, "result"); assert.deepEqual(decision.to, ["principal"]);
    const thread = messages(f, "principal", "p-ok").find(m => m.review?.role === "thread")!;
    assert.match(messageText(f.root, thread.id), /principal approve:\nthe Principal approves/);
    const decidedState = f.stateOf(name);
    assert.equal(decidedState.display, "applied");
    assert.equal(decidedState.integration?.state, "succeeded");
    assert.equal(decidedState.principal?.actor, "principal");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
    // The completion notice names the approving Principal vote and approval id.
    const openOp = f.store.getOperation("alice", "open-hi")!;
    const applyOp = f.store.getOperation("alice", applyRequestKeyFor(openOp.id))!;
    assert.equal(applyOp.state, "succeeded");
    const notices = (applyOp.plan as { merge: { notice: MessagePlan[] } }).merge.notice;
    assert.equal(notices.length, 1);
    const noticeText = messageText(f.root, notices[0]!.id);
    assert.match(noticeText, /the Principal approves/);
    assert.match(noticeText, new RegExp(`approval ${approval2.id}`));
    assert.equal(existsSync(mailInboxPathAt(f.root, "principal", notices[0]!.id, "new")), true);
    const appliedStatus = f.reviews.status(f.auth("bob"), name, 64 * 1024, "s8");
    assert.ok("entries" in appliedStatus); assert.equal(appliedStatus.display, "applied");
    assert.equal(appliedStatus.integration?.operation, applyOp.id);
    const principalApplied = f.reviews.status(f.auth("principal"), name, 64 * 1024, "p3");
    assert.ok(!("entries" in principalApplied) && !("requests" in principalApplied));
    assert.equal(principalApplied.display, "applied");
    const ledger = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" });
    assert.equal(ledger.report.status, "PASS", JSON.stringify(ledger.report.issues));
    const integrity = inspectIntegrity(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" },
      { files: new NodeIntegrityFiles(), git: createCanonicalObserver() });
    assert.equal(integrity.status, "PASS", JSON.stringify(integrity.issues));
    // Reopen: the state is identical, durable-only.
    const remembered = f.stateOf(name);
    f.reopen();
    assert.deepEqual(f.stateOf(name), remembered);
  } finally { f.close(); }
});


test("mail-v1: an undelegated Principal cannot decide", async () => {
  const f = fixture({ principalDelegated: false }); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open-hi");
    const name = f.requestName("open-hi");
    await f.vote("bob", name, "approve", "ok", "v-bob");
    await f.vote("carol", name, "approve", "ok", "v-carol");
    const approval = messages(f, "carol", "v-carol").find(m => m.review?.role === "approval")!;
    await assert.rejects(f.vote("principal", name, "approve", "yes", "p-no", approval.id), { code: "CAPABILITY_DENIED" });
  } finally { f.close(); }
});

test("DR46 current grammar: removed attestation inputs are invalid and direct tiered integration refuses", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    const identity = { repo: "project", targetRef: "refs/heads/main", expectedBase: f.base, candidate,
      policyRevision: "p1" } as const;
    // I48: every removed legacy kind refuses UNSUPPORTED_PROFILE at fresh
    // acceptance, independent of which other config the society runs.
    for (const [key, input] of [
      ["k-peer", { kind: "peer", identity, verdict: "APPROVE", evidence: "x" }],
      ["k-decision", { kind: "decision", identity, verdict: "ACCEPT", evidence: "x" }],
      ["k-revoke", { kind: "revoke", attestation: "op-00000000-0000-4000-8000-000000000001", evidence: "x" }],
      ["k-challenge", { kind: "challenge", integration: "op-00000000-0000-4000-8000-000000000001", identity, evidence: "x" }],
      ["k-finding", { kind: "finding", challenge: "op-00000000-0000-4000-8000-000000000001", valid: true, floor: "HIGH", scope: "s", evidence: "x" }],
      ["k-scope", { kind: "scope", finding: "op-00000000-0000-4000-8000-000000000001", identity, applies: true, evidence: "x" }],
    ] as const)
      await assert.rejects(f.reviews.record(f.auth("alice"), key, input as never), { code: "INVALID_REQUEST" });
    await assert.rejects(f.module.integrate(f.auth("alice"), "direct", { candidate, expected: f.base, tier: "LOW" }),
      { code: "UNSUPPORTED_PROFILE" });
  } finally { f.close(); }
});

test("mail-v1: a LOW cancel owns no mail and closes the request", async () => {
  // The open's fact freezes revision p1; the policy read inside advance reports
  // p2, so the request is ready but unintegrated — a LOW cancel still works.
  let reads = 0;
  const f = fixture({ reader: policy => {
    reads += 1;
    return { ...policy, policyRevision: reads === 1 ? "p1" : "p2" };
  } });
  try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "LOW", candidate }, "open-low");
    const name = f.requestName("open-low");
    const openOp = f.store.getOperation("alice", "open-low")!;
    assert.equal(f.store.getOperation("alice", applyRequestKeyFor(openOp.id)), null,
      "a revision drift before apply leaves the request unintegrated");
    assert.equal(f.stateOf(name).display, "applying");
    const drifted = f.reviews.status(f.auth("bob"), name, 64 * 1024, "s10");
    assert.ok("entries" in drifted); assert.equal(drifted.display, "applying");
    assert.ok(drifted.missing.some(m => m.includes("host policy revision changed (now p2)")));
    const cancelled = await f.cancel("alice", name, "c-1");
    assert.equal(cancelled.state, "succeeded");
    assert.deepEqual(messages(f, "alice", "c-1"), []);
    assert.equal(f.stateOf(name).terminal, "cancelled");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base, "main never moved");
  } finally { f.close(); }
});

test("mail-v1: a frozen request names the host's current policy revision, not the broker's bound one", async () => {
  const moved = fixture({ reader: policy => ({ ...policy, policyRevision: "p2" }) });
  try {
    const candidate = moved.candidateWith({ "one.txt": "a" });
    await moved.submit("alice", candidate);
    await moved.open("alice", { tier: "LOW", candidate }, "open");
    const op = moved.store.getOperation("alice", "open")!;
    assert.equal(op.kind, "attest.record");
    const fact = (op.plan as { fact: { identity: { policyRevision: string } } }).fact;
    assert.equal(fact.identity.policyRevision, "p2", "the current revision, not the bound one");
  } finally { moved.close(); }
  const unreadable = fixture({ reader: () => { throw new Error("policy unreadable"); } });
  try {
    const candidate = unreadable.candidateWith({ "one.txt": "a" });
    await unreadable.submit("alice", candidate);
    await assert.rejects(unreadablereopen(unreadable, candidate), { code: "BROKER_UNAVAILABLE" });
    assert.equal(unreadable.store.getOperation("alice", "open"), null, "no operation accepted");
  } finally { unreadable.close(); }
  const drifted = fixture({ reader: policy => ({ ...policy, protectedPaths: ["elsewhere.txt"] }) });
  try {
    const candidate = drifted.candidateWith({ "one.txt": "a" });
    await drifted.submit("alice", candidate);
    await assert.rejects(drifted.open("alice", { tier: "LOW", candidate }, "open"), { code: "POLICY_CHANGED" });
    assert.equal(drifted.store.getOperation("alice", "open"), null, "no operation accepted");
  } finally { drifted.close(); }
});
const unreadablereopen = (f: ReturnType<typeof fixture>, candidate: string) =>
  f.open("alice", { tier: "LOW", candidate }, "open");

test("mail-v1: an over-bound thread revision anchors every omitted entry at the revision that added it", async () => {
  // Head ~500 bytes; entries ~200 bytes each vs ~50-byte anchors. 2000 trims
  // from rev ~7 on while the newest entries stay in full.
  const f = fixture({ mailBodyBytes: 2000 });
  try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    const keys: string[] = [];
    for (let i = 1; i <= 9; i++) {
      const key = `rev-${i}`;
      await f.review(i % 2 === 0 ? "carol" : "bob", name, key, `entry ${i} ${"x".repeat(180)}`);
      keys.push(key);
    }
    // The last revision carries per-entry anchors for the omitted prefix.
    const lastEntry = messages(f, "bob", "rev-9").find(m => m.review?.role === "thread")!;
    const lastBody = messageText(f.root, lastEntry.id);
    const anchors = [...lastBody.matchAll(/^\[(\d+)\] (m-[0-9a-f-]+)$/gm)];
    assert.ok(anchors.length >= 3, `expected several omitted entries, got ${anchors.length}`);
    assert.match(lastBody, /Earlier entries omitted for size; each is in full in the revision that added it:/);
    for (const anchor of anchors) {
      const ordinal = Number(anchor[1]);
      const owner = keys.map((key, index) =>
        messages(f, (index + 1) % 2 === 0 ? "carol" : "bob", key)).find(plan => plan.some(m => m.id === anchor[2]));
      assert.ok(owner !== undefined, `anchor [${ordinal}] names a real revision`);
      const revision = owner.find(m => m.id === anchor[2])!;
      const revisionBody = messageText(f.root, revision.id);
      // The revision that added entry j contains that entry in full.
      const entryActor = ordinal % 2 === 0 ? "carol" : "bob";
      assert.match(revisionBody, new RegExp(`\\[${ordinal}\\] ${entryActor} review:\\nentry ${ordinal}`),
        `revision ${revision.id} holds entry ${ordinal} in full`);
    }
  } finally { f.close(); }
});

const CHECK: NonNullable<FixtureOptions["checks"]>[number] = {
  id: "verify", argv: ["/usr/bin/true"], env: {},  };

test("mail-v1: a failed host check leaves the request blocked and unreapplied", async () => {
  const f = fixture({ checks: [CHECK],
    runCheck: () => { throw new StoreError("CHECK_FAILED", "the host check failed"); } });
  try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    await f.vote("bob", name, "approve", "ok", "v-bob");
    const apply = f.applyOp("alice", "open")!;
    assert.equal(apply.state, "failed"); assert.equal(apply.errorCode, "CHECK_FAILED");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base, "main never moved");
    const notice = (apply.plan as { merge: { notice: MessagePlan[] } }).merge.notice[0]!;
    assert.equal(existsSync(mailArchivePathAt(f.root, notice.id)), false, "a failed apply publishes nothing");
    const state = f.stateOf(name);
    assert.equal(state.display, "blocked"); assert.equal(state.integration?.errorCode, "CHECK_FAILED");
    const failedStatus = f.reviews.status(f.auth("bob"), name, 64 * 1024, "s9");
    assert.ok("entries" in failedStatus);
    assert.equal(failedStatus.display, "blocked");
    assert.deepEqual(failedStatus.integration, { operation: apply.id, state: "failed", error: "CHECK_FAILED" });
    // A sweep never retries a settled integration.
    await f.reviews.advanceAll();
    assert.equal(f.applyOp("alice", "open")!.state, "failed");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
  } finally { f.close(); }
});

test("mail-v1: a requester stopped before the CAS cancels the application", async () => {
  let release!: () => void; let checking = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture({ checks: [CHECK], runCheck: () => { checking = true; return gate; } });
  try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    // The approving vote's advance is in the apply path when the check blocks.
    const voting = f.vote("bob", name, "approve", "ok", "v-bob");
    while (!checking) await new Promise(resolve => setTimeout(resolve, 1));
    f.stop("alice", "stopped");
    release();
    const voted = await voting;
    assert.equal(voted.state, "succeeded", "the vote receipt is still the vote's own success");
    const apply = f.applyOp("alice", "open")!;
    assert.equal(apply.state, "failed"); assert.equal(apply.errorCode, "CANCELLED_BEFORE_COMMIT");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
    assert.equal(f.stateOf(name).display, "blocked");
  } finally { f.close(); }
});

test("mail-v1: cancelling a request with a pending integration wins the pre-CAS check", async () => {
  let failCheck = true;
  const f = fixture({ checks: [CHECK], runCheck: () => {
    if (failCheck) throw new StoreError("BROKER_UNAVAILABLE", "check runner down");
  } });
  try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    // The integration is accepted; its first execution attempt is left pending
    // by a transient check-runner failure.
    await f.vote("bob", name, "approve", "ok", "v-bob");
    const apply = f.applyOp("alice", "open")!;
    assert.equal(apply.state, "pending", "integration accepted but not executed");
    // A cancel now: the pending integration cannot CAS past it.
    failCheck = false;
    const cancelled = await f.cancel("alice", name, "c-1");
    assert.equal(cancelled.state, "succeeded");
    assert.equal(f.stateOf(name).terminal, "cancelled");
    await assert.rejects(f.module.reconcile(apply.id), { code: "CANCELLED_BEFORE_COMMIT" });
    assert.equal(f.store.getOperationById(apply.id)!.state, "failed");
    assert.equal(f.store.getOperationById(apply.id)!.errorCode, "CANCELLED_BEFORE_COMMIT");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
  } finally { f.close(); }
});

test("mail-v1: a running check permits context publication and is stopped by an accepted cancel", async () => {
  let release!: () => void; let checking = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture({ checks: [CHECK], runCheck: (_candidate, _check, cancellation) => {
    checking = true; cancellation!.addEventListener("abort", release, { once: true }); return gate;
  } });
  try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    const voting = f.vote("bob", name, "approve", "ok", "v-bob");
    while (!checking) await new Promise(resolve => setTimeout(resolve, 1));
    const body = Buffer.from("updated goal\n"), sha256 = sha256Hex(body);
    const context = await f.module.publishContext(f.auth("principal"), "goal-during-check", {
      expected: null, entries: [{ path: "GOAL.md", bytes: body.length, sha256 }],
      content: { bytes: body.length, sha256, mediaType: "application/vnd.oma.context-v1" },
    }, (async function* () { yield body; })());
    assert.equal(context.state, "succeeded");
    await assert.rejects(f.reviews.advanceAll(), { code: "BROKER_UNAVAILABLE" });
    assert.equal((await f.cancel("alice", name)).state, "succeeded");
    await voting;
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base, "cancel prevented the merge");
    assert.equal(f.stateOf(name).terminal, "cancelled");
    assert.equal(f.applyOp("alice", "open")!.errorCode, "CANCELLED_BEFORE_COMMIT");
    await f.reviews.advanceAll();
  } finally { release(); f.close(); }
});

test("DR45: review history is decoded once per waiting/terminal sweep and status list", async () => {
  const f = fixture();
  try {
    const candidate = f.candidateWith({ "history.txt": "one" });
    await f.submit("alice", candidate);
    for (let i = 0; i < 8; i++) {
      await f.open("alice", { tier: "MEDIUM", candidate }, `history-${i}`);
      await f.cancel("alice", f.requestName(`history-${i}`), `cancel-${i}`);
    }
    for (let i = 0; i < 4; i++) {
      const waiting = f.candidateWith({ "waiting.txt": `${i}` });
      await f.submit("alice", waiting, `submit-wait-${i}`);
      await f.open("alice", { tier: "MEDIUM", candidate: waiting }, `wait-${i}`);
    }
    const original = f.store.attestationFacts.bind(f.store); let reads = 0;
    f.store.attestationFacts = () => { reads += 1; return original(); };
    await f.reviews.advanceAll();
    assert.equal(reads, 1, "waiting and completed requests must not each rescan history");
    reads = 0;
    const status = f.reviews.status(f.auth("bob"), undefined, 64 * 1024, "history");
    assert.ok("requests" in status); assert.equal(status.requests.length, 12);
    assert.equal(reads, 1);
  } finally { f.close(); }
});

test("DR45: accepted cancel interrupts checks even when its preparation cleanup fails", { timeout: 10_000 }, async () => {
  let release!: () => void, entered!: () => void, aborted = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const checking = new Promise<void>(resolve => { entered = resolve; });
  const f = fixture({ checks: [CHECK], runCheck: (_candidate, _check, signal) => {
    signal!.addEventListener("abort", () => { aborted = true; release(); }, { once: true }); entered(); return gate;
  } });
  const settle = PreacceptScope.prototype.settle;
  let voting: Promise<unknown> | undefined;
  try {
    const candidate = f.candidateWith({ "cancel-cleanup.txt": "pending" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open-cleanup");
    const name = f.requestName("open-cleanup");
    voting = f.vote("bob", name, "approve", "checked", "vote-cleanup");
    await checking;
    PreacceptScope.prototype.settle = function () {
      const result = settle.call(this);
      if (f.store.getOperation("alice", "cancel-cleanup") !== null)
        throw new StoreError("BROKER_UNAVAILABLE", "injected cleanup failure");
      return result;
    };
    await assert.rejects(f.cancel("alice", name, "cancel-cleanup"), /cleanup failure/);
    assert.equal(aborted, true);
    await voting;
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
    assert.equal(f.stateOf(name).terminal, "cancelled");
  } finally { PreacceptScope.prototype.settle = settle; release(); await voting; f.close(); }
});

test("mail-v1: only the first ready request on a base applies; the other goes stale by refresh", async () => {
  const f = fixture(); try {
    const one = f.candidateWith({ "one.txt": "a" });
    const two = f.candidateWith({ "two.txt": "b" });
    await f.submit("alice", one); await f.submit("alice", two, "submit-two");
    await f.open("alice", { tier: "MEDIUM", candidate: one }, "open-1");
    await f.open("alice", { tier: "MEDIUM", candidate: two }, "open-2");
    const name1 = f.requestName("open-1");
    const name2 = f.requestName("open-2");
    await f.vote("bob", name1, "approve", "ok", "v1");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), one, "first applied");
    // Voting on the second request is accepted, then advance marks it stale.
    await f.vote("carol", name2, "approve", "ok", "v2");
    const state2 = f.stateOf(name2);
    assert.equal(state2.terminal, "stale"); assert.equal(state2.display, "stale");
    const refresh = state2.entries.at(-1)!;
    assert.equal(refresh.fact.kind, "refresh");
    assert.equal(refresh.fact.kind === "refresh" ? refresh.fact.main : null, one);
    const open2 = f.store.getOperation("alice", "open-2")!;
    assert.equal(f.store.getOperation("alice", applyRequestKeyFor(open2.id)), null, "no second integration");
    const refreshOp = refresh.operation;
    const thread = (f.store.getOperationById(refreshOp)!.plan as { messages: MessagePlan[] }).messages
      .find(m => m.review?.role === "thread")!;
    assert.match(messageText(f.root, thread.id), new RegExp(`main moved to ${one}`));
    assert.match(messageText(f.root, thread.id), /this request is stale/);
    await assert.rejects(f.vote("dave", name2, "approve", "late", "v-late"), { code: "REQUEST_CLOSED" });
    const stale = f.reviews.status(f.auth("bob"), name2, 64 * 1024, "s11");
    assert.ok("entries" in stale); assert.equal(stale.display, "stale");
    assert.equal(stale.entries.at(-1)?.kind, "refresh");
    assert.equal(stale.main.oid, one);
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), one, "main unchanged by the second");
  } finally { f.close(); }
});

test("mail-v1: a bound reviewer's retirement withdraws and re-asks the approval", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open");
    const name = f.requestName("open");
    await f.vote("bob", name, "approve", "bob ok", "v-bob");
    await f.vote("carol", name, "approve", "carol ok", "v-carol");
    await f.vote("dave", name, "approve", "dave ok", "v-dave");
    const first = messages(f, "carol", "v-carol").find(m => m.review?.role === "approval")!;
    const principalBefore = inboxCount(f, "principal");
    // Retire a bundled voter: the approval is invalid only through eligibility.
    f.stop("bob", "retired");
    await f.reviews.advanceAll();
    const state = f.stateOf(name);
    const refresh = state.entries.at(-1)!;
    assert.equal(refresh.fact.kind, "refresh");
    assert.equal(refresh.fact.kind === "refresh" ? refresh.fact.main : "?", null);
    const owned = (f.store.getOperationById(refresh.operation)!.plan as { messages: MessagePlan[] }).messages;
    const withdrawn = owned.find(m => m.review?.role === "withdrawn")!;
    assert.equal(withdrawn.review?.role === "withdrawn" ? withdrawn.review.approval : null, first.id);
    assert.equal(existsSync(mailInboxPathAt(f.root, "principal", withdrawn.id, "new")), true);
    // Quorum still holds with other votes: a new approval request was sent.
    const again = owned.find(m => m.review?.role === "approval")!;
    assert.notEqual(again.id, first.id);
    assert.deepEqual(again.review?.role === "approval" ? [...again.review.votes] : [],
      [f.store.getOperation("carol", "v-carol")!.id, f.store.getOperation("dave", "v-dave")!.id]);
    assert.equal(inboxCount(f, "principal"), principalBefore + 2, "withdrawn + new approval");
    assert.equal(f.stateOf(name).display, "principal-pending");
  } finally { f.close(); }
});

test("mail-v1: a large completion notice is split into parts that reassemble exactly", async () => {
  const f = fixture({ mailBodyBytes: 6 * 1024 });
  try {
    const big = Array.from({ length: 80 }, (_, i) => `line ${i} ${"x".repeat(50)}`).join("\n");
    const binary = `hdr${String.fromCharCode(0)}${"".repeat(4000)}`;
    const candidate = f.candidateWith({ "big.txt": big, "bin.dat": binary });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "LOW", candidate, reason: "bulk import" }, "open");
    const name = f.requestName("open");
    assert.equal(f.stateOf(name).display, "applied");
    const apply = f.applyOp("alice", "open")!;
    const notices = (apply.plan as { merge: { notice: MessagePlan[] } }).merge.notice;
    assert.ok(notices.length > 1, `expected multiple parts, got ${notices.length}`);
    const chunks: Buffer[] = [];
    let meta: { part: number; parts: number; sha256: string; bytes: number } | null = null;
    for (const [index, part] of notices.entries()) {
      assert.equal(part.review?.role === "notice" ? part.review.part : 0, index + 1);
      assert.equal(part.review?.role === "notice" ? part.review.parts : 0, notices.length);
      meta = part.review && part.review.role === "notice" ? part.review : meta;
      const text = messageText(f.root, part.id);
      const body = text.slice(text.indexOf("\r\n\r\n") + 4);   // decoded body, headers stripped
      const headerEnd = body.indexOf("\n");
      chunks.push(Buffer.from(body.slice(headerEnd + 1), "utf8"));
      // Every part reaches the Principal.
      assert.equal(existsSync(mailInboxPathAt(f.root, "principal", part.id, "new")), true);
      assert.match(body, new RegExp(`^Part ${index + 1}/${notices.length} of the ${name} completion notice`));
    }
    const document = Buffer.concat(chunks).toString("utf8");
    assert.equal(sha256Hex(document), meta!.sha256, "parts reassemble to the digest");
    assert.equal(Buffer.byteLength(document, "utf8"), meta!.bytes);
    assert.match(document, /OMA merge applied:/);
    assert.match(document, /GIT binary patch/, "the binary file survived in the diff");
    const ledger = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" });
    assert.equal(ledger.report.status, "PASS", JSON.stringify(ledger.report.issues));
    const integrity = inspectIntegrity(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" },
      { files: new NodeIntegrityFiles(), git: createCanonicalObserver() });
    assert.equal(integrity.status, "PASS", JSON.stringify(integrity.issues));
  } finally { f.close(); }
});

test("mail-v1: an oversize completion notice is remembered and never recomputed", async () => {
  // A real review module shares the fixture's store; its mergeDiff is counted.
  const f = fixture({ bundleBytes: 128 });
  try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    let diffs = 0;
    const counting = new ReviewModule(reviewLedger(f.store), f.mail, {
      ...reviewRuntime(),
      policy: () => snapshotIntegrationPolicy(f.policy),
      currentPolicy: () => snapshotIntegrationPolicy(f.policy),
      verifyObjectFormat: () => {},
      main: () => createCanonicalObserver().ref(f.projectGit, "refs/heads/main"),
      published: () => createCanonicalObserver().published(f.projectGit),
      ancestry: (b, c) => createCanonicalObserver().ancestry(f.projectGit, b, c),
      changedPaths: (b, c) => createCanonicalObserver().changedPaths(f.projectGit, b, c),
      gitlinks: c => createCanonicalObserver().gitlinks(f.projectGit, c),
      submitters: () => [],
      mergeDiff: (b, c, n) => { diffs++; return Buffer.from(`diff-${b}-${c}-${"x".repeat(200)}`, "utf8"); },
      applyMerge: () => Promise.resolve(),
      prepareRevert: () => { throw new StoreError("REF_STATE_UNKNOWN", "no revert in this fixture"); },
      publishCandidateRef: () => {},
      withWriter: work => work(),
    }, { mailBodyBytes: 256 * 1024, subjectBytes: 512, bundleBytes: 128 }, "demo");
    const openReceipt = await counting.record(f.auth("alice"), "open", {
      kind: "merge.open", title: "t", reason: "r", tier: "LOW", candidate, base: f.base });
    assert.equal(openReceipt.state, "succeeded");
    // The fixture module and counting module saw the same open: oversize means
    // no integration exists and the diff ran exactly once across all sweeps.
    const openOp = f.store.getOperation("alice", "open")!;
    assert.equal(f.store.getOperation("alice", applyRequestKeyFor(openOp.id)), null);
    const before = diffs;
    assert.ok(before >= 1, "the diff ran once");
    await counting.advanceAll();
    await counting.advanceAll();
    assert.equal(diffs, before, "an oversize notice is never recomputed");
    assert.equal(f.stateOf(f.requestName("open")).display, "applying", "the request stays ready");
    const oversized = counting.status(f.auth("bob"), f.requestName("open"), 64 * 1024, "s12");
    assert.ok("entries" in oversized);
    assert.ok(oversized.missing.some(m => m.includes("completion notice exceeds the document bound")));
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
  } finally { f.close(); }
});

test("mail-v1: a skipped advance and a lost application are both recovered once", async () => {
  // Seam 1: the host policy is unreadable during the vote's advance, so no
  // integration is created; reopen + advanceAll applies exactly once.
  let unreadable = true; let policyReads = 0;
  const f = fixture({ reader: policy => {
    policyReads += 1;
    if (unreadable && policyReads > 1) throw new Error("policy unreadable");
    return policy;
  } });
  try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "LOW", candidate }, "open");
    assert.equal(f.applyOp("alice", "open"), null, "no integration while the policy is unreadable");
    unreadable = false;
    f.reopen();
    await f.reviews.advanceAll();
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate, "applied once after recovery");
    const applied = f.applyOp("alice", "open")!;
    assert.equal(applied.state, "succeeded");
    await f.reviews.advanceAll();
    assert.equal(f.applyOp("alice", "open")!.id, applied.id, "no second integration");
  } finally { f.close(); }

  // Seam 2: publication fails after the CAS; reconcile publishes the same
  // frozen notice ids without a second compareAndSwap (a re-CAS against
  // expected=base would error — main is already the candidate).
  let publishFails = true;
  const g = fixture();
  try {
    const original = g.mail.publishGated.bind(g.mail);
    g.mail.publishGated = async (operationId: string, proof: Parameters<MailModule["publishGated"]>[1]) => {
      // Only the integration's gated publication fails; submissions publish fine.
      if (publishFails && g.store.getOperationById(operationId)?.kind === "git.integrate")
        throw new StoreError("BROKER_UNAVAILABLE", "mail sink down");
      await original(operationId, proof);
    };
    const candidate = g.candidateWith({ "one.txt": "a" });
    await g.submit("alice", candidate);
    await g.open("alice", { tier: "LOW", candidate }, "open");
    const apply = g.applyOp("alice", "open")!;
    assert.equal(apply.state, "pending", "CAS done, result not committed");
    assert.equal(g.git(["rev-parse", "refs/heads/main"]), candidate, "main moved before the crash");
    publishFails = false;
    g.reopen();
    await g.module.reconcile(apply.id);
    const settled = g.store.getOperationById(apply.id)!;
    assert.equal(settled.state, "succeeded");
    const notices = (apply.plan as { merge: { notice: MessagePlan[] } }).merge.notice;
    for (const part of notices)
      assert.equal(existsSync(mailArchivePathAt(g.root, part.id)), true,
        "the same frozen notice ids were published");
  } finally { g.close(); }

  // Seam 3: the first execution attempt dies inside the post-T effects; reopen
  // + reconcile applies exactly once.
  let dead = true;
  const h = fixture({ checks: [CHECK], runCheck: () => {
    if (dead) throw new StoreError("BROKER_UNAVAILABLE", "died before CAS");
  } });
  try {
    const candidate = h.candidateWith({ "one.txt": "a" });
    await h.submit("alice", candidate);
    await h.open("alice", { tier: "LOW", candidate }, "open");
    const apply = h.applyOp("alice", "open")!;
    assert.equal(apply.state, "pending");
    dead = false;
    h.reopen();
    await h.module.reconcile(apply.id);
    assert.equal(h.store.getOperationById(apply.id)!.state, "succeeded");
    assert.equal(h.git(["rev-parse", "refs/heads/main"]), candidate);
    await h.module.reconcile(apply.id);
    await h.reviews.advanceAll();
    assert.equal(h.applyOp("alice", "open")!.id, apply.id);
  } finally { h.close(); }
});

test("mail-v1: review.status lists newest first and counts what the frame cannot carry", async () => {
  const f = fixture(); try {
    // Three open requests on three bases is impossible once one applies; keep
    // them all unapplied (MEDIUM with no votes).
    const c1 = f.candidateWith({ "a.txt": "a" }); await f.submit("alice", c1, "s1");
    const c2 = f.candidateWith({ "b.txt": "b" }); await f.submit("alice", c2, "s2");
    const c3 = f.candidateWith({ "c.txt": "c" }); await f.submit("alice", c3, "s3");
    await f.open("alice", { tier: "MEDIUM", candidate: c1, title: "first" }, "open-1");
    await f.open("alice", { tier: "MEDIUM", candidate: c2, title: "second" }, "open-2");
    await f.open("alice", { tier: "MEDIUM", candidate: c3, title: "third" }, "open-3");
    const names = ["open-1", "open-2", "open-3"].map(key => f.requestName(key));
    const list = f.reviews.status(f.auth("bob"), undefined, 64 * 1024, "l1");
    assert.ok("requests" in list);
    assert.deepEqual(list.requests.map(r => r.name), [names[2], names[1], names[0]], "newest first");
    assert.deepEqual(list.requests.map(r => r.title), ["third", "second", "first"]);
    assert.equal(list.omitted, 0);
    assert.equal(list.main.oid, f.base);
    assert.equal(list.requests[0]!.kind, "merge"); assert.equal(list.requests[0]!.requester, "alice");
    // A smaller frame keeps only as many as fit; the rest are counted, not dropped.
    const fullBytes = Buffer.byteLength(JSON.stringify({ v: 1, id: "l1", ok: true, result: list }));
    const bounded = f.reviews.status(f.auth("bob"), undefined, fullBytes - 180, "l2");
    assert.ok("requests" in bounded);
    assert.ok(bounded.requests.length < 3 && bounded.requests.length >= 1,
      `expected a partial list at ${fullBytes - 180} bytes, got ${bounded.requests.length}`);
    assert.equal(bounded.omitted, 3 - bounded.requests.length);
    assert.equal(bounded.requests[0]!.name, names[2]);
    // A frame too small for anything still answers honestly.
    const empty = f.reviews.status(f.auth("bob"), undefined, 120, "l3");
    assert.ok("requests" in empty);
    assert.equal(empty.requests.length, 0); assert.equal(empty.omitted, 3);
  } finally { f.close(); }
});

test("mail-v1/AV-20261003-24: a request detail keeps the newest entries inside the frame and reports the rest", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate, reason: "bounded detail" }, "open-bounded");
    const name = f.requestName("open-bounded");
    const actors = ["alice", "bob", "carol", "dave"];
    for (let i = 0; i < 40; i++) await f.review(actors[i % actors.length]!, name);
    const full = f.reviews.status(f.auth("bob"), name, 64 * 1024, "d0");
    assert.ok("entries" in full);
    assert.equal(full.entries.length, 40);
    const fullBytes = Buffer.byteLength(JSON.stringify({ v: 1, id: "d0", ok: true, result: full }));
    const budget = Math.floor(fullBytes / 2);
    const bounded = f.reviews.status(f.auth("bob"), name, budget, "d1");
    assert.ok("entries" in bounded);
    const wire = Buffer.byteLength(JSON.stringify({ v: 1, id: "d1", ok: true, result: bounded }));
    assert.ok(wire <= budget, `a ${wire}-byte detail answers inside the ${budget}-byte frame`);
    assert.ok(bounded.entries.length > 0 && bounded.entries.length < full.entries.length,
      `expected a partial entry list at ${budget} bytes, got ${bounded.entries.length}`);
    // The newest tail survives; the dropped prefix is reported, never hidden.
    assert.deepEqual(bounded.entries.map(entry => entry.index),
      Array.from({ length: bounded.entries.length }, (_, index) => full.entries.length - bounded.entries.length + index + 1));
    const omitted = full.entries.length - bounded.entries.length;
    assert.equal(bounded.missing.at(-1), `${omitted} earlier ${omitted === 1 ? "entry" : "entries"} omitted for size`);
    assert.deepEqual(bounded.missing.slice(0, -1), full.missing);
    // The bounded answer still decodes as the Worker detail variant.
    assert.equal(decodeRpcReply("review.status", { v: 1, id: "d1", ok: true, result: bounded }, "d1", { name }).ok, true);
    // A frame that cannot hold even the empty detail is refused honestly,
    // never delivered as an oversized success.
    assert.throws(() => f.reviews.status(f.auth("bob"), name, 200, "d2"), { code: "FRAME_TOO_LARGE" });
  } finally { f.close(); }
});

test("mail-v1: review.status reports an unobservable main as null", async () => {
  const f = fixture(); try {
    rmSync(f.projectGit, { recursive: true, force: true });
    const status = f.reviews.status(f.auth("bob"), undefined, 64 * 1024, "m1");
    assert.ok("requests" in status);
    assert.equal(status.main.oid, null);
    assert.equal(typeof status.main.observedAtMs, "number");
  } finally { f.close(); }
});

test("mail-v1: the review.status wire method filters the Principal and rejects bad params", async () => {
  const f = fixture(); try {
    const unused = (): never => { throw new Error("unexpected fixture effect"); };
    const dispatcher = new PublicDispatcher({
      store: { listAgents: () => f.store.listAgents(), getAgent: actor => f.store.getAgent(actor),
        getReceipt: () => null, hasOperation: () => false },
      mail: { send: async () => unused() },
      units: { statusSnapshot: unused }, views: { status: unused },
      lifecycle: { create: async () => unused(), start: unused, stop: unused, ack: unused, follow: unused },
      review: f.reviews,
      git: {
        knownRefs: unused, isPublished: () => false,
        submit: async () => unused(), integrate: async () => unused(), publishContext: async () => unused() },
      limits: { frameBytes: 64 * 1024, mailBodyBytes: 256 * 1024, subjectBytes: 512, addresses: 64,
        replyReferences: 64, contextFiles: 256, contextBytes: 8 * 1024 * 1024, bundleBytes: 256 * 1024 * 1024,
        logBytes: 1024 * 1024, batchMaxMessages: 24, idleStreamSeconds: 60, receiptWaitSeconds: 60 },
      waitRun: unused, isDraining: () => false, assertAdmission() {},
       refreshViews() {},
      readLogs: async () => unused(),
      failureAnswer: (id: string, error: unknown) => ({ v: 1, id, ok: false, error: {
        code: (error as { code?: string }).code ?? "INTERNAL_ERROR",
        message: (error as { message?: string }).message ?? "error", retry: "never" } }),
    });
    const call = (actor: "bob" | "principal", params: object, extra: object = {}) =>
      dispatcher.dispatch(f.auth(actor),
        { v: 1, id: "wire-1", method: "review.status", params, ...extra } as never, null);
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open");
    const name = f.requestName("open");
    // Worker named + list.
    const named = await call("bob", { name }) as { ok: boolean; result: { display?: string } };
    assert.equal(named.ok, true); assert.equal(named.result.display, "peer-needed");
    const listed = await call("bob", {}) as { ok: boolean; result: { requests?: { name: string }[] } };
    assert.equal(listed.ok, true); assert.equal(listed.result.requests?.[0]?.name, name);
    // Principal: hidden before the approval mail, visible after, minimal shape.
    const hidden = await call("principal", { name }) as { ok: boolean; error: { code: string; message: string } };
    assert.equal(hidden.ok, false); assert.equal(hidden.error.code, "CAPABILITY_DENIED");
    const hiddenMessage = hidden.error.message;
    await f.vote("bob", name, "approve", "ok", "v-bob");
    await f.vote("carol", name, "approve", "ok", "v-carol");
    const visible = await call("principal", { name }) as { ok: boolean; result: Record<string, unknown> };
    assert.equal(visible.ok, true);
    assert.deepEqual(Object.keys(visible.result).sort(),
      ["approval", "display", "identity", "kind", "name", "tier", "title"]);
    assert.equal(visible.result.display, "principal-pending");
    assert.equal(typeof visible.result.approval, "string");
    // Principal with an unknown name gets the same refusal as a hidden one.
    const unknown = await call("principal", { name: "merge-00000000-0000-4000-8000-000000000000" }) as { ok: boolean; error: { message: string } };
    assert.equal(unknown.ok, false); assert.match(unknown.error.message, /^no request .* is visible to the Principal$/);
    assert.notEqual(unknown.error.message, hiddenMessage, "the name is echoed; the refusal shape is identical");
    // Principal with no name is refused outright.
    assert.equal((await call("principal", {}) as { ok: boolean }).ok, false);
    // Params are closed: a bad name fails the check, a request key is forbidden.
    assert.equal((await call("bob", { name: "not a name" }) as { error: { code: string } }).error.code, "INVALID_REQUEST");
    assert.equal((await call("bob", {}, { request: "key-1" }) as { error: { code: string } }).error.code, "INVALID_REQUEST");
    // The response decodes through the closed result codec.
    const reply = await call("bob", { name });
    const decoded = decodeRpcReply("review.status", reply, "wire-1", { name });
    assert.ok(decoded.ok);
    // Raw attest.record by the Principal (the tools are only a schema): open,
    // review, cancel and a vote that names no approval are all refused -- the
    // module is the authority, not the registered tool.
    const attest = (params: Record<string, unknown>) => dispatcher.dispatch(f.auth("principal"),
      { v: 1, id: "wire-p", method: "attest.record", request: `wire-p-${JSON.stringify(params).length}`, params } as never, null);
    for (const params of [
      { kind: "merge.open", tier: "HIGH", title: "bypass", reason: "r", candidate, base: f.base },
      { kind: "review", name, body: "b" },
      { kind: "cancel", name, reason: "r" },
      { kind: "vote", name, verdict: "approve", body: "b" },
      { kind: "vote", name, verdict: "approve", body: "b", approval: "m-00000000-0000-4000-8000-000000000001-0" },
    ]) {
      const answer = await attest(params) as { ok: boolean; error: { code: string; message: string } };
      assert.equal(answer.ok, false, JSON.stringify(answer));
      assert.match(answer.error.code, /CAPABILITY_DENIED|INVALID_REQUEST|APPROVAL_STALE/, answer.error.message);
    }
  } finally { f.close(); }
});

test("mail-v1: authority comes from authenticated facts — mail text and git authorship are not votes", async () => {
  const f = fixture(); try {
    // The candidate's commit claims bob as its author, but alice is the
    // authenticated submitter: submitters come from git.submit records,
    // never from Git author fields.
    const blob = f.git(["hash-object", "-w", "--stdin"], "spoofed authorship\n");
    const tree = f.git(["mktree"], `100644 blob ${blob}\tspoof.txt\n`);
    const forged = runGitText(["commit-tree", tree, "-p", f.base, "-m", "authored as bob"],
      { gitDir: f.projectGit, env: { GIT_AUTHOR_NAME: "bob", GIT_AUTHOR_EMAIL: "bob@demo.oma.invalid",
        GIT_COMMITTER_NAME: "mallory", GIT_COMMITTER_EMAIL: "mallory@elsewhere.invalid" } });
    assert.equal(forged.status, 0, forged.stderr);
    const candidate = forged.stdout.trim();
    await f.submit("alice", candidate, "submit-spoofed");
    const opened = await f.open("alice", { tier: "MEDIUM", candidate }, "open-spoofed");
    assert.equal(opened.state, "succeeded");
    const name = f.requestName("open-spoofed");
    const state = f.stateOf(name);
    assert.deepEqual(state.authors, ["alice"], "the authenticated submitter owns the request");
    // alice cannot approve what she submitted, even though the commit names bob.
    await assert.rejects(f.vote("alice", name, "approve", "mine", "v-self"), { code: "SELF_REVIEW" });
    await f.vote("bob", name, "approve", "bob approves", "v-bob");
    assert.equal(f.stateOf(name).display, "applied", "bob's approve applies alice's request");

    // Mail text is never a vote: two Workers mailing "approve" move nothing.
    const mainNow = f.git(["rev-parse", "refs/heads/main"]);
    const candidate2 = f.candidateWith({ "mail.txt": "mail says approve\n" }, mainNow);
    await f.submit("alice", candidate2, "submit-mail");
    await f.open("alice", { tier: "HIGH", candidate: candidate2, base: mainNow }, "open-mail");
    const name2 = f.requestName("open-mail");
    for (const [actor, key] of [["bob", "mail-bob"], ["carol", "mail-carol"]] as const)
      await f.mail.send(f.auth(actor), key, { to: ["residents"], subject: `[${name2}] I approve`,
        kind: "message", body: "approve — looks good to me" });
    const after = f.stateOf(name2);
    assert.equal(after.display, "peer-needed", "mail text approving changed nothing");
    assert.deepEqual(after.approvers, []);
    assert.equal(after.approval, null, "no approval mail was emitted");
    const inboxDir = join(f.root, "mail", "inboxes", "principal", "new");
    const principalMails = (existsSync(inboxDir) ? readdirSync(inboxDir) : [])
      .map(file => readFileSync(join(inboxDir, file), "utf8"));
    assert.equal(principalMails.filter(eml => /X-Oma-Kind: approval_required/i.test(eml)).length, 0,
      "no approval was ever sent to the Principal");
  } finally { f.close(); }
});
