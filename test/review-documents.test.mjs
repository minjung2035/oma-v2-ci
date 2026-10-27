import test from "node:test";
import assert from "node:assert/strict";
import { reviewState } from "@oma/domain/review-evaluation";
import { reviewSubject, reviewThreadBody, reviewApprovalBody, reviewNoticeDocument, splitReviewNotice } from "@oma/mail/review-documents";
import { OMISSION_MARKER_COMPACT, NOTICE_PART_OVERHEAD } from "@oma/domain/review-bounds";

const request = "op-11111111-1111-4111-8111-111111111111";
const fact = { kind: "merge.open", version: 1, name: "merge-11111111-1111-4111-8111-111111111111",
  title: "검토 🐈", reason: "요청 이유", tier: "HIGH", submitters: [],
  identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: "a".repeat(40),
    candidate: "b".repeat(40), policyRevision: "p1" } };
const open = { sequence: 1, operation: request, actor: "alice", fact, messages: [] };
const operation = index => `op-22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
const entry = index => ({ sequence: index + 1, operation: operation(index), actor: "bob",
  fact: { kind: "review", version: 1, request, body: `의견 🐈 ${index}` }, messages: [] });
const state = entries => reviewState({ open, entries, integration: null, eligible: new Set(["bob"]), highPeerFloor: 1 });

test("DR39 review documents: Unicode subject is cut only between code points", () => {
  assert.equal(reviewSubject("a🐈나끝", 9), "a🐈...");
  assert.equal(reviewSubject("a🐈나끝", 11), "a🐈나끝");
});

test("DR39 review documents: a long thread keeps its newest complete entry and names omitted history", () => {
  const entries = Array.from({ length: 20000 }, (_, index) => entry(index + 1));
  const current = state(entries);
  const body = reviewThreadBody(current, fact, entries, null, 2048);
  assert.ok(Buffer.byteLength(body) <= 2048);
  assert.ok(body.includes(OMISSION_MARKER_COMPACT));
  assert.ok(body.endsWith("[20000] bob review:\n의견 🐈 20000"));
  assert.ok(!body.includes("[1] bob review:"));
  const first = Number(body.match(/\[(\d+)\] bob review:/)[1]);
  // One more entry cannot fit: compaction retains the maximal newest suffix.
  const earlier = `[${first - 1}] bob review:\n의견 🐈 ${first - 1}\n`;
  assert.ok(Buffer.byteLength(body) + Buffer.byteLength(earlier) > 2048);
});

test("DR39 review documents: anchored omission preserves the prior revision and byte boundary", () => {
  const entries = [entry(1), entry(2), entry(3)];
  entries[0].fact.body = "옛 의견".repeat(300);
  const current = state(entries);
  const body = reviewThreadBody(current, fact, entries, "m-11111111-1111-4111-8111-111111111111-0", 2048);
  assert.ok(body.includes("[1] m-11111111-1111-4111-8111-111111111111-0"));
  assert.ok(body.endsWith("[2] bob review:\n의견 🐈 2\n[3] bob review:\n의견 🐈 3"));
  assert.ok(!body.includes(OMISSION_MARKER_COMPACT));
  assert.throws(() => reviewThreadBody(current, fact, entries, null, 1), error => error.code === "INTERNAL_ERROR");
});

test("DR39 review documents: bound vote order and completion evidence follow frozen facts", () => {
  const entries = [entry(1), entry(2)];
  for (const current of entries) current.fact = { kind: "vote", version: 1, request,
    verdict: "approve", body: current.fact.body, approval: null };
  const approval = reviewApprovalBody("m-11111111-1111-4111-8111-111111111111-0", fact, entries, "alice",
    [operation(2), operation(1), operation(3)]);
  assert.ok(approval.indexOf("의견 🐈 2") < approval.indexOf("의견 🐈 1"));
  assert.ok(approval.includes(`${operation(3)}\n(unavailable)`));
  const document = reviewNoticeDocument(operation(4), state(entries), fact, "diff bytes\n");
  assert.ok(document.includes(`Previous main: ${fact.identity.expectedBase}\nNew main: ${fact.identity.candidate}`));
  assert.ok(document.includes("[1] bob vote approve:\n의견 🐈 1\n[2] bob vote approve:\n의견 🐈 2"));
  assert.ok(document.endsWith("diff bytes\n"));
});

test("DR39 review documents: notice parts fit including a newline exactly at the boundary", () => {
  for (const document of ["x".repeat(8) + "\ny", "🐈가나\n🐈끝\n".repeat(20)]) {
    const chunks = splitReviewNotice(document, NOTICE_PART_OVERHEAD + 8);
    assert.equal(chunks.join(""), document);
    assert.ok(chunks.every(chunk => Buffer.byteLength(chunk) <= 8));
    assert.ok(chunks.every(chunk => !chunk.includes("\ufffd")));
  }
});
