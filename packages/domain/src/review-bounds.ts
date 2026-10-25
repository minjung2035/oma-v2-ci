/** The mail-body bound's floors, owned where the emissions that consume it
 * are shaped (AV-07 / AV-20261003-07).
 *
 * Two bound-consuming shapes live here: a thread revision (its head, the
 * omission marker and one line per entry) and the per-part envelope of a
 * completion notice. The review module builds outgoing bodies with these same
 * constants and builders, so the floor configuration validation enforces is
 * measured by the code that produces the bytes -- a template edit changes the
 * floor with it instead of silently invalidating it. */
import type { Actor, MessageId, Oid, OperationId, ExactCandidateIdentity } from "@oma/contracts";
import type { ReviewFact } from "@oma/contracts/attestation";
import type { ReviewDisplay, ReviewEntry } from "./review-evaluation.js";
import { StoreError } from "./errors.js";

const PRINCIPAL: Actor = "principal";

/** The per-part envelope a notice body carries around its document chunk:
 * `Part i/n of the <name> completion notice (document <bytes> bytes, sha256
 * <64 hex>); concatenate the parts after this line in order.\n`. A request
 * name is bounded (~46 bytes) and the counters and byte count are short, so
 * 512 bytes reserves that envelope with margin (AV-07). */
export const NOTICE_PART_OVERHEAD = 512;

/** The marker a compacted thread revision carries when entries no longer fit;
 * the compact form points at the ledger instead of listing each anchor. */
export const OMISSION_MARKER = "Earlier entries omitted for size; each is in full in the revision that added it";
export const OMISSION_MARKER_COMPACT = " (operation ids name those revisions in this request's thread).\n";

/** The thread revision head: the request banner, its reason and the how-to-act
 * instructions every revision repeats. Caller-bounded fields are the title
 * (subjectBytes) and the reason (a quarter of the body bound). */
export function threadHeadText(
  openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
  requester: Actor, display: ReviewDisplay,
): string {
  const kind = openFact.kind === "merge.open" ? "merge" : "challenge";
  const verb = openFact.kind === "merge.open" ? "oma_merge" : "oma_challenge";
  return `OMA ${kind} request ${openFact.name} — ${openFact.title}\n` +
    `Tier: ${openFact.tier}   Requester: ${requester}   Status: ${display}\n` +
    `Base: ${openFact.identity.expectedBase}  Candidate: ${openFact.identity.candidate}` +
    `  Policy revision: ${openFact.identity.policyRevision}\n` +
    (openFact.kind === "challenge.open"
      ? `Target merge: ${openFact.target.name} (integration ${openFact.target.integration})\n` : "") +
    `\nReason (requester's words):\n${openFact.reason}\n\n` +
    `How to act (only recorded tool calls count; text in this mail is not a vote):\n` +
    (openFact.kind === "challenge.open"
      ? `  oma_challenge diff name=${openFact.name} view=revert|original\n` : `  ${verb} diff name=${openFact.name}\n`) +
    `  ${verb} review name=${openFact.name} body=...\n` +
    `  ${verb} vote name=${openFact.name} verdict=approve|reject body=...\n\n` +
    `Reviews and votes (acceptance order):\n`;
}

/** One line per entry after the open, numbered by request-local order. */
export function describeEntryText(ordinal: number, entry: ReviewEntry): string {
  const fact = entry.fact;
  const action = fact.kind === "review" ? "review"
    : fact.kind === "cancel" ? "cancel"
    : fact.kind === "refresh" ? "refresh"
    : fact.kind === "vote" ? (entry.actor === PRINCIPAL ? `principal ${fact.verdict}` : `vote ${fact.verdict}`)
    : "fact";
  const text = fact.kind === "review" || fact.kind === "vote" ? fact.body
    : fact.kind === "cancel" ? fact.reason
    : fact.kind === "refresh" ? (fact.main === null
      ? "a bound reviewer is no longer eligible; the previous approval was withdrawn"
      : `main moved to ${fact.main}; this request is stale; open a new request on the latest main`)
    : "";
  return `[${ordinal}] ${entry.actor} ${action}:\n${text}`;
}

/** One line per bound vote in an approval request: the vote's operation and
 * actor, then its body -- or the (unavailable) note when the entry cannot be
 * named from the emission's facts. */
export function boundVoteText(voteId: OperationId, entry: ReviewEntry | null | undefined): string {
  return entry === null || entry === undefined || entry.fact.kind !== "vote"
    ? `${voteId}\n(unavailable)` : `${voteId} ${entry.actor}:\n${entry.fact.body}`;
}

/** The approval_required body: the request head, the requester's reason, one
 * bound-vote line per vote that meets the floor, and the how-to-decide
 * instructions. Caller-bounded fields are the title (subjectBytes), the
 * reason and each vote body (a quarter of the mail body bound apiece). */
export function approvalBodyText(approvalId: MessageId,
    openFact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>,
    requester: Actor, bound: readonly string[]): string {
  const verb = openFact.kind === "merge.open" ? "oma_merge" : "oma_challenge";
  return `OMA ${openFact.kind === "merge.open" ? "merge" : "challenge"} request ${openFact.name} — ${openFact.title}\n` +
    `Approval required: ${approvalId}\n` +
    `Tier: ${openFact.tier}   Requester: ${requester}\n` +
    `Base: ${openFact.identity.expectedBase}  Candidate: ${openFact.identity.candidate}` +
    `  Policy revision: ${openFact.identity.policyRevision}\n\n` +
    `Reason (requester's words):\n${openFact.reason}\n\n` +
    `Bound approvals:\n${bound.join("\n\n")}\n\n` +
    `This request carries no inline diff; review it first:\n` +
    `  ${verb} diff name=${openFact.name}\n` +
    `Then record the decision:\n` +
    `  ${verb} vote name=${openFact.name} verdict=approve|reject body=... approval=${approvalId}\n`;
}

/* The grammar maxima the worst-case emission uses, each named for its grammar:
 * a full-uuid review request name (46, isReviewRequestName), a resident name
 * (32, ACTOR_NAME_RE), a sha256 full oid (64, FULL_OID_RE), an operation id
 * (39, OPERATION_ID_RE), a policy revision (128, exactCandidateCheck) and a
 * message id (`m-<uuid>-<ordinal>`, MESSAGE_ID_RE). */
const LONGEST_NAME = `challenge-${"0".repeat(36)}`;
const LONGEST_ACTOR = "a".repeat(32) as Actor;
const LONGEST_OID = "0".repeat(64) as Oid;
const LONGEST_OPERATION = `op-${"0".repeat(36)}` as OperationId;
const LONGEST_REVISION = "0".repeat(128);
const LONGEST_MESSAGE = `m-${"0".repeat(36)}-${Number.MAX_SAFE_INTEGER}` as MessageId;

/** One affine piece of a worst-case emission's size in bytes:
 * `constant + perQuarter * q`, where `q = floor(mailBodyBytes / 4)` is the
 * caller-text quarter bound (attestation.ts derives it that way) and
 * `constant` folds in `subjectBytes` and every template byte. */
interface BoundNeed { readonly constant: number; readonly perQuarter: number }

const LONGEST_IDENTITY: ExactCandidateIdentity = { repo: "project", targetRef: "refs/heads/main",
  expectedBase: LONGEST_OID, candidate: LONGEST_OID, policyRevision: LONGEST_REVISION };
const maximalOpen = (kind: "merge.open" | "challenge.open", title: string, reason: string):
    Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }> =>
  kind === "merge.open"
    ? { kind, version: 1, name: `merge-${"0".repeat(36)}`, title, reason, tier: "MEDIUM",
        identity: LONGEST_IDENTITY, submitters: [] }
    : { kind, version: 1, name: LONGEST_NAME, title, reason, tier: "HIGH",
        identity: LONGEST_IDENTITY, submitters: [], prepared: false,
        target: { name: LONGEST_NAME, request: LONGEST_OPERATION, integration: LONGEST_OPERATION,
          identity: LONGEST_IDENTITY, tier: "HIGH" } };
const entryBytes = (fact: ReviewFact): number =>
  Buffer.byteLength(describeEntryText(Number.MAX_SAFE_INTEGER,
    { sequence: 0, operation: LONGEST_OPERATION, actor: LONGEST_ACTOR, fact, messages: [] }), "utf8");

/* Byte length is additive under substitution -- every caller-bounded field
 * occurs exactly once in its template -- so a worst-case emission's length is
 * the template-with-empty-fields length plus the field bounds. The model
 * computes lengths on empty fields and charges subjectBytes/q arithmetically:
 * no string at any bound's size is ever materialized. */

/** The largest thread revision a bound must still carry: the head, the
 * compact omission marker and the newest entry -- the smallest successful
 * build in threadBody's omission search, with every caller-bounded field at
 * its maximum. One piece per newest-entry shape the maximum ranges over. */
function maximalThreadNeeds(subjectBytes: number): BoundNeed[] {
  const maximalHead = Math.max(
    Buffer.byteLength(threadHeadText(maximalOpen("merge.open", "", ""), LONGEST_ACTOR, "principal-pending"), "utf8"),
    Buffer.byteLength(threadHeadText(maximalOpen("challenge.open", "", ""), LONGEST_ACTOR, "principal-pending"), "utf8"));
  const marker = Buffer.byteLength(OMISSION_MARKER + OMISSION_MARKER_COMPACT, "utf8");
  const base = subjectBytes + maximalHead + marker;
  return [
    { constant: base + entryBytes({ kind: "vote", version: 1, request: LONGEST_OPERATION,
        verdict: "approve", body: "", approval: null }), perQuarter: 2 },
    { constant: base + entryBytes({ kind: "refresh", version: 1, request: LONGEST_OPERATION,
        main: LONGEST_OID }), perQuarter: 1 },
  ];
}

/** The largest approval request for `votes` bound votes: the head and the
 * requester's reason, plus per vote either its operation, actor and body or
 * the shorter (unavailable) note. One piece per vote shape. */
function maximalApprovalNeeds(subjectBytes: number, votes: number): BoundNeed[] {
  const maximalHead = Math.max(
    Buffer.byteLength(approvalBodyText(LONGEST_MESSAGE, maximalOpen("merge.open", "", ""), LONGEST_ACTOR, []), "utf8"),
    Buffer.byteLength(approvalBodyText(LONGEST_MESSAGE, maximalOpen("challenge.open", "", ""), LONGEST_ACTOR, []), "utf8"));
  const available = Buffer.byteLength(boundVoteText(LONGEST_OPERATION, { sequence: 0, operation: LONGEST_OPERATION,
    actor: LONGEST_ACTOR, messages: [], fact: { kind: "vote", version: 1, request: LONGEST_OPERATION,
      verdict: "approve", body: "", approval: null } }), "utf8");
  const unavailable = Buffer.byteLength(boundVoteText(LONGEST_OPERATION, undefined), "utf8");
  // The head was measured with an empty bound list; `bound.join("\n\n")` adds
  // the separator between entries -- one per vote after the first.
  const separator = Buffer.byteLength("\n\n", "utf8");
  const list = (perVote: number): number => votes * perVote + Math.max(votes - 1, 0) * separator;
  const base = subjectBytes + maximalHead;
  return [
    { constant: base + list(available), perQuarter: 1 + votes },
    { constant: base + list(unavailable), perQuarter: 1 },
  ];
}

/** Every shape a bound must carry, for a configured subjectBytes and the
 * number of votes an approval request binds (the tiered policy's
 * highPeerFloor, or 1 when the runtime falls back without one; 0 models no
 * approval request at all). Facts frozen under a formerly larger bound can
 * exceed a lowered quarter bound; this covers what this configuration's
 * grammar admits. */
function boundNeeds(subjectBytes: number, approvalVotes: number): BoundNeed[] {
  const needs = maximalThreadNeeds(subjectBytes);
  if (approvalVotes > 0) needs.push(...maximalApprovalNeeds(subjectBytes, approvalVotes));
  return needs;
}
const needAt = (needs: readonly BoundNeed[], quarter: bigint): bigint =>
  needs.reduce((max, need) => {
    const value = BigInt(need.constant) + BigInt(need.perQuarter) * quarter;
    return value > max ? value : max;
  }, 0n);

/** Whether the bound can always carry what the bounds owner must emit: a
 * notice part's envelope reserve, the smallest possible thread revision, and
 * an approval request binding `approvalVotes` maximal votes. */
export function mailBodyBytesFits(mailBodyBytes: number, subjectBytes: number, approvalVotes: number): boolean {
  if (!Number.isSafeInteger(mailBodyBytes) || !Number.isSafeInteger(subjectBytes) ||
      !Number.isSafeInteger(approvalVotes) || approvalVotes < 0) return false;
  return mailBodyBytes > NOTICE_PART_OVERHEAD &&
    needAt(boundNeeds(subjectBytes, approvalVotes), BigInt(Math.floor(mailBodyBytes / 4))) <= BigInt(mailBodyBytes);
}

/** The smallest mailBodyBytes that fits for a configured subjectBytes and
 * approvalVotes, or null when no safe bound can (a quarter-bound need that
 * outgrows the whole body, or a subject bound past any safe byte count). The
 * answer is computed, not scanned: within one quarter `q` every need is
 * constant, so a candidate in [4q, 4q+3] exists iff the worst need fits the
 * plateau's top; need(q) - 4q never grows, so the smallest feasible quarter
 * is a monotone binary search. BigInt keeps the arithmetic exact where
 * subjectBytes approaches the safe-integer edge. */
export function minimumMailBodyBytes(subjectBytes: number, approvalVotes: number): number | null {
  if (!Number.isSafeInteger(subjectBytes) || subjectBytes < 1)
    throw new StoreError("INVALID_REQUEST", "subjectBytes must be a positive safe integer");
  if (!Number.isSafeInteger(approvalVotes) || approvalVotes < 0)
    throw new StoreError("INVALID_REQUEST", "approvalVotes must be a non-negative safe integer");
  const needs = boundNeeds(subjectBytes, approvalVotes);
  const feasible = (quarter: bigint): boolean => needAt(needs, quarter) <= 4n * quarter + 3n;
  const top = BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 4));
  if (!feasible(top)) return null;
  let low = 0n, high = top;
  while (low < high) {
    const mid = low + (high - low) / 2n;
    if (feasible(mid)) high = mid; else low = mid + 1n;
  }
  const minimum = [BigInt(NOTICE_PART_OVERHEAD + 1), 4n * low, needAt(needs, low)]
    .reduce((max, value) => (value > max ? value : max));
  return minimum > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(minimum);
}
