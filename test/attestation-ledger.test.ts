import { readableBody } from "../src/mail/display.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { AuthContext, ExactCandidateIdentity } from "../implementation/contracts.js";
import { AttestationModule } from "../src/attestation.js";
import { MailModule } from "../src/mail.js";
import { Store, readDiagnosticSnapshot } from "../src/store.js";
import { StoreError } from "../src/domain/errors.js";
import { inspectLedger } from "../src/diagnostics/ledger.js";
import { reconcileOrdinaryMail } from "../src/mail/reconcile.js";
import { attestationSnapshot } from "../src/git/attestation-snapshot.js";
import { requestHash } from "../src/hash.js";
import { makeValidAgent, ALL_CAPS } from "./fixtures/spec.js";

const identity: ExactCandidateIdentity = { repo: "project", targetRef: "refs/heads/main", expectedBase: "1".repeat(40),
  candidate: "2".repeat(40), policyRevision: "p1" };
const peer = { kind: "peer", identity, verdict: "APPROVE", evidence: "Read the exact diff" } as const;
const isCode = (code: string) => (error: unknown) => error instanceof StoreError && error.code === code;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-attestation-")); const path = join(root, "runtime.sqlite");
  let now = 100;
  const store = new Store(path, 0, { society: "demo" }, () => now);
  store.transaction(tx => { tx.insertAgent(makeValidAgent("principal")); tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" }));
    tx.insertAgent(makeValidAgent("bob", { createdBy: "alice" })); });
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
  let delegated = true; let exact = true; let observations = 0;
  const module = new AttestationModule(store, mail, { exact(value) {
    observations++; assert.equal(store.inTransaction, false); assert.deepEqual(value, identity);
    if (!exact) throw new StoreError("STALE_BASE", "candidate changed");
  }, principal() { if (!delegated) throw new StoreError("CAPABILITY_DENIED", "not delegated"); } });
  const auth = (actor = "alice"): AuthContext => ({ actor, role: actor === "principal" ? "principal" : "resident",
    incarnation: actor === "principal" ? 0 : 1, capabilities: new Set(ALL_CAPS), channel: "actor",
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } });
  return { root, path, store, mail, module, auth, observations: () => observations, time: (value: number) => now = value,
    delegation: (value: boolean) => delegated = value, exact: (value: boolean) => exact = value,
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("DR27: accepted fact, commons mail and receipt share one stable identity; retry does not reauthorize", async t => {
  const f = fixture(); t.after(() => f.close());
  const receipt = await f.module.record(f.auth(), "review", peer);
  assert.equal(receipt.state, "succeeded");
  const { operation, sequence } = f.store.attestations.all()[0]!;
  assert.equal(sequence, 1); assert.equal(operation!.actor, "alice");
  assert.ok(!("messages" in operation!.plan));
  assert.deepEqual(operation!.plan.message.to, ["commons"]);
  assert.deepEqual(operation!.plan.message.recipients, ["alice", "bob"]);
  assert.equal(f.store.deliveries.forOperation(operation!.id).length, 2);
  assert.equal(JSON.parse(readableBody(readFileSync(f.mail.archivePath(operation!.plan.message.id), "utf8"))).evidence, "Read the exact diff");
  assert.equal(f.observations(), 2);
  f.store.transaction(tx => tx.updateAgent({ name: "alice", desired: "stopped" })); f.exact(false);
  assert.deepEqual(await f.module.record(f.auth(), "review", peer), receipt);
  assert.equal(f.store.attestations.all().length, 1);
  await assert.rejects(f.module.record(f.auth(), "review", { ...peer, verdict: "OBJECT" }), isCode("REQUEST_KEY_REUSED"));
  await assert.rejects(f.module.record(f.auth(), "new", peer), isCode("STALE_RUN"));
  await assert.rejects(f.module.record({ ...f.auth(), incarnation: 0 }, "review", peer), isCode("STALE_RUN"));
  const report = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" }).report;
  assert.equal(report.status, "PASS", JSON.stringify(report));
});

test("DR27: publication failure retains the fact; recovery publishes its original recipient snapshot", async t => {
  const f = fixture(); t.after(() => f.close());
  const materialize = f.mail.materialize.bind(f.mail);
  f.mail.materialize = async () => { throw new StoreError("BROKER_UNAVAILABLE", "injected publication failure"); };
  const first = await f.module.record(f.auth(), "pending-review", peer); assert.equal(first.state, "pending");
  const before = f.store.attestations.all()[0]!.operation;
  assert.equal(attestationSnapshot(f.store.attestations.all(), identity).reviews.length, 1);
  f.store.transaction(tx => { tx.updateAgent({ name: "alice", desired: "stopped" }); tx.insertAgent(makeValidAgent("later")); });
  f.mail.materialize = materialize;
  const result = await reconcileOrdinaryMail(f.store, f.mail);
  assert.equal(result.repaired, 1);
  const after = f.store.attestations.all()[0]!.operation;
  assert.equal(after.planJson, before.planJson); assert.equal(after.state, "succeeded");
  assert.ok(!("messages" in after.plan));
  assert.deepEqual(after.plan.message.recipients, ["alice", "bob"]);
  assert.equal(f.store.deliveries.get(after.plan.message.id, "later"), null);
});

test("DR27: only an author revokes; Principal order survives clock rollback and revocation", async t => {
  const f = fixture(); t.after(() => f.close());
  await f.module.record(f.auth(), "approve", peer);
  const first = f.store.attestations.all()[0]!.operation;
  await assert.rejects(f.module.record(f.auth("bob"), "other-revoke", { kind: "revoke", attestation: first.id, evidence: "not mine" }), isCode("INVALID_REQUEST"));
  await f.module.record(f.auth(), "own-revoke", { kind: "revoke", attestation: first.id, evidence: "new evidence" });
  f.time(90);
  await f.module.record(f.auth("principal"), "accept", { kind: "decision", identity, verdict: "ACCEPT", evidence: "read" });
  f.time(80);
  await f.module.record(f.auth("principal"), "reject", { kind: "decision", identity, verdict: "REJECT", evidence: "found problem" });
  const reject = f.store.attestations.all().at(-1)!.operation;
  f.delegation(false);
  await f.module.record(f.auth("principal"), "withdraw", { kind: "revoke", attestation: reject.id, evidence: "withdrawn, not an acceptance" });
  const reviews = attestationSnapshot(f.store.attestations.all(), identity).reviews;
  assert.equal(reviews[0]!.revoked, true); assert.equal(reviews.at(-1)!.value, "REJECT"); assert.equal(reviews.at(-1)!.revoked, true);
  assert.ok(reviews.at(-1)!.sequence > reviews.at(-2)!.sequence);
  await assert.rejects(f.module.record(f.auth("principal"), "not-delegated", { kind: "decision", identity, verdict: "ACCEPT", evidence: "read" }), isCode("CAPABILITY_DENIED"));
  await assert.rejects(f.module.record(f.auth(), "not-principal", { kind: "decision", identity, verdict: "ACCEPT", evidence: "read" }), isCode("INVALID_REQUEST"));
});

test("DR27: challenges require actual exact successful integration; floors and scoped exemptions are explicit", async t => {
  const f = fixture(); t.after(() => f.close());
  const id = "op-00000000-0000-4000-8000-000000000003";
  const payload = { candidate: identity.candidate, expected: identity.expectedBase };
  const plan = { kind: "git.integrate", repo: "project", target: identity.targetRef, base: identity.expectedBase,
    candidate: identity.candidate, policyRevision: identity.policyRevision, checkProfileDigest: "a".repeat(64) };
  f.store.transaction(tx => tx.acceptOperation({ id, actor: "alice", requestKey: "integration", kind: "git.integrate",
    requestHash: requestHash("git.integrate", payload), payloadJson: JSON.stringify(payload), planJson: JSON.stringify(plan) }));
  const challenge = { kind: "challenge", identity, integration: id, evidence: "regression" } as const;
  await assert.rejects(f.module.record(f.auth(), "not-integrated", challenge), isCode("INVALID_REQUEST"));
  f.store.transaction(tx => tx.setOperationSucceeded(id, JSON.stringify({ kind: plan.kind, base: plan.base,
    candidate: plan.candidate, target: plan.target, policyRevision: plan.policyRevision, changed: true })));
  await assert.rejects(f.module.record(f.auth(), "wrong-identity", { ...challenge, identity: { ...identity, policyRevision: "other" } }), isCode("INVALID_REQUEST"));
  await f.module.record(f.auth(), "challenge", challenge);
  const challenged = f.store.attestations.all().at(-1)!.operation;
  await f.module.record(f.auth("principal"), "finding", { kind: "finding", challenge: challenged.id,
    valid: true, floor: "MEDIUM", scope: "Changes to the failed data migration semantics", evidence: "reproduced" });
  const finding = f.store.attestations.all().at(-1)!.operation;
  await f.module.record(f.auth("principal"), "outside", { kind: "scope", finding: finding.id, identity, applies: false, evidence: "unrelated semantics" });
  await f.module.record(f.auth("principal"), "inside", { kind: "scope", finding: finding.id, identity, applies: true, evidence: "corrected assessment" });
  const assessment = f.store.attestations.all().at(-1)!.operation;
  await f.module.record(f.auth("principal"), "revoke-assessment", { kind: "revoke", attestation: assessment.id, evidence: "needs another review" });
  let snapshot = attestationSnapshot(f.store.attestations.all(), identity);
  assert.equal(snapshot.floors.length, 1); assert.equal(snapshot.scopeAssessments.length, 0, "old exemption must not reappear");
  await assert.rejects(f.module.record(f.auth(), "remove-floor", { kind: "revoke", attestation: finding.id, evidence: "requester cannot remove floor" }), isCode("INVALID_REQUEST"));
  await f.module.record(f.auth("principal"), "remove-floor", { kind: "revoke", attestation: finding.id, evidence: "explicitly withdrawn" });
  snapshot = attestationSnapshot(f.store.attestations.all(), identity); assert.equal(snapshot.floors.length, 0);
});

test("DR27: a pre-v3 database fails closed at open and at diagnostics; no migration is attempted", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-attestation-migrate-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "runtime.sqlite"); const db = new DatabaseSync(path);
  db.exec("CREATE TABLE legacy(id TEXT PRIMARY KEY); INSERT INTO legacy VALUES ('kept'); PRAGMA user_version = 1");
  const before = db.prepare("SELECT * FROM legacy ORDER BY id").all(); db.close();
  // Diagnostics refuse a pre-v3 snapshot too: the unsupported version is the finding.
  assert.throws(() => readDiagnosticSnapshot(root), isCode("STORE_CORRUPT"));
  assert.throws(() => new Store(path, 0, { society: "demo" }), (error: unknown) =>
    error instanceof StoreError && error.code === "STORE_CORRUPT" && /user_version 1/.test(error.message));
  // The file is byte-for-byte untouched: nothing migrated, nothing was written.
  const after = new DatabaseSync(path);
  try {
    assert.deepEqual(after.prepare("SELECT * FROM legacy ORDER BY id").all(), before);
    assert.equal(after.prepare("PRAGMA user_version").get()!.user_version, 1);
  } finally { after.close(); }
});
