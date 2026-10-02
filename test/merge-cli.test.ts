/** mail-v1 review CLI: merge/challenge commands resolve and freeze revisions
 * once, sequence the trusted submit ahead of the open, and expose status/diff
 * as reads. Transport is a real framed peer answering scripted results. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { generateOperationId } from "../src/ids.js";
import { StoreError, publicFailure, failureText } from "../src/domain/errors.js";
import { attestationProblem } from "../src/domain/attestation.js";
import { RequestCache } from "../src/request-cache.js";
import { exportRefForRequestKey } from "../src/domain/derived.js";
import { runCliWithPeer } from "./fixtures/cli-peer.js";

const MSG = `m-${crypto.randomUUID?.() ?? "00000000-0000-4000-8000-000000000000"}-0`;
const messageId = () => `m-${generateOperationId().slice(3)}-0`;

const git = (cwd: string, args: string[]): string =>
  execFileSync("/usr/bin/git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd } }).trim();
const gitRaw = (cwd: string, args: string[]): Buffer =>
  execFileSync("/usr/bin/git", args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd } });

type Request = Record<string, unknown> & { method: string; params: Record<string, unknown>; request?: string };
type Handler = (request: Record<string, unknown>, body: AsyncIterable<Uint8Array> | null) => Promise<object>;
const asRequest = (request: Record<string, unknown>): Request => request as Request;
const frame = async (request: Record<string, unknown>, result: unknown) => ({ v: 1, id: request.id, ok: true, result });
const receipt = (result: unknown) => ({ operation: generateOperationId(), state: "succeeded", result });
const publishReceipt = (candidate: string) => receipt({ kind: "git.submit", candidate,
  publishedRef: `refs/oma/published/alice/${generateOperationId()}`, message: messageId(), recipientCount: 1 });
const openReceipt = (name: string) => receipt({ kind: "attest.record", request: name, messages: [messageId()], recipientCount: 1 });

/** A workspace clone like the provisioner makes: HEAD is the candidate and
 * refs/remotes/origin/main records the fetched base. */
function workspace(root: string): { cwd: string; base: string; candidate: string } {
  const cwd = join(root, "work");
  mkdirSync(cwd, { recursive: true });
  git(cwd, ["init", "-q"]);
  git(cwd, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "base", "--allow-empty"]);
  writeFileSync(join(cwd, "a.txt"), "first\n");
  git(cwd, ["add", "a.txt"]); git(cwd, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "base file"]);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  git(cwd, ["update-ref", "refs/remotes/origin/main", base]);
  writeFileSync(join(cwd, "a.txt"), "second\n");
  git(cwd, ["add", "a.txt"]); git(cwd, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "work"]);
  return { cwd, base, candidate: git(cwd, ["rev-parse", "HEAD"]) };
}
/** The canonical repo merge diff reads: main and a published candidate ref. */
function canonical(root: string, fileBytes = 150 * 1024): { repo: string; base: string; candidate: string } {
  const repo = join(root, "canon.git");
  git(root, ["init", "-q", "--bare", repo]);
  const scratch = join(root, "scratch");
  git(root, ["init", "-q", scratch]);
  git(scratch, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "base", "--allow-empty"]);
  writeFileSync(join(scratch, "file.txt"), "line\n");
  git(scratch, ["add", "file.txt"]); git(scratch, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "v1"]);
  const base = git(scratch, ["rev-parse", "HEAD"]);
  const lines = Array.from({ length: fileBytes / 40 }, (_, i) => `row ${i} ${"x".repeat(24)}`).join("\n") + "\n한 줄";
  writeFileSync(join(scratch, "file.txt"), lines + "\n");
  git(scratch, ["add", "file.txt"]); git(scratch, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "v2"]);
  const candidate = git(scratch, ["rev-parse", "HEAD"]);
  git(scratch, ["push", repo, `${base}:refs/heads/main`, `${candidate}:refs/oma/published/alice/${generateOperationId()}`]);
  return { repo, base, candidate };
}
const principalStatus = (name: string, base: string, candidate: string) => ({
  name, kind: "merge", tier: "LOW", title: "t",
  identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: base, candidate, policyRevision: "p1" },
  approval: null, display: "peer-needed",
});

test("mail-v1 CLI: merge open resolves HEAD + origin/main, submits once, then opens", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-merge-cli-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const { cwd, base, candidate } = workspace(home);
  writeFileSync(join(cwd, "reason.md"), "because it fixes the thing\n");
  process.env.OMA_ACTOR = "alice"; t.after(() => { delete process.env.OMA_ACTOR; });
  const calls: string[] = [];
  const run = await runCliWithPeer(home, cwd,
    ["merge", "open", "--tier", "LOW", "--title", "the fix", "--file", join(cwd, "reason.md"), "--request", "K1"],
    (request) => {
      const r = asRequest(request);
      calls.push(r.method);
      if (request.method === "git.known") return frame(request, { hasCandidate: false, prerequisites: [] });
      if (request.method === "git.submit") {
        assert.equal(request.request, "K1.submit");
        const params = request.params as Record<string, unknown>;
        assert.equal(params.candidate, candidate);
        assert.equal(params.exportRef, exportRefForRequestKey("K1.submit"));
        assert.deepEqual(params.to, ["alice"]);
        assert.equal(params.subject, `merge candidate ${candidate.slice(0, 12)}`);
        assert.equal(params.body, "Candidate for a merge request; review happens in the request thread.");
        assert.deepEqual(params.paths, []);
        assert.ok(typeof params.bundle === "object", "the candidate is bundled through the trusted submit path");
        return frame(request, publishReceipt(candidate));
      }
      assert.equal(r.method, "attest.record");
      assert.equal(r.request, "K1");
      assert.deepEqual(r.params, { kind: "merge.open", tier: "LOW", title: "the fix",
        reason: "because it fixes the thing\n", candidate, base });
      return frame(request, openReceipt("merge-11111111"));
    });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(calls, ["git.known", "git.submit", "attest.record"]);
});

test("mail-v1 CLI: same-key replay after HEAD moved returns the frozen request", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-merge-replay-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const { cwd } = workspace(home);
  writeFileSync(join(cwd, "r.md"), "r\n");
  const result = openReceipt("merge-22222222");
  const calls: string[] = [];
  const handler: Handler = async (request) => {
    const r = asRequest(request);
    calls.push(`${r.method}:${r.request ?? ""}`);
    if (r.method === "git.known") return frame(request, { hasCandidate: true, prerequisites: [] });
    if (r.method === "operation.get") return frame(request, result);
    return frame(request, result);
  };
  assert.equal((await runCliWithPeer(home, cwd,
    ["merge", "open", "--tier", "LOW", "--title", "t", "--file", join(cwd, "r.md"), "--request", "K2"], handler)).status, 0);
  // HEAD moved and the recorded base ref is gone — the replay depends on
  // neither; the frozen request is the request.
  writeFileSync(join(cwd, "a.txt"), "moved\n"); git(cwd, ["add", "a.txt"]);
  git(cwd, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "moved"]);
  git(cwd, ["update-ref", "-d", "refs/remotes/origin/main"]);
  const second = await runCliWithPeer(home, cwd,
    ["merge", "open", "--tier", "LOW", "--title", "t", "--file", join(cwd, "r.md"), "--request", "K2"], handler);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(second.requests.map(r => r.method), ["operation.get"],
    "replay answers the frozen request; it never re-resolves HEAD or the base ref");
});

test("mail-v1 CLI: merge open with no recorded base refuses before any request", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-merge-nobase-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const { cwd } = workspace(home);
  git(cwd, ["update-ref", "-d", "refs/remotes/origin/main"]);
  writeFileSync(join(cwd, "r.md"), "r\n");
  const run = await runCliWithPeer(home, cwd,
    ["merge", "open", "--tier", "LOW", "--title", "t", "--file", join(cwd, "r.md")], (request) => frame(request, {}));
  assert.equal(run.status, 2);
  assert.match(run.stderr, /no recorded base: run `git fetch origin main` and build the candidate on it/);
  assert.deepEqual(run.requests, []);
});

test("mail-v1 CLI: dirty workspace warns; known candidate skips the submit; pending submit stops the open", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-merge-warn-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const { cwd, candidate } = workspace(home);
  writeFileSync(join(cwd, "a.txt"), "uncommitted\n");   // not staged/committed
  writeFileSync(join(cwd, "r.md"), "r\n");
  const known = await runCliWithPeer(home, cwd,
    ["merge", "open", "--tier", "LOW", "--title", "t", "--file", join(cwd, "r.md"), "--request", "K3"],
    async (request) => {
      if (asRequest(request).method === "git.known") return frame(request, { hasCandidate: true, prerequisites: [] });
      return frame(request, openReceipt("merge-33333333"));
    });
  assert.equal(known.status, 0, known.stderr);
  assert.match(known.stderr, /uncommitted changes that are not part of the candidate/);
  assert.deepEqual(known.requests.map(r => r.method), ["git.known", "attest.record"], "no submit for a known candidate");
  // A pending submit stops the open and names the submit key to query again.
  const pending = await runCliWithPeer(home, cwd,
    ["merge", "open", "--tier", "LOW", "--title", "t", "--file", join(cwd, "r.md"), "--request", "K4"],
    async (request) => {
      if (asRequest(request).method === "git.known") return frame(request, { hasCandidate: false, prerequisites: [] });
      assert.equal(asRequest(request).method, "git.submit");
      return frame(request, { operation: generateOperationId(), state: "pending" });
    });
  assert.equal(pending.status, 0, pending.stderr);
  assert.match(pending.stdout, /Query again: use --request K4\.submit/);
  assert.deepEqual(pending.requests.map(r => r.method), ["git.known", "git.submit"]);
  assert.equal(new RequestCache(home).read("K4.submit").kind, "present");
  assert.equal(new RequestCache(home).read("K4").kind, "absent", "the open never froze");
  void candidate;
});

test("mail-v1 CLI: review/vote/cancel send exact params; approval only via --approval", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-merge-facts-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const { cwd } = workspace(home);
  const name = "merge-abcd1234";
  writeFileSync(join(cwd, "body.md"), "looks right\n");
  const requests: Request[] = [];
  const handler = (request: Record<string, unknown>) => { requests.push(asRequest(request)); return frame(request, openReceipt(name)); };
  const run = (args: string[]) => runCliWithPeer(home, cwd, args, handler);
  assert.equal((await run(["merge", "review", name, "--file", join(cwd, "body.md"), "--request", "r1"])).status, 0);
  assert.deepEqual(requests[0]!.params, { kind: "review", name, body: "looks right\n" });
  const approval = messageId();
  assert.equal((await run(["merge", "vote", name, "--verdict", "approve", "--file", join(cwd, "body.md"),
    "--approval", approval, "--request", "v1"])).status, 0);
  assert.deepEqual(requests[1]!.params, { kind: "vote", name, verdict: "approve", body: "looks right\n", approval });
  assert.equal((await run(["merge", "vote", name, "--verdict", "reject", "--file", join(cwd, "body.md"), "--request", "v2"])).status, 0);
  assert.deepEqual(requests[2]!.params, { kind: "vote", name, verdict: "reject", body: "looks right\n" });
  assert.equal((await run(["merge", "cancel", name, "--file", join(cwd, "body.md"), "--request", "c1"])).status, 0);
  assert.deepEqual(requests[3]!.params, { kind: "cancel", name, reason: "looks right\n" });
  // Grammar refusals never reach the transport.
  for (const args of [
    ["merge", "review", "challenge-abcd1234", "--file", join(cwd, "body.md")],
    ["challenge", "review", "merge-abcd1234", "--file", join(cwd, "body.md")],
    ["merge", "vote", name, "--verdict", "maybe", "--file", join(cwd, "body.md")],
    ["merge", "vote", name, "--verdict", "approve", "--file", join(cwd, "body.md"), "--approval", "not-a-message"],
  ]) {
    const refused = await run(args);
    assert.equal(refused.status, 2, `${args.join(" ")}: ${refused.stderr}`);
  }
  assert.equal(requests.length, 4, "refusals sent nothing");
});

test("mail-v1 CLI: merge status answers the review.status result", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-merge-status-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const { cwd, base, candidate } = workspace(home);
  const baseStatus = principalStatus("merge-abcd1234", base, candidate);
  const { approval: _omit, ...minimal } = baseStatus;
  const detail = { ...minimal, reason: "r", requester: "alice",
    required: 0, approvers: [], rejectors: [],
    principal: { approval: null, sent: false, decision: null, decisionApproval: null },
    integration: null, entries: [], missing: ["missing"], main: { oid: candidate, observedAtMs: 1 } };
  const list = { requests: [], omitted: 0, main: { oid: candidate, observedAtMs: 1 } };
  const named = await runCliWithPeer(home, cwd, ["merge", "status", "merge-abcd1234"],
    async (request) => { assert.deepEqual(request.params, { name: "merge-abcd1234" }); return frame(request, detail); });
  assert.equal(named.status, 0, named.stderr);
  assert.deepEqual(JSON.parse(named.stdout), detail);
  const all = await runCliWithPeer(home, cwd, ["merge", "status"], (request) => frame(request, list));
  assert.equal(all.status, 0); assert.deepEqual(JSON.parse(all.stdout), list);
});

test("mail-v1 CLI: merge diff pages a large diff; challenge --view original uses the target identity", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-merge-diff-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const { cwd } = workspace(home);
  const { repo, base, candidate } = canonical(home);
  process.env.OMA_PROJECT_GIT = repo; t.after(() => { delete process.env.OMA_PROJECT_GIT; });
  delete process.env.OMA_WORKER_ARCHIVE;   // a Principal-style environment still diffs
  const name = "merge-00c0ffee";
  const statusReply = principalStatus(name, base, candidate);
  const fullBytes = gitRaw(cwd, ["--git-dir", repo, "diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color",
    base, candidate]);
  const full = fullBytes.toString("utf8");
  const digest = createHash("sha256").update(fullBytes).digest("hex");
  assert.ok(fullBytes.length > 64 * 1024, `fixture diff must exceed a page (${fullBytes.length})`);
  const handler = (request: Record<string, unknown>) => {
    assert.equal(request.method, "review.status");
    return frame(request, statusReply);
  };
  const page1 = JSON.parse((await runCliWithPeer(home, cwd, ["merge", "diff", name], handler)).stdout);
  assert.equal(page1.name, name); assert.equal(page1.view, "merge");
  assert.equal(page1.base, base); assert.equal(page1.candidate, candidate);
  assert.equal(page1.policyRevision, "p1");
  assert.equal(page1.sha256, digest); assert.equal(page1.bytes, Buffer.byteLength(full));
  assert.equal(page1.cursor, 0); assert.ok(typeof page1.next === "number" && page1.next > 0);
  const page2 = JSON.parse((await runCliWithPeer(home, cwd, ["merge", "diff", name, "--cursor", String(page1.next)], handler)).stdout);
  assert.equal(page2.cursor, page1.next);
  if (page2.next !== null) {
    const page3 = JSON.parse((await runCliWithPeer(home, cwd, ["merge", "diff", name, "--cursor", String(page2.next)], handler)).stdout);
    assert.equal(page3.next, null);
    assert.equal(Buffer.concat([Buffer.from(page1.text), Buffer.from(page2.text), Buffer.from(page3.text)]).equals(fullBytes), true,
      "pages reassemble the exact diff");
  } else {
    assert.equal(Buffer.concat([Buffer.from(page1.text), Buffer.from(page2.text)]).equals(fullBytes), true,
      "pages reassemble the exact diff");
  }
  const bad = await runCliWithPeer(home, cwd, ["merge", "diff", name, "--cursor", "abc"], handler);
  assert.equal(bad.status, 2); assert.match(bad.stderr, /invalid cursor/);
  // A cursor inside a UTF-8 sequence refuses: find a continuation byte.
  const continuation = fullBytes.findIndex((byte, i) => i > 0 && (byte & 0xc0) === 0x80);
  if (continuation > 0) {
    const mid = await runCliWithPeer(home, cwd, ["merge", "diff", name, "--cursor", String(continuation)], handler);
    assert.equal(mid.status, 2); assert.match(mid.stderr, /not at a page boundary/);
  }
  const past = await runCliWithPeer(home, cwd, ["merge", "diff", name, "--cursor", String(fullBytes.length)], handler);
  assert.equal(past.status, 2); assert.match(past.stderr, /not at a page boundary/);
  // An empty diff is a single empty page; only cursor 0 stands.
  const empty = { ...statusReply, identity: { ...statusReply.identity, candidate: base } };
  const noDiff = JSON.parse((await runCliWithPeer(home, cwd, ["merge", "diff", name],
    (request) => frame(request, empty))).stdout);
  assert.equal(noDiff.bytes, 0); assert.equal(noDiff.next, null); assert.equal(noDiff.text, "");
  const pastEmpty = await runCliWithPeer(home, cwd, ["merge", "diff", name, "--cursor", "1"],
    (request) => frame(request, empty));
  assert.equal(pastEmpty.status, 2);
  // A challenge's original view names the target merge's identity.
  const challengeName = "challenge-00c0ffee";
  const challengeStatus = { ...principalStatus(challengeName, "0".repeat(40), "1".repeat(40)), kind: "challenge",
    target: { name: "merge-00c0ffee", integration: generateOperationId(),
      identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: base, candidate, policyRevision: "p1" } } };
  const orig = JSON.parse((await runCliWithPeer(home, cwd, ["challenge", "diff", challengeName, "--view", "original"],
    (request) => frame(request, challengeStatus))).stdout);
  assert.equal(orig.view, "original");
  assert.equal(orig.base, base); assert.equal(orig.candidate, candidate);
  const revert = JSON.parse((await runCliWithPeer(home, cwd, ["challenge", "diff", challengeName],
    (request) => frame(request, { ...challengeStatus, identity: { repo: "project", targetRef: "refs/heads/main",
      expectedBase: candidate, candidate: base, policyRevision: "p1" } }))).stdout);
  assert.equal(revert.view, "revert"); assert.equal(revert.base, candidate); assert.equal(revert.candidate, base);
});

test("mail-v1 CLI: challenge open carries the merge name; candidate+base go together and publish first", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-challenge-cli-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const { cwd, base, candidate } = workspace(home);
  writeFileSync(join(cwd, "r.md"), "revert it\n");
  const requests: Request[] = [];
  // Prepared path: no candidate → no submit, just the open.
  const prepared = await runCliWithPeer(home, cwd,
    ["challenge", "open", "--merge", "merge-abcd1234", "--tier", "HIGH", "--title", "t", "--file", join(cwd, "r.md"), "--request", "C1"],
    (request) => { requests.push(asRequest(request)); return frame(request, openReceipt("challenge-99999999")); });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.deepEqual(requests.map(r => r.method), ["attest.record"]);
  assert.deepEqual(requests[0]!.params, { kind: "challenge.open", merge: "merge-abcd1234", tier: "HIGH",
    title: "t", reason: "revert it\n" });
  // Caller-provided candidate: published first like a merge open.
  const supplied = await runCliWithPeer(home, cwd,
    ["challenge", "open", "--merge", "merge-abcd1234", "--tier", "LOW", "--title", "t", "--file", join(cwd, "r.md"),
      "--candidate", candidate, "--base", base, "--request", "C2"],
    async (request) => {
      if (request.method === "git.known") return frame(request, { hasCandidate: true, prerequisites: [] });
      return frame(request, openReceipt("challenge-88888888"));
    });
  assert.equal(supplied.status, 0, supplied.stderr);
  assert.deepEqual(supplied.requests.map(r => r.method), ["git.known", "attest.record"]);
  assert.deepEqual(supplied.requests[1]!.params, { kind: "challenge.open", merge: "merge-abcd1234", tier: "LOW",
    title: "t", reason: "revert it\n", candidate, base });
  for (const args of [
    ["challenge", "open", "--merge", "challenge-abcd1234", "--tier", "LOW", "--title", "t", "--file", join(cwd, "r.md")],
    ["challenge", "open", "--merge", "merge-abcd1234", "--tier", "MEDIUM", "--title", "t", "--file", join(cwd, "r.md")],
    ["challenge", "open", "--merge", "merge-abcd1234", "--tier", "LOW", "--title", "t", "--file", join(cwd, "r.md"), "--candidate", candidate],
  ]) {
    const refused = await runCliWithPeer(home, cwd, args, (request) => frame(request, {}));
    assert.equal(refused.status, 2, args.join(" "));
    assert.deepEqual(refused.requests, []);
  }
});

test("DR27 (kept module-level coverage): exact attestation identity uses the shared non-coercing grammar; missing conditions survive public sanitization", () => {
  const identity = { repo: "project", targetRef: "refs/heads/main", candidate: "2".repeat(40),
    expectedBase: "1".repeat(40), policyRevision: "p1" };
  const fact = { kind: "peer", identity, verdict: "APPROVE", evidence: "read" };
  assert.equal(attestationProblem(fact), null);
  for (const policyRevision of ["p\n1", "p".repeat(129), ""])
    assert.notEqual(attestationProblem({ ...fact, identity: { ...identity, policyRevision } }), null);
  assert.notEqual(attestationProblem({ ...fact, verdict: { toString: () => "APPROVE" } }), null);
  assert.notEqual(attestationProblem({ ...fact, identity: { ...identity, candidate: "a".repeat(64) } }), null);
  const failure = publicFailure(new StoreError("INTEGRATION_CONDITIONS", "missing",
    { details: { effectiveTier: "HIGH", missing: "Principal ACCEPT" } }));
  assert.deepEqual(failure.details, { effectiveTier: "HIGH", missing: "Principal ACCEPT" });
  assert.match(failureText(failure), /Principal ACCEPT/);
});

test("mail-v1 CLI: the removed control commands are gone", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-removed-cli-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const { cwd } = workspace(home);
  for (const args of [
    ["approve", "1".repeat(40), "--base", "2".repeat(40), "--target", "main", "--policy-revision", "p1", "--file", "x"],
    ["object", "1".repeat(40), "--file", "x"],
    ["revoke", "op-00000000-0000-4000-8000-000000000000", "--file", "x"],
    ["integrate", "1".repeat(40), "--expect", "2".repeat(40)],
    ["code", "show", "--path", "a.txt"],
    ["challenge", "op-00000000-0000-4000-8000-000000000000", "--valid", "true", "--file", "x"],
  ]) {
    const refused = await runCliWithPeer(home, cwd, args, (request) => frame(request, {}));
    assert.equal(refused.status, 2, args.join(" "));
    assert.deepEqual(refused.requests, []);
  }
});
