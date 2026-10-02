/** mail-v1 (merge requests): ReviewModule accepts opens/reviews/votes/cancels
 * as attest.record facts and owns their mail; the Principal decides by mail on
 * a bound approval, and worker mail never reaches it. A request this module
 * accepts only reaches `ready`; integration is a later owner. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, readDiagnosticSnapshot } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { GitModule } from "../src/git.js";
import { inspectLedger } from "../src/diagnostics/ledger.js";
import { inspectIntegrity } from "../src/diagnostics/integrity.js";
import { NodeIntegrityFiles } from "../src/diagnostics/files.js";
import { runGitText } from "../src/process/policies.js";
import { createCanonicalObserver } from "../src/git/canonical-command.js";
import { mailWorkersPathAt, mailArchivePathAt, mailInboxPathAt } from "../src/storage/paths.js";
import { reviewState as evaluate, type ReviewEntry as RE, type ReviewState as RS } from "../src/domain/review-evaluation.js";
import type { ReviewFact } from "../implementation/contracts/attestation.js";
import { applyRequestKeyFor } from "../src/domain/identifiers.js";
import { StoreError } from "../src/domain/errors.js";
import { PublicDispatcher } from "../src/broker/public-dispatcher.js";
import { decodeRpcReply } from "../src/protocol/response-codec.js";
import { ReviewModule } from "../src/review.js";
import { snapshotIntegrationPolicy } from "../src/git/integration-policy.js";
import { sha256Hex } from "../src/hash.js";
import { readableMail } from "../src/mail/display.js";
import { makeValidAgent, ALL_CAPS } from "./fixtures/spec.js";
import type { AuthContext, MessagePlan } from "../implementation/contracts.js";
import type { IntegrationPolicy } from "../src/git/integration-policy.js";
import type { OperationOf } from "../src/storage/operation-codec.js";

async function* empty(): AsyncIterable<Uint8Array> {}

interface FixtureOptions {
  readonly review?: boolean;
  readonly principalDelegated?: boolean;
  readonly protectedPaths?: readonly string[];
  readonly rules?: readonly { path: string; tier: "LOW" | "MEDIUM" | "HIGH"; statuses: ("A" | "M" | "D" | "T")[] }[];
  /** Overrides the live host-policy read (the bound policy stays the same). */
  readonly reader?: (policy: IntegrationPolicy) => IntegrationPolicy;
  readonly mailBodyBytes?: number;
  readonly bundleBytes?: number;
  readonly checks?: IntegrationPolicy["checks"];   // integration check fixtures
  readonly runCheck?: (candidate: string, check: unknown) => Promise<void> | void;
}
function fixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "oma-merge-review-"));
  const projectGit = join(root, "repos", "project.git");
  const git = (args: readonly string[], input?: string): string => {
    const result = runGitText([...args], { gitDir: projectGit, ...(input === undefined ? {} : { input }),
      env: { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@invalid" } });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  mkdirSync(join(root, "repos"), { recursive: true });
  assert.equal(runGitText(["init", "--bare", projectGit]).status, 0);
  const emptyTree = git(["mktree"], "");
  const base = git(["commit-tree", emptyTree, "-m", "base"]);
  git(["update-ref", "refs/heads/main", base]);
  const candidateWith = (files: Record<string, string>, parent = base): string => {
    const tree = git(["mktree"], Object.entries(files).map(([name, content]) =>
      `100644 blob ${git(["hash-object", "-w", "--stdin"], content)}\t${name}`).join("\n") + "\n");
    return git(["commit-tree", tree, "-p", parent, "-m", "candidate"]);
  };
  let store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
  for (const dir of ["new", "cur", "tmp"])
    mkdirSync(join(root, "mail", "workers", dir), { recursive: true });
  const agents = () => {
    store.transaction(tx => {
      for (const actor of ["principal", "alice", "bob", "carol", "dave", "ellen"])
        tx.insertAgent(makeValidAgent(actor, actor === "ellen" ? { desired: "stopped" } : {}));
      tx.insertAgent(makeValidAgent("frank", { desired: "retired" }));
    });
  };
  agents();
  const paths = { stateRoot: root, projectGit, contextGit: join(root, "context.git"), worldDir: join(root, "world"),
    society: "demo", quarantineTmpBytes: 1024 * 1024 };
  let mail = new MailModule(paths, store, 64);
  const policy: IntegrationPolicy = { policyRevision: "p1", protectedPaths: [...(options.protectedPaths ?? [])],
    checks: [...(options.checks ?? [])], tiered: { repositoryFloor: "LOW", highPeerFloor: 2,
      principalDelegated: options.principalDelegated ?? true, rules: [...(options.rules ?? [])],
      ...(options.review === false ? {} : { review: "mail-v1" as const }) } };
  const bounds = { mailBodyBytes: options.mailBodyBytes ?? 256 * 1024, subjectBytes: 512,
    bundleBytes: options.bundleBytes ?? 256 * 1024 };
  let module = new GitModule(paths, store, mail, policy,
    options.reader === undefined ? () => policy : () => options.reader!(policy),
    options.runCheck === undefined ? null
      : (candidate, check) => Promise.resolve(options.runCheck!(candidate, check)),
    bounds);
  const auth = (actor = "alice"): AuthContext => ({ actor, role: actor === "principal" ? "principal" : "resident",
    incarnation: actor === "principal" ? 0 : 1, capabilities: new Set(ALL_CAPS), channel: "actor",
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } });
  const submits = new Map<string, string>();
  const submit = (actor: string, oid: string, key = `submit-${submits.size}`) =>
    module.submit(auth(actor), key, { candidate: oid, exportRef: `refs/oma/export/${submits.size}`,
      prerequisites: [], to: [], paths: [], subject: "candidate", body: "submitted candidate" }, empty());
  const open = (actor: string, input: { tier: "LOW" | "MEDIUM" | "HIGH"; candidate: string; base?: string; title?: string; reason?: string },
      key = `open-${Math.random().toString(16).slice(2)}`) =>
    module.attestations.record(auth(actor), key, { kind: "merge.open", title: input.title ?? "the change",
      reason: input.reason ?? "needs to land", tier: input.tier, candidate: input.candidate, base: input.base ?? base });
  const review = (actor: string, name: string, key = `review-${Math.random().toString(16).slice(2)}`,
      body = `${actor} looked`) =>
    module.reviews.record(auth(actor), key, { kind: "review", name, body });
  const vote = (actor: string, name: string, verdict: "approve" | "reject", body: string,
      key = `vote-${Math.random().toString(16).slice(2)}`, approval?: string) =>
    module.reviews.record(auth(actor), key, { kind: "vote", name, verdict, body, ...(approval === undefined ? {} : { approval }) });
  const cancel = (actor: string, name: string, key = `cancel-${Math.random().toString(16).slice(2)}`) =>
    module.reviews.record(auth(actor), key, { kind: "cancel", name, reason: "withdrawn" });
  const stop = (actor: string, desired: "stopped" | "retired") =>
    store.transaction(tx => store.updateAgent({ name: actor, desired }));
  const requestName = (key: string, actor = "alice"): string => {
    const op = store.getOperation(actor, key)!;
    assert.equal(op.kind, "attest.record"); assert.equal(op.state, "succeeded");
    const result = op.result as { request: string };
    return result.request;
  };
  /** Rebuilds the pure decision the module computes, from the same ledger. */
  const stateOf = (name: string): RS => {
    const rows = store.attestations.all();
    const openRow = rows.find(row => "messages" in row.operation.plan &&
      isOpenish(row.operation.plan.fact) && row.operation.plan.fact.name === name);
    assert.ok(openRow !== undefined, `request ${name} exists`);
    const of = (row: { sequence: number; operation: OperationOf<"attest.record"> }): RE => {
      const plan = row.operation.plan as { fact: ReviewFact; messages: readonly MessagePlan[] };
      return { sequence: row.sequence, operation: row.operation.id, actor: row.operation.actor,
        fact: plan.fact, messages: plan.messages };
    };
    const entries = rows.filter(row => row.sequence > openRow.sequence && row.operation.id !== openRow.operation.id &&
      "messages" in row.operation.plan &&
      namesRequest(row.operation.plan.fact as { kind?: string; request?: unknown; target?: { request?: unknown } },
        openRow.operation.id)).map(of);
    const applied = store.getOperation(openRow.operation.actor, applyRequestKeyFor(openRow.operation.id));
    return evaluate({ open: of(openRow), entries,
      integration: applied === null ? null : { operation: applied.id, state: applied.state,
        errorCode: applied.state === "failed" ? applied.errorCode : null },
      eligible: new Set(store.listAgents().filter(a => a.role === "resident" && a.desired === "enabled").map(a => a.name)),
      highPeerFloor: 2 });
  };
  return { root, base, projectGit, git, candidateWith, submit, open, review, vote, cancel, requestName, stateOf, auth, stop,
    policy, applyOp: (actor: string, openKey: string) => {
      const openOp = store.getOperation(actor, openKey)!;
      return store.getOperation(actor, applyRequestKeyFor(openOp.id));
    },
    get store() { return store; }, get mail() { return mail; }, get module() { return module; },
    reopen() { store.close(); store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
      mail = new MailModule(paths, store, 64); module = new GitModule(paths, store, mail, policy,
        options.reader === undefined ? () => policy : () => options.reader!(policy),
        options.runCheck === undefined ? null
          : (candidate, check) => Promise.resolve(options.runCheck!(candidate, check)),
        bounds); },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

const isOpenish = (fact: unknown): fact is { name: string } =>
  fact !== null && typeof fact === "object" &&
  ((fact as { kind?: string }).kind === "merge.open" || (fact as { kind?: string }).kind === "challenge.open");
const namesRequest = (fact: { kind?: string; request?: unknown; target?: { request?: unknown } }, request: string): boolean =>
  (fact.kind === "review" || fact.kind === "vote" || fact.kind === "cancel" || fact.kind === "refresh")
    ? fact.request === request : fact.kind === "challenge.open" && fact.target?.request === request;
const messages = (f: ReturnType<typeof fixture>, actor: string, key: string): readonly MessagePlan[] => {
  const op = f.store.getOperation(actor, key)!;
  assert.equal(op.kind, "attest.record");
  return (op.plan as { messages: readonly MessagePlan[] }).messages;
};
const inboxCount = (f: ReturnType<typeof fixture>, actor: string): number => {
  const dir = join(f.root, "mail", "inboxes", actor, "new");
  return existsSync(dir) ? readdirSync(dir).length : 0;
};
const messageText = (root: string, id: string): string =>
  readableMail(readFileSync(join(root, "mail", "objects", `${id}.eml`), "utf8"));
const workerFile = (root: string, id: string): string => join(root, "mail", "workers", "cur", `${id}:2,`);

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
    assert.match(name, /^merge-[0-9a-f]{8}$/);
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
    const status = f.module.reviews.status(f.auth("bob"), name, 64 * 1024, "s1");
    assert.ok("entries" in status);
    assert.equal(status.display, "applied");
    assert.equal(status.integration?.operation, integration.id);
    assert.equal(status.integration?.state, "succeeded");
    assert.equal(status.integration?.error, null);
    assert.deepEqual(status.entries, []); assert.deepEqual(status.missing, []);
    assert.deepEqual(status.principal, { approval: null, sent: false, decision: null });
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
    const open2_status = f.module.reviews.status(f.auth("carol"), name2, 64 * 1024, "s2");
    assert.ok("entries" in open2_status); assert.equal(open2_status.display, "peer-needed");
    const beforeVote = f.module.reviews.status(f.auth("carol"), name, 64 * 1024, "s3");
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
    const afterVote = f.module.reviews.status(f.auth("carol"), name, 64 * 1024, "s4");
    assert.ok("entries" in afterVote);
    assert.equal(afterVote.display, "applied");
    assert.deepEqual(afterVote.entries.map(e => [e.index, e.actor, e.kind, e.verdict]),
      [[1, "bob", "review", undefined], [2, "bob", "vote", "approve"]]);
    assert.deepEqual(afterVote.approvers, ["bob"]);
  } finally { f.close(); }
});
const messages0Id = (f: ReturnType<typeof fixture>, key: string): string =>
  f.store.getOperation("alice", key)!.id;

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
    assert.throws(() => f.module.reviews.status(f.auth("principal"), name, 64 * 1024, "p0"),
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
    await assert.rejects(f.module.reviews.record(f.auth("alice"), "ref", { kind: "refresh", name } as never),
      { code: "INVALID_REQUEST" });
    const pending = f.module.reviews.status(f.auth("bob"), name, 64 * 1024, "s5");
    assert.ok("entries" in pending); assert.equal(pending.display, "principal-pending");
    assert.equal(pending.principal.approval, approval2.id);
    assert.equal(pending.principal.sent, true); assert.equal(pending.principal.decision, null);
    const principalView = f.module.reviews.status(f.auth("principal"), name, 64 * 1024, "p2");
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
    const rejected = f.module.reviews.status(f.auth("dave"), name2, 64 * 1024, "s6");
    assert.ok("entries" in rejected); assert.equal(rejected.display, "rejected");
    // The reject itself withdrew the approval; the verdict lives in entries.
    assert.equal(rejected.principal.approval, null);
    assert.equal(rejected.principal.sent, true);
    assert.equal(rejected.principal.decision, null);
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
    const cancelledView = f.module.reviews.status(f.auth("dave"), name3, 64 * 1024, "s7");
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
    const appliedStatus = f.module.reviews.status(f.auth("bob"), name, 64 * 1024, "s8");
    assert.ok("entries" in appliedStatus); assert.equal(appliedStatus.display, "applied");
    assert.equal(appliedStatus.integration?.operation, applyOp.id);
    const principalApplied = f.module.reviews.status(f.auth("principal"), name, 64 * 1024, "p3");
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

test("mail-v1: review mode gates legacy attestations and direct integration, and vice versa", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await assert.rejects(f.module.attestations.record(f.auth("alice"), "legacy",
      { kind: "peer", identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: f.base, candidate,
        policyRevision: "p1" }, verdict: "APPROVE", evidence: "x" }),
      { code: "UNSUPPORTED_PROFILE" });
    await assert.rejects(f.module.integrate(f.auth("alice"), "direct", { candidate, expected: f.base, tier: "LOW" }),
      { code: "UNSUPPORTED_PROFILE" });
  } finally { f.close(); }
  const g = fixture({ review: false }); try {
    const candidate = g.candidateWith({ "one.txt": "a" });
    await g.submit("alice", candidate);
    await assert.rejects(g.open("alice", { tier: "LOW", candidate }, "open"), { code: "UNSUPPORTED_PROFILE" });
    const legacy = await g.module.attestations.record(g.auth("alice"), "legacy",
      { kind: "peer", identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: g.base, candidate,
        policyRevision: "p1" }, verdict: "APPROVE", evidence: "x" });
    assert.equal(legacy.state, "succeeded");
  } finally { g.close(); }
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
    const drifted = f.module.reviews.status(f.auth("bob"), name, 64 * 1024, "s10");
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
  id: "verify", argv: ["/usr/bin/true"], env: {}, timeoutSeconds: 60, tmpBytes: 1024 * 1024,
  resources: { memoryBytes: 16 * 1024 * 1024, tasks: 16, cpuQuotaPercent: 10, tmpBytes: 1024 * 1024,
    workspaceBytes: 64 * 1024 * 1024, stagingBytes: 32 * 1024 * 1024, checkTimeoutSeconds: 60 } };

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
    const failedStatus = f.module.reviews.status(f.auth("bob"), name, 64 * 1024, "s9");
    assert.ok("entries" in failedStatus);
    assert.equal(failedStatus.display, "blocked");
    assert.deepEqual(failedStatus.integration, { operation: apply.id, state: "failed", error: "CHECK_FAILED" });
    // A sweep never retries a settled integration.
    await f.module.reviews.advanceAll();
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

test("mail-v1: a busy writer refuses a cancel while a merge is executing", async () => {
  let release!: () => void; let checking = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture({ checks: [CHECK], runCheck: () => { checking = true; return gate; } });
  try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    const voting = f.vote("bob", name, "approve", "ok", "v-bob");
    while (!checking) await new Promise(resolve => setTimeout(resolve, 1));
    // The writer is held by the in-flight apply; cancel serializes and is busy.
    await assert.rejects(f.cancel("alice", name), (error: unknown) =>
      (error as { code: string }).code === "BROKER_UNAVAILABLE");
    await assert.rejects(f.module.reviews.advanceAll(), { code: "BROKER_UNAVAILABLE" });
    release();
    await voting;
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate, "the merge completed");
    assert.equal(f.stateOf(name).display, "applied");
  } finally { f.close(); }
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
    const stale = f.module.reviews.status(f.auth("bob"), name2, 64 * 1024, "s11");
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
    await f.module.reviews.advanceAll();
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
    const counting = new ReviewModule(f.store, f.mail, {
      policy: () => snapshotIntegrationPolicy(f.policy),
      currentPolicy: () => snapshotIntegrationPolicy(f.policy),
      verifyObjectFormat: () => {},
      main: () => createCanonicalObserver().ref(f.projectGit, "refs/heads/main"),
      published: () => createCanonicalObserver().published(f.projectGit),
      ancestry: (b, c) => createCanonicalObserver().ancestry(f.projectGit, b, c),
      changedPaths: (b, c) => createCanonicalObserver().changedPaths(f.projectGit, b, c),
      submitters: () => [],
      mergeDiff: (b, c, n) => { diffs++; return `diff-${b}-${c}-${"x".repeat(200)}`; },
      applyMerge: () => Promise.resolve(),
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
    await f.module.reviews.advanceAll();
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate, "applied once after recovery");
    const applied = f.applyOp("alice", "open")!;
    assert.equal(applied.state, "succeeded");
    await f.module.reviews.advanceAll();
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
    await h.module.reviews.advanceAll();
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
    const list = f.module.reviews.status(f.auth("bob"), undefined, 64 * 1024, "l1");
    assert.ok("requests" in list);
    assert.deepEqual(list.requests.map(r => r.name), [names[2], names[1], names[0]], "newest first");
    assert.deepEqual(list.requests.map(r => r.title), ["third", "second", "first"]);
    assert.equal(list.omitted, 0);
    assert.equal(list.main.oid, f.base);
    assert.equal(list.requests[0]!.kind, "merge"); assert.equal(list.requests[0]!.requester, "alice");
    // A smaller frame keeps only as many as fit; the rest are counted, not dropped.
    const fullBytes = Buffer.byteLength(JSON.stringify({ v: 1, id: "l1", ok: true, result: list }));
    const bounded = f.module.reviews.status(f.auth("bob"), undefined, fullBytes - 180, "l2");
    assert.ok("requests" in bounded);
    assert.ok(bounded.requests.length < 3 && bounded.requests.length >= 1,
      `expected a partial list at ${fullBytes - 180} bytes, got ${bounded.requests.length}`);
    assert.equal(bounded.omitted, 3 - bounded.requests.length);
    assert.equal(bounded.requests[0]!.name, names[2]);
    // A frame too small for anything still answers honestly.
    const empty = f.module.reviews.status(f.auth("bob"), undefined, 120, "l3");
    assert.ok("requests" in empty);
    assert.equal(empty.requests.length, 0); assert.equal(empty.omitted, 3);
  } finally { f.close(); }
});

test("mail-v1: review.status reports an unobservable main as null", async () => {
  const f = fixture(); try {
    rmSync(f.projectGit, { recursive: true, force: true });
    const status = f.module.reviews.status(f.auth("bob"), undefined, 64 * 1024, "m1");
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
      git: { reviews: f.module.reviews, knownRefs: unused, isPublished: () => false,
        submit: async () => unused(), integrate: async () => unused(), publishContext: async () => unused() },
      limits: { frameBytes: 64 * 1024, mailBodyBytes: 256 * 1024, subjectBytes: 512, addresses: 64,
        replyReferences: 64, contextFiles: 256, contextBytes: 8 * 1024 * 1024, bundleBytes: 256 * 1024 * 1024,
        logBytes: 1024 * 1024, batchMaxMessages: 24, idleStreamSeconds: 60, receiptWaitSeconds: 60 },
      waitRun: unused, isDraining: () => false, assertAdmission() {},
      admitResource: () => () => undefined, refreshViews() {},
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
    const unknown = await call("principal", { name: "merge-00000000" }) as { ok: boolean; error: { message: string } };
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
  } finally { f.close(); }
});
