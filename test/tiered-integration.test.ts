import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, ExactCandidateIdentity, RiskTier } from "../implementation/contracts.js";
import { GitModule } from "../src/git.js";
import { MailModule } from "../src/mail.js";
import { Store, readDiagnosticSnapshot } from "../src/store.js";
import { inspectLedger } from "../src/diagnostics/ledger.js";
import { StoreError, AcceptedFailure } from "../src/domain/errors.js";
import { runGitText } from "../src/process/policies.js";
import type { IntegrationPolicy } from "../src/git/integration-policy.js";
import { authorizeCanonicalNoop, createCanonicalObserver } from "../src/git/canonical-command.js";
import { operationPlanCheck } from "../src/durable.js";
import { IntegrationPublicationObserver, consumeIntegrationPublication } from "../src/git/integration-publication.js";
import { makeValidAgent, ALL_CAPS } from "./fixtures/spec.js";

const code = (value: string) => (error: unknown) => (error instanceof StoreError || error instanceof AcceptedFailure) && error.code === value;
async function* empty(): AsyncIterable<Uint8Array> {}
function fixture() {
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
  const policy: IntegrationPolicy = { policyRevision: "p1", protectedPaths: [], checks: [], tiered: {
    repositoryFloor: "LOW", highPeerFloor: 2, principalDelegated: true, rules: [] } };
  let module = new GitModule(paths, store, mail, policy, () => policy);
  const auth = (actor = "alice"): AuthContext => ({ actor, role: actor === "principal" ? "principal" : "resident",
    incarnation: actor === "principal" ? 0 : 1, capabilities: new Set(ALL_CAPS), channel: "actor",
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } });
  const identity = (oid = candidate, expected = base): ExactCandidateIdentity => ({ repo: "project", targetRef: "refs/heads/main",
    expectedBase: expected, candidate: oid, policyRevision: policy.policyRevision });
  const submit = (actor = "alice", oid = candidate, key = "submit") => module.submit(auth(actor), key, {
    candidate: oid, exportRef: "refs/oma/export/test", prerequisites: [], to: [], paths: [], subject: "candidate", body: "submitted candidate", }, empty());
  const peer = (actor: string, verdict: "APPROVE" | "OBJECT", key = `${verdict}-${actor}`, oid = candidate) =>
    module.attestations.record(auth(actor), key, { kind: "peer", identity: identity(oid), verdict, evidence: "Exact candidate reviewed" });
  return { root, git, base, candidate, policy, auth, identity, submit, peer,
    get store() { return store; }, get mail() { return mail; }, get module() { return module; },
    reopen() { store.close(); store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
      mail = new MailModule(paths, store, 64); module = new GitModule(paths, store, mail, policy, () => policy); },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
for (const tier of ["LOW", "MEDIUM", "HIGH"] as const) test(`DR27: real Git ${tier} integrates exact candidate and publishes only after CAS`, async t => {
  const f = fixture(); t.after(() => f.close()); await f.submit();
  if (tier !== "LOW") await f.peer("bob", "APPROVE");
  if (tier === "HIGH") {
    await f.peer("carol", "APPROVE");
    await f.module.attestations.record(f.auth("principal"), "accept", {
      kind: "decision", identity: f.identity(), verdict: "ACCEPT", evidence: "High-level review" });
  }
  const publish = f.mail.publishGated.bind(f.mail); let integrationMail = 0;
  f.mail.publishGated = async (id, proof) => {
    const row = f.store.getOperationById(id)!;
    if (row.kind === "git.integrate") {
      integrationMail++; assert.equal(f.git("rev-parse", "refs/heads/main"), f.candidate);
      assert.equal(existsSync(f.mail.archivePath(row.plan.publication!.message.id)), false);
      await assert.rejects(publish(id), code("REF_STATE_UNKNOWN"));
    }
    return publish(id, proof);
  };
  const request = { candidate: f.candidate, expected: f.base, tier };
  const receipt = await f.module.integrate(f.auth(), "integrate", request);
  assert.equal(receipt.state, "succeeded"); assert.equal(integrationMail, 1);
  const row = f.store.getOperation("alice", "integrate")!; assert.equal(row.kind, "git.integrate");
  if (row.kind !== "git.integrate") return;
  assert.equal(row.plan.publication!.tiered.effective, tier); assert.equal(row.plan.publication!.noopRef, null);
  assert.deepEqual(row.plan.publication!.message.recipients, ["alice", "bob", "carol"]);
  assert.match(readFileSync(f.mail.archivePath(row.plan.publication!.message.id), "utf8"), /Canonical integration/);
  assert.deepEqual(await f.module.integrate(f.auth(), "integrate", request), receipt); assert.equal(integrationMail, 1);
  const report = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" }).report;
  assert.equal(report.status, "PASS", JSON.stringify(report));
});

test("DR27: republishing cannot turn an authenticated submitter into an eligible reviewer; a distinct child can approve", async t => {
  const f = fixture(); t.after(() => f.close()); await f.submit(); await f.submit("bob");
  await f.peer("alice", "APPROVE"); await f.peer("bob", "APPROVE");
  const request = { candidate: f.candidate, expected: f.base, tier: "MEDIUM" as RiskTier };
  await assert.rejects(f.module.integrate(f.auth("bob"), "no-self", request), code("INTEGRATION_CONDITIONS"));
  assert.equal(f.store.getOperation("bob", "no-self"), null);
  await f.peer("carol", "APPROVE");
  assert.equal((await f.module.integrate(f.auth("bob"), "no-self", request)).state, "succeeded");
});

test("DR27: active OBJECT blocks LOW until its own author revokes; high approval cannot erase it", async t => {
  const f = fixture(); t.after(() => f.close()); await f.submit(); await f.peer("bob", "OBJECT");
  const objection = f.store.getOperation("bob", "OBJECT-bob")!;
  await f.module.attestations.record(f.auth("principal"), "accept", { kind: "decision", identity: f.identity(), verdict: "ACCEPT", evidence: "review" });
  const request = { candidate: f.candidate, expected: f.base, tier: "LOW" as RiskTier };
  await assert.rejects(f.module.integrate(f.auth(), "integrate", request), code("INTEGRATION_CONDITIONS"));
  assert.equal(f.git("rev-parse", "refs/heads/main"), f.base);
  await f.module.attestations.record(f.auth("bob"), "revoke", { kind: "revoke", attestation: objection.id, evidence: "resolved" });
  assert.equal((await f.module.integrate(f.auth(), "integrate", request)).state, "succeeded");
});

for (const noop of [false, true]) test(`DR27: ${noop ? "no-op authorization" : "CAS"} survives publication failure, restart and authority changes without replay`, async t => {
  const f = fixture(); t.after(() => f.close()); const oid = noop ? f.base : f.candidate; await f.submit("alice", oid);
  const publish = f.mail.publishGated.bind(f.mail); let calls = 0;
  f.mail.publishGated = async (id, proof) => { calls++; await publish(id, proof); throw new StoreError("BROKER_UNAVAILABLE", "after archive, before success"); };
  assert.equal((await f.module.integrate(f.auth(), "integrate", { candidate: oid, expected: f.base, tier: "LOW" })).state, "pending");
  assert.equal(calls, 1);
  const before = f.store.getOperation("alice", "integrate")!; assert.equal(before.kind, "git.integrate");
  assert.equal(before.state, "pending"); if (before.kind !== "git.integrate") return;
  const message = before.plan.publication!.message; const bytes = readFileSync(f.mail.archivePath(message.id));
  f.store.transaction(tx => { tx.updateAgent({ name: "alice", desired: "stopped" }); tx.insertAgent(makeValidAgent("later")); });
  f.policy.policyRevision = "p2"; f.policy.tiered!.principalDelegated = false;
  f.reopen(); await f.module.reconcile(before.id);
  const after = f.store.getOperationById(before.id)!; assert.equal(after.state, "succeeded"); assert.equal(after.planJson, before.planJson);
  assert.deepEqual(readFileSync(f.mail.archivePath(message.id)), bytes); assert.equal(f.store.deliveries.get(message.id, "later"), null);
  assert.equal(f.git("rev-parse", "refs/heads/main"), oid);
});

test("DR27: a no-op witness is not created when main differs; a matching witness survives main moving later", t => {
  const f = fixture(); t.after(() => f.close()); const observer = createCanonicalObserver(); const ref = "refs/oma/integrations/test";
  const repository = join(f.root, "project.git");
  assert.equal(authorizeCanonicalNoop(observer, repository, ref, f.candidate).kind, "absent");
  const first = authorizeCanonicalNoop(observer, repository, ref, f.base); assert.equal(first.kind, "present");
  f.git("update-ref", "refs/heads/main", f.candidate, f.base);
  const witness = observer.ref(repository, ref); assert.equal(witness.kind, "present");
  if (witness.kind === "present") assert.equal(witness.value, f.base);
});

test("DR27: challenge floor survives reopen and new candidate identities; exact outside scope does not spread by ancestry", async t => {
  const f = fixture(); t.after(() => f.close()); await f.submit();
  const integrated = await f.module.integrate(f.auth(), "first", { candidate: f.candidate, expected: f.base, tier: "LOW" });
  await f.module.attestations.record(f.auth("bob"), "challenge", { kind: "challenge", integration: integrated.operation,
    identity: f.identity(), evidence: "Missing validation on the write path" });
  const challenge = f.store.getOperation("bob", "challenge")!;
  await f.module.attestations.record(f.auth("principal"), "finding", { kind: "finding", challenge: challenge.id,
    valid: true, floor: "HIGH", scope: "Writes that bypass validation, independent of file or patch spelling", evidence: "Confirmed" });
  const finding = f.store.getOperation("principal", "finding")!;
  f.reopen();
  // These are not patch/ancestry assertions of scope: both new identities must be assessed.
  const tree = f.git("rev-parse", `${f.candidate}^{tree}`);
  const next = f.git("commit-tree", tree, "-p", f.candidate, "-m", "altered validation implementation");
  const outside = f.git("commit-tree", tree, "-p", f.candidate, "-m", "unrelated followup");
  await f.submit("alice", next, "altered-submit"); await f.submit("alice", outside, "unrelated-submit");
  const exact = f.identity(next, f.candidate), unrelated = f.identity(outside, f.candidate);
  const request = { candidate: next, expected: f.candidate, tier: "LOW" as const };
  await assert.rejects(f.module.integrate(f.auth(), "altered", request), error => {
    assert.ok(code("INTEGRATION_CONDITIONS")(error));
    assert.match((error as StoreError).details!.missing as string, /scope assessment/); return true;
  });
  await f.module.attestations.record(f.auth("principal"), "inside", { kind: "scope", finding: finding.id,
    identity: exact, applies: true, evidence: "The altered candidate still changes that write path" });
  await assert.rejects(f.module.integrate(f.auth(), "altered", request), error => {
    assert.equal((error as StoreError).details?.effectiveTier, "HIGH"); return code("INTEGRATION_CONDITIONS")(error);
  });
  await f.module.attestations.record(f.auth("principal"), "outside", { kind: "scope", finding: finding.id,
    identity: unrelated, applies: false, evidence: "No change to the scoped behavior" });
  const result = await f.module.integrate(f.auth(), "unrelated", { candidate: outside, expected: f.candidate, tier: "LOW" });
  assert.equal(result.state, "succeeded");
  assert.ok(result.result?.kind === "git.integrate"); assert.equal(result.result.publication?.effectiveTier, "LOW");
});

test("DR27: fact arriving during mail preparation is rechecked before acceptance; no result mail leaks", async t => {
  const f = fixture(); t.after(() => f.close()); await f.submit();
  const freeze = f.mail.freezeIntegration.bind(f.mail); let preparedMessage = "";
  f.mail.freezeIntegration = async (...args) => {
    const prepared = await freeze(...args); preparedMessage = prepared.message.id;
    await f.peer("bob", "OBJECT"); return prepared;
  };
  await assert.rejects(f.module.integrate(f.auth(), "raced", { candidate: f.candidate, expected: f.base, tier: "LOW" }), code("INTEGRATION_CONDITIONS"));
  assert.equal(f.store.getOperation("alice", "raced"), null);
  assert.equal(existsSync(f.mail.archivePath(preparedMessage)), false);
  assert.equal(existsSync(f.mail.objectPath(preparedMessage)), false);
  assert.equal(f.git("rev-parse", "refs/heads/main"), f.base);
});


test("DR27: accepted authority retains its policy and rejects corrupted evidence without current reauthorization", async t => {
  const f = fixture(); t.after(() => f.close()); await f.submit(); await f.peer("bob", "APPROVE");
  const receipt = await f.module.integrate(f.auth(), "retained", { candidate: f.candidate, expected: f.base, tier: "MEDIUM" });
  assert.equal(receipt.state, "succeeded");
  const operation = f.store.getOperationById(receipt.operation)!;
  if (operation.kind !== "git.integrate") return assert.fail("wrong kind");
  const check = operationPlanCheck("git.integrate", { operationId: operation.id, actor: operation.actor,
    stateRoot: f.root, repositoryIdentity: { society: "demo" } });
  const original = JSON.parse(operation.planJson);
  assert.equal(check(original), null);
  const changes: Array<(plan: typeof original) => void> = [
    plan => { plan.publication.tiered.effective = "LOW"; },
    plan => { plan.publication.tiered.approvers.push("bob"); },
    plan => { plan.publication.tiered.approvers = ["principal"]; },
    plan => { plan.publication.tiered.approvers = ["alice"]; },
    plan => { plan.publication.tiered.snapshot.reviews[0].revoked = true; },
    plan => { plan.publication.tiered.snapshot.eligibleResidents = []; },
    plan => { plan.publication.tiered.snapshot.identity.expectedBase = f.candidate; },
    plan => { plan.publication.tiered.policy.tiered.repositoryFloor = "HIGH"; },
    plan => { plan.publication.tiered.policy.protectedPaths = ["/"]; },
    plan => { plan.publication.tiered.authorityDigest = "0".repeat(64); },
    plan => { delete plan.publication.tiered.snapshot; },
  ];
  for (const mutate of changes) { const altered = structuredClone(original); mutate(altered); assert.notEqual(check(altered), null); }
  await f.module.attestations.record(f.auth("bob"), "late-revoke", { kind: "revoke",
    attestation: f.store.getOperation("bob", "APPROVE-bob")!.id, evidence: "Later review changed" });
  f.store.transaction(tx => tx.updateAgent({ name: "bob", desired: "stopped" }));
  f.policy.policyRevision = "p2"; f.reopen();
  assert.equal(f.store.getOperationById(operation.id)!.planJson, operation.planJson);
  assert.equal(f.store.getOperationById(operation.id)!.state, "succeeded");
});

test("DR27: unrelated Worker creation during preparation does not revoke exact integration evidence", async t => {
  const f = fixture(); t.after(() => f.close()); await f.submit(); await f.peer("bob", "APPROVE");
  const freeze = f.mail.freezeIntegration.bind(f.mail);
  f.mail.freezeIntegration = async (...args) => {
    const prepared = await freeze(...args);
    f.store.transaction(tx => tx.insertAgent(makeValidAgent("unrelated"))); return prepared;
  };
  const receipt = await f.module.integrate(f.auth(), "unrelated-create", { candidate: f.candidate, expected: f.base, tier: "MEDIUM" });
  assert.equal(receipt.state, "succeeded");
  const row = f.store.getOperationById(receipt.operation)!;
  if (row.kind !== "git.integrate") return assert.fail("wrong kind");
  assert.ok(row.plan.publication!.message.recipients.includes("unrelated"), "recipient membership still freezes at acceptance");
});

for (const noop of [false, true]) test(`DR27: ${noop ? "no-op" : "CAS"} publication proof is observed, exact and single-use`, async t => {
  const f = fixture(); t.after(() => f.close()); const oid = noop ? f.base : f.candidate; await f.submit("alice", oid);
  const observer = createCanonicalObserver(); const repository = join(f.root, "project.git");
  const proofOwner = new IntegrationPublicationObserver({ main: () => observer.ref(repository, "refs/heads/main"),
    noopWitness: ref => observer.ref(repository, ref) });
  f.mail.publishGated = async () => { throw new StoreError("BROKER_UNAVAILABLE", "sink unavailable"); };
  const receipt = await f.module.integrate(f.auth(), "proof", { candidate: oid, expected: f.base, tier: "LOW" });
  assert.equal(receipt.state, "pending"); const row = f.store.getOperationById(receipt.operation)!;
  if (row.kind !== "git.integrate") return assert.fail("wrong kind");
  for (const value of [null, true, {}, JSON.parse("{}")]) assert.throws(() => consumeIntegrationPublication(value, row), code("REF_STATE_UNKNOWN"));
  const proof = proofOwner.integration(row); consumeIntegrationPublication(proof, row);
  assert.throws(() => consumeIntegrationPublication(proof, row), code("REF_STATE_UNKNOWN"));
  const falseObservation = new IntegrationPublicationObserver({ main: () => observer.ref(repository, "refs/missing"),
    noopWitness: () => observer.ref(repository, "refs/missing") });
  assert.throws(() => falseObservation.integration(row), code("REF_STATE_UNKNOWN"));
});
