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
    checks: [], tiered: { repositoryFloor: "LOW", highPeerFloor: 2,
      principalDelegated: options.principalDelegated ?? true, rules: [...(options.rules ?? [])],
      ...(options.review === false ? {} : { review: "mail-v1" as const }) } };
  const bounds = { mailBodyBytes: options.mailBodyBytes ?? 256 * 1024, subjectBytes: 512 };
  let module = new GitModule(paths, store, mail, policy,
    options.reader === undefined ? () => policy : () => options.reader!(policy),
    null, bounds);
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
  return { root, base, projectGit, git, candidateWith, submit, open, review, vote, cancel, requestName, stateOf, auth,
    get store() { return store; }, get mail() { return mail; }, get module() { return module; },
    reopen() { store.close(); store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
      mail = new MailModule(paths, store, 64); module = new GitModule(paths, store, mail, policy,
        options.reader === undefined ? () => policy : () => options.reader!(policy), null, bounds); },
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

test("mail-v1: a LOW merge request is accepted with no mail and is ready", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    const receipt = await f.open("alice", { tier: "LOW", candidate }, "open-low");
    assert.equal(receipt.state, "succeeded");
    const op = f.store.getOperation("alice", "open-low")!;
    assert.equal(op.kind, "attest.record");
    assert.deepEqual((op.plan as { messages: unknown[] }).messages, []);
    const name = f.requestName("open-low");
    assert.match(name, /^merge-[0-9a-f]{8}$/);
    const result = op.result as { request: string; messages: string[]; recipientCount: number };
    assert.equal(result.request, name); assert.deepEqual(result.messages, []); assert.equal(result.recipientCount, 0);
    const state = f.stateOf(name);
    assert.equal(state.ready, true); assert.equal(state.display, "applying");
    assert.equal(state.required, 0);
    // A LOW request has no review thread: votes and reviews are refused.
    await assert.rejects(f.vote("bob", name, "approve", "ok"), { code: "INVALID_REQUEST" });
    await assert.rejects(f.review("bob", name), { code: "INVALID_REQUEST" });
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
    const receipt = await f.open("alice", { tier: "LOW", candidate: stale, base: moved }, "ok");
    assert.equal(receipt.state, "succeeded");
    await assert.rejects(f.open("alice", { tier: "LOW", candidate: stale, base: moved }, "dup"), { code: "REQUEST_EXISTS" });
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
    const voted = await f.vote("bob", name, "approve", "bob approves", "v-bob");
    assert.equal(voted.state, "succeeded");
    const rev2 = messages(f, "bob", "v-bob")[0]!;
    assert.equal(rev2.review?.role === "thread" ? rev2.review.revision : -1, 2);
    const after = f.stateOf(name);
    assert.equal(after.ready, true); assert.equal(after.display, "applying");
    assert.deepEqual(after.approvers, ["bob"]);
    // The requester and a submitter may not vote on their own change.
    await assert.rejects(f.vote("alice", name, "approve", "self"), { code: "SELF_REVIEW" });
    const submitted = f.candidateWith({ "bob.txt": "b" });
    await f.submit("bob", submitted, "submit-by-bob");
    await f.open("alice", { tier: "MEDIUM", candidate: submitted }, "open-med2");
    const name2 = f.requestName("open-med2", "alice");
    await assert.rejects(f.vote("bob", name2, "approve", "self"), { code: "SELF_REVIEW" });
    // A Worker vote never names an approval.
    await assert.rejects(f.vote("bob", name, "approve", "sneaky", "v-sneaky", rev0.id), { code: "INVALID_REQUEST" });
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
    const decided = await f.vote("principal", name, "approve", "the Principal approves", "p-ok", approval2.id);
    assert.equal(decided.state, "succeeded");
    const decision = messages(f, "principal", "p-ok").find(m => m.review?.role === "decision")!;
    assert.equal(decision.kind, "result"); assert.deepEqual(decision.to, ["principal"]);
    const thread = messages(f, "principal", "p-ok").find(m => m.review?.role === "thread")!;
    assert.match(messageText(f.root, thread.id), /principal approve:\nthe Principal approves/);
    const decidedState = f.stateOf(name);
    assert.equal(decidedState.ready, true); assert.equal(decidedState.display, "applying");
    assert.equal(decidedState.principal?.actor, "principal");
    // A second HIGH request: the Principal rejects it outright.
    await f.open("alice", { tier: "HIGH", candidate: otherCandidate }, "open-hi2");
    const name2 = f.requestName("open-hi2");
    await f.vote("bob", name2, "approve", "bob ok", "v2-bob");
    await f.vote("carol", name2, "approve", "carol ok", "v2-carol");
    const approval3 = messages(f, "carol", "v2-carol").find(m => m.review?.role === "approval")!;
    await f.vote("principal", name2, "reject", "no", "p-rej", approval3.id);
    assert.equal(f.stateOf(name2).terminal, "rejected");
    await assert.rejects(f.vote("dave", name2, "approve", "late", "v2-dave"), { code: "REQUEST_CLOSED" });
    // Cancellation: only the requester; a sent approval is withdrawn.
    await assert.rejects(f.cancel("bob", name, "c-bob"), { code: "CAPABILITY_DENIED" });
    await f.open("alice", { tier: "HIGH", candidate: thirdCandidate }, "open-hi3");
    const name3 = f.requestName("open-hi3");
    await f.vote("bob", name3, "approve", "ok", "v3-bob");
    await f.vote("carol", name3, "approve", "ok", "v3-carol");
    const approval4 = messages(f, "carol", "v3-carol").find(m => m.review?.role === "approval")!;
    const cancelled = await f.cancel("alice", name3, "c-alice");
    assert.equal(cancelled.state, "succeeded");
    const withdrawn2 = messages(f, "alice", "c-alice").find(m => m.review?.role === "withdrawn")!;
    assert.equal(withdrawn2.review?.role === "withdrawn" ? withdrawn2.review.approval : null, approval4.id);
    assert.equal(f.stateOf(name3).terminal, "cancelled");
    await assert.rejects(f.vote("bob", name3, "approve", "late", "v3-late"), { code: "REQUEST_CLOSED" });
    // Authority boundaries: the Principal may only vote; refresh is never a caller input.
    await assert.rejects(f.open("principal", { tier: "LOW", candidate }, "p-open"), { code: "CAPABILITY_DENIED" });
    await assert.rejects(f.review("principal", name), { code: "CAPABILITY_DENIED" });
    await assert.rejects(f.cancel("principal", name, "p-cancel"), { code: "CAPABILITY_DENIED" });
    await assert.rejects(f.module.reviews.record(f.auth("alice"), "ref", { kind: "refresh", name } as never),
      { code: "INVALID_REQUEST" });
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
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "LOW", candidate }, "open-low");
    const name = f.requestName("open-low");
    const cancelled = await f.cancel("alice", name, "c-1");
    assert.equal(cancelled.state, "succeeded");
    assert.deepEqual(messages(f, "alice", "c-1"), []);
    assert.equal(f.stateOf(name).terminal, "cancelled");
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
