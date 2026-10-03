/** I48: mail-v1 is the only production review grammar. attest.record accepts
 * only the review kinds; the legacy attestation kinds refuse UNSUPPORTED_PROFILE
 * at fresh acceptance. Their durable rows still decode, their commons mail and
 * recipients stay what the plan froze, and a same-key replay still returns the
 * historical receipt -- the durable answer precedes every current-config check. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { AuthContext, ExactCandidateIdentity } from "../implementation/contracts.js";
import type { AttestationInput } from "../implementation/contracts/attestation.js";
import { AttestationModule } from "../src/attestation.js";
import { MailModule } from "../src/mail.js";
import { Store, readDiagnosticSnapshot } from "../src/store.js";
import { StoreError } from "../src/domain/errors.js";
import { inspectLedger } from "../src/diagnostics/ledger.js";
import { attestationSnapshot } from "../src/git/attestation-snapshot.js";
import { requestHash } from "../src/hash.js";
import { messageIdForOperation } from "../src/domain/derived.js";
import { buildFrozenMessage } from "../src/mail/serialize.js";
import { messagePlanFrom } from "../src/mail/facts.js";
import { operationPlanCheck } from "../src/durable.js";
import { makeValidAgent, ALL_CAPS } from "./fixtures/spec.js";

const identity: ExactCandidateIdentity = { repo: "project", targetRef: "refs/heads/main", expectedBase: "1".repeat(40),
  candidate: "2".repeat(40), policyRevision: "p1" };
const peer = { kind: "peer", identity, verdict: "APPROVE", evidence: "Read the exact diff" } as const;
const isCode = (code: string) => (error: unknown) => error instanceof StoreError && error.code === code;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-attestation-")); const path = join(root, "runtime.sqlite");
  const store = new Store(path, 0, { society: "demo" });
  store.transaction(tx => { tx.insertAgent(makeValidAgent("principal")); tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" }));
    tx.insertAgent(makeValidAgent("bob", { createdBy: "alice" })); });
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
  const module = new AttestationModule(store);
  const auth = (actor = "alice"): AuthContext => ({ actor, role: actor === "principal" ? "principal" : "resident",
    incarnation: actor === "principal" ? 0 : 1, capabilities: new Set(ALL_CAPS), channel: "actor",
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } });
  return { root, path, store, mail, module, auth,
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("every removed legacy attestation kind refuses at fresh acceptance and claims no key", async t => {
  const f = fixture(); t.after(() => f.close());
  const legacy = [
    { kind: "peer", identity, verdict: "APPROVE", evidence: "x" },
    { kind: "decision", identity, verdict: "ACCEPT", evidence: "x" },
    { kind: "revoke", attestation: "op-00000000-0000-4000-8000-000000000001", evidence: "x" },
    { kind: "challenge", integration: "op-00000000-0000-4000-8000-000000000001", identity, evidence: "x" },
    { kind: "finding", challenge: "op-00000000-0000-4000-8000-000000000001", valid: true, floor: "HIGH", scope: "s", evidence: "x" },
    { kind: "scope", finding: "op-00000000-0000-4000-8000-000000000001", identity, applies: true, evidence: "x" },
  ] as const;
  for (const [index, input] of legacy.entries())
    await assert.rejects(f.module.record(f.auth(), `legacy-${index}`, input), isCode("UNSUPPORTED_PROFILE"));
  // A refused request left no claim: the same key may still be retried or reused.
  assert.equal(f.store.getOperation("alice", "legacy-0"), null);
  await assert.rejects(f.module.record(f.auth(), "legacy-0", { kind: "merge.open", title: "t", reason: "r",
    tier: "LOW", candidate: identity.candidate, base: identity.expectedBase }), isCode("UNSUPPORTED_PROFILE"));
});

test("a malformed attestation is invalid input, not a profile refusal", async t => {
  const f = fixture(); t.after(() => f.close());
  await assert.rejects(f.module.record(f.auth(), "bad", { kind: "bogus" } as unknown as AttestationInput),
    isCode("INVALID_REQUEST"));
  await assert.rejects(f.module.record(f.auth(), "bad2", "not an object" as unknown as AttestationInput),
    isCode("INVALID_REQUEST"));
});

/** A succeeded legacy attest.record as the ledger held it: one frozen commons
 * mail, its recipients, and the attestations order index. The object is real
 * emitted mail so the materializer's header checks describe an actual row. */
async function acceptedLegacyRow(f: ReturnType<typeof fixture>, id: string, key: string,
    fact: Record<string, unknown> = peer) {
  const messageId = messageIdForOperation(id, 0);
  const recipients = ["alice", "bob"];
  const eml = await buildFrozenMessage({ id: messageId, sender: "alice", society: "demo", to: ["commons"],
    kind: "result", contextRevision: null, replyHeaders: { replyTo: ["commons"], inReplyTo: null, references: [] } },
    { subject: "Attestation: peer", body: JSON.stringify(fact) });
  const message = messagePlanFrom(eml, recipients);
  f.mail.freezeObject(message.id, eml);
  const plan = { kind: "attest.record", fact, message };
  f.store.transaction(tx => {
    tx.acceptOperation({ id, actor: "alice", requestKey: key, kind: "attest.record",
      requestHash: requestHash("attest.record", fact), payloadJson: JSON.stringify(fact), planJson: JSON.stringify(plan) });
    tx.insertDeliveries(recipients.map(recipient => ({ operationId: id, messageId, recipient })));
    tx.setOperationSucceeded(id, JSON.stringify({ kind: "attest.record", message: messageId,
      recipientCount: recipients.length, archivePath: `${f.root}/mail/archive/cur/${messageId}:2,` }));
  });
  return { messageId, plan };
}

test("an accepted legacy row keeps its receipt: same-key replay answers before the removed grammar", async t => {
  const f = fixture(); t.after(() => f.close());
  const id = "op-00000000-0000-4000-8000-000000000201";
  await acceptedLegacyRow(f, id, "review");
  const before = f.store.getOperation("alice", "review")!;
  assert.equal(before.kind, "attest.record"); assert.equal(before.state, "succeeded");
  // The durable answer precedes the grammar change: same key, same input ->
  // the historical receipt even though fresh legacy acceptance is refused.
  const replay = await f.module.record(f.auth(), "review", peer);
  assert.equal(replay.state, "succeeded"); assert.equal(replay.operation, id);
  assert.equal(f.store.attestations.all().length, 1, "replay created no second fact");
  // A different payload under the same key is still a key-reuse refusal.
  await assert.rejects(f.module.record(f.auth(), "review", { ...peer, verdict: "OBJECT" }), isCode("REQUEST_KEY_REUSED"));
  // Even after the requester is stopped, the receipt answer does not change.
  f.store.transaction(tx => tx.updateAgent({ name: "alice", desired: "stopped" }));
  assert.deepEqual(await f.module.record(f.auth(), "review", peer), replay);
});

test("durable decode and the tier evidence snapshot still read a legacy attestation row", async t => {
  const f = fixture(); t.after(() => f.close());
  const id = "op-00000000-0000-4000-8000-000000000202";
  const { messageId, plan } = await acceptedLegacyRow(f, id, "legacy-peer");
  const row = f.store.getOperationById(id)!;
  assert.equal(row.planJson, JSON.stringify(plan));
  const check = operationPlanCheck("attest.record", { operationId: id, actor: "alice",
    stateRoot: f.root, repositoryIdentity: { society: "demo" } });
  assert.equal(check(JSON.parse(row.planJson)), null);
  // Plan-level drift the plan relation itself owns: the frozen commons result
  // mail and its operation-derived identity are checked without the payload.
  const original = JSON.parse(row.planJson);
  for (const mutate of [
    (p: typeof original) => { p.message.kind = "message"; },
    (p: typeof original) => { p.message.to = ["alice"]; },
    (p: typeof original) => { p.message.id = "m-00000000-0000-4000-8000-000000009999-0"; },
  ]) { const altered = structuredClone(original); mutate(altered); assert.notEqual(check(altered), null); }
  // Drift the plan's grammar still parses but full decode owns: fact changes
  // contradict the authenticated request bytes, and a new recipient leaves the
  // delivery rows behind. Neither may re-read as the accepted fact.
  const db = new DatabaseSync(f.path);
  try {
    for (const mutate of [
      (p: typeof original) => { p.fact.verdict = "OBJECT"; },
      (p: typeof original) => { p.message.recipients = ["mallory"]; },
      (p: typeof original) => { p.fact.identity.candidate = "9".repeat(40); },
    ]) {
      const drifted = structuredClone(original); mutate(drifted);
      db.prepare("UPDATE operations SET plan_json = ? WHERE id = ?").run(JSON.stringify(drifted), id);
      assert.throws(() => f.store.getOperationById(id), isCode("STORE_CORRUPT"));
    }
    db.prepare("UPDATE operations SET plan_json = ? WHERE id = ?").run(JSON.stringify(original), id);
  } finally { db.close(); }
  const snapshot = attestationSnapshot(f.store.attestations.all(), identity);
  assert.equal(snapshot.reviews.length, 1);
  assert.equal(snapshot.reviews[0]!.id, id);
  assert.equal(existsSyncLike(join(f.root, "mail", "objects", `${messageId}.eml`)), true);
});

function existsSyncLike(path: string): boolean { try { readFileSync(path); return true; } catch { return false; } }

test("DR27: v1 migration preserves every rowid and byte, checks foreign keys, and diagnostics never migrate", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-attestation-migrate-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "runtime.sqlite"); const db = new DatabaseSync(path);
  db.exec(readFileSync(new URL("../../implementation/schema-v1.sql", import.meta.url), "utf8"));
  const agent = makeValidAgent("alice");
  db.prepare(`INSERT INTO agents VALUES (?,?,?,?,?,?,?,?,?,?)`).run(agent.name, agent.specHash, agent.role, agent.desired,
    agent.incarnation!, agent.profile, null, agent.specJson, 1, 1);
  for (const [rowid, state] of [[7, "pending"], [41, "succeeded"]] as const) {
    const id = `op-00000000-0000-4000-8000-${String(rowid).padStart(12, "0")}`;
    const payload = '{ "topic" : "kept" }'; const plan = '{ "kind" : "route.follow", "agent" : "alice", "topic" : "kept" }';
    const result = state === "pending" ? null : '{ "kind" : "route.follow", "topic" : "kept", "subscribed" : true }';
    db.prepare("INSERT INTO operations(rowid,id,actor,request_key,request_hash,kind,payload_json,plan_json,state,result_json,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(rowid, id, "alice", String(rowid), requestHash("route.follow", { topic: "kept" }), "route.follow", payload, plan, state, result, 1, 1);
  }
  const before = db.prepare("SELECT rowid,* FROM operations ORDER BY rowid").all(); db.close();
  const old = readDiagnosticSnapshot(root); assert.equal(old.schemaVersion, 1);
  assert.equal(inspectLedger(old, { stateRoot: root, society: "demo" }).report.status, "PASS");
  const store = new Store(path, 0, { society: "demo" });
  assert.equal(store.getOperation("alice", "7")!.state, "pending"); assert.equal(store.getOperation("alice", "41")!.state, "succeeded"); store.close();
  const after = new DatabaseSync(path);
  assert.deepEqual(after.prepare("SELECT rowid,* FROM operations ORDER BY rowid").all(), before);
  assert.deepEqual(after.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(after.prepare("PRAGMA user_version").get()!.user_version, 3); after.close();
});
