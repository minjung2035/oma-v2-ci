/** mail-v1 pure review evaluator: seeded property/differential tests (no
 * fixtures, no I/O). Random legal-ish ledgers — worker votes from an actor
 * pool that includes the author and never-eligible actors, reviews, cancels,
 * refreshes, Principal votes naming current/withdrawn/fabricated/null
 * approval ids, eligibility churn, and noise challenge.open entries — are
 * stepped through reviewState/planEffects exactly as ReviewModule does:
 * before, after0 with the entry's messages still empty, then after with the
 * emitted messages attached. Every step asserts invariants (quorum
 * composition, a single current approval, terminal silence, emission gating),
 * never snapshots. A ~15-line naive projection is diffed against the
 * evaluator on every state, and each sequence is evaluated twice for
 * determinism. The seed is printed in every assertion label. */
import test from "node:test";
import assert from "node:assert/strict";
import type { MessageId, OperationId } from "@oma/contracts";
import type { ExactCandidateIdentity, MessagePlan, RiskTier } from "@oma/contracts";
import type { ReviewFact } from "@oma/contracts/attestation";
import { reviewState, planEffects, type ReviewEntry, type ReviewState } from "@oma/domain/review-evaluation";

const OP = (n: number): OperationId => `op-ff000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MID = (n: number): MessageId => `m-ff000000-0000-4000-8000-${String(n).padStart(12, "0")}-0`;
const identity: ExactCandidateIdentity = { repo: "project", targetRef: "refs/heads/main",
  expectedBase: "1".repeat(40), candidate: "2".repeat(40), policyRevision: "p1" };

const open = (tier: RiskTier, kind: "merge.open" | "challenge.open", submitters: string[],
    id = OP(1), sequence = 1): ReviewEntry => {
  const fact: ReviewFact = kind === "merge.open"
    ? { kind: "merge.open", version: 1, name: "merge-fuzz", title: "t", reason: "r",
        tier, identity, submitters }
    : { kind: "challenge.open", version: 1, name: "challenge-fuzz", title: "t", reason: "r",
        tier: tier === "MEDIUM" ? "HIGH" : tier, identity, submitters, prepared: true,
        target: { name: "merge-target", request: OP(90), integration: OP(91), identity, tier: "LOW" } };
  return { sequence, operation: id, actor: "alice", fact, messages: [] };
};
const challengeNoise = (sequence: number, operation: OperationId, actor: string, request: OperationId): ReviewEntry =>
  ({ sequence, operation, actor,
     fact: { kind: "challenge.open", version: 1, name: `challenge-n${sequence}`, title: "t", reason: "r",
             tier: "LOW", identity, submitters: ["bob"], prepared: true,
             target: { name: "merge-fuzz", request, integration: OP(90), identity, tier: "LOW" } },
     messages: [] });

const reviewMessage = (id: string, review: MessagePlan["review"]): MessagePlan =>
  ({ id, objectPath: `mail/objects/${id}.eml`, sha256: "0".repeat(64), bytes: 10, dateMs: 1,
     to: review?.role === "thread" ? ["residents"] : ["principal"], recipients: ["alice"],
     kind: review?.role === "approval" ? "approval_required" : "message",
     contextRevision: null, replyHeaders: { replyTo: [], inReplyTo: null, references: [] },
     ...(review?.role === "thread" ? { audience: "workers" as const } : {}),
     ...(review === undefined ? {} : { review }) });
const approvalMessage = (id: string, votes: readonly string[]): MessagePlan =>
  ({ ...reviewMessage(id, { role: "approval", request: OP(1), name: "merge-fuzz", votes: [...votes] }),
     kind: "approval_required", approvalFor: identity });
const withdrawnMessage = (id: string, approval: string): MessagePlan =>
  reviewMessage(id, { role: "withdrawn", request: OP(1), name: "merge-fuzz", approval });

/* ---------------- seeded PRNG ---------------- */

type Rng = () => number;
const mulberry32 = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const int = (r: Rng, n: number) => Math.floor(r() * n);
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, xs.length)]!;

/* ---------------- naive differential projection ----------------
 * Independently recomputes the quorum-facing fields: latest vote per
 * non-Principal actor, eligible non-author approvers, reject-blockers, the
 * first-`required` bundle by vote sequence, and the earliest terminal fact. */
interface Naive { required: number; approvers: string[]; rejectors: string[];
  bundle: OperationId[]; terminal: "cancelled" | "rejected" | "stale" | null;
  latestVotes: Map<string, OperationId>; peerReady: boolean; }
const naive = (o: ReviewEntry, entries: readonly ReviewEntry[], eligible: ReadonlySet<string>,
    floor: number): Naive => {
  const fact = o.fact as Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>;
  const required = fact.kind === "challenge.open" ? floor
    : fact.tier === "HIGH" ? floor : fact.tier === "MEDIUM" ? 1 : 0;
  const authors = new Set([o.actor, ...fact.submitters]);
  const latest = new Map<string, ReviewEntry>();
  let terminal: Naive["terminal"] = null;
  for (const e of entries) {
    if (e.fact.kind === "vote" && e.actor !== "principal") latest.set(e.actor, e);
    if (terminal === null) {
      if (e.fact.kind === "cancel") terminal = "cancelled";
      else if (e.fact.kind === "vote" && e.actor === "principal" && e.fact.verdict === "reject") terminal = "rejected";
      else if (e.fact.kind === "refresh" && e.fact.main !== null) terminal = "stale";
    }
  }
  const ok = [...latest.values()]
    .filter(e => e.fact.kind === "vote" && e.fact.verdict === "approve" && eligible.has(e.actor) && !authors.has(e.actor))
    .sort((a, b) => a.sequence - b.sequence);
  const rejectors = [...latest.values()]
    .filter(e => e.fact.kind === "vote" && e.fact.verdict === "reject").map(e => e.actor).sort();
  return { required, approvers: ok.map(e => e.actor).sort(), rejectors,
    bundle: ok.length >= required ? ok.slice(0, required).map(e => e.operation) : [],
    terminal, latestVotes: new Map([...latest].map(([k, v]) => [k, v.operation])),
    peerReady: terminal === null && rejectors.length === 0 && ok.length >= required };
};

/** The current approval recomputed straight from the message stream: the last
 * approval-role message not named by a later withdrawn-role message. */
const scanApproval = (o: ReviewEntry, entries: readonly ReviewEntry[]):
    { id: MessageId; votes: OperationId[] } | null => {
  let current: { id: MessageId; votes: OperationId[] } | null = null;
  for (const entry of [o, ...entries])
    for (const message of entry.messages) {
      const meta = message.review;
      if (meta === undefined) continue;
      if (meta.role === "approval") current = { id: message.id, votes: [...meta.votes] };
      else if (meta.role === "withdrawn" && current !== null && meta.approval === current.id) current = null;
    }
  return current;
};

/** Every state the harness builds must satisfy these, whatever the ledger. */
const assertStateShape = (after: ReviewState, o: ReviewEntry, ledger: readonly ReviewEntry[],
    eligible: ReadonlySet<string>, floor: number, lbl: string): void => {
  // Approvers are exactly the eligible non-author latest-approve voters; the
  // author's own votes and ineligible votes never count. Rejectors are the
  // latest-reject voters (eligibility/authorship does not protect a reject).
  assert.deepEqual([...after.approvers], [...after.approvers].sort(), `${lbl}: approvers sorted`);
  assert.equal(new Set(after.approvers).size, after.approvers.length, `${lbl}: approvers distinct`);
  for (const a of after.approvers) {
    assert.ok(eligible.has(a), `${lbl}: ineligible approver ${a}`);
    assert.ok(!after.authors.includes(a), `${lbl}: author ${a} counted as approver`);
    const latest = after.latestVotes.get(a);
    assert.ok(latest !== undefined && latest.fact.kind === "vote" && latest.fact.verdict === "approve",
      `${lbl}: approver ${a} has no latest approve`);
  }
  for (const a of after.rejectors) {
    const latest = after.latestVotes.get(a);
    assert.ok(latest !== undefined && latest.fact.kind === "vote" && latest.fact.verdict === "reject",
      `${lbl}: rejector ${a} has no latest reject`);
    assert.ok(!after.approvers.includes(a), `${lbl}: ${a} is both approver and rejector`);
  }
  assert.ok(!after.latestVotes.has("principal"), `${lbl}: principal leaked into worker votes`);
  // Differential: the naive projection agrees on every quorum-facing field.
  const nv = naive(o, ledger, eligible, floor);
  assert.deepEqual([...after.approvers], nv.approvers, `${lbl}: approvers vs naive`);
  assert.deepEqual([...after.rejectors], nv.rejectors, `${lbl}: rejectors vs naive`);
  assert.equal(after.required, nv.required, `${lbl}: required vs naive`);
  assert.equal(after.terminal, nv.terminal, `${lbl}: terminal vs naive`);
  assert.deepEqual([...after.bundle], nv.bundle, `${lbl}: bundle vs naive`);
  assert.equal(after.latestVotes.size, nv.latestVotes.size, `${lbl}: latestVotes size`);
  for (const [actor, op] of nv.latestVotes)
    assert.equal(after.latestVotes.get(actor)?.operation, op, `${lbl}: latestVote ${actor}`);
  // At most one current approval, and — with every emitted effect attached —
  // a current approval is always a valid one.
  assert.deepEqual(after.approval, scanApproval(o, ledger), `${lbl}: approval vs message scan`);
  if (after.approval !== null)
    assert.equal(after.approvalValid, true, `${lbl}: an invalid approval stayed current`);
  // A Principal vote is tracked only while it names the current approval.
  if (after.principal !== null) {
    assert.ok(after.approval !== null, `${lbl}: principal without approval`);
    assert.ok(after.principal.fact.kind === "vote" && after.principal.fact.approval === after.approval!.id,
      `${lbl}: principal names a non-current approval`);
  }
  // Readiness: non-HIGH tiers are exactly the naive peer quorum; HIGH adds a
  // still-valid approval decided by the Principal.
  if (after.tier !== "HIGH")
    assert.equal(after.ready, nv.peerReady, `${lbl}: ready vs naive peer quorum`);
  else
    assert.equal(after.ready,
      after.terminal === null && after.rejectors.length === 0 && after.approvalValid &&
        after.principal !== null && after.principal.fact.kind === "vote" &&
        after.principal.fact.verdict === "approve",
      `${lbl}: HIGH ready`);
  if (after.terminal !== null) assert.equal(after.ready, false, `${lbl}: terminal cannot be ready`);
  // Display and the missing/shortfall strings agree with the computed sets.
  const expectedDisplay = after.terminal !== null ? after.terminal
    : after.rejectors.length > 0 ? "blocked"
    : after.ready ? "applying"
    : after.tier === "HIGH" && after.approvalValid ? "principal-pending" : "peer-needed";
  assert.equal(after.display, expectedDisplay, `${lbl}: display`);
  if (after.terminal === "cancelled") assert.ok(after.missing.includes("cancelled"), `${lbl}: missing cancelled`);
  if (after.terminal === "stale") assert.ok(after.missing.includes("main moved"), `${lbl}: missing stale`);
  if (after.terminal === "rejected") assert.ok(after.missing.includes("rejected by the Principal"), `${lbl}: missing rejected`);
  for (const rj of after.rejectors) assert.ok(after.missing.includes(`rejected by ${rj}`), `${lbl}: missing rejector ${rj}`);
  if (after.terminal === null && after.rejectors.length === 0) {
    const shortfall = after.required - after.approvers.length;
    if (shortfall > 0)
      assert.ok(after.missing.includes(
        `${shortfall} more approving Worker review${shortfall === 1 ? "" : "s"} (have ${after.approvers.length} of ${after.required})`),
        `${lbl}: shortfall string`);
    else if (after.tier === "HIGH" && !after.ready) {
      const line = after.approval === null ? "peer approval not yet sent"
        : !after.approvalValid ? "approval is no longer current"
        : `Principal decision on approval ${after.approval.id}`;
      assert.ok(after.missing.includes(line), `${lbl}: principal-pending line`);
    } else assert.deepEqual(after.missing, [], `${lbl}: ready state has no missing lines`);
  }
};

/* ---------------- the seeded sweep ---------------- */

const ACTORS = ["alice", "bob", "carol", "dave", "erin", "frank", "gail", "henry"];
const SEEDS = [1201201, 1201202, 1201203];
const SEQUENCES_PER_SEED = 170;
const MAX_STEPS = 22;

const coverage = { sequences: 0, steps: 0, approvals: 0, withdraws: 0, cancels: 0,
  terminalSeen: 0, principalVotes: 0, membership: 0, challenges: 0, readySeen: 0 };

/** Generates and replays one random ledger, asserting every invariant. Returns
 * a compact log so the same sequence can be evaluated twice for determinism. */
const simulate = (seed: number, index: number): string => {
  const r = mulberry32((seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0);
  const lbl = (step: number) => `seed ${seed} seq ${index} step ${step}`;
  const kind = r() < 0.78 ? "merge.open" : "challenge.open";
  const tier: RiskTier = kind === "merge.open"
    ? pick(r, ["LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "HIGH"]) : pick(r, ["LOW", "HIGH"]);
  const submitters = r() < 0.3 ? ["alice", "bob"] : ["alice"];
  const floor = 1 + int(r, 3);
  const eligible = new Set(["alice", ...ACTORS.slice(1).filter(() => r() < 0.55)]);
  const o = open(tier, kind, submitters);
  if (kind === "challenge.open") coverage.challenges++;
  const ledger: ReviewEntry[] = [];
  const log: string[] = [`${kind}:${tier}:f${floor}:e${[...eligible].sort().join(".")}:s${submitters.join(".")}`];
  const withdrawnIds: MessageId[] = [];
  let nextSeq = 2, nextOp = 100, nextMid = 1;
  const st = (entries: readonly ReviewEntry[]) =>
    reviewState({ open: o, entries: [...entries], eligible: new Set(eligible),
      highPeerFloor: floor, integration: null });
  const steps = 4 + int(r, MAX_STEPS - 3);
  for (let j = 0; j < steps; j++) {
    const at = lbl(j);
    const roll = r();
    // Eligibility churn mutates the input set, then lands a refresh(null) —
    // the broker's own spell for "a bound reviewer lost eligibility" — so the
    // before-state already sees the new set, as in acceptRefresh.
    const membershipTarget = roll >= 0.77 && roll < 0.83
      ? pick(r, ACTORS.filter(a => a !== "alice" && !submitters.includes(a))) : null;
    if (membershipTarget !== null) {
      if (eligible.has(membershipTarget)) eligible.delete(membershipTarget); else eligible.add(membershipTarget);
      coverage.membership++;
    }
    const before = st(ledger);
    let actor: string, fact: ReviewFact;
    if (roll < 0.50) {                                       // Worker vote
      actor = pick(r, [...ACTORS, "mallory"]);               // mallory is never eligible
      fact = { kind: "vote", version: 1, request: o.operation,
        verdict: r() < 0.72 ? "approve" : "reject", body: "b", approval: null };
    } else if (roll < 0.62) {                                // review (inert)
      actor = pick(r, ACTORS);
      fact = { kind: "review", version: 1, request: o.operation, body: "b" };
    } else if (roll < 0.69) {                                // cancel
      actor = pick(r, ACTORS);
      fact = { kind: "cancel", version: 1, request: o.operation, reason: "r" };
      coverage.cancels++;
    } else if (roll < 0.77) {                                // refresh
      actor = o.actor;
      fact = { kind: "refresh", version: 1, request: o.operation,
        main: pick(r, [null, null, identity.expectedBase, "9".repeat(40), "f".repeat(40)]) };
    } else if (membershipTarget !== null) {                  // the churn entry
      actor = o.actor;
      fact = { kind: "refresh", version: 1, request: o.operation, main: null };
    } else if (roll < 0.94) {                                // Principal vote
      actor = "principal";
      const current = before.approval?.id;
      const pool: (MessageId | null)[] = [`m-fabricated-${int(r, 999)}`, null];
      if (current !== undefined) pool.push(current, current);
      if (withdrawnIds.length > 0) pool.push(pick(r, withdrawnIds));
      fact = { kind: "vote", version: 1, request: o.operation,
        verdict: r() < 0.75 ? "approve" : "reject", body: "b", approval: pick(r, pool) };
      coverage.principalVotes++;
    } else {                                                 // noise challenge.open entry
      const noise = challengeNoise(nextSeq, OP(nextOp), pick(r, ACTORS), o.operation);
      actor = noise.actor; fact = noise.fact;
    }
    const entry: ReviewEntry = { sequence: nextSeq, operation: OP(nextOp), actor, fact, messages: [] };
    nextSeq++; nextOp++;
    const after0 = st([...ledger, entry]);
    const fx = planEffects(before, after0);

    // --- transition invariants ---
    const withdrawExpected = before.approval !== null && after0.approval !== null &&
      after0.approval.id === before.approval.id && !after0.approvalValid;
    assert.equal(fx.withdraw !== null, withdrawExpected, `${at}: withdraw emission`);
    if (fx.withdraw !== null) {
      assert.equal(fx.withdraw.id, before.approval?.id, `${at}: withdraw id`);
      assert.ok(fx.withdraw.reason.length > 0, `${at}: withdraw reason`);
    }
    const approveExpected = after0.tier === "HIGH" && after0.terminal === null &&
      after0.rejectors.length === 0 && after0.approvers.length >= after0.required &&
      after0.integration === null &&
      (after0.approval === null || withdrawExpected || !after0.approvalValid);
    assert.equal(fx.approve !== null, approveExpected, `${at}: approve gate`);
    if (fx.approve !== null) {
      assert.deepEqual([...fx.approve], [...after0.bundle], `${at}: approve carries the bundle`);
      assert.equal(fx.approve.length, after0.required, `${at}: bundle size`);
      if (before.approval !== null)
        assert.ok(fx.withdraw !== null, `${at}: a fresh approval never replaces a live one silently`);
      coverage.approvals++;
    }
    if (fx.withdraw !== null) coverage.withdraws++;
    // Once terminal, nothing further is ever emitted and terminal never moves.
    if (before.terminal !== null) {
      assert.equal(after0.terminal, before.terminal, `${at}: terminal changed`);
      assert.equal(fx.withdraw, null, `${at}: withdraw after terminal`);
      assert.equal(fx.approve, null, `${at}: approve after terminal`);
    }
    // Tier/floor rules: a challenge is never MEDIUM and always takes the HIGH floor.
    if (after0.kind === "challenge") assert.notEqual(after0.tier, "MEDIUM", `${at}: MEDIUM challenge`);

    // --- attach the emitted effects (module order: withdrawn, then approve) ---
    const messages: MessagePlan[] = [];
    if (fx.withdraw !== null) {
      messages.push(withdrawnMessage(MID(nextMid++), fx.withdraw.id));
      withdrawnIds.push(fx.withdraw.id);
    }
    let emittedApproval: MessageId | null = null;
    if (fx.approve !== null) {
      emittedApproval = MID(nextMid++);
      messages.push(approvalMessage(emittedApproval, fx.approve));
    }
    ledger.push({ ...entry, messages });
    const after = st(ledger);

    // --- resulting-state invariants ---
    if (fx.withdraw !== null && fx.approve !== null) {
      const roles = messages.map(m => m.review?.role);
      assert.ok(roles.indexOf("withdrawn") === 0 && roles.indexOf("approval") === 1,
        `${at}: the withdrawn notice precedes the re-approval`);
    }
    if (fx.approve !== null) {
      assert.equal(after.approval?.id, emittedApproval, `${at}: emitted approval is the current one`);
      assert.deepEqual(after.approval?.votes, [...fx.approve], `${at}: current approval votes`);
    }
    if (fx.withdraw !== null && fx.approve === null)
      assert.equal(after.approval, null, `${at}: withdrawn approval stayed current`);
    // A Principal approve counts only while it names the current approval; a
    // reject is terminal however it names the approval (module admission would
    // have refused a stale name before the fact existed).
    if (fact.kind === "vote" && actor === "principal") {
      if (fact.verdict === "approve")
        if (after.approval !== null && fact.approval === after.approval.id)
          assert.equal(after.principal?.operation, entry.operation, `${at}: bound principal approve untracked`);
        else
          assert.notEqual(after.principal?.operation, entry.operation, `${at}: stale principal approve counted`);
      else if (before.terminal === null)
        assert.equal(after.terminal, "rejected", `${at}: principal reject did not terminate`);
    }
    assertStateShape(after, o, ledger, eligible, floor, at);
    if (after.terminal !== null) coverage.terminalSeen++;
    if (after.ready) coverage.readySeen++;
    coverage.steps++;
    log.push(`${membershipTarget ?? ""}${fact.kind}@${actor}` +
      `${fact.kind === "vote" ? `:${fact.verdict}->${String(fact.approval)}` : ""}` +
      `|w:${fx.withdraw === null ? "-" : fx.withdraw.id}|a:${fx.approve === null ? "-" : fx.approve.join(",")}` +
      `|${after.display}`);
  }
  // Epilogue: an integration projection drives the display deterministically.
  for (const [state, display] of [["pending", "applying"], ["succeeded", "applied"],
      ["failed", "blocked"], ["unknown", "unknown"]] as const) {
    const projected = reviewState({ open: o, entries: [...ledger], eligible: new Set(eligible),
      highPeerFloor: floor, integration: { operation: OP(900), state, errorCode: null } });
    assert.equal(projected.display, display, `${lbl(-1)}: integration ${state} display`);
  }
  coverage.sequences++;
  return log.join("\n");
};

test(`seeded evaluator invariant sweep — mulberry32 seeds ${SEEDS.join(", ")} ` +
     `(${SEQUENCES_PER_SEED} ledgers each), determinism by double evaluation`, () => {
  for (const seed of SEEDS)
    for (let i = 0; i < SEQUENCES_PER_SEED; i++) {
      const first = simulate(seed, i);
      const second = simulate(seed, i);
      assert.equal(second, first, `seed ${seed} seq ${i}: evaluation is not deterministic`);
    }
});

test("evaluator fuzz coverage report", () => {
  // Existence proof that the sweep exercised the interesting regions; a seed
  // change that collapses coverage (e.g. no approvals ever emitted) must fail.
  assert.ok(coverage.sequences >= SEEDS.length * SEQUENCES_PER_SEED, "all sequences ran");
  assert.ok(coverage.approvals > 50, `approvals emitted: ${coverage.approvals}`);
  assert.ok(coverage.withdraws > 50, `withdrawals emitted: ${coverage.withdraws}`);
  assert.ok(coverage.cancels > 50, `cancels: ${coverage.cancels}`);
  assert.ok(coverage.principalVotes > 100, `principal votes: ${coverage.principalVotes}`);
  assert.ok(coverage.challenges > 50, `challenge ledgers: ${coverage.challenges}`);
  assert.ok(coverage.terminalSeen > 100, `terminal states: ${coverage.terminalSeen}`);
  assert.ok(coverage.readySeen > 50, `ready states: ${coverage.readySeen}`);
  assert.ok(coverage.membership > 50, `eligibility churns: ${coverage.membership}`);
});
