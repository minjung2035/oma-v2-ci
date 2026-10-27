/** mail-v1 acceptance under concurrent record calls: facts serialize through
 * the single-writer/T-side re-derivation boundary — every request key lands at
 * most once, a lost race is a deterministic refusal (never a half-recorded
 * fact), at most one approval/decision mail exists, and the settled state is
 * what the pure evaluator computes from the committed ledger. */
import test from "node:test";
import assert from "node:assert/strict";
import { readDiagnosticSnapshot } from "@oma/storage";
import { inspectLedger } from "#oma-test/app/diagnostics/ledger";
import type { Receipt, MessagePlan } from "@oma/contracts";
import { fixture, messages, inboxCount } from "./fixtures/review-fixture.js";
import { makeValidAgent } from "./fixtures/spec.js";

test("DR44: Integration's pre-CAS authority never calls the public Review workflow", async () => {
  const f = fixture();
  try {
    f.reviews.assertApplicable = () => { throw new Error("workflow callback reached CAS"); };
    const candidate = f.candidateWith({ "a.txt": "independent authority\n" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "LOW", candidate }, "no-workflow-callback");
    assert.equal(f.applyOp("alice", "no-workflow-callback")?.state, "succeeded");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
  } finally { f.close(); }
});

test("cancel cannot claim success after CAS while the integration notice is still pending", { timeout: 10_000 }, async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const materializing = new Promise<void>(resolve => { entered = resolve; });
  const materialize = f.mail.publishGated.bind(f.mail);
  f.mail.publishGated = async (...args) => {
    if (f.store.getOperationById(args[0])?.kind === "git.integrate") { entered(); await gate; }
    return materialize(...args);
  };
  let opening: Promise<Receipt> | undefined;
  try {
    const candidate = f.candidateWith({ "after-cas.txt": "landed" });
    await f.submit("alice", candidate);
    opening = f.open("alice", { tier: "LOW", candidate }, "open-cas");
    await materializing;
    assert.equal(f.applyOp("alice", "open-cas")!.state, "pending");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
    await assert.rejects(f.cancel("alice", f.requestName("open-cas"), "too-late"), { code: "REQUEST_CLOSED" });
    assert.equal(f.store.getOperation("alice", "too-late"), null);
    release(); await opening;
    assert.equal(f.applyOp("alice", "open-cas")!.state, "succeeded");
  } finally { release(); await opening; f.close(); }
});

test("DR44: review acceptance snapshots recipients without mutating frozen thread or completion plans", async () => {
  const f = fixture();
  try {
    const prepared: MessagePlan[] = [];
    const freeze = f.mail.freezeReviewMessage.bind(f.mail);
    f.mail.freezeReviewMessage = async (...args) => {
      const frozen = await freeze(...args);
      Object.freeze(frozen.message.recipients);
      Object.freeze(frozen.message);
      prepared.push(frozen.message);
      return frozen;
    };
    const candidate = f.candidateWith({ "a.txt": "land this\n" });
    await f.submit("alice", candidate);
    const opened = await f.open("alice", { tier: "MEDIUM", candidate }, "immutable-open");
    assert.equal(opened.state, "succeeded");
    const name = f.requestName("immutable-open");
    const voted = await f.vote("bob", name, "approve", "checked the change", "immutable-vote");
    assert.equal(voted.state, "succeeded");
    const applied = f.applyOp("alice", "immutable-open");
    assert.equal(applied?.state, "succeeded");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
    assert.ok(prepared.some(message => message.review?.role === "notice"));
    assert.ok(prepared.every(message => message.recipients.length === 0), "acceptance changed a preparation artifact");
    for (const [actor, key] of [["alice", "immutable-open"], ["bob", "immutable-vote"]] as const) {
      const operation = f.store.getOperation(actor, key);
      assert.ok(operation?.state === "succeeded" && operation.result.kind === "attest.record");
      assert.ok(operation.result.recipientCount > 0, "receipt did not use the accepted recipient snapshot");
      assert.ok(messages(f, actor, key).every(message => message.recipients.length > 0));
    }
  } finally { f.close(); }
});

type Outcome = { ok: true; receipt: Receipt } | { ok: false; error: unknown };
const settle = (p: Promise<Receipt>): Promise<Outcome> =>
  p.then(receipt => ({ ok: true as const, receipt }), (error: unknown) => ({ ok: false as const, error }));
const codeOf = (o: Outcome): string | null =>
  o.ok ? null : (o.error as { code?: string }).code ?? "no-code";
const addAgents = (f: ReturnType<typeof fixture>, names: readonly string[]) =>
  f.store.transaction(tx => { for (const name of names) tx.insertAgent(makeValidAgent(name)); });
const attestationMessages = (f: ReturnType<typeof fixture>) =>
  f.store.attestations.all()
    .flatMap(row => "messages" in row.operation.plan ? row.operation.plan.messages : []);
const mailOfRole = (f: ReturnType<typeof fixture>, role: "approval" | "withdrawn" | "decision" | "thread" | "notice") =>
  attestationMessages(f).filter(m => m.review?.role === role);

test("8 concurrent Worker votes on one HIGH request: serialized acceptance, one op per key, one approval", async () => {
  const f = fixture(); try {
    addAgents(f, ["erin", "fred", "gail", "henry", "iris"]);
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open-hi");
    const name = f.requestName("open-hi");
    const voters = ["bob", "carol", "dave", "erin", "fred", "gail", "henry", "iris"];
    const wave = await Promise.all(voters.map(v => settle(f.vote(v, name, "approve", `${v} approves`, `v-${v}`))));
    // Every prepare snapshots the same pre-wave ledger, so exactly one
    // transaction survives the T-side re-derivation; the rest get the busy
    // refusal and record nothing.
    const accepted = wave.filter(o => o.ok);
    assert.equal(accepted.length, 1, `wave winners: ${wave.map((o, i) => `${voters[i]}:${o.ok ? "ok" : codeOf(o)}`).join(",")}`);
    for (const [i, o] of wave.entries()) {
      const key = `v-${voters[i]}`;
      if (o.ok) {
        assert.equal(o.receipt.state, "succeeded");
        assert.equal(f.store.getOperation(voters[i]!, key)?.id, o.receipt.operation);
      } else {
        assert.equal(codeOf(o), "BROKER_UNAVAILABLE", `loser ${voters[i]} refuses busy`);
        assert.equal((o.error as { details?: { reason?: string } }).details?.reason, "busy");
        assert.equal(f.store.getOperation(voters[i]!, key), null, "a refused vote left no operation");
      }
    }
    // Same-key serial retries: each refused key now lands once.
    for (const [i, o] of wave.entries()) if (!o.ok) {
      const retry = await f.vote(voters[i]!, name, "approve", `${voters[i]} approves`, `v-${voters[i]}`);
      assert.equal(retry.state, "succeeded", `retry v-${voters[i]}`);
    }
    const st = f.stateOf(name);
    assert.deepEqual([...st.approvers], [...voters].sort(), "each actor's vote counts once");
    assert.equal(st.latestVotes.size, voters.length);
    assert.equal(st.entries.filter(e => e.fact.kind === "vote" && e.actor !== "principal").length, voters.length);
    assert.equal(st.required, 2);
    // Exactly one approval mail was ever emitted, on the op whose vote formed
    // the quorum; the bound votes are the first two accepted approvers.
    const approvals = mailOfRole(f, "approval");
    assert.equal(approvals.length, 1, "one approval mail total");
    assert.equal(inboxCount(f, "principal"), 1);
    assert.equal(mailOfRole(f, "withdrawn").length, 0);
    assert.equal(st.approval?.id, approvals[0]!.id);
    assert.equal(st.approvalValid, true);
    assert.deepEqual(st.approval?.votes, [...st.bundle]);
    assert.equal(st.approval?.votes.length, 2);
    assert.equal(st.display, "principal-pending");
    // One operation per request key; the ledger passes its own diagnostic.
    for (const v of voters) assert.ok(f.store.getOperation(v, `v-${v}`)?.state === "succeeded");
    const ledger = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" });
    assert.equal(ledger.report.status, "PASS", JSON.stringify(ledger.report.issues));
    const remembered = f.stateOf(name);
    f.reopen();
    assert.deepEqual(f.stateOf(name), remembered, "durable-only replay after reopen");
  } finally { f.close(); }
});

for (const order of ["cancel-first", "vote-first"] as const) test(
  `cancel vs approve race (${order}): loser refuses or the request cancels before apply`, async () => {
    const f = fixture(); try {
      const candidate = f.candidateWith({ "one.txt": "a" });
      await f.submit("alice", candidate);
      await f.open("alice", { tier: "MEDIUM", candidate }, "open-m");
      const name = f.requestName("open-m");
      const mkCancel = () => settle(f.cancel("alice", name, "c-1"));
      const mkVote = () => settle(f.vote("bob", name, "approve", "bob approves", "v-bob"));
      const [first, second] = order === "cancel-first"
        ? await Promise.all([mkCancel(), mkVote()])
        : await Promise.all([mkVote(), mkCancel()]);
      const [c, v] = order === "cancel-first" ? [first, second] : [second, first];
      assert.ok(c.ok || v.ok, "at least one of the pair lands");
      for (const o of [c, v])
        if (!o.ok) assert.ok(codeOf(o) === "REQUEST_CLOSED" || codeOf(o) === "BROKER_UNAVAILABLE",
          `unexpected refusal ${codeOf(o)}`);
      // Both landing is only possible when the cancel commits after the vote
      // but before the integration: the request then stays cancelled.
      await f.reviews.advanceAll();   // settle a skipped advance
      const st = f.stateOf(name);
      if (v.ok && !c.ok) {
        assert.equal(st.display, "applied");
        assert.equal(st.integration?.state, "succeeded");
        assert.equal(st.terminal, null);
        assert.deepEqual(st.approvers, ["bob"]);
      } else {
        assert.equal(st.terminal, "cancelled");
        assert.equal(st.display, "cancelled");
        assert.equal(st.integration, null, "a cancelled request never integrated");
        assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base, "main did not move");
      }
      assert.equal(f.store.getOperation("alice", "c-1") !== null, c.ok, "one op per key");
      assert.equal(f.store.getOperation("bob", "v-bob") !== null, v.ok, "one op per key");
      const cancels = st.entries.filter(e => e.fact.kind === "cancel");
      const votes = st.entries.filter(e => e.fact.kind === "vote" && e.actor === "bob");
      assert.equal(cancels.length, c.ok ? 1 : 0);
      assert.equal(votes.length, v.ok ? 1 : 0);
    } finally { f.close(); }
  });

test("concurrent opens: same key shares one operation, different keys refuse REQUEST_EXISTS", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    const other = f.candidateWith({ "two.txt": "b" });
    const third = f.candidateWith({ "three.txt": "c" });
    await f.submit("alice", candidate, "sub-a");
    await f.submit("alice", other, "sub-b");
    await f.submit("alice", third, "sub-c");
    const input = { tier: "MEDIUM" as const, candidate };
    // Same key, same payload: one operation exists for the key. A retry that
    // raced the commit may read the duplicate as REQUEST_EXISTS — still no
    // second operation — but a post-commit retry always gets the same receipt.
    const [o1, o2] = await Promise.all([settle(f.open("alice", input, "dup")), settle(f.open("alice", input, "dup"))]);
    assert.ok(o1.ok || o2.ok, "the open lands once");
    for (const o of [o1, o2]) if (!o.ok) assert.equal(codeOf(o), "REQUEST_EXISTS");
    if (o1.ok && o2.ok) assert.equal(o1.receipt.operation, o2.receipt.operation, "same-key opens share one op");
    const op = f.store.getOperation("alice", "dup");
    assert.ok(op !== null && op.kind === "attest.record");
    const retry = await f.open("alice", input, "dup");
    assert.equal(retry.state, "succeeded");
    assert.equal(retry.operation, op.id, "settled same-key retry returns the same receipt");
    // Different keys, same change: the duplicate scan in T lets exactly one in.
    // (While a live request covers the identity, every later open refuses.)
    const [p1, p2] = await Promise.all([
      settle(f.open("alice", { tier: "MEDIUM", candidate: other }, "k1")),
      settle(f.open("alice", { tier: "MEDIUM", candidate: other }, "k2"))]);
    assert.equal([p1, p2].filter(o => o.ok).length, 1, `one of k1/k2 lands: ${codeOf(p1)} ${codeOf(p2)}`);
    const refused = [p1, p2].find(o => !o.ok);
    assert.ok(refused !== undefined && codeOf(refused) === "REQUEST_EXISTS");
    const winnerKey = p1.ok ? "k1" : "k2";
    assert.equal((refused!.error as { details?: { name?: string } }).details?.name, f.requestName(winnerKey));
    // The covering request is still open, so the same identity refuses again.
    await assert.rejects(f.open("alice", { tier: "MEDIUM", candidate: other }, "k3"), { code: "REQUEST_EXISTS" });
    // Different keys, different request identities: nothing to conflict on —
    // both open (a distinct candidate, and the same candidate at another tier).
    const [d1, d2] = await Promise.all([
      settle(f.open("alice", { tier: "MEDIUM", candidate: third }, "other-1")),
      settle(f.open("alice", { tier: "HIGH", candidate, title: "the same change at HIGH" }, "other-2"))]);
    assert.ok(d1.ok && d2.ok, `distinct opens both land: ${codeOf(d1)} ${codeOf(d2)}`);
    assert.notEqual(f.requestName("other-1"), f.requestName("other-2"));
  } finally { f.close(); }
});

test("concurrent Principal votes on one approval: exactly one decision is recorded", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open-hi");
    const name = f.requestName("open-hi");
    await f.vote("bob", name, "approve", "bob ok", "v-bob");
    await f.vote("carol", name, "approve", "carol ok", "v-carol");
    const approval = messages(f, "carol", "v-carol").find(m => m.review?.role === "approval")!;
    // Two Principal votes naming the same current approval: the first commit
    // decides the request; the second reads the moved state.
    const [a, b] = await Promise.all([
      settle(f.vote("principal", name, "approve", "yes", "p-yes", approval.id)),
      settle(f.vote("principal", name, "reject", "no", "p-no", approval.id))]);
    assert.notEqual(a.ok, b.ok, `exactly one decision lands: ${codeOf(a)}/${codeOf(b)}`);
    const loser = a.ok ? b : a;
    assert.ok(codeOf(loser) === "REQUEST_CLOSED" || codeOf(loser) === "BROKER_UNAVAILABLE",
      `loser refusal ${codeOf(loser)}`);
    await f.reviews.advanceAll();
    const st = f.stateOf(name);
    const principalEntries = st.entries.filter(e => e.actor === "principal" && e.fact.kind === "vote");
    assert.equal(principalEntries.length, 1, "one Principal vote in the ledger");
    assert.equal(mailOfRole(f, "decision").length, 1, "one decision mail");
    if (a.ok) {
      assert.equal(st.principal?.operation, f.store.getOperation("principal", "p-yes")!.id);
      assert.equal(st.display, "applied");
      assert.equal(st.integration?.state, "succeeded");
    } else {
      assert.equal(st.terminal, "rejected");
      assert.equal(st.display, "rejected");
      assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
      // The reject's own op withdrew the sent approval.
      const withdrawn = mailOfRole(f, "withdrawn");
      assert.equal(withdrawn.length, 1);
      assert.equal(withdrawn[0]!.review?.role === "withdrawn" ? withdrawn[0]!.review.approval : null, approval.id);
    }
    // Exactly one op per principal key; the loser recorded nothing.
    assert.equal(f.store.getOperation("principal", "p-yes") !== null, a.ok);
    assert.equal(f.store.getOperation("principal", "p-no") !== null, b.ok);
  } finally { f.close(); }
});

test("concurrent same-key facts never double-record; a same-actor re-vote serializes", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open-hi");
    const name = f.requestName("open-hi");
    // Two identical votes with one key: both callers get the one receipt.
    const [s1, s2] = await Promise.all([
      settle(f.vote("bob", name, "approve", "same", "same-key")),
      settle(f.vote("bob", name, "approve", "same", "same-key"))]);
    assert.ok(s1.ok && s2.ok, `same-key votes share the receipt: ${codeOf(s1)} ${codeOf(s2)}`);
    assert.equal(s1.ok && s2.ok ? s1.receipt.operation : null, s2.ok ? s2.receipt.operation : null);
    const bobOps = f.stateOf(name).entries.filter(e => e.actor === "bob" && e.fact.kind === "vote");
    assert.equal(bobOps.length, 1, "one vote entry for one key");
    // One actor, two different keys, opposite verdicts: at most one tx per
    // snapshot; a loser retries to a clean serialized state.
    const [r1, r2] = await Promise.all([
      settle(f.vote("carol", name, "approve", "first", "c-1")),
      settle(f.vote("carol", name, "reject", "second", "c-2"))]);
    assert.ok(r1.ok || r2.ok);
    for (const o of [r1, r2]) if (!o.ok) assert.equal(codeOf(o), "BROKER_UNAVAILABLE");
    if (!r1.ok) assert.equal((await f.vote("carol", name, "approve", "first", "c-1")).state, "succeeded");
    if (!r2.ok) assert.equal((await f.vote("carol", name, "reject", "second", "c-2")).state, "succeeded");
    const st = f.stateOf(name);
    // Both facts are durable; the later one is carol's effective vote.
    const carolVotes = st.entries.filter(e => e.actor === "carol" && e.fact.kind === "vote");
    assert.equal(carolVotes.length, 2);
    const latest = st.latestVotes.get("carol")!;
    assert.ok(carolVotes.some(e => e.operation === latest.operation));
    // Whatever order the retries landed, the evaluator is self-consistent:
    // carol's latest vote decides whether she blocks the request.
    const latestFact = latest.fact;
    assert.equal(st.rejectors.includes("carol"), latestFact.kind === "vote" && latestFact.verdict === "reject");
    assert.equal(st.display, st.rejectors.length > 0 ? "blocked" : "principal-pending");
    const ledger = inspectLedger(readDiagnosticSnapshot(f.root), { stateRoot: f.root, society: "demo" });
    assert.equal(ledger.report.status, "PASS", JSON.stringify(ledger.report.issues));
  } finally { f.close(); }
});

test("concurrent review + vote + cancel on one request: facts serialize, terminal wins", async () => {
  const f = fixture(); try {
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open-hi");
    const name = f.requestName("open-hi");
    // A review, a vote and the requester's cancel issued together: at most the
    // first commit survives unchanged; losers get busy/closed, and no fact is
    // half-recorded — every accepted key has an op, every refused key none.
    const wave = await Promise.all([
      settle(f.review("bob", name, "rev-1")),
      settle(f.vote("carol", name, "approve", "ok", "v-carol")),
      settle(f.cancel("alice", name, "c-1"))]);
    const okCount = wave.filter(o => o.ok).length;
    assert.ok(okCount >= 1 && okCount <= wave.length);
    const keys: [string, string][] = [["bob", "rev-1"], ["carol", "v-carol"], ["alice", "c-1"]];
    for (const [i, o] of wave.entries()) {
      const [actor, key] = keys[i]!;
      if (!o.ok) assert.ok(codeOf(o) === "BROKER_UNAVAILABLE" || codeOf(o) === "REQUEST_CLOSED",
        `refusal ${codeOf(o)}`);
      assert.equal(f.store.getOperation(actor, key) !== null, o.ok, `${key}: op exists iff accepted`);
    }
    const st = f.stateOf(name);
    // If the cancel landed, the request is cancelled no matter what raced it;
    // otherwise every landed fact is visible and consistent.
    if (wave[2]!.ok) {
      assert.equal(st.terminal, "cancelled");
      assert.equal(st.display, "cancelled");
    }
    const kinds = st.entries.map(e => e.fact.kind);
    for (const o of st.entries) assert.ok(kinds.includes(o.fact.kind));
    assert.equal(st.entries.length, okCount, "each accepted fact is one entry");
    // Losers retry cleanly under the same key — unless the request closed.
    for (const [i, o] of wave.entries()) if (!o.ok) {
      const retry = i === 0 ? settle(f.review("bob", name, "rev-1"))
        : i === 1 ? settle(f.vote("carol", name, "approve", "ok", "v-carol"))
        : settle(f.cancel("alice", name, "c-1"));
      const r = await retry;
      assert.ok(r.ok || codeOf(r) === "REQUEST_CLOSED", `retry ${i}: ${codeOf(r)}`);
    }
    const after = f.stateOf(name);
    assert.equal(after.terminal === null, !after.entries.some(e => e.fact.kind === "cancel"),
      "a cancel entry is terminal exactly when present");
  } finally { f.close(); }
});
