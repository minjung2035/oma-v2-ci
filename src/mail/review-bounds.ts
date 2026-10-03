/** The mail-body bound's floors, owned where the emissions that consume it
 * are shaped (AV-07 / AV-20261003-07).
 *
 * Two bound-consuming shapes live here: a thread revision (its head, the
 * omission marker and one line per entry) and the per-part envelope of a
 * completion notice. The review module builds outgoing bodies with these same
 * constants and builders, so the floor configuration validation enforces is
 * measured by the code that produces the bytes -- a template edit changes the
 * floor with it instead of silently invalidating it. */
import type { Actor, Oid, OperationId, ExactCandidateIdentity } from "../../implementation/contracts.js";
import type { ReviewFact } from "../../implementation/contracts/attestation.js";
import type { ReviewDisplay, ReviewEntry } from "../domain/review-evaluation.js";
import { StoreError } from "../domain/errors.js";

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

/* The grammar maxima the worst-case emission uses, each named for its grammar:
 * a full-uuid review request name (46, isReviewRequestName), a resident name
 * (32, ACTOR_NAME_RE), a sha256 full oid (64, FULL_OID_RE), an operation id
 * (39, OPERATION_ID_RE) and a policy revision (128, exactCandidateCheck). */
const LONGEST_NAME = `challenge-${"0".repeat(36)}`;
const LONGEST_ACTOR = "a".repeat(32) as Actor;
const LONGEST_OID = "0".repeat(64) as Oid;
const LONGEST_OPERATION = `op-${"0".repeat(36)}` as OperationId;
const LONGEST_REVISION = "0".repeat(128);

/** The largest thread revision a bound must still carry: the head, the
 * compact omission marker and the newest entry -- the smallest successful
 * build in threadBody's omission search, with every caller-bounded field at
 * its maximum. `textBound` is the caller-text quarter of the candidate bound
 * (attestation.ts derives it as floor(mailBodyBytes / 4)). */
function maximalThreadBytes(subjectBytes: number, textBound: number): number {
  const callerText = "x".repeat(textBound);
  const title = "x".repeat(subjectBytes);
  const identity: ExactCandidateIdentity = { repo: "project", targetRef: "refs/heads/main",
    expectedBase: LONGEST_OID, candidate: LONGEST_OID, policyRevision: LONGEST_REVISION };
  const head = (fact: Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>): number =>
    Buffer.byteLength(threadHeadText(fact, LONGEST_ACTOR, "principal-pending"), "utf8");
  const maximalHead = Math.max(
    head({ kind: "merge.open", version: 1, name: `merge-${"0".repeat(36)}`, title,
      reason: callerText, tier: "MEDIUM", identity, submitters: [] }),
    head({ kind: "challenge.open", version: 1, name: LONGEST_NAME, title,
      reason: callerText, tier: "HIGH", identity, submitters: [], prepared: false,
      target: { name: LONGEST_NAME, request: LONGEST_OPERATION, integration: LONGEST_OPERATION,
        identity, tier: "HIGH" } }));
  const entry = (fact: ReviewFact): number =>
    Buffer.byteLength(describeEntryText(Number.MAX_SAFE_INTEGER,
      { sequence: 0, operation: LONGEST_OPERATION, actor: LONGEST_ACTOR, fact, messages: [] }), "utf8");
  const maximalEntry = Math.max(
    entry({ kind: "vote", version: 1, request: LONGEST_OPERATION, verdict: "approve",
      body: callerText, approval: null }),
    entry({ kind: "refresh", version: 1, request: LONGEST_OPERATION, main: LONGEST_OID }));
  return maximalHead + Buffer.byteLength(OMISSION_MARKER + OMISSION_MARKER_COMPACT, "utf8") + maximalEntry;
}

/** Whether the bound can always carry what the bounds owner must emit: a
 * notice part's envelope reserve and the smallest possible thread revision.
 * Facts frozen under a formerly larger bound can exceed a lowered quarter
 * bound; this covers what this configuration's grammar admits. */
export function mailBodyBytesFits(mailBodyBytes: number, subjectBytes: number): boolean {
  if (!Number.isSafeInteger(mailBodyBytes) || !Number.isSafeInteger(subjectBytes)) return false;
  return mailBodyBytes > NOTICE_PART_OVERHEAD &&
    maximalThreadBytes(subjectBytes, Math.floor(mailBodyBytes / 4)) <= mailBodyBytes;
}

/** The smallest mailBodyBytes that fits for a configured subjectBytes; the
 * check itself is exact -- intermediate values an odd boundary can leave are
 * still accepted when they fit. */
export function minimumMailBodyBytes(subjectBytes: number): number {
  if (!Number.isSafeInteger(subjectBytes) || subjectBytes < 1)
    throw new StoreError("INVALID_REQUEST", "subjectBytes must be a positive safe integer");
  let candidate = NOTICE_PART_OVERHEAD + 1;
  while (!mailBodyBytesFits(candidate, subjectBytes)) candidate++;
  return candidate;
}
