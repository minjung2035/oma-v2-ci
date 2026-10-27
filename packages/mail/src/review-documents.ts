/** Pure review documents. Acceptance, recipients and frozen EML remain owned
 * by ReviewModule; the templates and their size floors share review-bounds. */
import type { Actor, MessageId, OperationId } from "@oma/contracts/identity";
import type { ReviewFact } from "@oma/contracts/attestation";
import type { ReviewEntry, ReviewState } from "@oma/domain/review-evaluation";
import { StoreError } from "@oma/domain/errors";
import { NOTICE_PART_OVERHEAD, OMISSION_MARKER, OMISSION_MARKER_COMPACT, approvalBodyText, boundVoteText,
  describeEntryText, threadHeadText } from "@oma/domain/review-bounds";

type OpenFact = Extract<ReviewFact, { kind: "merge.open" | "challenge.open" }>;

export function reviewSubject(text: string, subjectBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= subjectBytes) return text;
  let out = "";
  let bytes = 0;
  for (const point of text) {
    const size = Buffer.byteLength(point, "utf8");
    if (bytes + size > subjectBytes - 3) break;
    out += point;
    bytes += size;
  }
  return `${out}...`;
}

/** Keep the newest entries, naming the revisions that carried omitted ones.
 * Prefix/suffix byte counts choose the same omission as the original search
 * without rebuilding the whole history once for each omitted entry. */
export function reviewThreadBody(state: ReviewState, openFact: OpenFact,
    entries: readonly ReviewEntry[], previousThreadId: MessageId | null, mailBodyBytes: number): string {
  const head = threadHeadText(openFact, state.requester, state.display);
  const lines = entries.map((entry, index) => describeEntryText(index + 1, entry));
  const full = head + lines.join("\n");
  if (Buffer.byteLength(full, "utf8") <= mailBodyBytes) return full;
  const anchors = entries.map((entry, index) => {
    const message = entry.messages.find(candidate =>
      candidate.review?.role === "thread" && candidate.review.request === state.request);
    return `[${index + 1}] ${message?.id ?? previousThreadId ?? "(unknown)"}`;
  });
  const anchorBytes = [0];
  for (const anchor of anchors) anchorBytes.push(anchorBytes.at(-1)! + Buffer.byteLength(anchor, "utf8"));
  const suffixBytes = Array<number>(lines.length + 1).fill(0);
  for (let index = lines.length - 1; index >= 0; index--)
    suffixBytes[index] = suffixBytes[index + 1]! + Buffer.byteLength(lines[index]!, "utf8");
  const anchoredHead = `${head}${OMISSION_MARKER}:\n`;
  const compactHead = head + OMISSION_MARKER + OMISSION_MARKER_COMPACT;
  for (const anchored of [true, false]) {
    const prefix = anchored ? anchoredHead : compactHead;
    const prefixBytes = Buffer.byteLength(prefix, "utf8");
    for (let omitted = 0; omitted < lines.length; omitted++) {
      const bytes = prefixBytes + suffixBytes[omitted]! + Math.max(lines.length - omitted - 1, 0) +
        (anchored ? anchorBytes[omitted]! + Math.max(omitted - 1, 0) + 1 : 0);
      if (bytes <= mailBodyBytes)
        return prefix + (anchored ? `${anchors.slice(0, omitted).join("\n")}\n` : "") + lines.slice(omitted).join("\n");
    }
  }
  throw new StoreError("INTERNAL_ERROR", "mail bounds cannot hold a thread revision");
}

export function reviewApprovalBody(approvalId: MessageId, openFact: OpenFact,
    entries: readonly ReviewEntry[], requester: Actor, votes: readonly OperationId[]): string {
  const byOperation = new Map(entries.map(entry => [entry.operation, entry]));
  return approvalBodyText(approvalId, openFact, requester,
    votes.map(voteId => boundVoteText(voteId, byOperation.get(voteId))));
}

export function reviewNoticeDocument(integrationId: OperationId, state: ReviewState,
    openFact: OpenFact, diff: string): string {
  const entries = state.entries.map((entry, index) => describeEntryText(index + 1, entry));
  const lowMerge = openFact.kind === "merge.open" && openFact.tier === "LOW";
  const principal = state.principal !== null && state.principal.fact.kind === "vote"
    ? `${state.principal.fact.body} (approval ${state.principal.fact.approval})` : "none";
  return `OMA ${openFact.kind === "merge.open" ? "merge" : "revert"} applied: ${state.name} — ${openFact.title}` +
    `\nIntegration operation: ${integrationId}   Tier: ${state.tier}   Requester: ${state.requester}` +
    `\nPrevious main: ${state.identity.expectedBase}\nNew main: ${state.identity.candidate}` +
    (openFact.kind === "challenge.open"
      ? `\nReverts merge ${openFact.target.name} (integration ${openFact.target.integration})` : "") +
    `\n\nReason:\n${openFact.reason}\n\nReviews and votes:\n` +
    `${lowMerge ? "none — LOW is applied without prior review" : entries.join("\n")}` +
    `\n\nPrincipal: ${principal}\n\n` +
    `Diff (git diff --binary --full-index --no-ext-diff --no-textconv --no-color ` +
    `${state.identity.expectedBase} ${state.identity.candidate}):\n` + diff;
}

/** Parts concatenate to the exact UTF-8 document. A line break is chosen only
 * within the byte budget, including its newline; otherwise cut between code
 * points. The envelope reserve shares the configuration floor's owner. */
export function splitReviewNotice(document: string, mailBodyBytes: number): string[] {
  const bytes = Buffer.from(document, "utf8");
  const budget = mailBodyBytes - NOTICE_PART_OVERHEAD;
  if (budget <= 0) throw new StoreError("INTERNAL_ERROR", "mail body bound cannot hold a notice part");
  const chunks: Buffer[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (bytes.length - at <= budget) { chunks.push(bytes.subarray(at)); break; }
    const lastBreak = bytes.subarray(at, at + budget).lastIndexOf(0x0a);
    let cut: number;
    if (lastBreak >= 0) cut = lastBreak + 1;
    else {
      cut = budget;
      while (cut > 0 && (bytes[at + cut]! & 0b1100_0000) === 0b1000_0000) cut--;
      if (cut === 0) throw new StoreError("INTERNAL_ERROR", "mail bound splits a UTF-8 sequence");
    }
    chunks.push(bytes.subarray(at, at + cut));
    at += cut;
  }
  return chunks.map(chunk => chunk.toString("utf8"));
}
