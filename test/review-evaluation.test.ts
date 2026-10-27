/** mail-v1 review quorum/status owner: reviewState + planEffects are pure. */
import test from "node:test";
import assert from "node:assert/strict";
import type { MessageId, OperationId } from "@oma/contracts";
import type { ExactCandidateIdentity, MessagePlan } from "@oma/contracts";
import type { ReviewFact } from "@oma/contracts/attestation";
import { StoreError } from "@oma/domain/errors";
import { reviewState, planEffects, type ReviewEntry, type ReviewState,
  type ReviewStateInput } from "@oma/domain/review-evaluation";

const OP = (n: number): OperationId => `op-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MID = (n: number): MessageId => `m-00000000-0000-4000-8000-${String(n).padStart(12, "0")}-0`;
const identity: ExactCandidateIdentity = { repo: "project", targetRef: "refs/heads/main",
  expectedBase: "1".repeat(40), candidate: "2".repeat(40), policyRevision: "p1" };
const ELIGIBLE = new Set(["alice", "bob", "carol", "dave"]);

const open = (tier: "LOW" | "MEDIUM" | "HIGH", kind: "merge.open" | "challenge.open" = "merge.open",
    id = OP(1), sequence = 1): ReviewEntry => {
  const fact: ReviewFact = kind === "merge.open"
    ? { kind: "merge.open", version: 1, name: "merge-00000000-0000-4000-8000-000000000000", title: "t", reason: "r",
        tier, identity, submitters: ["alice"] }
    : { kind: "challenge.open", version: 1, name: "challenge-00000000-0000-4000-8000-000000000000", title: "t", reason: "r",
        tier: tier === "MEDIUM" ? "HIGH" : tier, identity, submitters: ["alice"], prepared: true,
        target: { name: "merge-ffffffff-0000-4000-8000-000000000000", request: OP(90), integration: OP(91), identity, tier: "LOW" } };
  return { sequence, operation: id, actor: "alice", fact, messages: [] };
};
const vote = (sequence: number, actor: string, verdict: "approve" | "reject",
    request: string = OP(1), approval: string | null = null, messages: readonly MessagePlan[] = []): ReviewEntry =>
  ({ sequence, operation: OP(sequence), actor,
     fact: { kind: "vote", version: 1, request, verdict, body: "b", approval }, messages });
const review = (sequence: number, actor: string, request = OP(1)): ReviewEntry =>
  ({ sequence, operation: OP(sequence), actor,
     fact: { kind: "review", version: 1, request, body: "b" }, messages: [] });
const cancel = (sequence: number, actor = "alice", request = OP(1)): ReviewEntry =>
  ({ sequence, operation: OP(sequence), actor,
     fact: { kind: "cancel", version: 1, request, reason: "r" }, messages: [] });
const refresh = (sequence: number, main: string | null, request = OP(1)): ReviewEntry =>
  ({ sequence, operation: OP(sequence), actor: "alice",
     fact: { kind: "refresh", version: 1, request, main }, messages: [] });

const reviewMessage = (id: string, request: string, name: string, review: MessagePlan["review"]): MessagePlan =>
  ({ id, objectPath: `mail/objects/${id}.eml`, sha256: "0".repeat(64), bytes: 10, dateMs: 1,
     to: review?.role === "thread" ? ["residents"] : ["principal"], recipients: ["alice"],
     kind: review?.role === "approval" ? "approval_required" : "message",
     contextRevision: null, replyHeaders: { replyTo: [], inReplyTo: null, references: [] },
     ...(review?.role === "thread" ? { audience: "workers" as const } : {}),
     ...(review === undefined ? {} : { review }) });
const approvalMessage = (id: string, votes: readonly string[], request = OP(1), name = "merge-00000000-0000-4000-8000-000000000000"): MessagePlan =>
  ({ ...reviewMessage(id, request, name, { role: "approval", request, name, votes: [...votes] }),
     kind: "approval_required", approvalFor: identity });
const withdrawnMessage = (id: string, approval: string, request = OP(1), name = "merge-00000000-0000-4000-8000-000000000000"): MessagePlan =>
  reviewMessage(id, request, name, { role: "withdrawn", request, name, approval });
const withMessages = (entry: ReviewEntry, messages: readonly MessagePlan[]): ReviewEntry =>
  ({ ...entry, messages });

const state = (openEntry: ReviewEntry, entries: readonly ReviewEntry[],
    over: Partial<Omit<ReviewStateInput, "open" | "entries">> = {}): ReviewState =>
  reviewState({ open: openEntry, entries, eligible: over.eligible ?? ELIGIBLE,
    highPeerFloor: over.highPeerFloor ?? 2, integration: over.integration ?? null });
const effects = (openEntry: ReviewEntry, before: readonly ReviewEntry[], after: readonly ReviewEntry[],
    over: Partial<Omit<ReviewStateInput, "open" | "entries">> = {}) =>
  planEffects(state(openEntry, before, over), state(openEntry, after, over));

test("LOW merge is ready immediately; missing is empty", () => {
  const s = state(open("LOW"), []);
  assert.equal(s.ready, true); assert.equal(s.display, "applying");
  assert.deepEqual(s.missing, []); assert.equal(s.required, 0);
  assert.equal(s.name, "merge-00000000-0000-4000-8000-000000000000"); assert.equal(s.requester, "alice");
  assert.deepEqual(s.authors, ["alice"]);
});

test("MEDIUM needs one eligible Worker approve; shortfall is reported", () => {
  const s0 = state(open("MEDIUM"), []);
  assert.equal(s0.ready, false); assert.equal(s0.display, "peer-needed");
  assert.deepEqual(s0.missing, ["1 more approving Worker review (have 0 of 1)"]);
  const s1 = state(open("MEDIUM"), [vote(2, "bob", "approve")]);
  assert.equal(s1.ready, true); assert.deepEqual(s1.approvers, ["bob"]);
  assert.deepEqual(s1.bundle, [OP(2)]);
});

test("an author's approve is tracked but never counted", () => {
  const s = state(open("MEDIUM"), [vote(2, "alice", "approve")]);
  assert.equal(s.ready, false); assert.deepEqual(s.approvers, []);
  assert.equal(s.latestVotes.get("alice")?.operation, OP(2));
  const s2 = state(open("MEDIUM"), [vote(2, "alice", "approve"), vote(3, "bob", "approve")]);
  assert.equal(s2.ready, true);
});

test("an ineligible approver does not count, but an ineligible rejector still blocks", () => {
  const eligible = new Set(["alice", "bob"]);
  const s = state(open("MEDIUM"), [vote(2, "carol", "approve")], { eligible });
  assert.equal(s.ready, false);
  const ready = state(open("MEDIUM"), [vote(2, "bob", "approve")], { eligible });
  assert.equal(ready.ready, true);
  const blocked = state(open("MEDIUM"), [vote(2, "bob", "approve"), vote(3, "carol", "reject")], { eligible });
  assert.equal(blocked.ready, false); assert.equal(blocked.display, "blocked");
  assert.deepEqual(blocked.rejectors, ["carol"]);
  assert.deepEqual(blocked.missing, ["rejected by carol"]);
});

test("a reject blocks until the same actor's later approve clears it", () => {
  const entries = [vote(2, "bob", "reject"), vote(3, "bob", "approve")];
  const s = state(open("MEDIUM"), entries);
  assert.equal(s.ready, true); assert.deepEqual(s.rejectors, []);
  assert.deepEqual(s.latestVotes.get("bob")?.fact, entries[1]!.fact);
});

test("HIGH: one approve emits nothing; the second approves with the bundle in vote order", () => {
  const o = open("HIGH");
  const fx1 = effects(o, [], [vote(2, "bob", "approve")]);
  assert.equal(fx1.withdraw, null); assert.equal(fx1.approve, null);
  const fx2 = effects(o, [vote(2, "bob", "approve")],
    [vote(2, "bob", "approve"), vote(3, "carol", "approve")]);
  assert.equal(fx2.withdraw, null); assert.deepEqual(fx2.approve, [OP(2), OP(3)]);
  const s = state(o, [vote(2, "bob", "approve"), vote(3, "carol", "approve")]);
  assert.equal(s.ready, false); assert.equal(s.display, "peer-needed");
});

test("a third approve leaves the bundle valid and emits no Principal mail", () => {
  const o = open("HIGH");
  const entries = [
    vote(2, "bob", "approve"),
    withMessages(vote(3, "carol", "approve"), [approvalMessage(MID(1), [OP(2), OP(3)])]),
    vote(4, "dave", "approve"),
  ];
  const before = state(o, entries.slice(0, 2));
  const after = state(o, entries);
  assert.equal(after.approvalValid, true);
  const fx = planEffects(before, after);
  assert.equal(fx.withdraw, null); assert.equal(fx.approve, null);
});

test("superseding a bundled vote withdraws the old approval and sends a new one", () => {
  const o = open("HIGH");
  const entries = [
    vote(2, "bob", "approve"),
    withMessages(vote(3, "carol", "approve"), [approvalMessage(MID(1), [OP(2), OP(3)])]),
    vote(4, "bob", "approve"),
  ];
  const before = state(o, entries.slice(0, 2));
  const after = state(o, entries);
  assert.equal(after.approvalValid, false);
  const fx = planEffects(before, after);
  assert.deepEqual(fx.withdraw, { id: MID(1), reason: "superseded vote by bob" });
  assert.deepEqual(fx.approve, [OP(3), OP(4)]);
});

test("quorum still holds after an approver retires: withdrawn then a new approval", () => {
  const o = open("HIGH");
  const entries = [
    vote(2, "bob", "approve"),
    withMessages(vote(3, "carol", "approve"), [approvalMessage(MID(1), [OP(2), OP(3)])]),
    vote(4, "dave", "approve"),
  ];
  // dave's approve arrives while bob is still eligible; then bob retires — evaluated
  // over the same entries with a narrower eligible set.
  const eligible = new Set(["alice", "carol", "dave"]);
  const before = state(o, entries);
  const after = state(o, entries, { eligible });
  assert.equal(after.approvalValid, false);
  assert.deepEqual(after.bundle, [OP(3), OP(4)]);
  const fx = planEffects(before, after);
  assert.deepEqual(fx.withdraw, { id: MID(1), reason: "reviewer bob no longer eligible" });
  assert.deepEqual(fx.approve, [OP(3), OP(4)]);
});

test("a bundled approver regaining eligibility does not invalidate the sent approval", () => {
  const o = open("HIGH");
  const entries = [
    vote(2, "bob", "approve"),
    vote(3, "carol", "approve"),
    withMessages(vote(4, "dave", "approve"), [approvalMessage(MID(1), [OP(3), OP(4)])]),
  ];
  // bob was ineligible when the approval was sent; its votes are carol and dave.
  const before = state(o, entries, { eligible: new Set(["alice", "carol", "dave"]) });
  assert.equal(before.approvalValid, true);
  // bob is eligible again: the bundle reorders to [bob, carol] but every vote in
  // the sent approval is still its actor's latest approve by an eligible non-author.
  const after = state(o, entries);
  assert.deepEqual(after.bundle, [OP(2), OP(3)]);
  assert.equal(after.approvalValid, true);
  const fx = planEffects(before, after);
  assert.equal(fx.withdraw, null); assert.equal(fx.approve, null);
});

test("a reject after the approval was sent withdraws it and sends none", () => {
  const o = open("HIGH");
  const entries = [
    vote(2, "bob", "approve"),
    withMessages(vote(3, "carol", "approve"), [approvalMessage(MID(1), [OP(2), OP(3)])]),
    vote(4, "dave", "reject"),
  ];
  const before = state(o, entries.slice(0, 2));
  const after = state(o, entries);
  const fx = planEffects(before, after);
  assert.deepEqual(fx.withdraw, { id: MID(1), reason: "rejected by dave" });
  assert.equal(fx.approve, null);
  assert.equal(after.display, "blocked");
});

test("Principal approve on the current approval makes a HIGH request ready", () => {
  const o = open("HIGH");
  const entries = [
    vote(2, "bob", "approve"),
    withMessages(vote(3, "carol", "approve"), [approvalMessage(MID(1), [OP(2), OP(3)])]),
    vote(4, "principal", "approve", OP(1), MID(1)),
  ];
  const s = state(o, entries);
  assert.equal(s.approvalValid, true);
  assert.equal(s.principal?.operation, OP(4));
  assert.equal(s.ready, true); assert.equal(s.display, "applying"); assert.deepEqual(s.missing, []);
  const waiting = state(o, entries.slice(0, 2));
  assert.equal(waiting.display, "principal-pending");
  assert.deepEqual(waiting.missing, [`Principal decision on approval ${MID(1)}`]);
});

test("a Principal vote naming a withdrawn approval is not counted", () => {
  const o = open("HIGH");
  const entries = [
    vote(2, "bob", "approve"),
    withMessages(vote(3, "carol", "approve"), [approvalMessage(MID(1), [OP(2), OP(3)])]),
    withMessages(vote(4, "bob", "approve"), [withdrawnMessage(MID(2), MID(1)), approvalMessage(MID(3), [OP(3), OP(4)])]),
    vote(5, "principal", "approve", OP(1), MID(1)),
  ];
  const s = state(o, entries);
  assert.equal(s.approval?.id, MID(3));
  assert.equal(s.principal, null);
  assert.equal(s.ready, false); assert.equal(s.display, "principal-pending");
});

test("a Principal reject closes the request", () => {
  const o = open("HIGH");
  const entries = [
    vote(2, "bob", "approve"),
    withMessages(vote(3, "carol", "approve"), [approvalMessage(MID(1), [OP(2), OP(3)])]),
    vote(4, "principal", "reject", OP(1), MID(1)),
  ];
  const s = state(o, entries);
  assert.equal(s.terminal, "rejected"); assert.equal(s.display, "rejected");
  assert.deepEqual(s.missing, ["rejected by the Principal"]);
  const fx = planEffects(state(o, entries.slice(0, 2)), s);
  assert.deepEqual(fx.withdraw, { id: MID(1), reason: "rejected by the Principal" });
  assert.equal(fx.approve, null);
});

test("cancel by the requester cancels and withdraws a current approval", () => {
  const o = open("HIGH");
  const entries = [
    vote(2, "bob", "approve"),
    withMessages(vote(3, "carol", "approve"), [approvalMessage(MID(1), [OP(2), OP(3)])]),
    cancel(4),
  ];
  const s = state(o, entries);
  assert.equal(s.terminal, "cancelled"); assert.equal(s.display, "cancelled");
  assert.deepEqual(s.missing, ["cancelled"]);
  const fx = planEffects(state(o, entries.slice(0, 2)), s);
  assert.deepEqual(fx.withdraw, { id: MID(1), reason: "cancelled" });
  assert.equal(fx.approve, null);
});

test("a refresh with a moved main marks the request stale; a null main does not", () => {
  const o = open("LOW");
  assert.equal(state(o, [refresh(2, "3".repeat(40))]).terminal, "stale");
  assert.equal(state(o, [refresh(2, "3".repeat(40))]).display, "stale");
  assert.deepEqual(state(o, [refresh(2, "3".repeat(40))]).missing, ["main moved"]);
  assert.equal(state(o, [refresh(2, null)]).ready, true);
});

test("an ordinary review entry does not change readiness", () => {
  const s = state(open("MEDIUM"), [review(2, "bob"), vote(3, "carol", "approve")]);
  assert.equal(s.ready, true);
});

test("integration state drives the display", () => {
  const ready = state(open("LOW"), []);
  const integration = (s: "pending" | "unknown" | "succeeded" | "failed") =>
    ({ operation: OP(50), state: s, errorCode: null }) as const;
  assert.equal(state(open("LOW"), [], { integration: integration("pending") }).display, "applying");
  assert.equal(state(open("LOW"), [], { integration: integration("succeeded") }).display, "applied");
  assert.equal(state(open("LOW"), [], { integration: integration("failed") }).display, "blocked");
  assert.equal(state(open("LOW"), [], { integration: integration("unknown") }).display, "unknown");
  const failed = state(open("LOW"), [], { integration: { operation: OP(50), state: "failed", errorCode: "CHECK_FAILED" } });
  assert.deepEqual(failed.missing, ["integration failed (CHECK_FAILED)"]);
  assert.equal(ready.ready, true);
});

test("a LOW challenge requires highPeerFloor approves", () => {
  const o = open("LOW", "challenge.open", OP(9), 5);
  const at = (seq: number, actor: string, verdict: "approve" | "reject") => vote(seq, actor, verdict, OP(9));
  const s0 = state(o, [at(6, "bob", "approve")], { highPeerFloor: 2 });
  assert.equal(s0.required, 2); assert.equal(s0.ready, false);
  const s1 = state(o, [at(6, "bob", "approve"), at(7, "carol", "approve")], { highPeerFloor: 2 });
  assert.equal(s1.ready, true);
});

test("the earliest terminal event wins", () => {
  const o = open("LOW");
  const s = state(o, [refresh(2, "3".repeat(40)), cancel(3)]);
  assert.equal(s.terminal, "stale");
  const s2 = state(o, [cancel(2), refresh(3, "3".repeat(40))]);
  assert.equal(s2.terminal, "cancelled");
});

test("inconsistent inputs are corrupt", () => {
  const o = open("LOW");
  const corrupt = (fn: () => unknown) => assert.throws(fn,
    (e: unknown) => e instanceof StoreError && e.code === "STORE_CORRUPT");
  corrupt(() => reviewState({ open: o, entries: [vote(3, "bob", "approve"), vote(2, "carol", "approve")],
    eligible: ELIGIBLE, highPeerFloor: 2, integration: null }));
  corrupt(() => reviewState({ open: o, entries: [vote(1, "bob", "approve")],
    eligible: ELIGIBLE, highPeerFloor: 2, integration: null }));
  corrupt(() => reviewState({ open: o, entries: [vote(2, "bob", "approve", OP(7))],
    eligible: ELIGIBLE, highPeerFloor: 2, integration: null }));
  corrupt(() => reviewState({ open: { ...o, fact: { kind: "review", version: 1, request: OP(1), body: "b" } },
    entries: [], eligible: ELIGIBLE, highPeerFloor: 2, integration: null }));
  corrupt(() => reviewState({ open: o, entries: [], eligible: ELIGIBLE, highPeerFloor: 0, integration: null }));
});
