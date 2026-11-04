/** Fresh, effect-level Client tests. Not provider/peer-auth or whole-broker crash proof. */
import test from "node:test";
import assert from "node:assert/strict";
import { ClientError } from "@oma/client/errors";
import { collaborationClient } from "./fixtures/collaboration-client.js";

function refused(error: unknown): boolean {
  assert.ok(error instanceof ClientError);
  assert.match(error.message, /STALE_TARGET|APPROVAL_STALE|SOURCE_UNREADABLE|CAPABILITY_DENIED|WRONG_TARGET_KIND|INVALID_REQUEST/u);
  return true;
}

test("001. Client: unrelated peer activity preserves the exact target; newer own verdict fences the old verdict and vote withdrawal", async t => {
  const h = await collaborationClient(t), { f } = h;
  const candidate = f.candidateWith({ "decision.txt": "review the exact committed source\n" });
  await f.submit("alice", candidate); await f.open("alice", { tier: "HIGH", candidate }, "open");
  const request = f.store.getOperation("alice", "open")!.id, name = f.requestName("open");
  const first = h.target("bob", request, "review");
  await f.vote("dave", name, "reject", "independent unrelated findings", "dave-reject");
  const approved = await h.call("bob", "oma_review", { target: first, decision: "approve", reason: "Reviewed original source" }).invoke();
  assert.notEqual(approved.disposition, "existing");
  if (approved.disposition === "existing") assert.fail("a verdict needs its own receipt");
  assert.equal(approved.receipt.state, "succeeded");
  const vote = f.store.getOperationById(approved.receipt.operation);
  assert.ok(vote?.kind === "attest.record" && vote.plan.fact.kind === "vote");
  assert.equal(vote.plan.fact.verdict, "approve"); assert.equal(vote.plan.fact.request, request);
  const oldVote = h.target("bob", request, "vote"), count = f.store.acceptedOperationPage().items.length;
  await assert.rejects(h.call("bob", "oma_review", { target: first, decision: "reject", reason: "Stale own-vote expectation" }).invoke(), refused);
  assert.equal(f.store.acceptedOperationPage().items.length, count);
  const latest = h.target("bob", request, "review");
  const rejected = await h.call("bob", "oma_review", { target: latest, decision: "reject", reason: "Newer exact findings" }).invoke();
  if (rejected.disposition === "existing") assert.fail("new verdict must be append-only");
  assert.notEqual(rejected.receipt.operation, approved.receipt.operation);
  await assert.rejects(h.call("bob", "oma_review", { target: oldVote, decision: "withdraw", reason: "Do not silently retract a later verdict" }).invoke(), refused);
  const newestVote = h.target("bob", request, "vote");
  const withdrawn = await h.call("bob", "oma_review", { target: newestVote, decision: "withdraw", reason: "Retract only the latest owned vote" }).invoke();
  if (withdrawn.disposition === "existing") assert.fail("withdrawal has its own accepted fact");
  const control = f.store.getOperationById(withdrawn.receipt.operation);
  assert.ok(control?.kind === "attest.record" && control.plan.fact.kind === "review.withdraw");
  assert.equal(control.plan.fact.vote, rejected.receipt.operation);
  assert.deepEqual(f.store.getOperationById(vote.id), vote, "withdrawal never rewrites the earlier approval fact");
  const status = await h.call("bob", "oma_review", { target: newestVote, decision: "withdraw", reason: "No duplicate withdrawal of a stale target" }).invoke().then(() => "accepted", refused);
  assert.notEqual(status, "accepted");
  assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base, "HIGH lacks quorum; neither an old nor withdrawn approval applies it");
});

test("002. Client: omitted existing change never reads HEAD; revision invalidates old decisions and terminal cancellation cannot reopen", async t => {
  const h = await collaborationClient(t), { f } = h;
  const candidate = f.candidateWith({ "source.txt": "first exact revision\n" });
  await f.submit("alice", candidate); await f.open("alice", { tier: "HIGH", candidate }, "open");
  const request = f.store.getOperation("alice", "open")!.id;
  const proposal = h.target("alice", request, "proposal"), staleDecision = h.target("bob", request, "review");
  const before = f.store.acceptedOperationPage().items;
  const existing = await h.call("alice", "oma_merge", { proposal, reason: "Observe the original without a caller repository", tier: "HIGH" }).invoke();
  assert.equal(existing.disposition, "existing");
  assert.deepEqual(f.store.acceptedOperationPage().items, before, "existing resolution creates no attestation or attempt");
  for (const [patch, message] of [[{ tier: "LOW" }, "resubmission must supply its recorded tier"],
    [{ tier: "HIGH", title: "Not the original title" }, "resubmission cannot change the original title"]] as const)
    await assert.rejects(h.call("alice", "oma_merge", { proposal, reason: "Cannot revise only metadata", ...patch }).invoke(), error => {
      assert.ok(error instanceof ClientError); assert.equal(error.message, message); return true;
    });
  const revisedCandidate = f.candidateWith({ "source.txt": "second exact revision\n" });
  await f.submit("alice", revisedCandidate, "submit-revision");
  const revised = await h.call("alice", "oma_merge", { proposal, reason: "Replace the source with an explicit committed revision", tier: "HIGH",
    change: { candidate: revisedCandidate, base: f.base } }).invoke();
  if (revised.disposition === "existing") assert.fail("changed source must append a revision");
  const revision = f.store.getOperationById(revised.receipt.operation);
  assert.ok(revision?.kind === "attest.record" && revision.plan.fact.kind === "review.revise");
  assert.equal(revision.plan.fact.revision, 1); assert.equal(revision.plan.fact.attemptNumber, 1);
  assert.equal(revision.plan.fact.identity.candidate, revisedCandidate); assert.equal(revision.plan.fact.request, request);
  const count = f.store.acceptedOperationPage().items.length;
  await assert.rejects(h.call("bob", "oma_review", { target: staleDecision, decision: "approve", reason: "Old source is not the new source" }).invoke(), refused);
  assert.equal(f.store.acceptedOperationPage().items.length, count);
  const current = h.target("alice", request, "proposal"), submission = h.target("alice", request, "submission");
  const cancelled = await h.call("alice", "oma_review", { target: submission, decision: "withdraw", reason: "Cancel this exact revised proposal" }).invoke();
  if (cancelled.disposition === "existing") assert.fail("cancellation must have its own fact");
  const control = f.store.getOperationById(cancelled.receipt.operation);
  assert.ok(control?.kind === "attest.record" && control.plan.fact.kind === "cancel");
  assert.equal(control.plan.fact.request, request);
  await assert.rejects(h.call("alice", "oma_merge", { proposal: current, reason: "A terminal request cannot reopen", tier: "HIGH" }).invoke(), refused);
  assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
});

test("003. Client: a changed own verdict after freeze and before dispatch is checked at actual review acceptance", async t => {
  const h = await collaborationClient(t), { f } = h;
  const candidate = f.candidateWith({ "race.txt": "exact source\n" });
  await f.submit("alice", candidate); await f.open("alice", { tier: "HIGH", candidate }, "open");
  const request = f.store.getOperation("alice", "open")!.id, name = f.requestName("open"), target = h.target("bob", request, "review");
  let raced = false;
  h.beforeDispatch(async method => {
    if (method !== "attest.record" || raced) return;
    raced = true; await f.vote("bob", name, "reject", "another authorized session won the race", "concurrent-vote");
  });
  await assert.rejects(h.call("bob", "oma_review", { target, decision: "approve", reason: "This old target must not overwrite a new verdict" }).invoke(), refused);
  assert.equal(raced, true);
  const votes = f.store.attestations.all().filter(row => row.operation.plan.fact.kind === "vote");
  assert.equal(votes.length, 1); assert.equal(votes[0]!.operation.requestKey, "concurrent-vote");
  assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
});

test("004. Client: validly encoded forged source/actor/birth and self-review targets create no effect; legitimate independent vote still works", async t => {
  const h = await collaborationClient(t), { f } = h;
  const candidate = f.candidateWith({ "forgery.txt": "actual original proposal\n" });
  await f.submit("alice", candidate); await f.open("alice", { tier: "HIGH", candidate }, "open");
  const request = f.store.getOperation("alice", "open")!.id, target = h.target("bob", request, "review");
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { basename, dirname, join } = await import("node:path");
  const { collaborationRecordRootPathAt } = await import("@oma/domain/paths");
  const { encodeCollaborationTarget, decodeCollaborationTarget } = await import("@oma/domain/collaboration-targets");
  const directory = join(collaborationRecordRootPathAt(f.root, "bob"), "reviews", request, "targets");
  const original = decodeCollaborationTarget(readFileSync(join(directory, basename(target))), basename(target));
  if (original.kind !== "review") assert.fail("independent reviewer must inspect an exact review target");
  const before = f.store.acceptedOperationPage().items, refs = f.git(["for-each-ref", "--format=%(refname) %(objectname)"]);
  for (const [actor, forged] of [["bob", { ...original, source: { base: f.base, candidate: f.base } }],
    ["bob", { ...original, actor: "carol" }], ["bob", { ...original, societyBirth: "another-society-birth" }],
    ["alice", { ...original, actor: "alice" }]] as const) {
    const encoded = encodeCollaborationTarget(forged), physical = join(collaborationRecordRootPathAt(f.root, actor), "reviews", request, "targets", encoded.name);
    mkdirSync(dirname(physical), { recursive: true }); writeFileSync(physical, encoded.bytes);
    await assert.rejects(h.call(actor, "oma_review", { target: join("/oma/reviews", request, "targets", encoded.name), decision: "approve", reason: "A path and digest cannot create authority" }).invoke(), refused);
    assert.deepEqual(f.store.acceptedOperationPage().items, before);
    assert.equal(f.git(["for-each-ref", "--format=%(refname) %(objectname)"]), refs);
  }
  const good = await h.call("bob", "oma_review", { target, decision: "approve", reason: "Actual independent source review" }).invoke();
  if (good.disposition === "existing") assert.fail("a legitimate verdict must have its own receipt");
  assert.equal(good.receipt.state, "succeeded");
});

test("005. Client: only the current broker approval is decidable; Principal rejection is final and cannot be withdrawn or reopened", async t => {
  const h = await collaborationClient(t), { f } = h;
  const candidate = f.candidateWith({ "principal.txt": "requires a final Principal decision\n" });
  await f.submit("alice", candidate); await f.open("alice", { tier: "HIGH", candidate }, "open");
  const request = f.store.getOperation("alice", "open")!.id, name = f.requestName("open");
  const proposal = h.target("alice", request, "proposal");
  await f.vote("bob", name, "approve", "source checked", "peer-bob");
  await f.vote("carol", name, "approve", "source checked independently", "peer-carol");
  const target = h.target("principal", request, "review");
  const { readFileSync, writeFileSync } = await import("node:fs"), { dirname, basename, join } = await import("node:path");
  const { decodeCollaborationTarget, encodeCollaborationTarget } = await import("@oma/domain/collaboration-targets");
  const current = decodeCollaborationTarget(readFileSync(target), basename(target));
  if (current.kind !== "review") assert.fail("Principal requires a broker-issued review target");
  const encoded = encodeCollaborationTarget({ ...current, approval: "m-11111111-1111-4111-8111-111111111111-0" });
  const fake = join(dirname(target), encoded.name); writeFileSync(fake, encoded.bytes);
  const count = f.store.acceptedOperationPage().items.length;
  await assert.rejects(h.call("principal", "oma_review", { target: fake, decision: "approve", reason: "Fake ordinary notice does not grant approval authority" }).invoke(), refused);
  assert.equal(f.store.acceptedOperationPage().items.length, count);
  const rejected = await h.call("principal", "oma_review", { target, decision: "reject", reason: "This request must remain rejected" }).invoke();
  if (rejected.disposition === "existing") assert.fail("Principal verdict must append a fact");
  const fact = f.store.getOperationById(rejected.receipt.operation);
  assert.ok(fact?.kind === "attest.record" && fact.plan.fact.kind === "vote");
  assert.equal(fact.plan.fact.approval, current.approval); assert.equal(fact.plan.fact.verdict, "reject");
  const rejectedCount = f.store.acceptedOperationPage().items.length;
  await assert.rejects(h.call("principal", "oma_review", { target, decision: "approve", reason: "Cannot supersede a terminal rejection" }).invoke(), refused);
  const vote = encodeCollaborationTarget({ version: "collaboration-v1", kind: "vote", societyBirth: current.societyBirth,
    request, requestName: name, revision: current.revision, policyRevision: current.policyRevision, actor: "principal",
    vote: fact.id, expectedCurrentVote: fact.id, scope: current.preparation, approval: current.approval });
  const votePath = join(dirname(target), vote.name); writeFileSync(votePath, vote.bytes);
  await assert.rejects(h.call("principal", "oma_review", { target: votePath, decision: "withdraw", reason: "Cannot withdraw terminal rejection" }).invoke(), refused);
  await assert.rejects(h.call("alice", "oma_merge", { proposal, reason: "Cannot reopen the rejected request", tier: "HIGH" }).invoke(), refused);
  assert.equal(f.store.acceptedOperationPage().items.length, rejectedCount);
  assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
  assert.deepEqual(f.store.getOperationById(fact.id), fact);
});

test("006. Client: broker revert binds the actual applied delta; omitted existing replacement survives main movement without recomputing the correction", async t => {
  const h = await collaborationClient(t), { f } = h;
  const candidate = f.candidateWith({ "original.txt": "the applied change to correct\n" });
  await f.submit("alice", candidate); await f.open("alice", { tier: "LOW", candidate }, "open");
  assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
  const merge = f.store.getOperation("alice", "open")!, applied = h.target("bob", merge.id, "applied");
  const { readFileSync } = await import("node:fs"), { join } = await import("node:path");
  const { collaborationRecordRootPathAt } = await import("@oma/domain/paths");
  const originalSource = join(collaborationRecordRootPathAt(f.root, "bob"), "reviews", merge.id, "revisions/0/manifest.json");
  const sourceBytes = readFileSync(originalSource);
  const opened = await h.call("bob", "oma_challenge", { merge: applied, reason: "Undo only the actual applied change", tier: "LOW" }).invoke();
  if (opened.disposition === "existing") assert.fail("a new correction must append an opening fact");
  const challenge = f.store.getOperationById(opened.receipt.operation);
  assert.ok(challenge?.kind === "attest.record" && challenge.plan.fact.kind === "challenge.open");
  const fact = challenge.plan.fact;
  assert.equal(fact.target.request, merge.id); assert.equal(fact.target.identity.expectedBase, f.base);
  assert.equal(fact.target.identity.candidate, candidate); assert.equal(fact.prepared, true);
  assert.equal(f.git(["rev-parse", `${fact.identity.candidate}^`]), candidate);
  assert.equal(f.git(["rev-parse", `${fact.identity.candidate}^{tree}`]), f.git(["rev-parse", `${f.base}^{tree}`]));
  const proposal = h.target("bob", challenge.id, "proposal");
  const moved = f.candidateWith({ "original.txt": "the applied change to correct\n", "unrelated.txt": "must survive correction\n" }, candidate);
  await f.submit("alice", moved, "submit-main-move"); await f.open("alice", { tier: "LOW", candidate: moved, base: candidate }, "move-main");
  assert.equal(f.git(["rev-parse", "refs/heads/main"]), moved);
  const before = f.store.acceptedOperationPage().items;
  const existing = await h.call("bob", "oma_challenge", { merge: applied, proposal, reason: "Observe exactly the original frozen correction", tier: "LOW" }).invoke();
  assert.equal(existing.disposition, "existing"); assert.deepEqual(f.store.acceptedOperationPage().items, before);
  assert.deepEqual(f.store.getOperationById(challenge.id), challenge);
  assert.equal(f.git(["rev-parse", "refs/heads/main"]), moved, "LOW challenge still requires independent review");
  assert.deepEqual(readFileSync(originalSource), sourceBytes, "a related challenge cannot replace the merge's revision-zero source");
  const originalStatus = readFileSync(join(collaborationRecordRootPathAt(f.root, "bob"), "reviews", merge.id, "status.md"), "utf8");
  assert.match(originalStatus, /Integration phase: applied/u);
  assert.ok(originalStatus.includes(applied), "the original immutable applied target remains discoverable after the challenge");
});

test("007. Client: a new omitted change requires the recorded workspace base and never substitutes current canonical main", async t => {
  const h = await collaborationClient(t), { f } = h;
  const { join } = await import("node:path"), { runGitText } = await import("@oma/process/policies");
  const candidate = f.candidateWith({ "candidate.txt": "freeze local HEAD with the original recorded base\n" });
  await f.submit("alice", candidate);
  const request = h.call("alice", "oma_merge", { reason: "No implicit main base", tier: "HIGH" });
  const workspace = join(f.root, "agents/alice/workspace");
  const git = (args: string[]) => { const result = runGitText(args, { cwd: workspace }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  git(["clone", "--no-local", "--no-checkout", f.projectGit, "."]);
  git(["fetch", "origin", candidate]); // Ordinary clone fetches branches, not refs/oma/published.
  git(["checkout", "--detach", candidate]);
  git(["update-ref", "-d", "refs/remotes/origin/main"]);
  const before = f.store.acceptedOperationPage().items;
  await assert.rejects(request.invoke(), error => {
    assert.ok(error instanceof ClientError); assert.match(error.message, /^SOURCE_UNREADABLE: the recorded workspace base is unavailable/u); return true;
  });
  assert.deepEqual(f.store.acceptedOperationPage().items, before);
  git(["update-ref", "refs/remotes/origin/main", f.base]);
  const moved = f.candidateWith({ "other.txt": "independent canonical main movement\n" });
  await f.submit("carol", moved, "publish-other"); await f.open("carol", { tier: "LOW", candidate: moved }, "move-main");
  assert.equal(f.git(["rev-parse", "refs/heads/main"]), moved);
  const opened = await h.call("alice", "oma_merge", { reason: "Freeze only HEAD and the recorded base", tier: "HIGH" }).invoke();
  if (opened.disposition === "existing") assert.fail("a fresh opening must own its receipt");
  const operation = f.store.getOperationById(opened.receipt.operation);
  assert.ok(operation?.kind === "attest.record" && operation.plan.fact.kind === "merge.open");
  assert.equal(operation.plan.fact.identity.expectedBase, f.base); assert.equal(operation.plan.fact.identity.candidate, candidate);
  assert.equal(f.git(["rev-parse", "refs/heads/main"]), moved, "HIGH cannot skip its independent source reviews");
});

test("009. Client: a mistyped local candidate closes before send; corrupt source preserves original uncertainty", async t => {
  const h = await collaborationClient(t), { f } = h;
  const { join } = await import("node:path"), { runGitText } = await import("@oma/process/policies");
  const workspace = join(f.root, "agents/alice/workspace");
  const missing = "f".repeat(f.base.length);
  const rejected = h.call("alice", "oma_merge", { change: { candidate: missing, base: f.base },
    tier: "LOW", reason: "A full-length typo is not an uncertain submitted change" });
  const git = (args: string[]) => { const result = runGitText(args, { cwd: workspace }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  git(["clone", "--no-local", "--branch", "main", f.projectGit, "."]);
  const before = f.store.acceptedOperationPage().items, refs = git(["for-each-ref", "--format=%(refname) %(objectname)"]);
  const first = await rejected.invokeTool();
  const text = first.content.map(item => item.text ?? "").join("\n");
  assert.match(text, /SOURCE_UNREADABLE/u);
  assert.doesNotMatch(text, /ACCEPTANCE_UNKNOWN/u);
  const rejection = (result: typeof first) => {
    assert.ok(result.details && typeof result.details === "object");
    assert.equal(Reflect.get(result.details, "disposition"), "rejected");
    return Reflect.get(result.details, "rejection");
  };
  assert.deepEqual(rejection(await rejected.invokeTool()), rejection(first), "the original invocation keeps its protected rejection");
  assert.deepEqual(f.store.acceptedOperationPage().items, before);
  assert.equal(git(["for-each-ref", "--format=%(refname) %(objectname)"]), refs, "no export ref was created");
  assert.ok(!h.calls.some(call => call.method === "git.submit" || call.method === "attest.record"));
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "--allow-empty", "-qm", "valid replacement source"]);
  const candidate = git(["rev-parse", "HEAD"]);
  const correction = h.call("alice", "oma_merge", { change: { candidate, base: f.base },
    tier: "LOW", reason: "Submit the actual committed source after protected rejection" });
  const correctionRefs = git(["for-each-ref", "--format=%(refname) %(objectname)"]);
  const { readFileSync, writeFileSync, chmodSync } = await import("node:fs");
  const object = join(workspace, ".git/objects", candidate.slice(0, 2), candidate.slice(2)), bytes = readFileSync(object);
  chmodSync(object, 0o600);
  try {
    writeFileSync(object, "corrupt Git object");
    const unknown = await correction.invokeTool();
    assert.ok(unknown.details && typeof unknown.details === "object");
    assert.equal(Reflect.get(unknown.details, "acceptance"), "unknown");
    assert.equal(Reflect.get(unknown.details, "rejection"), null, "a failed object observation cannot prove nonacceptance");
    assert.deepEqual(f.store.acceptedOperationPage().items, before);
    assert.equal(git(["for-each-ref", "--format=%(refname) %(objectname)"]), correctionRefs, "failed source preparation creates no export ref");
  } finally { writeFileSync(object, bytes); chmodSync(object, 0o444); }
  assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
  assert.deepEqual(rejection(await rejected.invokeTool()), rejection(first), "another source observation cannot rewrite the rejected call");
});

for (const failure of ["pending", "unknown", "failed"] as const) test(
  `008. Client fault injection: same source with ${failure} integration never becomes an unrelated attempt or reinterprets an old failed receipt`, async t => {
    const { StoreError } = await import("@oma/domain/errors");
    let policyChanged = false;
    const h = await collaborationClient(t, { checks: [{ id: "injected-boundary", argv: ["/usr/bin/false"], env: {} }],
      // Failure injection only, not a successful trusted-check/platform proof.
      runCheck: () => { throw new StoreError(failure === "failed" ? "CHECK_FAILED" : "BROKER_UNAVAILABLE", "injected check boundary loss"); },
      reader: policy => ({ ...policy, policyRevision: policyChanged ? "p2" : policy.policyRevision }) });
    const { f } = h, candidate = f.candidateWith({ "retry.txt": "exact original failed source\n" });
    await f.submit("alice", candidate); await f.open("alice", { tier: "LOW", candidate }, "open");
    const request = f.store.getOperation("alice", "open")!.id, original = f.applyOp("alice", "open"); assert.ok(original?.kind === "git.integrate");
    assert.equal(original.state, failure === "failed" ? "failed" : "pending");
    if (failure === "unknown") f.store.transaction(tx => tx.setOperationUnknown(original.id));
    const frozenOriginal = f.store.getOperationById(original.id), proposal = h.target("alice", request, "proposal");
    const before = f.store.acceptedOperationPage().items;
    const outcome = await h.call("alice", "oma_merge", { proposal, reason: "Observe only the exact original attempt or explicitly retry a confirmed failure", tier: "LOW" }).invoke();
    if (failure !== "failed") {
      assert.equal(outcome.disposition, "existing");
      assert.deepEqual(f.store.acceptedOperationPage().items, before);
    } else {
      if (outcome.disposition === "existing") assert.fail("an exact settled failure permits a distinct retry fact");
      const retry = f.store.getOperationById(outcome.receipt.operation);
      assert.ok(retry?.kind === "attest.record" && retry.plan.fact.kind === "review.retry");
      assert.equal(retry.plan.fact.expectedAttempt, original.id); assert.equal(retry.plan.fact.attemptNumber, 1);
      const current = h.target("alice", request, "proposal"), count = f.store.acceptedOperationPage().items.length;
      policyChanged = true;
      await assert.rejects(h.call("alice", "oma_merge", { proposal: current, reason: "Cannot silently adopt a changed policy", tier: "LOW" }).invoke(), error => {
        assert.ok(error instanceof ClientError); assert.match(error.message, /POLICY_CHANGED|policy.*differ|policy.*changed/u); return true;
      });
      assert.equal(f.store.acceptedOperationPage().items.length, count);
    }
    assert.deepEqual(f.store.getOperationById(original.id), frozenOriginal);
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
  });
