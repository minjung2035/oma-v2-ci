import { serializePlanIntent } from "./fixtures/plan.js";
/** mail-v1 review grammar: wire inputs, frozen facts, review mail metadata and
 * ledger decode relations for the review attest.record/git.integrate variants. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExactCandidateIdentity, MessagePlan, MutationMethod } from "@oma/contracts";
import type { ReviewFact } from "@oma/contracts/attestation";
import { Store, readDiagnosticSnapshot } from "@oma/storage";
import { inspectLedger } from "#oma-test/app/diagnostics/ledger";
import { StoreError } from "@oma/domain/errors";
import { attestationParamsCheck, messagePlanCheck } from "@oma/domain/validation";
import { reviewFactProblem } from "@oma/domain/attestation";
import { isDerivedRequestKey, isReviewRequestName, applyRequestKeyFor, refreshRequestKeyFor,
  reviewRequestNameFor, reviewRequestNameOwnedBy } from "@oma/domain/identifiers";
import { requestHash } from "@oma/domain/request-identity";
import { generateOperationId } from "@oma/native/identity";
import { messageIdForOperation as generateMessageId } from "@oma/domain/derived";
import { makeValidAgent } from "./fixtures/spec.js";

const CANDIDATE = "2".repeat(40);
const BASE = "1".repeat(40);
const identity: ExactCandidateIdentity = { repo: "project", targetRef: "refs/heads/main",
  expectedBase: BASE, candidate: CANDIDATE, policyRevision: "p1" };
const LIMITS = { mailBodyBytes: 1 << 20, subjectBytes: 512 };
const ok = (value: unknown) => assert.equal(attestationParamsCheck(value, LIMITS), null);
const bad = (value: unknown) => assert.notEqual(attestationParamsCheck(value, LIMITS), null);
const OP = "op-00000000-0000-4000-8000-000000000001";
const NAME = "merge-00000000-0000-4000-8000-000000000001";
const MSG = "m-00000000-0000-4000-8000-000000000001-0";

test("identifiers: derived request keys and review request names", () => {
  assert.equal(isDerivedRequestKey(`~apply.${OP}`), true);
  assert.equal(isDerivedRequestKey(`~refresh.${OP}.0`), true);
  assert.equal(isDerivedRequestKey(`~refresh.${OP}.37`), true);
  assert.equal(isDerivedRequestKey(`~refresh.${OP}.01`), false);
  assert.equal(isDerivedRequestKey(`~refresh.${OP}.`), false);
  assert.equal(isDerivedRequestKey(`~apply.${OP}.x`), false);
  assert.equal(isDerivedRequestKey(`~apply.not-an-op`), false);
  assert.equal(isDerivedRequestKey("plain-key"), false);
  assert.equal(isReviewRequestName(NAME), true);
  assert.equal(isReviewRequestName("challenge-0000000a"), false);
  assert.equal(isReviewRequestName("merge-0000000G"), false);
  assert.equal(isReviewRequestName("merge-0000000"), false);
  // AV-02: a fresh name carries the operation's whole UUID -- two opens can no
  // longer collide on an 8-hex truncation and exchange facts meant for each
  // other. Short pre-release names are refused by the current grammar.
  assert.equal(reviewRequestNameFor("merge", "op-0123abcd-4567-4000-8000-000000000000"),
    "merge-0123abcd-4567-4000-8000-000000000000");
  assert.equal(reviewRequestNameFor("challenge", OP), "challenge-00000000-0000-4000-8000-000000000001");
  assert.equal(isReviewRequestName("merge-00000000"), false);
  assert.equal(isReviewRequestName("merge-0123abcd-4567-4000-8000-000000000000"), true);
  assert.equal(isReviewRequestName("challenge-0123abcd-4567-4000-8000-000000000000"), true);
  assert.equal(isReviewRequestName("merge-0123abcd-4567-4000-8000-00000000000"), false);
  assert.equal(isReviewRequestName("merge-0123abcd-4567-4000-8000-0000000000000"), false);
  assert.equal(isReviewRequestName("merge-0123ABCD-4567-4000-8000-000000000000"), false);
  // Ownership admits only this operation's full UUID name.
  assert.equal(reviewRequestNameOwnedBy("merge", OP, "merge-00000000-0000-4000-8000-000000000001"), true);
  assert.equal(reviewRequestNameOwnedBy("merge", OP, "merge-00000000"), false);
  assert.equal(reviewRequestNameOwnedBy("challenge", OP, "merge-00000000"), false);
  assert.equal(reviewRequestNameOwnedBy("merge", OP, "merge-0123abcd"), false);
  assert.equal(reviewRequestNameOwnedBy("merge", OP, "merge-0123abcd-4567-4000-8000-000000000000"), false);
  assert.equal(reviewRequestNameOwnedBy("challenge", OP, "challenge-00000000-0000-4000-8000-000000000001"), true);
});

test("wire: every valid ReviewInput kind is accepted", () => {
  ok({ kind: "merge.open", tier: "LOW", title: "Fix bug", reason: "needed", candidate: CANDIDATE, base: BASE });
  ok({ kind: "merge.open", tier: "HIGH", title: "Fix bug", reason: "needed", candidate: CANDIDATE, base: BASE });
  ok({ kind: "challenge.open", merge: NAME, tier: "LOW", title: "Revert", reason: "broke prod" });
  ok({ kind: "challenge.open", merge: NAME, tier: "HIGH", title: "Revert", reason: "broke prod",
    candidate: CANDIDATE, base: BASE });
  ok({ kind: "review", name: NAME, body: "looks fine" });
  ok({ kind: "review", name: "challenge-0000000a-0000-4000-8000-000000000000", body: "looks fine" });
  ok({ kind: "vote", name: NAME, verdict: "approve", body: "ship it" });
  ok({ kind: "vote", name: "challenge-0000000a-0000-4000-8000-000000000000", verdict: "reject", body: "no", approval: MSG });
  ok({ kind: "cancel", name: NAME, reason: "superseded" });
  ok({ kind: "cancel", name: "challenge-0000000a-0000-4000-8000-000000000000", reason: "superseded" });
});

test("wire: malformed review inputs are refused", () => {
  bad({ kind: "merge.open", tier: "LOW", title: "t", reason: "   ", candidate: CANDIDATE, base: BASE });
  bad({ kind: "merge.open", tier: "LOW", title: "t", reason: "r", candidate: CANDIDATE, base: BASE, extra: 1 });
  bad({ kind: "merge.open", tier: "NOPE", title: "t", reason: "r", candidate: CANDIDATE, base: BASE });
  bad({ kind: "merge.open", tier: "LOW", title: "has\nnewline", reason: "r", candidate: CANDIDATE, base: BASE });
  bad({ kind: "review", name: NAME, body: "x".repeat((LIMITS.mailBodyBytes >> 2) + 1) });
  bad({ kind: "review", name: "not-a-name", body: "ok" });
  bad({ kind: "vote", name: NAME, verdict: "maybe", body: "ok" });
  bad({ kind: "vote", name: NAME, verdict: "approve", body: "ok", approval: "not-a-message" });
  bad({ kind: "cancel", name: NAME, reason: "" });
  bad({ kind: "challenge.open", merge: NAME, tier: "LOW", title: "t", reason: "r", candidate: CANDIDATE });
  bad({ kind: "challenge.open", merge: NAME, tier: "MEDIUM", title: "t", reason: "r" });
  bad({ kind: "refresh", request: OP });
  bad({ kind: "refresh", version: 1 });
  bad({ kind: "unknown", body: "x" });
});

test("wire: the frozen refresh fact shape is admitted for stored payloads only", () => {
  // Stored refresh rows carry their frozen fact as payload; decode re-validates
  // the derived key, so a caller still cannot mint one from the wire.
  ok({ kind: "refresh", version: 1, request: OP, main: CANDIDATE });
});

const baseMessage = {
  id: MSG, objectPath: `mail/objects/${MSG}.eml`, sha256: "0".repeat(64), bytes: 10, dateMs: 1,
  to: [] as string[], recipients: [] as string[], kind: "message" as const,
  contextRevision: null, replyHeaders: { replyTo: [], inReplyTo: null, references: [] },
};
const messageOk = (value: unknown) => assert.equal(messagePlanCheck(value), null);
const messageBad = (value: unknown) => assert.notEqual(messagePlanCheck(value), null);

test("durable: review mail metadata per role", () => {
  const thread = { ...baseMessage, to: ["residents"], recipients: ["alice", "bob"], audience: "workers",
    review: { role: "thread", request: OP, name: NAME, revision: 0 } };
  messageOk(thread);
  messageBad({ ...thread, audience: undefined });
  messageBad({ ...thread, kind: "result" });
  messageBad({ ...thread, to: ["principal"], recipients: ["principal"] });
  messageBad({ ...baseMessage, audience: "workers" });
  const approval = { ...baseMessage, kind: "approval_required" as const, to: ["principal"], recipients: ["principal"],
    approvalFor: identity, review: { role: "approval", request: OP, name: NAME, votes: [OP] } };
  messageOk(approval);
  messageBad({ ...approval, audience: "workers" });
  messageBad({ ...approval, approvalFor: undefined });
  messageBad({ ...approval, review: { ...approval.review, votes: [] } });
  messageBad({ ...approval, review: { ...approval.review, votes: [OP, OP] } });
  messageBad({ ...approval, review: { ...approval.review, votes: ["bad"] } });
  const withdrawn = { ...baseMessage, to: ["principal"], recipients: ["principal"],
    review: { role: "withdrawn", request: OP, name: NAME, approval: MSG } };
  messageOk(withdrawn);
  messageBad({ ...withdrawn, kind: "result" });
  const decision = { ...baseMessage, kind: "result" as const, to: ["principal"], recipients: ["principal"],
    review: { role: "decision", request: OP, name: NAME, approval: MSG } };
  messageOk(decision);
  messageBad({ ...decision, to: ["commons", "principal"] });
  const notice = { ...baseMessage, kind: "result" as const, to: ["commons", "principal"], recipients: ["alice", "principal"],
    review: { role: "notice", request: OP, name: NAME, part: 2, parts: 3, sha256: "f".repeat(64), bytes: 100 } };
  messageOk(notice);
  messageBad({ ...notice, review: { ...notice.review, part: 4 } });
  messageBad({ ...notice, review: { ...notice.review, sha256: "F".repeat(64) } });
  messageBad({ ...notice, audience: "workers" });
  messageOk(baseMessage);
  messageBad({ ...baseMessage, review: { role: "bogus" } });
  messageBad({ ...baseMessage, review: { role: "thread", request: OP, name: "bad", revision: 0 } });
});

test("durable: frozen review fact grammar", () => {
  const open: ReviewFact = { kind: "merge.open", version: 1, name: NAME, title: "t", reason: "r",
    tier: "MEDIUM", identity, submitters: ["alice", "bob"] };
  assert.equal(reviewFactProblem(open), null);
  assert.notEqual(reviewFactProblem({ ...open, version: 2 }), null);
  assert.notEqual(reviewFactProblem({ ...open, submitters: ["bob", "alice"] }), null);
  assert.notEqual(reviewFactProblem({ ...open, submitters: ["alice", "alice"] }), null);
  assert.notEqual(reviewFactProblem({ ...open, identity: { ...identity, repo: "nope" } }), null);
  assert.equal(reviewFactProblem({ kind: "vote", version: 1, request: OP, verdict: "reject", body: "no", approval: null }), null);
  assert.equal(reviewFactProblem({ kind: "cancel", version: 1, request: OP, reason: "done" }), null);
  assert.equal(reviewFactProblem({ kind: "refresh", version: 1, request: OP, main: null }), null);
  assert.equal(reviewFactProblem({ kind: "refresh", version: 1, request: OP, main: CANDIDATE }), null);
  assert.notEqual(reviewFactProblem({ kind: "refresh", version: 1, request: OP, main: "bad" }), null);
  const challenge = { kind: "challenge.open", version: 1, name: "challenge-0000000a-0000-4000-8000-000000000000", title: "t", reason: "r",
    tier: "HIGH", identity, submitters: ["alice"], prepared: true,
    target: { name: NAME, request: OP, integration: "op-00000000-0000-4000-8000-000000000002", identity, tier: "LOW" } };
  assert.equal(reviewFactProblem(challenge), null);
  assert.notEqual(reviewFactProblem({ ...challenge, target: { ...challenge.target, extra: 1 } }), null);
});

// --- Ledger decode through the real Store -----------------------------------

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-review-grammar-"));
  const path = join(root, "runtime.sqlite");
  const store = new Store(path, 0, { society: "demo" }, () => 100);
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" }));
    tx.insertAgent(makeValidAgent("bob", { createdBy: "alice" }));
  });
  return { root, path, store,
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

/** Fault injection below the transaction boundary: a committed row is patched
 * raw, as a torn or damaged ledger would leave it. */
function patch(storePath: string, id: string, fields: Record<string, string>): void {
  const db = new DatabaseSync(storePath);
  try {
    for (const [column, value] of Object.entries(fields))
      db.prepare(`UPDATE operations SET ${column}=? WHERE id=?`).run(value, id);
  } finally { db.close(); }
}
const isCorrupt = (error: unknown): boolean => error instanceof StoreError && error.code === "STORE_CORRUPT";

function message(operationId: string, ordinal: number, fields: Partial<MessagePlan>): MessagePlan {
  const id = generateMessageId(operationId, ordinal);
  return { ...baseMessage, id, objectPath: `mail/objects/${id}.eml`, ...fields };
}

function accept(store: Store, id: string, actor: string, key: string, kind: MutationMethod,
    payload: unknown, plan: unknown, deliveries: readonly [string, string][] = []): void {
  store.transaction(tx => {
    const accepted = tx.acceptOperation({ id, actor, requestKey: key, requestHash: requestHash(kind, payload),
      kind, payloadJson: JSON.stringify(payload), planJson: serializePlanIntent(plan) });
    assert.equal(accepted, "inserted");
    if (deliveries.length)
      tx.insertDeliveries(deliveries.map(([messageId, recipient]) => ({ messageId, recipient, operationId: id })));
  });
}

/** A merge.open review op (LOW tier, no messages) and its frozen name. */
function openMerge(store: Store): { id: string; name: string } {
  const id = generateOperationId();
  const name = reviewRequestNameFor("merge", id);
  const fact: ReviewFact = { kind: "merge.open", version: 1, name, title: "Fix", reason: "needed",
    tier: "LOW", identity, submitters: ["alice"] };
  const payload = { kind: "merge.open", tier: "LOW", title: "Fix", reason: "needed",
    candidate: CANDIDATE, base: BASE };
  store.transaction(tx => tx.acceptOperation({ id, actor: "alice", requestKey: `merge-${id}`, kind: "attest.record",
    requestHash: requestHash("attest.record", payload), payloadJson: JSON.stringify(payload),
    planJson: serializePlanIntent({ kind: "attest.record", fact, messages: [] }) }));
  return { id, name };
}

function decodeOk(store: Store, id: string): void {
  const operation = store.operations.getById(id);
  assert.ok(operation, "operation must decode");
}
function decodeCorrupt(store: Store, id: string): void {
  assert.throws(() => store.operations.getById(id), isCorrupt);
}
function ledgerClean(root: string): void {
  const report = inspectLedger(readDiagnosticSnapshot(root), { stateRoot: root, society: "demo" }).report;
  assert.equal(report.status, "PASS", JSON.stringify(report.issues));
}

test("decode: merge.open review fact with no messages", () => {
  const f = fixture();
  try {
    const open = openMerge(f.store);
    decodeOk(f.store, open.id);
    const operation = f.store.operations.getById(open.id);
    assert.equal(operation!.kind, "attest.record");
    ledgerClean(f.root);
  } finally { f.close(); }
});

test("decode: vote with thread + approval messages referencing the request", () => {
  const f = fixture();
  try {
    const open = openMerge(f.store);
    const id = generateOperationId();
    const thread = message(id, 0, { kind: "message", to: ["residents"], recipients: ["alice", "bob"],
      audience: "workers", review: { role: "thread", request: open.id, name: open.name, revision: 1 } });
    const approval = message(id, 1, { kind: "approval_required", to: ["principal"], recipients: ["principal"],
      approvalFor: identity, review: { role: "approval", request: open.id, name: open.name, votes: [id] } });
    const payload = { kind: "vote", name: open.name, verdict: "approve", body: "looks good" };
    const fact: ReviewFact = { kind: "vote", version: 1, request: open.id, verdict: "approve", body: "looks good", approval: null };
    f.store.transaction(tx => {
      assert.equal(tx.acceptOperation({ id, actor: "bob", requestKey: `vote-${id}`, kind: "attest.record",
        requestHash: requestHash("attest.record", payload), payloadJson: JSON.stringify(payload),
        planJson: serializePlanIntent({ kind: "attest.record", fact, messages: [thread, approval] }) }), "inserted");
      tx.insertDeliveries([
        { messageId: thread.id, recipient: "alice", operationId: id },
        { messageId: thread.id, recipient: "bob", operationId: id },
        { messageId: approval.id, recipient: "principal", operationId: id },
      ]);
    });
    decodeOk(f.store, id);
    ledgerClean(f.root);
  } finally { f.close(); }
});

test("decode: refresh fact under a derived request key", () => {
  const f = fixture();
  try {
    const open = openMerge(f.store);
    const fact: ReviewFact = { kind: "refresh", version: 1, request: open.id, main: null };
    const id = generateOperationId();
    accept(f.store, id, "alice", refreshRequestKeyFor(open.id, 0), "attest.record", fact,
      { kind: "attest.record", fact, messages: [] });
    decodeOk(f.store, id);
    ledgerClean(f.root);
  } finally { f.close(); }
});

test("decode: merge integration under its derived apply key", () => {
  const f = fixture();
  try {
    const open = openMerge(f.store);
    const id = generateOperationId();
    const notice = message(id, 0, { kind: "result", to: ["commons", "principal"], recipients: ["alice", "principal"],
      review: { role: "notice", request: open.id, name: open.name, part: 1, parts: 1, sha256: "f".repeat(64), bytes: 100 } });
    const payload = { candidate: CANDIDATE, expected: BASE, tier: "LOW" };
    const plan = {policyIdentity: "02c010d0ad2a2e60c59a05b83368e8699b97567828b4f75ffa160dfd35b1bb70", noopRef: null,  kind: "git.integrate", repo: "project", target: "refs/heads/main", base: BASE,
      candidate: CANDIDATE, policyRevision: "p1", checkProfileDigest: "e".repeat(64),
      merge: { version: 1, request: open.id, name: open.name, tier: "LOW", notice: [notice] } };
    f.store.transaction(tx => {
      assert.equal(tx.acceptOperation({ id, actor: "alice", requestKey: applyRequestKeyFor(open.id), kind: "git.integrate",
        requestHash: requestHash("git.integrate", payload), payloadJson: JSON.stringify(payload),
        planJson: serializePlanIntent(plan) }), "inserted");
      tx.insertDeliveries([
        { messageId: notice.id, recipient: "alice", operationId: id },
        { messageId: notice.id, recipient: "principal", operationId: id },
      ]);
    });
    const operation = f.store.operations.getById(id);
    assert.ok(operation && operation.kind === "git.integrate" && operation.plan.merge !== undefined);
    ledgerClean(f.root);
  } finally { f.close(); }
});

test("decode: review payload naming a different request is corrupt", () => {
  const f = fixture();
  try {
    const open = openMerge(f.store);
    const payload = { kind: "vote", name: open.name, verdict: "approve", body: "ok" };
    const fact: ReviewFact = { kind: "vote", version: 1, request: open.id, verdict: "approve", body: "ok", approval: null };
    const id = generateOperationId();
    accept(f.store, id, "bob", `vote-${id}`, "attest.record", payload,
      { kind: "attest.record", fact, messages: [] });
    decodeOk(f.store, id);
    // Damage: the stored payload names a different request than the frozen fact's.
    const renamed = { ...payload, name: "merge-ffffffff" };
    patch(f.path, id, { payload_json: JSON.stringify(renamed), request_hash: requestHash("attest.record", renamed) });
    decodeCorrupt(f.store, id);
    const report = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" }).report;
    assert.equal(report.status, "FAIL");
    assert.ok(report.issues.some(issue => issue.code === "INVALID_ROW_OR_RELATION" && issue.identity === id));
  } finally { f.close(); }
});

test("decode: a derived key on an ordinary mail.send is corrupt", () => {
  const f = fixture();
  try {
    const open = openMerge(f.store);
    const id = generateOperationId();
    const msg = message(id, 0, {});
    const payload = { kind: "message", to: [], subject: "hi", body: "x" };
    const plan = { kind: "mail.send", message: { ...msg, to: [], recipients: [], kind: "message" } };
    accept(f.store, id, "alice", `mail-${id}`, "mail.send", payload, plan);
    decodeOk(f.store, id);
    patch(f.path, id, { request_key: applyRequestKeyFor(open.id) });
    decodeCorrupt(f.store, id);
    patch(f.path, id, { request_key: refreshRequestKeyFor(open.id, 2) });
    decodeCorrupt(f.store, id);
  } finally { f.close(); }
});

test("decode: apply key that names a different request is corrupt", () => {
  const f = fixture();
  try {
    const open = openMerge(f.store);
    const other = generateOperationId();
    const id = generateOperationId();
    const notice = message(id, 0, { kind: "result", to: ["commons", "principal"], recipients: [],
      review: { role: "notice", request: open.id, name: open.name, part: 1, parts: 1,
        sha256: "f".repeat(64), bytes: 10 } });
    const payload = { candidate: CANDIDATE, expected: BASE, tier: "LOW" };
    const plan = {policyIdentity: "02c010d0ad2a2e60c59a05b83368e8699b97567828b4f75ffa160dfd35b1bb70", noopRef: null,  kind: "git.integrate", repo: "project", target: "refs/heads/main", base: BASE,
      candidate: CANDIDATE, policyRevision: "p1", checkProfileDigest: "e".repeat(64),
      merge: { version: 1, request: open.id, name: open.name, tier: "LOW", notice: [notice] } };
    accept(f.store, id, "alice", applyRequestKeyFor(open.id), "git.integrate", payload, plan);
    decodeOk(f.store, id);
    patch(f.path, id, { request_key: applyRequestKeyFor(other) });
    decodeCorrupt(f.store, id);
    patch(f.path, id, { request_key: `key-${id}` });
    decodeCorrupt(f.store, id);
  } finally { f.close(); }
});
