/** AV-20261003-07: bounds the grammar accepts but the runtime cannot serve
 * must be refused by configuration validation, not discovered later as
 * INTERNAL_ERROR on accepted work.
 *
 * The audited code checked only "positive safe integer" for mailBodyBytes and
 * batchMaxMessages, so it accepted:
 *   - mailBodyBytes <= NOTICE_PART_OVERHEAD: every completion notice part
 *     computes a non-positive chunk budget and splitNotice throws on the
 *     accepted notice (AV-07).
 *   - mailBodyBytes below the smallest thread revision: threadBody's
 *     omission fallback throws INTERNAL_ERROR with accepted thread entries
 *     outstanding.
 *   - batchMaxMessages = 1: an actor whose direct and public mail are both
 *     pending can never drain either class -- selectBatch throws
 *     UNSUPPORTED_PROFILE on work the store already accepted.
 *
 * The floor is measured by the same constants and builders the emission
 * paths use (mail/review-bounds.ts), so these tests pin the boundary, not a
 * duplicated number. */
import test from "node:test";
import assert from "node:assert/strict";
import type { Actor, ExactCandidateIdentity, HostConfig, MessageId, Oid, OperationId } from "@oma/contracts";
import type { ReviewFact } from "@oma/contracts/attestation";
import { validateConfig } from "@oma/config";
import { defaultHostConfig } from "@oma/config/defaults";
import { StoreError } from "@oma/domain/errors";
import {
  NOTICE_PART_OVERHEAD, OMISSION_MARKER, OMISSION_MARKER_COMPACT, approvalBodyText, boundVoteText,
  describeEntryText, mailBodyBytesFits, minimumMailBodyBytes, threadHeadText,
} from "@oma/domain/review-bounds";
import { MIN_MIXED_BATCH_MESSAGES } from "@oma/domain/limits";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";

function withLimits(config: HostConfig, limits: Partial<HostConfig["limits"]>): HostConfig {
  const copy = structuredClone(config);
  copy.limits = { ...copy.limits, ...limits };
  return copy;
}

test("AV-20261003-07: the shipped limits stay valid above the floor", () => {
  const fixture = createCompleteConfigurationFixture();
  try { assert.doesNotThrow(() => validateConfig(fixture.config)); }
  finally { fixture.close(); }
});

test("AV-20261003-07: mailBodyBytes at or under the notice-part overhead is refused", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    for (const mailBodyBytes of [1, NOTICE_PART_OVERHEAD - 1, NOTICE_PART_OVERHEAD])
      assert.throws(() => validateConfig(withLimits(fixture.config, { mailBodyBytes })),
        (error: unknown) => error instanceof Error && error.message.includes("limits.mailBodyBytes"),
        `mailBodyBytes=${mailBodyBytes} cannot carry a notice part`);
  } finally { fixture.close(); }
});

test("AV-20261003-07: mailBodyBytes under the smallest thread revision is refused, the floor itself is not", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const subjectBytes = fixture.config.limits.subjectBytes;
    // The fixture has no tiered policy: an approval request (if one is ever
    // emitted for a request opened under an earlier policy) binds one vote.
    assert.equal(fixture.config.integration.tiered, undefined);
    const floor = minimumMailBodyBytes(subjectBytes, 1)!;
    assert.ok(floor > NOTICE_PART_OVERHEAD, "the thread floor is above the notice envelope");
    assert.throws(() => validateConfig(withLimits(fixture.config, { mailBodyBytes: floor - 1 })),
      (error: unknown) => error instanceof Error && error.message.includes("limits.mailBodyBytes"),
      `mailBodyBytes=${floor - 1} cannot always hold a thread revision`);
    assert.doesNotThrow(() => validateConfig(withLimits(fixture.config, { mailBodyBytes: floor })),
      "a bound exactly at the measured floor is still valid");
    // A larger configured subject bound moves the floor with it.
    const taller = withLimits(fixture.config, { subjectBytes: subjectBytes * 2 });
    const tallerFloor = minimumMailBodyBytes(subjectBytes * 2, 1)!;
    assert.throws(() => validateConfig(withLimits(taller, { mailBodyBytes: tallerFloor - 1 })),
      /limits\.mailBodyBytes/, "the floor follows the configured subjectBytes");
    assert.doesNotThrow(() => validateConfig(withLimits(taller, { mailBodyBytes: tallerFloor })));
  } finally { fixture.close(); }
});

test("AV-20261003-07: a batch that cannot carry both mail classes is refused", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    assert.throws(() => validateConfig(withLimits(fixture.config, { batchMaxMessages: MIN_MIXED_BATCH_MESSAGES - 1 })),
      (error: unknown) => error instanceof Error && error.message.includes("limits.batchMaxMessages"),
      "batchMaxMessages=1 starves mixed direct/public pending mail");
    assert.doesNotThrow(() => validateConfig(withLimits(fixture.config, { batchMaxMessages: MIN_MIXED_BATCH_MESSAGES })),
      "the smallest mixed-capable batch is still valid");
  } finally { fixture.close(); }
});

/* ------------------------------------------------------------------------ *
 * FJ-4: the floor is computed, not scanned.
 *
 * The audited minimumMailBodyBytes walked every candidate from the notice
 * envelope upward, and each candidate materialized "x".repeat(subjectBytes)
 * and "x".repeat(mailBodyBytes / 4). subjectBytes has no grammar maximum, so a
 * large one either threw a raw RangeError out of validateConfig (~5e8: the
 * string cannot exist) or iterated ~4/3 * subjectBytes candidates (an
 * effective hang from ~1e6). The oracle below is that implementation, copied
 * verbatim, so the arithmetic replacement is pinned to it.
 * ------------------------------------------------------------------------ */
const ORACLE_LONGEST_NAME = `challenge-${"0".repeat(36)}`;
const ORACLE_LONGEST_ACTOR = "a".repeat(32) as Actor;
const ORACLE_LONGEST_OID = "0".repeat(64) as Oid;
const ORACLE_LONGEST_OPERATION = `op-${"0".repeat(36)}` as OperationId;
const ORACLE_LONGEST_REVISION = "0".repeat(128);
function oracleMaximalThreadBytes(subjectBytes: number, textBound: number): number {
  const callerText = "x".repeat(textBound);
  const title = "x".repeat(subjectBytes);
  const identity: ExactCandidateIdentity = { repo: "project", targetRef: "refs/heads/main",
    expectedBase: ORACLE_LONGEST_OID, candidate: ORACLE_LONGEST_OID, policyRevision: ORACLE_LONGEST_REVISION };
  const head = (fact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>): number =>
    Buffer.byteLength(threadHeadText(fact, ORACLE_LONGEST_ACTOR, "principal-pending"), "utf8");
  const maximalHead = Math.max(
    head({ kind: "merge.open", version: 1, name: `merge-${"0".repeat(36)}`, title,
      reason: callerText, tier: "MEDIUM", identity, submitters: [] }),
    head({ kind: "challenge.open", version: 1, name: ORACLE_LONGEST_NAME, title,
      reason: callerText, tier: "HIGH", identity, submitters: [], prepared: false,
      target: { name: ORACLE_LONGEST_NAME, request: ORACLE_LONGEST_OPERATION, integration: ORACLE_LONGEST_OPERATION,
        identity, tier: "HIGH" } }));
  const entry = (fact: ReviewFact): number =>
    Buffer.byteLength(describeEntryText(Number.MAX_SAFE_INTEGER,
      { sequence: 0, operation: ORACLE_LONGEST_OPERATION, actor: ORACLE_LONGEST_ACTOR, fact, messages: [] }), "utf8");
  const maximalEntry = Math.max(
    entry({ kind: "vote", version: 1, request: ORACLE_LONGEST_OPERATION, verdict: "approve",
      body: callerText, approval: null }),
    entry({ kind: "refresh", version: 1, request: ORACLE_LONGEST_OPERATION, main: ORACLE_LONGEST_OID }));
  return maximalHead + Buffer.byteLength(OMISSION_MARKER + OMISSION_MARKER_COMPACT, "utf8") + maximalEntry;
}
function oracleFits(mailBodyBytes: number, subjectBytes: number): boolean {
  if (!Number.isSafeInteger(mailBodyBytes) || !Number.isSafeInteger(subjectBytes)) return false;
  return mailBodyBytes > NOTICE_PART_OVERHEAD &&
    oracleMaximalThreadBytes(subjectBytes, Math.floor(mailBodyBytes / 4)) <= mailBodyBytes;
}
function oracleMinimum(subjectBytes: number): number {
  let candidate = NOTICE_PART_OVERHEAD + 1;
  while (!oracleFits(candidate, subjectBytes)) candidate++;
  return candidate;
}

test("FJ-4: the computed thread floor equals the audited linear scan, value for value", () => {
  // Every subject bound up to 48, then a stride across several kilobytes.
  const sweep = [...Array.from({ length: 48 }, (_, index) => index + 1)];
  for (let subjectBytes = 49; subjectBytes <= 6000; subjectBytes += 173) sweep.push(subjectBytes);
  for (const subjectBytes of sweep) {
    const expected = oracleMinimum(subjectBytes);
    // approvalVotes 0: the thread and the notice part alone, which is what
    // the audited floor measured.
    assert.equal(minimumMailBodyBytes(subjectBytes, 0), expected, `subjectBytes=${subjectBytes}`);
    // The predicate itself agrees on both sides of the floor, including the
    // odd values above it that the quarter's rounding can refuse.
    for (let mailBodyBytes = expected - 8; mailBodyBytes <= expected + 8; mailBodyBytes++)
      assert.equal(mailBodyBytesFits(mailBodyBytes, subjectBytes, 0), oracleFits(mailBodyBytes, subjectBytes),
        `subjectBytes=${subjectBytes} mailBodyBytes=${mailBodyBytes}`);
  }
});

test("FJ-4: a very large subjectBytes is decided in bounded time, and a refusal is INVALID_REQUEST naming the bound", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const refusal = (error: unknown): boolean => error instanceof StoreError && error.code === "INVALID_REQUEST" &&
      error.message.includes("limits.mailBodyBytes");
    for (const subjectBytes of [1e6, 1e9]) {
      const started = performance.now();
      assert.throws(() => validateConfig(withLimits(fixture.config, { subjectBytes })), refusal,
        `subjectBytes=${subjectBytes} under the shipped mailBodyBytes is an honest refusal, never a RangeError`);
      assert.ok(performance.now() - started < 200, `subjectBytes=${subjectBytes} refused in < 200 ms`);
    }
    const started = performance.now();
    const floor = minimumMailBodyBytes(1e9, 1);
    assert.ok(floor !== null && Number.isSafeInteger(floor) && floor > 2e9, "a safe floor exists for subjectBytes=1e9");
    assert.doesNotThrow(() => validateConfig(withLimits(fixture.config, { subjectBytes: 1e9, mailBodyBytes: floor })));
    assert.throws(() => validateConfig(withLimits(fixture.config, { subjectBytes: 1e9, mailBodyBytes: floor - 1 })), refusal);
    assert.ok(performance.now() - started < 200, "the floor of subjectBytes=1e9 is computed and checked in < 200 ms");
    // A subject bound no safe mailBodyBytes can follow is refused by name.
    assert.equal(minimumMailBodyBytes(Number.MAX_SAFE_INTEGER, 1), null);
    assert.throws(() => validateConfig(withLimits(fixture.config, { subjectBytes: Number.MAX_SAFE_INTEGER })),
      (error: unknown) => refusal(error) && (error as Error).message.includes("limits.subjectBytes"));
  } finally { fixture.close(); }
});

/* ------------------------------------------------------------------------ *
 * FJ-5: the approval_required body is inside the floor.
 *
 * An approval request carries the request head, the requester's reason and
 * every bound vote's body -- highPeerFloor of them, each up to a quarter of
 * mailBodyBytes. The audited floor measured only the thread revision and the
 * notice part, so a configuration validation accepted could emit an
 * approval_required body over mailBodyBytes (and, with larger floors, over
 * the stored-mail bound oma_mail_read refuses to read).
 * ------------------------------------------------------------------------ */
function withHighPeerFloor(config: HostConfig, highPeerFloor: number): HostConfig {
  const copy = structuredClone(config);
  copy.integration = { ...copy.integration,
    tiered: { repositoryFloor: "LOW", highPeerFloor, principalDelegated: true, rules: [] } };
  return copy;
}
const namesBoth = (error: unknown): boolean => error instanceof StoreError && error.code === "INVALID_REQUEST" &&
  error.message.includes("limits.mailBodyBytes") && error.message.includes("integration.tiered.highPeerFloor");

test("FJ-5: the shipped configuration (highPeerFloor 2) carries a maximal approval request", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const defaults = defaultHostConfig({ society: "demo", node: "/usr/bin/node", libdir: "/opt/oma",
       deploymentDigest: "a".repeat(64) });
    assert.equal(defaults.integration.tiered?.highPeerFloor, 2);
    assert.equal(mailBodyBytesFits(defaults.limits.mailBodyBytes, defaults.limits.subjectBytes, 2), true);
    assert.doesNotThrow(() => validateConfig(withLimits(withHighPeerFloor(fixture.config, 2), {
      mailBodyBytes: defaults.limits.mailBodyBytes, subjectBytes: defaults.limits.subjectBytes })));
  } finally { fixture.close(); }
});

test("FJ-5: a highPeerFloor whose bound votes cannot fit any mailBodyBytes is refused at load, naming both fields", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    // Reason plus three votes is already four quarters of the bound before
    // the head: no mailBodyBytes can carry it.
    for (const highPeerFloor of [3, 8])
      assert.throws(() => validateConfig(withHighPeerFloor(fixture.config, highPeerFloor)), namesBoth,
        `highPeerFloor=${highPeerFloor} cannot be carried by an approval request`);
  } finally { fixture.close(); }
});

test("FJ-5: the approval floor's boundary -- just inside validates, just outside is refused naming both fields", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const subjectBytes = fixture.config.limits.subjectBytes;
    const config = withHighPeerFloor(fixture.config, 2);
    const floor = minimumMailBodyBytes(subjectBytes, 2)!;
    assert.ok(floor > minimumMailBodyBytes(subjectBytes, 0)!, "two bound votes raise the floor above the thread's");
    assert.equal(mailBodyBytesFits(floor - 1, subjectBytes, 0), true,
      "just outside, the thread and notice still fit: the approval request is what is refused");
    assert.doesNotThrow(() => validateConfig(withLimits(config, { mailBodyBytes: floor })), "just inside");
    assert.throws(() => validateConfig(withLimits(config, { mailBodyBytes: floor - 1 })), namesBoth, "just outside");
    // The model is the builder's: a maximal approval body at the floor fits it,
    // and one under the bound just outside does not fit that bound.
    const maximal = (mailBodyBytes: number): number => {
      const quarter = Math.floor(mailBodyBytes / 4);
      const identity: ExactCandidateIdentity = { repo: "project", targetRef: "refs/heads/main",
        expectedBase: ORACLE_LONGEST_OID, candidate: ORACLE_LONGEST_OID, policyRevision: ORACLE_LONGEST_REVISION };
      const fact: Extract<ReviewFact, { kind: "challenge.open" }> = { kind: "challenge.open", version: 1,
        name: ORACLE_LONGEST_NAME, title: "x".repeat(subjectBytes), reason: "x".repeat(quarter), tier: "HIGH", identity,
        submitters: [], prepared: false, target: { name: ORACLE_LONGEST_NAME, request: ORACLE_LONGEST_OPERATION,
          integration: ORACLE_LONGEST_OPERATION, identity, tier: "HIGH" } };
      const vote = boundVoteText(ORACLE_LONGEST_OPERATION, { sequence: 1, operation: ORACLE_LONGEST_OPERATION,
        actor: ORACLE_LONGEST_ACTOR, messages: [], fact: { kind: "vote", version: 1, request: ORACLE_LONGEST_OPERATION,
          verdict: "approve", body: "x".repeat(quarter), approval: null } });
      return Buffer.byteLength(approvalBodyText(`m-${"0".repeat(36)}-${Number.MAX_SAFE_INTEGER}` as MessageId, fact,
        ORACLE_LONGEST_ACTOR, [vote, vote]), "utf8");
    };
    assert.ok(maximal(floor) <= floor, "a maximal approval request fits the floor");
    assert.ok(maximal(floor - 1) > floor - 1, "and exceeds the bound just under it");
  } finally { fixture.close(); }
});
