/** mail-v1 review quorum/status owner (design §2). Pure: no I/O, no Store, no
 * clock. Acceptance effects, integration admission and status display all read
 * this one evaluation so they cannot diverge.
 *
 * Usage the accepting module follows:
 *   before  = reviewState(input as the ledger stands);
 *   after0  = reviewState(input + the new entry with no messages yet);
 *   effects = planEffects(before, after0);
 *   the entry's messages are then built from effects;
 *   final   = reviewState(input + the entry carrying those messages).
 */
import { canonicalJson } from "./canonical-json.js";
import { StoreError } from "./errors.js";
import type { ErrorCode } from "@oma/contracts/errors";
import type { Actor, MessageId, OperationId } from "@oma/contracts/identity";
import type { ReviewFact } from "@oma/contracts/attestation";
import type { MessagePlan } from "@oma/contracts/durable";
import type { ExactCandidateIdentity, RiskTier } from "@oma/contracts/values";

export interface ReviewEntry {
  readonly sequence: number;
  readonly operation: OperationId;
  readonly actor: Actor;
  readonly fact: ReviewFact;
  readonly messages: readonly MessagePlan[];
}
export interface ReviewStateInput {
  /** fact kind merge.open | challenge.open */
  readonly open: ReviewEntry;
  /** Later facts naming this request, strictly ascending sequence > open.sequence. */
  readonly entries: readonly ReviewEntry[];
  readonly integration: {
    readonly operation: OperationId;
    readonly state: "pending" | "unknown" | "succeeded" | "failed";
    readonly errorCode: ErrorCode | null;
  } | null;
  /** Current reviewers: role resident && desired "enabled". */
  readonly eligible: ReadonlySet<Actor>;
  readonly highPeerFloor: number;
}
export type ReviewDisplay = "peer-needed" | "principal-pending" | "applying" | "blocked" |
  "rejected" | "cancelled" | "stale" | "applied" | "unknown";
export interface ReviewState {
  readonly request: OperationId;
  readonly name: string;
  readonly kind: "merge" | "challenge";
  readonly tier: RiskTier;
  readonly identity: ExactCandidateIdentity;
  readonly requester: Actor;
  /** The requester plus the open fact's submitters, sorted. */
  readonly authors: readonly Actor[];
  readonly entries: readonly ReviewEntry[];
  /** Worker votes only — the Principal is excluded — latest by sequence. */
  readonly latestVotes: ReadonlyMap<Actor, ReviewEntry>;
  readonly required: number;
  readonly approvers: readonly Actor[];
  /** Latest-vote rejects are never erased by eligibility loss. */
  readonly rejectors: readonly Actor[];
  /** The vote operation ids of the first `required` approvers, ordered by the
   * sequence of their latest approve. Empty while approvers < required. */
  readonly bundle: readonly OperationId[];
  readonly approval: { readonly id: MessageId; readonly votes: readonly OperationId[] } | null;
  readonly approvalValid: boolean;
  readonly principal: ReviewEntry | null;
  readonly terminal: "cancelled" | "rejected" | "stale" | null;
  readonly integration: ReviewStateInput["integration"];
  readonly ready: boolean;
  readonly display: ReviewDisplay;
  readonly missing: readonly string[];
}
export interface PrincipalEffects {
  readonly withdraw: { readonly id: MessageId; readonly reason: string } | null;
  readonly approve: readonly OperationId[] | null;
}

const PRINCIPAL: Actor = "principal";

/** The request operation an entry's fact names, or null for a non-request fact. */
function requestOf(fact: ReviewFact): OperationId | null {
  switch (fact.kind) {
    case "review": case "vote": case "cancel": case "refresh": return fact.request;
    case "challenge.open": return fact.target.request;
    default: return null;
  }
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of value instanceof Map ? value.values() : Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const bySequence = (a: ReviewEntry, b: ReviewEntry) => a.sequence - b.sequence;

export function reviewState(input: ReviewStateInput): ReviewState {
  const { open, entries, integration, eligible } = input;
  const fact = open.fact;
  if (fact.kind !== "merge.open" && fact.kind !== "challenge.open")
    throw new StoreError("STORE_CORRUPT", "review open entry is not a merge/challenge open fact");
  if (!Number.isSafeInteger(input.highPeerFloor) || input.highPeerFloor < 1)
    throw new StoreError("STORE_CORRUPT", "invalid high peer floor");
  let previous = open.sequence;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= previous)
      throw new StoreError("STORE_CORRUPT", "review entries are not in strict acceptance order");
    previous = entry.sequence;
    if (requestOf(entry.fact) !== open.operation)
      throw new StoreError("STORE_CORRUPT", "review entry names another request");
  }
  const kind = fact.kind === "merge.open" ? "merge" : "challenge";
  const required = kind === "challenge" ? input.highPeerFloor
    : fact.tier === "HIGH" ? input.highPeerFloor
    : fact.tier === "MEDIUM" ? 1 : 0;
  const authors = [...new Set<Actor>([open.actor, ...fact.submitters])].sort();
  const authorSet = new Set(authors);

  const latestVotes = new Map<Actor, ReviewEntry>();
  let terminal: ReviewState["terminal"] = null;
  for (const entry of entries) {
    if (entry.fact.kind === "vote" && entry.actor !== PRINCIPAL) latestVotes.set(entry.actor, entry);
    if (terminal === null) {
      if (entry.fact.kind === "cancel") terminal = "cancelled";
      else if (entry.fact.kind === "vote" && entry.actor === PRINCIPAL && entry.fact.verdict === "reject")
        terminal = "rejected";
      else if (entry.fact.kind === "refresh" && entry.fact.main !== null) terminal = "stale";
    }
  }
  // Approvers are ordered by the sequence of their latest approve for the
  // bundle, then named sorted for the report.
  const approverEntries = [...latestVotes.values()]
    .filter(entry => entry.fact.kind === "vote" && entry.fact.verdict === "approve" &&
      eligible.has(entry.actor) && !authorSet.has(entry.actor))
    .sort(bySequence);
  const approvers = approverEntries.map(entry => entry.actor).sort();
  const bundle = approverEntries.length >= required
    ? approverEntries.slice(0, required).map(entry => entry.operation) : [];
  const rejectors = [...latestVotes.values()]
    .filter(entry => entry.fact.kind === "vote" && entry.fact.verdict === "reject")
    .map(entry => entry.actor).sort();

  // The current approval is the last approval message no later withdrawn
  // message names. Open facts can only own thread mail; scan them anyway.
  let approval: ReviewState["approval"] = null;
  for (const entry of [open, ...entries]) {
    for (const message of entry.messages) {
      const meta = message.review;
      if (meta === undefined) continue;
      if (meta.role === "approval") approval = { id: message.id, votes: [...meta.votes] };
      else if (meta.role === "withdrawn" && approval !== null && meta.approval === approval.id) approval = null;
    }
  }
  // A sent approval stays valid while every bundled vote still is its actor's
  // latest approve by an eligible non-author. The bundle may reorder (an earlier
  // vote regains eligibility) without invalidating it.
  const byOperation = new Map<OperationId, ReviewEntry>();
  for (const entry of [open, ...entries]) byOperation.set(entry.operation, entry);
  const approvalValid = approval !== null && approval.votes.length === required &&
    approval.votes.every(voteId => {
      const vote = byOperation.get(voteId);
      if (vote === undefined) return false;
      const latest = latestVotes.get(vote.actor);
      return latest !== undefined && latest.operation === voteId &&
        latest.fact.kind === "vote" && latest.fact.verdict === "approve" &&
        eligible.has(vote.actor) && !authorSet.has(vote.actor);
    }) &&
    terminal === null && rejectors.length === 0 &&
    (integration === null || integration.state === "pending");
  let principal: ReviewEntry | null = null;
  if (approval !== null)
    for (const entry of entries)
      if (entry.fact.kind === "vote" && entry.actor === PRINCIPAL && entry.fact.approval === approval.id)
        principal = entry;   // ascending order: the last match is the latest
  const ready = terminal === null && integration === null && rejectors.length === 0 && (
    (kind === "merge" && fact.tier === "LOW") ||
    (fact.tier !== "HIGH" && approvers.length >= required) ||
    (fact.tier === "HIGH" && approvalValid && principal !== null &&
      principal.fact.kind === "vote" && principal.fact.verdict === "approve"));
  const display: ReviewDisplay =
    integration !== null ? (
      integration.state === "succeeded" ? "applied"
      : integration.state === "failed" ? "blocked"
      : integration.state === "pending" ? "applying" : "unknown") :
    terminal !== null ? terminal :
    rejectors.length > 0 ? "blocked" :
    ready ? "applying" :
    fact.tier === "HIGH" && approvalValid ? "principal-pending" : "peer-needed";
  const missing: string[] = [];
  if (terminal === "cancelled") missing.push("cancelled");
  else if (terminal === "rejected") missing.push("rejected by the Principal");
  else if (terminal === "stale") missing.push("main moved");
  for (const rejector of rejectors) missing.push(`rejected by ${rejector}`);
  if (integration !== null) {
    if (integration.state === "pending") missing.push("integration pending");
    else if (integration.state === "unknown") missing.push("integration outcome unknown");
    else if (integration.state === "failed")
      missing.push(integration.errorCode === null ? "integration failed" : `integration failed (${integration.errorCode})`);
  } else if (terminal === null && rejectors.length === 0) {
    const shortfall = required - approvers.length;
    if (shortfall > 0)
      missing.push(`${shortfall} more approving Worker review${shortfall === 1 ? "" : "s"} (have ${approvers.length} of ${required})`);
    else if (fact.tier === "HIGH" && !ready) {
      if (approval === null) missing.push("peer approval not yet sent");
      else if (!approvalValid) missing.push("approval is no longer current");
      else missing.push(`Principal decision on approval ${approval.id}`);
    }
  }
  return freeze({
    request: open.operation, name: fact.name, kind, tier: fact.tier, identity: fact.identity,
    requester: open.actor, authors, entries, latestVotes, required, approvers, rejectors,
    bundle, approval, approvalValid, principal, terminal, integration, ready, display, missing,
  });
}

/** Why the current approval lost validity, for the withdrawn notice body. */
function withdrawReason(before: ReviewState, after: ReviewState): string {
  if (after.terminal === "cancelled") return "cancelled";
  if (after.terminal === "stale") return "main moved";
  if (after.terminal === "rejected") return "rejected by the Principal";
  for (const rejector of after.rejectors)
    if (!before.rejectors.includes(rejector)) return `rejected by ${rejector}`;
  if (after.rejectors.length > 0) return `rejected by ${after.rejectors[0]}`;
  const entries = new Map(after.entries.map(entry => [entry.operation, entry]));
  const approvers = new Set(after.approvers);
  for (const voteId of before.approval?.votes ?? []) {
    const vote = entries.get(voteId);
    if (vote === undefined) return "superseded vote by a reviewer";
    const latest = after.latestVotes.get(vote.actor);
    if (latest === undefined || latest.operation !== voteId) return `superseded vote by ${vote.actor}`;
    if (!approvers.has(vote.actor)) return `reviewer ${vote.actor} no longer eligible`;
  }
  return "approval superseded";
}

/** The Principal mail a newly accepted fact must cause: a withdrawn notice for
 * a current approval that just lost validity, then a new approval when quorum
 * still holds for HIGH. A further approve that leaves the bundle valid causes
 * neither. */
export function planEffects(before: ReviewState, after: ReviewState): PrincipalEffects {
  const withdraw = before.approval !== null && after.approval !== null &&
    after.approval.id === before.approval.id && !after.approvalValid
    ? { id: before.approval.id, reason: withdrawReason(before, after) } : null;
  const approve = after.tier === "HIGH" && after.terminal === null && after.rejectors.length === 0 &&
    after.approvers.length >= after.required && after.integration === null &&
    (after.approval === null || withdraw !== null || !after.approvalValid)
    ? [...after.bundle] : null;
  return freeze({ withdraw, approve });
}

/** The decision-determining projection of a state; `missing` text and the
 * latest-votes map derive from the same fields, so they carry no signal. */
export function sameReviewDecision(left: ReviewState, right: ReviewState): boolean {
  const project = (s: ReviewState) => ({
    name: s.name, kind: s.kind, tier: s.tier, identity: s.identity, requester: s.requester,
    authors: s.authors, required: s.required, approvers: s.approvers, rejectors: s.rejectors,
    bundle: s.bundle, approval: s.approval, approvalValid: s.approvalValid,
    principal: s.principal?.operation ?? null, terminal: s.terminal, integration: s.integration,
    ready: s.ready, display: s.display,
    entries: s.entries.map(entry => ({ sequence: entry.sequence, operation: entry.operation,
      actor: entry.actor, fact: entry.fact,
      messages: entry.messages.map(message => ({ id: message.id, review: message.review })) })) });
  return canonicalJson(project(left)) === canonicalJson(project(right));
}
