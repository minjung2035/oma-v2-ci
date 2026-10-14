/** mail-v1 mandatory (I48): the legacy tiered acceptance path is gone for fresh
 * requests -- a tiered society reviews with oma_merge/oma_challenge and refuses
 * direct git.integrate; a non-tiered society still integrates directly.
 * Durable tiered rows keep their exact decode and recovery semantics. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type { AuthContext, ExactCandidateIdentity, RiskTier } from "../implementation/contracts.js";
import { GitModule } from "../src/git.js";
import { MailModule } from "../src/mail.js";
import { Store, readDiagnosticSnapshot } from "../src/store.js";
import { inspectLedger } from "../src/diagnostics/ledger.js";
import { StoreError, AcceptedFailure } from "../src/domain/errors.js";
import { runGitText } from "../src/process/policies.js";
import type { IntegrationPolicy } from "../src/git/integration-policy.js";
import { snapshotIntegrationPolicy } from "../src/git/integration-policy.js";
import { authorizeCanonicalNoop, createCanonicalObserver } from "../src/git/canonical-command.js";
import { operationPlanCheck } from "../src/durable.js";
import { IntegrationPublicationObserver, consumeIntegrationPublication } from "../src/git/integration-publication.js";
import { evaluateTier } from "../src/domain/tier-evaluation.js";
import { requestHash } from "../src/hash.js";
import { messageIdForOperation } from "../src/domain/derived.js";
import { buildFrozenMessage } from "../src/mail/serialize.js";
import { messagePlanFrom } from "../src/mail/facts.js";
import { makeValidAgent, ALL_CAPS } from "./fixtures/spec.js";

const code = (value: string) => (error: unknown) => (error instanceof StoreError || error instanceof AcceptedFailure) && error.code === value;
async function* empty(): AsyncIterable<Uint8Array> {}
function fixture(options: { tiered?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "oma-tiered-")); const projectGit = join(root, "project.git");
  const git = (...args: string[]) => {
    const result = runGitText(args, { gitDir: projectGit, env: { GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@invalid",
      GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@invalid" } });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  assert.equal(runGitText(["init", "--bare", projectGit]).status, 0);
  const tree = git("mktree"); const base = git("commit-tree", tree, "-m", "base");
  const candidate = git("commit-tree", tree, "-p", base, "-m", "candidate"); git("update-ref", "refs/heads/main", base);
  let store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
  store.transaction(tx => { for (const actor of ["principal", "alice", "bob", "carol"])
    tx.insertAgent(makeValidAgent(actor, { createdBy: actor === "bob" ? "alice" : null })); });
  const paths = { stateRoot: root, projectGit, contextGit: join(root, "context.git"), worldDir: join(root, "world"),
    society: "demo", quarantineTmpBytes: 1024 * 1024 };
  let mail = new MailModule(paths, store, 64);
  const policy: IntegrationPolicy = { policyRevision: "p1", protectedPaths: [], checks: [],
    ...(options.tiered === false ? {} : { tiered: {
      review: "mail-v1" as const, repositoryFloor: "LOW", highPeerFloor: 2, principalDelegated: true, rules: [] } }) };
  let module = new GitModule(paths, store, mail, policy, () => policy);
  const auth = (actor = "alice"): AuthContext => ({ actor, role: actor === "principal" ? "principal" : "resident",
    incarnation: actor === "principal" ? 0 : 1, capabilities: new Set(ALL_CAPS), channel: "actor",
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } });
  const identity = (oid = candidate, expected = base): ExactCandidateIdentity => ({ repo: "project", targetRef: "refs/heads/main",
    expectedBase: expected, candidate: oid, policyRevision: policy.policyRevision });
  const submit = (actor = "alice", oid = candidate, key = "submit") => module.submit(auth(actor), key, {
    candidate: oid, exportRef: "refs/oma/export/test", prerequisites: [], to: [], paths: [], subject: "candidate", body: "submitted candidate", }, empty());
  return { root, git, base, candidate, policy, auth, identity, submit,
    get store() { return store; }, get mail() { return mail; }, get module() { return module; },
    reopen() { store.close(); store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
      mail = new MailModule(paths, store, 64); module = new GitModule(paths, store, mail, policy, () => policy); },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("a non-tiered society integrates a submitted candidate directly and replays the receipt", async t => {
  const f = fixture({ tiered: false }); t.after(() => f.close());
  await f.submit();
  const request = { candidate: f.candidate, expected: f.base };
  const receipt = await f.module.integrate(f.auth(), "integrate", request);
  assert.equal(receipt.state, "succeeded");
  assert.equal(f.git("rev-parse", "refs/heads/main"), f.candidate);
  const row = f.store.getOperation("alice", "integrate")!; assert.equal(row.kind, "git.integrate");
  if (row.kind !== "git.integrate") return;
  assert.equal(row.plan.publication, undefined, "non-tiered integration owns no publication mail");
  assert.equal(row.plan.merge, undefined);
  assert.deepEqual(await f.module.integrate(f.auth(), "integrate", request), receipt);
  const report = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" }).report;
  assert.equal(report.status, "PASS", JSON.stringify(report));
});

test("a non-tiered society rejects a tier request and a tiered society rejects direct integration", async t => {
  const flat = fixture({ tiered: false }); t.after(() => flat.close());
  await flat.submit();
  await assert.rejects(flat.module.integrate(flat.auth(), "tiered", { candidate: flat.candidate, expected: flat.base, tier: "LOW" }),
    code("UNSUPPORTED_PROFILE"));
  const f = fixture(); t.after(() => f.close());
  await f.submit();
  await assert.rejects(f.module.integrate(f.auth(), "direct", { candidate: f.candidate, expected: f.base, tier: "LOW" }),
    code("UNSUPPORTED_PROFILE"));
  // And the removed legacy attestation kinds are refused at fresh acceptance.
  await assert.rejects(f.module.attestations.record(f.auth("alice"), "legacy",
    { kind: "peer", identity: f.identity(), verdict: "APPROVE", evidence: "Exact candidate reviewed" }),
    code("UNSUPPORTED_PROFILE"));
});

/** A pending git.integrate with a tiered publication, as a society accepted it
 * before the mail-v1 mandatory floor or under it: the retained evidence decides
 * recovery, not today's defaults. */
async function pendingTieredRow(f: ReturnType<typeof fixture>, id: string) {
  const snapshot = snapshotIntegrationPolicy(f.policy);
  const tieredPolicy = f.policy.tiered!;
  const evidence = { tiered: tieredPolicy, protectedPaths: snapshot.protectedPaths, checks: snapshot.checks };
  const authoritySnapshot = { identity: f.identity(), requester: "alice", requested: "LOW" as RiskTier,
    deterministic: { tier: "LOW" as RiskTier, reasons: [] }, repositoryFloor: tieredPolicy.repositoryFloor,
    highPeerFloor: tieredPolicy.highPeerFloor, principalDelegated: tieredPolicy.principalDelegated,
    submitters: ["alice"], eligibleResidents: [], floors: [], scopeAssessments: [], reviews: [] };
  const evaluated = evaluateTier(authoritySnapshot);
  assert.equal(evaluated.effectiveTier, "LOW"); assert.deepEqual(evaluated.missing, []);
  const accepted = { requested: "LOW", effective: evaluated.effectiveTier, policyDigest: snapshot.policyIdentity,
    authorityDigest: evaluated.digest, reasons: evaluated.reasons, approvers: evaluated.approvers,
    objections: evaluated.objections, principalDecision: evaluated.principalDecision,
    activeFloors: evaluated.activeFloors, snapshot: authoritySnapshot, policy: evidence };
  // The frozen object is real emitted mail: id/sha256/bytes and every header
  // the materializer re-checks come from the same serializer production used.
  const messageId = messageIdForOperation(id, 0);
  const recipients = ["alice", "bob", "carol"];
  const eml = await buildFrozenMessage({ id: messageId, sender: "alice", society: "demo",
    to: ["commons"], kind: "result", contextRevision: null,
    replyHeaders: { replyTo: ["commons"], inReplyTo: null, references: [] } },
    { subject: "Canonical integration", body: "Tiered integration applied." });
  const message = messagePlanFrom(eml, recipients);
  f.mail.freezeObject(message.id, eml);
  const plan = { kind: "git.integrate", repo: "project", target: "refs/heads/main", base: f.base,
    candidate: f.candidate, policyRevision: "p1", checkProfileDigest: snapshot.checkProfileDigest,
    publication: { tiered: accepted, noopRef: null, message } };
  const payload = { candidate: f.candidate, expected: f.base, tier: "LOW" };
  f.store.transaction(tx => {
    tx.acceptOperation({ id, actor: "alice", requestKey: "tiered-pending", kind: "git.integrate",
      requestHash: requestHash("git.integrate", payload), payloadJson: JSON.stringify(payload),
      planJson: JSON.stringify(plan) });
    tx.insertDeliveries(recipients.map(recipient => ({ operationId: id, messageId, recipient })));
  });
  return { messageId, plan, payload };
}

test("an accepted tiered publication plan still decodes exactly and rejects drift", async t => {
  const f = fixture(); t.after(() => f.close()); await f.submit();
  const id = "op-00000000-0000-4000-8000-000000000101";
  const { plan } = await pendingTieredRow(f, id);
  const row = f.store.getOperationById(id)!; assert.equal(row.kind, "git.integrate");
  const check = operationPlanCheck("git.integrate", { operationId: id, actor: "alice",
    stateRoot: f.root, repositoryIdentity: { society: "demo" } });
  assert.equal(check(JSON.parse(row.planJson)), null, JSON.stringify(plan));
  const original = JSON.parse(row.planJson);
  const changes: Array<(plan: typeof original) => void> = [
    plan => { plan.publication.tiered.effective = "HIGH"; },
    plan => { plan.publication.tiered.approvers.push("bob"); },
    plan => { plan.publication.tiered.snapshot.eligibleResidents = ["mallory"]; },
    plan => { plan.publication.tiered.snapshot.identity.expectedBase = f.candidate; },
    plan => { plan.publication.tiered.policy.tiered.repositoryFloor = "HIGH"; },
    plan => { plan.publication.tiered.authorityDigest = "0".repeat(64); },
    plan => { delete plan.publication.tiered.snapshot; },
    plan => { plan.candidate = f.base; },
  ];
  for (const mutate of changes) { const altered = structuredClone(original); mutate(altered); assert.notEqual(check(altered), null); }
  // The frozen recipient set is owned by the delivery rows: drifting it is
  // corruption at full decode even though the plan's own grammar still parses.
  const db = new DatabaseSync(join(f.root, "runtime.sqlite"));
  try {
    const drifted = structuredClone(original); drifted.publication.message.recipients = ["mallory"];
    db.prepare("UPDATE operations SET plan_json = ? WHERE id = ?").run(JSON.stringify(drifted), id);
    assert.throws(() => f.store.getOperationById(id), code("STORE_CORRUPT"));
  } finally { db.close(); }
});

test("a pending tiered publication row reconciles under its retained policy, once", async t => {
  const f = fixture(); t.after(() => f.close()); await f.submit();
  const id = "op-00000000-0000-4000-8000-000000000102";
  const { messageId, plan } = await pendingTieredRow(f, id);
  await f.module.reconcile(id);
  const row = f.store.getOperationById(id)!;
  assert.equal(row.state, "succeeded");
  assert.equal(row.planJson, JSON.stringify(plan), "recovery never rewrites the accepted plan");
  assert.equal(f.git("rev-parse", "refs/heads/main"), f.candidate);
  assert.ok(existsSync(f.mail.archivePath(messageId)), "the plan's frozen publication mail is materialized");
  // Reconciliation is idempotent and does not double-publish.
  await f.module.reconcile(id);
  assert.equal(f.store.getOperationById(id)!.state, "succeeded");
});

test("a no-op witness is not created when main differs; a matching witness survives main moving later", t => {
  const f = fixture(); t.after(() => f.close()); const observer = createCanonicalObserver(); const ref = "refs/oma/integrations/test";
  const repository = join(f.root, "project.git");
  assert.equal(authorizeCanonicalNoop(observer, repository, ref, f.candidate).kind, "absent");
  const first = authorizeCanonicalNoop(observer, repository, ref, f.base); assert.equal(first.kind, "present");
  f.git("update-ref", "refs/heads/main", f.candidate, f.base);
  const witness = observer.ref(repository, ref); assert.equal(witness.kind, "present");
  if (witness.kind === "present") assert.equal(witness.value, f.base);
});

test("publication proof is observed, exact and single-use for a pending publication row", async t => {
  const f = fixture(); t.after(() => f.close()); const oid = f.candidate; await f.submit("alice", oid);
  const id = "op-00000000-0000-4000-8000-000000000103";
  await pendingTieredRow(f, id);
  // The publication proof is the applied canonical effect: main must already
  // name the candidate before the observer mints evidence.
  f.git("update-ref", "refs/heads/main", f.candidate);
  const observer = createCanonicalObserver(); const repository = join(f.root, "project.git");
  const proofOwner = new IntegrationPublicationObserver({ main: () => observer.ref(repository, "refs/heads/main"),
    noopWitness: ref => observer.ref(repository, ref) });
  const row = f.store.getOperationById(id)!;
  if (row.kind !== "git.integrate") return assert.fail("wrong kind");
  for (const value of [null, true, {}, JSON.parse("{}")]) assert.throws(() => consumeIntegrationPublication(value, row), code("REF_STATE_UNKNOWN"));
  const proof = proofOwner.integration(row); consumeIntegrationPublication(proof, row);
  assert.throws(() => consumeIntegrationPublication(proof, row), code("REF_STATE_UNKNOWN"));
  const falseObservation = new IntegrationPublicationObserver({ main: () => observer.ref(repository, "refs/missing"),
    noopWitness: () => observer.ref(repository, "refs/missing") });
  assert.throws(() => falseObservation.integration(row), code("REF_STATE_UNKNOWN"));
});
