/** MCS-X05: one original submission freeze, two existing acceptance owners.
 * This is a closed source-preparation envelope, never an accepted workflow DSL.
 * The publication receipt does not establish acceptance of the review request. */
import type { PublicMethods } from "@oma/contracts";
import type { InvocationPublication } from "@oma/contracts/public-wire";
import type { Decoded } from "./receipt-codec.js";
import { decodeReceipt } from "./receipt-codec.js";
import { decodeMutationPayload } from "./request-codec.js";
import { canonicalCollaborationJson } from "@oma/domain/collaboration-targets";
import { exportRefForRequestKey } from "@oma/domain/derived";
import { isValidActor } from "@oma/domain/identifiers";

type ReviewInput = PublicMethods["attest.record"]["params"];
type SubmissionReview = Extract<ReviewInput, { kind: "merge.open" | "challenge.open" | "review.revise" }>;
export interface FrozenSubmission {
  readonly kind: "collaboration.submission";
  readonly review: SubmissionReview;
  readonly publication: { readonly key: string; readonly params: PublicMethods["git.submit"]["params"] };
}
export type SubmissionPublication = InvocationPublication;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const closed = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export function submissionPublicationKey(parent: string): string {
  if (!/^inv1-[a-f0-9]{64}$/u.test(parent)) throw new TypeError("invalid original submission key");
  return `${parent}.submit`;
}
export function submissionPublicationSubject(review: SubmissionReview, maximum: number): string {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new TypeError("invalid publication subject bound");
  return review.kind === "review.revise" ? "Candidate".slice(0, maximum) : review.title;
}
export function decodeFrozenSubmission(value: unknown, parent?: string): Decoded<FrozenSubmission> {
  try {
    // Canonical validation rejects accessors, lossy JSON, invalid Unicode and cycles.
    const row: unknown = JSON.parse(canonicalCollaborationJson(value));
    if (!object(row) || !closed(row, ["kind", "review", "publication"]) || row.kind !== "collaboration.submission" ||
        !object(row.publication) || !closed(row.publication, ["key", "params"]) || typeof row.publication.key !== "string" ||
        !/^inv1-[a-f0-9]{64}\.submit$/u.test(row.publication.key)) throw new TypeError("invalid closed submission preparation");
    if (parent !== undefined && row.publication.key !== submissionPublicationKey(parent)) throw new TypeError("publication belongs to another original submission");
    const review = decodeMutationPayload("attest.record", row.review);
    if ((review.kind !== "merge.open" && review.kind !== "challenge.open" && review.kind !== "review.revise") ||
        review.candidate === undefined || review.base === undefined) throw new TypeError("publication needs an exact caller-supplied submission source");
    const publication = decodeMutationPayload("git.submit", row.publication.params);
    if (publication.candidate !== review.candidate || publication.exportRef !== exportRefForRequestKey(row.publication.key) ||
        publication.to.length !== 1 || !isValidActor(publication.to[0]) || publication.paths.length !== 0 ||
        publication.body !== review.reason || publication.bundle === undefined || publication.bundle.bytes < 1 ||
        (review.kind !== "review.revise" && publication.subject !== review.title) ||
        (review.kind === "review.revise" && (!publication.subject || !"Candidate".startsWith(publication.subject))))
      throw new TypeError("publication differs from its exact original submission source and notice");
    return { ok: true, value: { kind: "collaboration.submission", review,
      publication: { key: row.publication.key, params: publication } } };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "invalid submission preparation" }; }
}
export function decodeSubmissionPublication(value: unknown, parent: string): Decoded<SubmissionPublication> {
  try {
    const row: unknown = JSON.parse(canonicalCollaborationJson(value));
    if (!object(row) || !closed(row, ["key", "receipt"]) || row.key !== submissionPublicationKey(parent))
      throw new TypeError("publication observation belongs to another invocation");
    if (row.receipt === null) return { ok: true, value: { key: row.key, receipt: null } };
    const receipt = decodeReceipt(row.receipt, { expectedKind: "git.submit" });
    if (!receipt.ok) throw new TypeError(receipt.reason);
    return { ok: true, value: { key: row.key, receipt: receipt.value } };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "invalid publication observation" }; }
}
