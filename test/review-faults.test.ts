/** mail-v1 fault injection at the durable boundaries the review flow owns: a
 * crash BETWEEN two durable steps must repair to exactly-once — never a lost
 * approval, a duplicated notice part, or a second main CAS.
 *
 * Injection uses the same monkeypatch seams as challenge-review.test.ts
 * (store.claimKey) plus three mail boundaries:
 *  - mail.materialize: the post-T boundary of ReviewModule.acceptPrepared —
 *    the operation committed, its frozen objects exist, nothing was published.
 *  - mail.publishGated: the gated publication the integration coordinator
 *    calls after the canonical effect — a throw leaves the CAS done and the
 *    notice wholly unpublished.
 *  - store.markMaterialized: the per-delivery flag inside
 *    MailMaterializer.publish — a throw leaves the inbox/archive hardlink in
 *    place but the ledger flag uncommitted: a real mid-publication cut, not a
 *    clean refusal.
 * Repair owners are the production ones: MailModule.reconcilePending for
 * pending attest.record mail and GitModule.reconcile → applyMerge for a
 * pending git.integrate; f.reopen() swaps in unpatched modules the way a
 * restart does, so no injected stub survives into the repaired world. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readDiagnosticSnapshot, Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { inspectLedger } from "#oma-test/app/diagnostics/ledger";
import { inspectIntegrity } from "#oma-test/app/diagnostics/integrity";
import { NodeIntegrityFiles } from "#oma-test/app/diagnostics/files";
import { createCanonicalObserver } from "@oma/git/canonical-command";
import { mailArchivePathAt, mailInboxPathAt } from "@oma/domain/paths";
import { applyRequestKeyFor, parseMessageId } from "@oma/domain/identifiers";
import { expandAddresses, type MailModule } from "@oma/mail";
import { sha256Hex } from "@oma/domain/canonical-json";
import { fixture, messages, inboxCount, messageText, workerFile } from "./fixtures/review-fixture.js";
import type { MessagePlan } from "@oma/contracts";

type F = ReturnType<typeof fixture>;

/** The next mail.materialize call on this module throws a transient failure:
 * the accepted operation's mail boundary dies after its T committed. */
function failNextMaterialize(f: F): void {
  const real = f.mail.materialize.bind(f.mail);
  let armed = true;
  (f.mail as { materialize: MailModule["materialize"] }).materialize = async (id: string) => {
    if (armed) {
      armed = false;
      throw new StoreError("BROKER_UNAVAILABLE", "injected: process died before materializing the accepted mail");
    }
    await real(id);
  };
}

/** The nth markMaterialized flag write against an operation of `kind` dies:
 * the delivery's inbox link already exists, the flag transaction rolls back,
 * and the publish loop abandons every later delivery of the operation. */
function failNthDeliveryFlag(f: F, kind: "git.integrate" | "attest.record", nth: number): void {
  const real = f.store.markMaterialized.bind(f.store);
  let seen = 0;
  (f.store as { markMaterialized: Store["markMaterialized"] }).markMaterialized = (message, recipient) => {
    const parsed = parseMessageId(message);
    const owner = parsed === null ? null : f.store.getOperationById(parsed.operationId);
    if (owner !== null && owner.kind === kind && ++seen === nth)
      throw new StoreError("BROKER_UNAVAILABLE", "injected: died between the inbox link and the ledger flag");
    return real(message, recipient);
  };
}

const objectExists = (f: F, id: string): boolean =>
  existsSync(join(f.root, "mail", "objects", `${id}.eml`));
const inboxLink = (f: F, actor: string, id: string): boolean =>
  existsSync(mailInboxPathAt(f.root, actor, id, "new")) || existsSync(mailInboxPathAt(f.root, actor, id, "cur"));
const materialized = (f: F, id: string, actor: string): 0 | 1 =>
  f.store.getDelivery(id, actor)?.materialized ?? 0;
/** Review-mail plans of one role across the whole attestation ledger (a
 * duplicated send would be an extra row here, not just an extra file — mail
 * file names are id-deterministic). */
const reviewMails = (f: F, role: "thread" | "approval" | "withdrawn" | "decision"): MessagePlan[] =>
  f.store.attestations.all()
    .flatMap(row => "messages" in row.operation.plan ? row.operation.plan.messages : [] as const)
    .filter(message => message.review?.role === role);
const ledgerPass = (f: F): void => {
  const ledger = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" });
  assert.equal(ledger.report.status, "PASS", JSON.stringify(ledger.report.issues));
};
const integrityPass = (f: F): void => {
  const integrity = inspectIntegrity(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" },
    { files: new NodeIntegrityFiles(), git: createCanonicalObserver() });
  assert.equal(integrity.status, "PASS", JSON.stringify(integrity.issues));
};
/** Completion-notice parts reassemble to the document sha256 they name. */
type NoticeMeta = Extract<NonNullable<MessagePlan["review"]>, { role: "notice" }>;
const reassembledNotice = (f: F, notice: readonly MessagePlan[]): string => {
  const chunks: Buffer[] = [];
  let meta: NoticeMeta | null = null;
  for (const [index, part] of notice.entries()) {
    const review = part.review;
    assert.ok(review && review.role === "notice", `part ${index + 1} carries notice metadata`);
    assert.equal(review.part, index + 1);
    assert.equal(review.parts, notice.length);
    meta = review;
    const text = messageText(f.root, part.id);
    const body = text.slice(text.indexOf("\r\n\r\n") + 4);
    assert.match(body, new RegExp(`^Part ${index + 1}/${notice.length} `));
    chunks.push(Buffer.from(body.slice(body.indexOf("\n") + 1), "utf8"));
  }
  const document = Buffer.concat(chunks).toString("utf8");
  assert.ok(meta !== null);
  assert.equal(sha256Hex(document), meta.sha256, "parts reassemble to the document digest");
  assert.equal(Buffer.byteLength(document, "utf8"), meta.bytes);
  return document;
};

test("mail-v1 faults: a quorum-forming vote committed without its approval mail is repaired to exactly one delivery", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open");
    const name = f.requestName("open");
    await f.vote("bob", name, "approve", "bob approves", "v-bob");
    // The crash lands between the vote's acceptance commit and its mail
    // materialization: the fact and the frozen messages are durable, nothing
    // was published.
    failNextMaterialize(f);
    const crashed = await f.vote("carol", name, "approve", "carol approves", "v-carol");
    assert.equal(crashed.state, "pending", "the vote committed; only its mail boundary failed");
    const voteOp = f.store.getOperation("carol", "v-carol")!;
    assert.equal(voteOp.state, "pending");
    const owned = messages(f, "carol", "v-carol");
    const thread = owned.find(m => m.review?.role === "thread")!;
    const approval = owned.find(m => m.review?.role === "approval")!;
    // The ledger already carries the valid approval; the mail does not exist.
    const during = f.stateOf(name);
    assert.equal(during.display, "principal-pending");
    assert.equal(during.approval?.id, approval.id);
    assert.equal(during.approvalValid, true);
    for (const message of owned) assert.equal(objectExists(f, message.id), true, "the frozen object survived");
    assert.equal(existsSync(workerFile(f.root, thread.id)), false);
    assert.equal(existsSync(mailArchivePathAt(f.root, approval.id)), false);
    assert.equal(inboxLink(f, "principal", approval.id), false);
    assert.equal(inboxCount(f, "principal"), 0);
    // Restart: the ordinary-mail sweep repairs the pending operation.
    f.reopen();
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 1, repaired: 1, remaining: 0 });
    assert.equal(f.store.getOperation("carol", "v-carol")!.state, "succeeded");
    // Exactly once, for every message the vote owns.
    assert.equal(existsSync(workerFile(f.root, thread.id)), true);
    assert.equal(existsSync(mailArchivePathAt(f.root, approval.id)), true);
    assert.equal(inboxLink(f, "principal", approval.id), true);
    assert.equal(materialized(f, approval.id, "principal"), 1);
    for (const worker of ["alice", "bob", "carol", "dave", "ellen"])
      assert.equal(inboxLink(f, worker, thread.id), true, `${worker} got the revision once`);
    assert.equal(inboxLink(f, "principal", thread.id), false, "thread mail never reaches the Principal");
    assert.equal(reviewMails(f, "approval").length, 1, "one approval exists in the whole ledger");
    // A second sweep and an advance sweep change nothing.
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 0, repaired: 0, remaining: 0 });
    await f.reviews.advanceAll();
    assert.equal(inboxCount(f, "principal"), 1);
    // The request was never lost: the Principal decides on the repaired approval.
    const decided = await f.vote("principal", name, "approve", "the Principal approves", "pv", approval.id);
    assert.equal(decided.state, "succeeded");
    assert.equal(f.stateOf(name).display, "applied");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
    ledgerPass(f);
  } finally { f.close(); }
});

test("mail-v1 faults: a re-asked approval lost before materialization arrives exactly once after repair", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open");
    const name = f.requestName("open");
    await f.vote("bob", name, "approve", "bob ok", "v-bob");
    await f.vote("carol", name, "approve", "carol ok", "v-carol");
    const first = messages(f, "carol", "v-carol").find(m => m.review?.role === "approval")!;
    await f.vote("bob", name, "reject", "bob objects", "v-bob-x");
    const withdrawn = messages(f, "bob", "v-bob-x").find(m => m.review?.role === "withdrawn")!;
    assert.equal(f.stateOf(name).display, "blocked");
    const principalBaseline = inboxCount(f, "principal");
    // The replacement approval dies between commit and materialize.
    failNextMaterialize(f);
    const recrashed = await f.vote("bob", name, "approve", "bob ok again", "v-bob2");
    assert.equal(recrashed.state, "pending");
    const second = messages(f, "bob", "v-bob2").find(m => m.review?.role === "approval")!;
    assert.notEqual(second.id, first.id, "the re-ask is a fresh approval");
    assert.equal(f.stateOf(name).approval?.id, second.id);
    assert.equal(f.stateOf(name).approvalValid, true);
    assert.equal(inboxLink(f, "principal", second.id), false, "the replacement never reached the Principal");
    assert.equal(inboxCount(f, "principal"), principalBaseline);
    f.reopen();
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 1, repaired: 1, remaining: 0 });
    assert.equal(f.store.getOperation("bob", "v-bob2")!.state, "succeeded");
    // The repaired approval lands once; the earlier approval and its withdrawn
    // notice are still single facts in mail and in the ledger.
    for (const id of [first.id, withdrawn.id, second.id]) {
      assert.equal(inboxLink(f, "principal", id), true, `${id} delivered once`);
      assert.equal(materialized(f, id, "principal"), 1);
    }
    assert.equal(reviewMails(f, "approval").length, 2);
    assert.equal(reviewMails(f, "withdrawn").length, 1);
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 0, repaired: 0, remaining: 0 });
    // The stale approval stays stale; the repaired one applies the request.
    await assert.rejects(f.vote("principal", name, "approve", "stale", "pv-stale", first.id),
      { code: "APPROVAL_STALE" });
    await f.vote("principal", name, "approve", "fine", "pv", second.id);
    assert.equal(f.stateOf(name).display, "applied");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
    ledgerPass(f);
  } finally { f.close(); }
});

test("mail-v1 faults: a crash midway through a multi-part completion notice leaves a half-state that repair completes once", async () => {
  const f = fixture({ mailBodyBytes: 6 * 1024 });
  try {
    const big = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(50)}`).join("\n");
    const candidate = f.candidateWith({ "big.txt": big, "bin.dat": `hdr${String.fromCharCode(0)}${" ".repeat(4000)}` });
    await f.submit("alice", candidate);
    const recipients = expandAddresses(f.store, ["commons", "principal"], "demo").recipients;
    // Kill the (R+2)th notice flag: part 1 fully delivered, part 2's first
    // delivery done and its second linked but unflagged, everything later
    // untouched — a mid-loop cut, not a clean boundary.
    failNthDeliveryFlag(f, "git.integrate", recipients.length + 2);
    const opened = await f.open("alice", { tier: "LOW", candidate, reason: "bulk import" }, "open");
    assert.equal(opened.state, "succeeded", "the open fact committed; only the notice died");
    const apply = f.applyOp("alice", "open")!;
    assert.equal(apply.state, "pending");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate, "the CAS already committed");
    const notice = (apply.plan as { merge: { notice: MessagePlan[] } }).merge.notice;
    assert.ok(notice.length > 1, `expected a multi-part notice, got ${notice.length}`);
    // The crashed half-state is exactly the delivery prefix, plus one linked
    // but unflagged row — the durable boundary itself is visible.
    const rows = f.store.deliveriesForOperation(apply.id);
    const cut = recipients.length + 2;
    rows.forEach((row, index) => {
      if (index < cut - 1) {
        assert.equal(row.materialized, 1, `delivery ${index} flagged`);
        assert.equal(inboxLink(f, row.recipient, row.messageId), true);
      } else if (index === cut - 1) {
        assert.equal(row.materialized, 0, `delivery ${index} lost its flag`);
        assert.equal(inboxLink(f, row.recipient, row.messageId), true, "its inbox link was already durable");
      } else {
        assert.equal(row.materialized, 0);
        assert.equal(inboxLink(f, row.recipient, row.messageId), false);
      }
    });
    for (const [index, part] of notice.entries()) {
      const reached = rows.some(row => row.messageId === part.id && (row.materialized === 1 || inboxLink(f, row.recipient, row.messageId)));
      assert.equal(existsSync(mailArchivePathAt(f.root, part.id)), reached,
        `part ${index + 1} archive exists iff publication reached it`);
    }
    // Repair: reconcile sees main already at the candidate and republishes.
    f.reopen();
    await f.module.reconcile(apply.id);
    assert.equal(f.store.getOperationById(apply.id)!.state, "succeeded");
    for (const [index, part] of notice.entries()) {
      assert.equal(existsSync(mailArchivePathAt(f.root, part.id)), true, `part ${index + 1} archived once`);
      for (const recipient of recipients) {
        assert.equal(inboxLink(f, recipient, part.id), true, `part ${index + 1} delivered to ${recipient} once`);
        assert.equal(materialized(f, part.id, recipient), 1);
      }
    }
    const document = reassembledNotice(f, notice);
    assert.match(document, new RegExp(`OMA merge applied: ${f.requestName("open")}`));
    // A second reconcile and the review sweep are both inert.
    await f.module.reconcile(apply.id);
    const inboxes = ["principal", ...recipients].map(actor => inboxCount(f, actor));
    await f.reviews.advanceAll();
    assert.equal(f.applyOp("alice", "open")!.id, apply.id, "no second integration");
    assert.deepEqual(["principal", ...recipients].map(actor => inboxCount(f, actor)), inboxes, "nothing re-delivered");
    ledgerPass(f);
    integrityPass(f);
  } finally { f.close(); }
});

test("mail-v1 faults: a crash between the main CAS and notice materialization repairs without a second CAS", async () => {
  // Sub-case A: the gated publication dies before any delivery work — the
  // multi-part notice has no archive link and no inbox link at all.
  const g = fixture({ mailBodyBytes: 6 * 1024 });
  try {
    const big = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(50)}`).join("\n");
    const candidate = g.candidateWith({ "big.txt": big });
    await g.submit("alice", candidate);
    const realPublish = g.mail.publishGated.bind(g.mail);
    (g.mail as { publishGated: MailModule["publishGated"] }).publishGated = async (id, proof) => {
      if (g.store.getOperationById(id)?.kind === "git.integrate")
        throw new StoreError("BROKER_UNAVAILABLE", "injected: mail sink died before the notice publication");
      await realPublish(id, proof);
    };
    const opened = await g.open("alice", { tier: "LOW", candidate }, "open");
    assert.equal(opened.state, "succeeded");
    const apply = g.applyOp("alice", "open")!;
    assert.equal(apply.state, "pending", "CAS committed; the notice never materialized");
    assert.equal(g.git(["rev-parse", "refs/heads/main"]), candidate);
    const notice = (apply.plan as { merge: { notice: MessagePlan[] } }).merge.notice;
    assert.ok(notice.length > 1);
    for (const part of notice) {
      assert.equal(existsSync(mailArchivePathAt(g.root, part.id)), false);
      assert.equal(objectExists(g, part.id), true, "the frozen part object exists");
    }
    assert.equal(g.store.deliveriesForOperation(apply.id).every(row => row.materialized === 0), true);
    // Repair on fresh modules; watch the settle boundary for a re-CAS (a
    // retried CAS against base would fail and mark the operation unknown) and
    // count publication attempts.
    g.reopen();
    const unknownMarks: string[] = [];
    const realUnknown = g.store.setOperationUnknown.bind(g.store);
    (g.store as { setOperationUnknown: Store["setOperationUnknown"] }).setOperationUnknown = id => {
      unknownMarks.push(id); return realUnknown(id);
    };
    const publications: string[] = [];
    const realPublish2 = g.mail.publishGated.bind(g.mail);
    (g.mail as { publishGated: MailModule["publishGated"] }).publishGated = async (id, proof) => {
      publications.push(id); return realPublish2(id, proof);
    };
    await g.module.reconcile(apply.id);
    assert.deepEqual(unknownMarks, [], "the repair never re-ran a CAS path");
    assert.deepEqual(publications, [apply.id], "exactly one publication pass for the integration");
    assert.equal(g.store.getOperationById(apply.id)!.state, "succeeded");
    assert.equal(g.git(["rev-parse", "refs/heads/main"]), candidate);
    const recipients = expandAddresses(g.store, ["commons", "principal"], "demo").recipients;
    for (const part of notice)
      for (const recipient of recipients)
        assert.equal(materialized(g, part.id, recipient), 1);
    reassembledNotice(g, notice);
    await g.module.reconcile(apply.id);
    await g.reviews.advanceAll();
    assert.equal(g.applyOp("alice", "open")!.id, apply.id, "still the one integration");
    assert.equal(g.store.getOperationById(apply.id)!.state, "succeeded");
    ledgerPass(g);
  } finally { g.close(); }

  // Sub-case B: the publication dies at the FIRST delivery's flag — the part's
  // archive link and one inbox link exist, no delivery is flagged.
  const h = fixture({ mailBodyBytes: 6 * 1024 });
  try {
    const big = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(50)}`).join("\n");
    const candidate = h.candidateWith({ "big.txt": big });
    await h.submit("alice", candidate);
    failNthDeliveryFlag(h, "git.integrate", 1);
    const opened = await h.open("alice", { tier: "LOW", candidate }, "open");
    assert.equal(opened.state, "succeeded");
    const apply = h.applyOp("alice", "open")!;
    assert.equal(apply.state, "pending");
    assert.equal(h.git(["rev-parse", "refs/heads/main"]), candidate, "main moved before the crash");
    const notice = (apply.plan as { merge: { notice: MessagePlan[] } }).merge.notice;
    const rows = h.store.deliveriesForOperation(apply.id);
    assert.equal(existsSync(mailArchivePathAt(h.root, notice[0]!.id)), true, "part 1 archived before the cut");
    assert.equal(inboxLink(h, rows[0]!.recipient, rows[0]!.messageId), true, "the first inbox link exists");
    assert.equal(rows[0]!.materialized, 0, "its flag rolled back");
    assert.equal(rows.slice(1).every(row => row.materialized === 0 && !inboxLink(h, row.recipient, row.messageId)), true);
    for (const part of notice.slice(1))
      assert.equal(existsSync(mailArchivePathAt(h.root, part.id)), false, "later parts untouched");
    h.reopen();
    const unknownMarks: string[] = [];
    const realUnknown = h.store.setOperationUnknown.bind(h.store);
    (h.store as { setOperationUnknown: Store["setOperationUnknown"] }).setOperationUnknown = id => {
      unknownMarks.push(id); return realUnknown(id);
    };
    await h.module.reconcile(apply.id);
    assert.deepEqual(unknownMarks, [], "no re-CAS was attempted: main already held the candidate");
    assert.equal(h.store.getOperationById(apply.id)!.state, "succeeded");
    const recipients = expandAddresses(h.store, ["commons", "principal"], "demo").recipients;
    for (const part of notice)
      for (const recipient of recipients)
        assert.equal(materialized(h, part.id, recipient), 1, "every delivery flagged exactly once");
    reassembledNotice(h, notice);
    ledgerPass(h);
    integrityPass(h);
  } finally { h.close(); }
});

test("mail-v1 faults: an in-T claimKey failure discards the open; the same key retries as a fresh request", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    const objectsBefore = readdirSync(join(f.root, "mail", "objects")).length;
    const realClaim = f.store.claimKey.bind(f.store);
    let claims = 0;
    (f.store as { claimKey: Store["claimKey"] }).claimKey = (actor, key, hash) => {
      claims++;
      if (claims === 2) throw new StoreError("BROKER_UNAVAILABLE", "injected: died inside the acceptance transaction");
      return realClaim(actor, key, hash);
    };
    await assert.rejects(f.open("alice", { tier: "MEDIUM", candidate }, "open"), { code: "BROKER_UNAVAILABLE" });
    (f.store as { claimKey: Store["claimKey"] }).claimKey = realClaim;
    // Nothing committed and the frozen thread object was settled away.
    assert.equal(f.store.getOperation("alice", "open"), null);
    assert.equal(readdirSync(join(f.root, "mail", "objects")).length, objectsBefore,
      "the unaccepted frozen object was discarded, not leaked");
    // The documented contract: a refusal is retried under the same request key.
    // What committed nothing cannot replay a receipt — the retry is a fresh
    // open with a fresh operation, and exactly one request exists afterwards.
    const retried = await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    assert.equal(retried.state, "succeeded");
    const opens = f.store.attestations.all().filter(row =>
      "messages" in row.operation.plan && row.operation.plan.fact.kind === "merge.open");
    assert.equal(opens.length, 1, "one live request, not a half-accepted first attempt");
    assert.equal(opens[0]!.operation.id, retried.operation);
    const name = f.requestName("open");
    const thread = messages(f, "alice", "open")[0]!;
    assert.equal(thread.review?.role, "thread");
    for (const worker of ["alice", "bob", "carol", "dave", "ellen"])
      assert.equal(inboxLink(f, worker, thread.id), true);
    assert.equal(f.stateOf(name).display, "peer-needed");
    ledgerPass(f);
  } finally { f.close(); }
});

test("mail-v1 faults: a post-T crash makes a same-key replay return the same receipt, never a second request", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    failNextMaterialize(f);
    const crashed = await f.vote("bob", name, "approve", "bob ok", "v-bob");
    assert.equal(crashed.state, "pending");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate,
      "the applying vote's advance still moved main — the fact was durable");
    // Replaying the same key and payload is a receipt lookup, not a retry:
    // the same operation answers pending, then succeeded after repair.
    const replayed = await f.vote("bob", name, "approve", "bob ok", "v-bob");
    assert.equal(replayed.state, "pending");
    assert.equal(replayed.operation, crashed.operation, "the replay returned the same operation");
    assert.equal(f.store.attestations.all().filter(row => "messages" in row.operation.plan &&
      row.operation.plan.fact.kind === "vote").length, 1, "no second vote fact");
    // The same key with a different payload is still refused.
    await assert.rejects(f.vote("bob", name, "approve", "changed body", "v-bob"), { code: "REQUEST_KEY_REUSED" });
    f.reopen();
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 1, repaired: 1, remaining: 0 });
    const settled = await f.vote("bob", name, "approve", "bob ok", "v-bob");
    assert.equal(settled.state, "succeeded");
    assert.equal(settled.operation, crashed.operation);
    assert.equal(f.stateOf(name).display, "applied");
    ledgerPass(f);
  } finally { f.close(); }
});

test("mail-v1 faults: a cancel committed without its withdrawn mail is delivered once on repair", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open");
    const name = f.requestName("open");
    await f.vote("bob", name, "approve", "ok", "v-bob");
    await f.vote("carol", name, "approve", "ok", "v-carol");
    const approval = messages(f, "carol", "v-carol").find(m => m.review?.role === "approval")!;
    const baseline = inboxCount(f, "principal");
    // The cancel's commit is durable before its withdrawn notice is written.
    failNextMaterialize(f);
    const cancelled = await f.cancel("alice", name, "c-1");
    assert.equal(cancelled.state, "pending");
    const owned = messages(f, "alice", "c-1");
    const thread = owned.find(m => m.review?.role === "thread")!;
    const withdrawn = owned.find(m => m.review?.role === "withdrawn")!;
    assert.equal(withdrawn.review?.role === "withdrawn" ? withdrawn.review.approval : null, approval.id);
    // The request is already cancelled in the ledger; only the mail is owed.
    const during = f.stateOf(name);
    assert.equal(during.terminal, "cancelled");
    assert.equal(during.approval, null);
    assert.equal(inboxLink(f, "principal", withdrawn.id), false);
    assert.equal(existsSync(workerFile(f.root, thread.id)), false);
    assert.equal(inboxCount(f, "principal"), baseline);
    await assert.rejects(f.vote("dave", name, "approve", "late", "v-dave"), { code: "REQUEST_CLOSED" });
    f.reopen();
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 1, repaired: 1, remaining: 0 });
    assert.equal(f.store.getOperation("alice", "c-1")!.state, "succeeded");
    assert.equal(inboxLink(f, "principal", withdrawn.id), true);
    assert.equal(materialized(f, withdrawn.id, "principal"), 1);
    assert.match(messageText(f.root, withdrawn.id), /withdrawn: cancelled/);
    assert.equal(existsSync(workerFile(f.root, thread.id)), true);
    for (const worker of ["alice", "bob", "carol", "dave", "ellen"])
      assert.equal(inboxLink(f, worker, thread.id), true);
    // Once: a second sweep adds nothing and main never moved.
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 0, repaired: 0, remaining: 0 });
    await f.reviews.advanceAll();
    assert.equal(inboxCount(f, "principal"), baseline + 1, "one withdrawn notice total");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
    assert.equal(reviewMails(f, "withdrawn").length, 1);
    ledgerPass(f);
  } finally { f.close(); }
});

test("mail-v1 faults: a vote accepted before its thread revision materializes repairs the worker archive once", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    await f.review("bob", name, "rev-bob");
    const rev1 = messages(f, "bob", "rev-bob").find(m => m.review?.role === "thread")!;
    // The applying vote commits; its thread revision never reaches the
    // workers-only archive or the resident inboxes.
    failNextMaterialize(f);
    const voted = await f.vote("carol", name, "approve", "carol ok", "v-carol");
    assert.equal(voted.state, "pending");
    const rev2 = messages(f, "carol", "v-carol").find(m => m.review?.role === "thread")!;
    assert.equal(rev2.audience, "workers");
    assert.equal(existsSync(workerFile(f.root, rev2.id)), false, "the revision never reached the worker archive");
    assert.equal(existsSync(mailArchivePathAt(f.root, rev2.id)), false, "never the public archive");
    for (const worker of ["alice", "bob", "carol", "dave", "ellen"])
      assert.equal(inboxLink(f, worker, rev2.id), false);
    // The application was already committed by the vote's own advance: the
    // request shows applied and main moved while the revision mail is owed.
    assert.equal(f.stateOf(name).display, "applied");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
    f.reopen();
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 1, repaired: 1, remaining: 0 });
    assert.equal(f.store.getOperation("carol", "v-carol")!.state, "succeeded");
    assert.equal(existsSync(workerFile(f.root, rev2.id)), true, "the revision was repaired once");
    assert.equal(existsSync(mailArchivePathAt(f.root, rev2.id)), false);
    for (const worker of ["alice", "bob", "carol", "dave", "ellen"]) {
      assert.equal(inboxLink(f, worker, rev2.id), true, `${worker} got the revision once`);
      assert.equal(materialized(f, rev2.id, worker), 1);
    }
    assert.equal(inboxLink(f, "principal", rev2.id), false);
    // The repaired revision is a whole message, threading onto the prior one.
    const text = messageText(f.root, rev2.id);
    assert.match(text, new RegExp(`In-Reply-To: <${rev1.id}@`));
    assert.match(text, /\[2\] carol vote approve:\ncarol ok/);
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 0, repaired: 0, remaining: 0 });
    await f.reviews.advanceAll();
    assert.equal(f.stateOf(name).display, "applied");
    ledgerPass(f);
    integrityPass(f);
  } finally { f.close(); }
});

test("mail-v1 faults: repaired mid-boundary crashes leave a consistent ledger and no recoverable work", async () => {
  const f = fixture({ mailBodyBytes: 6 * 1024 });
  try {
    // First crash: a review fact commits without its thread mail.
    const candidate = f.candidateWith({ "a.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open-1");
    const name1 = f.requestName("open-1");
    failNextMaterialize(f);
    const reviewed = await f.review("bob", name1, "rev-1");
    assert.equal(reviewed.state, "pending");
    f.reopen();
    await f.mail.reconcilePending();
    assert.equal(f.store.getOperation("bob", "rev-1")!.state, "succeeded");
    await f.vote("carol", name1, "approve", "ok", "v-1");
    assert.equal(f.stateOf(name1).display, "applied");
    // Second crash on a different boundary: the HIGH request's completion
    // notice dies at a mid-loop delivery flag after main moved.
    const main1 = f.git(["rev-parse", "refs/heads/main"]);
    const second = f.candidateWith({ "b.txt": "b" }, main1);
    await f.submit("alice", second, "s-2");
    await f.open("alice", { tier: "HIGH", candidate: second, base: main1 }, "open-2");
    const name2 = f.requestName("open-2");
    await f.vote("bob", name2, "approve", "ok", "v2-bob");
    failNextMaterialize(f);
    const quorum = await f.vote("carol", name2, "approve", "ok", "v2-carol");
    assert.equal(quorum.state, "pending");
    const approval = messages(f, "carol", "v2-carol").find(m => m.review?.role === "approval")!;
    // Repair the vote, then let the Principal's decision die at a notice
    // delivery flag mid-publication.
    f.reopen();
    await f.mail.reconcilePending();
    failNthDeliveryFlag(f, "git.integrate", 3);
    const decided = await f.vote("principal", name2, "approve", "fine", "pv", approval.id);
    assert.equal(decided.state, "succeeded", "the deciding vote settled; the integration did not");
    const apply2 = f.applyOp("alice", "open-2")!;
    assert.equal(apply2.state, "pending");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), second, "the CAS committed first");
    f.reopen();
    await f.module.reconcile(apply2.id);
    assert.equal(f.store.getOperationById(apply2.id)!.state, "succeeded");
    assert.equal(f.stateOf(name2).display, "applied");
    // Every operation is terminal and no recoverable work remains.
    assert.deepEqual(f.store.recoverableOperations(), []);
    for (const row of f.store.attestations.all())
      assert.equal(row.operation.state, "succeeded", `${row.operation.id} settled`);
    for (const row of f.store.attestations.all()) {
      const applied = f.store.getOperation(row.operation.actor, applyRequestKeyFor(row.operation.id));
      if (applied !== null) assert.equal(applied.state, "succeeded");
    }
    // Every accepted delivery — attestation mail and the integrations'
    // completion notices alike — was materialized exactly once.
    for (const row of f.store.attestations.all()) {
      const plan = row.operation.plan;
      if (!("messages" in plan)) continue;
      for (const message of plan.messages)
        for (const recipient of message.recipients)
          assert.equal(materialized(f, message.id, recipient), 1,
            `${message.id} → ${recipient} materialized once`);
    }
    for (const key of ["open-1", "open-2"]) {
      const applied = f.applyOp("alice", key)!;
      for (const row of f.store.deliveriesForOperation(applied.id))
        assert.equal(row.materialized, 1, `${row.messageId} → ${row.recipient} materialized once`);
    }
    ledgerPass(f);
    integrityPass(f);
  } finally { f.close(); }
});
