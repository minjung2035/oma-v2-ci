/** Exact review addresses are observations of existing facts, never authority.
 * The publisher and synchronous acceptance gate use this same derivation. */
import type { Receipt } from "@oma/contracts/durable";
import type { ReviewInput } from "@oma/contracts/attestation";
import { sha256Hex } from "./canonical-json.js";
import { collaborationArguments } from "./collaboration-inputs.js";
import { canonicalCollaborationJson, encodeCollaborationTarget, type CollaborationTarget, type SettledFailure } from "./collaboration-targets.js";
import { reviewState, type ReviewEntry, type ReviewStateInput } from "./review-evaluation.js";
import { StoreError } from "./errors.js";
import { isValidOperationId, isValidFullOid } from "./identifiers.js";

/** Exact displayed paths only. No relative path, alias or mutable status file. */
export function collaborationTargetPath(reference: string, recordRoot: string): { readonly request: string; readonly name: string; readonly relative: string } {
  const prefix = `${recordRoot.replace(/\/$/u, "")}/reviews/`;
  if (!reference.startsWith(prefix)) throw new StoreError("CAPABILITY_DENIED", "target is outside this actor's permitted record root");
  const tail = reference.slice(prefix.length), match = /^(op-[a-f0-9-]{36})\/targets\/((?:proposal|review|submission|vote|applied)-[a-f0-9]{64}\.json)$/u.exec(tail);
  if (!match || !isValidOperationId(match[1])) throw new StoreError("INVALID_REQUEST", "expected an exact immutable OMA target path");
  return { request: match[1], name: match[2]!, relative: `reviews/${tail}` };
}

export interface CollaborationReviewScope {
  readonly actor: string;
  readonly role: "resident" | "principal";
  readonly societyBirth: string;
  readonly approvalPublished: boolean;
  readonly failedIntegration?: Receipt;
  readonly appliedManifestSha256?: string;
}
/** Shared exact manifest bytes; neither paths nor the patch are inferred from HEAD. */
export function collaborationReviewManifest(identity: object, diff: import("@oma/contracts/files").ReviewDiffArtifact,
  paths: readonly import("@oma/contracts/git").ChangedPath[]): string {
  return canonicalCollaborationJson({ version: "collaboration-v1", ...identity, diff,
    paths, patch: "proposal.patch", patchEncoding: "exact-bytes",
    binaryArtifacts: { state: "not-projected", coverage: "changed paths are not complete binary blob artifacts" } });
}
function ownVote(input: ReviewStateInput, actor: string, revision: number, scope: string | null, approval: string | null): ReviewEntry | undefined {
  return [...input.entries].reverse().find(entry => entry.actor === actor && entry.fact.kind === "vote" &&
    (entry.fact.version === 3 ? entry.fact.revision === revision && entry.fact.scope === scope : revision === 0 && scope === null) &&
    (actor !== "principal" || entry.fact.approval === approval));
}
/** No clock, filesystem, current configuration or mutable status enters a tuple. */
export function collaborationReviewTargets(input: ReviewStateInput, scope: CollaborationReviewScope): readonly CollaborationTarget[] {
  const state = reviewState(input), targets: CollaborationTarget[] = [];
  if ((scope.role === "principal") !== (scope.actor === "principal"))
    throw new StoreError("CAPABILITY_DENIED", "exact targets belong to another authenticated role");
  const common = { version: "collaboration-v1" as const, societyBirth: scope.societyBirth, request: state.request,
    requestName: state.name, revision: state.revision, policyRevision: state.sourceIdentity.policyRevision };
  const source = { base: state.sourceIdentity.expectedBase, candidate: state.sourceIdentity.candidate };
  const live = state.terminal === null && state.included === null && state.integration?.state !== "succeeded";
  if (scope.role === "resident" && scope.actor === state.requester && live) {
    let settledFailure: SettledFailure = null;
    if (state.integration?.state === "failed") {
      const receipt = scope.failedIntegration;
      if (receipt?.state !== "failed" || receipt.operation !== state.integration.operation)
        throw new StoreError("BROKER_UNAVAILABLE", "exact failed-attempt receipt is unavailable");
      settledFailure = { kind: "integration", operation: receipt.operation, evidenceSha256: sha256Hex(canonicalCollaborationJson(receipt)) };
    } else if (state.preparationFailure !== null) {
      const entry = [...input.entries].reverse().find(entry => entry.fact.kind === "review.preparation-failed" && entry.fact.attemptNumber === state.attemptNumber);
      if (!entry) throw new StoreError("STORE_CORRUPT", "settled preparation failure has no immutable fact");
      settledFailure = { kind: "preparation", operation: entry.operation, evidenceSha256: sha256Hex(canonicalCollaborationJson(entry.fact)) };
    }
    targets.push({ ...common, kind: "proposal", requester: state.requester, source, tier: state.tier,
      attemptNumber: state.attemptNumber, expectedAttempt: state.integration?.operation ?? null, settledFailure });
    targets.push({ ...common, kind: "submission", requester: state.requester, submission: state.revisionSource, source,
      attemptNumber: state.attemptNumber, expectedAttempt: state.integration?.operation ?? null });
  }
  const approval = scope.role === "principal" ? state.approval?.id ?? null : null;
  const vote = ownVote(input, scope.actor, state.revision, state.scope, approval);
  const revoked = vote !== undefined && input.entries.some(entry =>
    (entry.fact.kind === "review.withdraw" || entry.fact.kind === "review.invalidate") && entry.fact.vote === vote.operation);
  const canDecide = live && state.integration === null && (scope.role === "principal"
    ? state.principalRequired && state.approvalValid && approval !== null && scope.approvalPublished
    : !state.authors.includes(scope.actor) && (state.kind === "challenge" || state.tier !== "LOW"));
  if (canDecide) targets.push({ ...common, policyRevision: state.identity.policyRevision, kind: "review",
    scope: state.scope === null ? "source" : "integration", preparation: state.scope,
    source: { base: state.identity.expectedBase, candidate: state.identity.candidate }, actor: scope.actor,
    expectedOwnVote: vote?.operation ?? null, approval });
  if (live && (state.integration === null || state.integration.state === "pending") && vote?.fact.kind === "vote" && !revoked &&
      (scope.role !== "principal" || approval !== null && state.approvalValid && scope.approvalPublished))
    targets.push({ ...common, policyRevision: state.identity.policyRevision, kind: "vote", actor: scope.actor, vote: vote.operation,
      scope: state.scope, approval: vote.fact.approval, expectedCurrentVote: vote.operation });
  if (scope.role === "resident" && state.integration?.state === "succeeded" && scope.appliedManifestSha256 !== undefined) {
    const identity = state.integration.identity;
    if (!identity) throw new StoreError("BROKER_UNAVAILABLE", "applied integration has no exact recorded identity");
    targets.push({ ...common, policyRevision: identity.policyRevision, kind: "applied", integration: state.integration.operation,
      expectedBase: identity.expectedBase, candidate: identity.candidate, manifestSha256: scope.appliedManifestSha256, sourceRevision: state.revision });
  }
  // Validate constructed tuples too; a typed record is not runtime evidence.
  for (const target of targets) encodeCollaborationTarget(target);
  return targets;
}
/** Convert only the inspected exact decision/control target to existing inputs. */
export function collaborationReviewInput(raw: unknown, target: CollaborationTarget, actor: string, role: "resident" | "principal"): ReviewInput {
  const args = collaborationArguments("oma_review", raw);
  encodeCollaborationTarget(target);
  if (typeof args.reason !== "string") throw new StoreError("INVALID_REQUEST", "a nonblank reason is required");
  if (args.decision === "approve" || args.decision === "reject") {
    if (target.kind !== "review") throw new StoreError("INVALID_REQUEST", "WRONG_TARGET_KIND: a verdict requires an exact review target");
    if (target.actor !== actor || (role === "principal") !== (actor === "principal"))
      throw new StoreError("CAPABILITY_DENIED", "review target belongs to another actor or role");
    return { kind: "vote", name: target.requestName, verdict: args.decision, body: args.reason,
      ...(target.approval === null ? {} : { approval: target.approval }) };
  }
  if (args.decision !== "withdraw") throw new StoreError("INVALID_REQUEST", "invalid exact review decision");
  if (target.kind === "submission") {
    if (role !== "resident" || target.requester !== actor)
      throw new StoreError("CAPABILITY_DENIED", "only the Worker requester can withdraw this submission");
    return { kind: "cancel", name: target.requestName, reason: args.reason };
  }
  if (target.kind === "vote") {
    if (target.actor !== actor) throw new StoreError("CAPABILITY_DENIED", "only the reviewer can withdraw this exact vote");
    return { kind: "review.withdraw", name: target.requestName, vote: target.vote, reason: args.reason };
  }
  throw new StoreError("INVALID_REQUEST", "WRONG_TARGET_KIND: withdrawal requires an owned submission or vote target");
}

export interface CollaborationProposalMetadata {
  readonly version: "collaboration-v1";
  readonly request: string;
  readonly requestName: string;
  readonly kind: "merge" | "challenge";
  readonly title: string;
  readonly original: null | { readonly request: string; readonly integration: string };
}
export function collaborationProposalMetadata(input: ReviewStateInput): CollaborationProposalMetadata {
  const fact = input.open.fact;
  if (fact.kind !== "merge.open" && fact.kind !== "challenge.open") throw new StoreError("STORE_CORRUPT", "proposal metadata has no opening fact");
  return { version: "collaboration-v1", request: input.open.operation, requestName: fact.name,
    kind: fact.kind === "merge.open" ? "merge" : "challenge", title: fact.title,
    original: fact.kind === "merge.open" ? null : { request: fact.target.request, integration: fact.target.integration } };
}
export function decodeCollaborationProposalMetadata(raw: unknown): CollaborationProposalMetadata {
  const value: unknown = JSON.parse(canonicalCollaborationJson(raw));
  const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  const closed = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
  if (!object(value) || !closed(value, ["version", "request", "requestName", "kind", "title", "original"]) ||
      value.version !== "collaboration-v1" || !isValidOperationId(value.request) || typeof value.requestName !== "string" ||
      value.requestName !== `${value.kind}-${value.request.slice(3)}` || (value.kind !== "merge" && value.kind !== "challenge") ||
      typeof value.title !== "string" || value.title.trim().length === 0 || (value.kind === "merge" ? value.original !== null :
        !object(value.original) || !closed(value.original, ["request", "integration"]) || !isValidOperationId(value.original.request) || !isValidOperationId(value.original.integration)))
    throw new StoreError("INVALID_REQUEST", "invalid closed proposal metadata");
  // The closed shape and every field were checked above; no model authority is asserted.
  return value as unknown as CollaborationProposalMetadata;
}
function submissionTitle(reason: string, explicit: unknown, maximum: number): string {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new TypeError("invalid host review title byte bound");
  if (explicit !== undefined) {
    if (typeof explicit !== "string" || explicit.trim().length === 0 || /[\u0000-\u001f\u007f-\u009f]/u.test(explicit) || Buffer.byteLength(explicit) > maximum)
      throw new StoreError("INVALID_REQUEST", "explicit review title is blank, contains controls or exceeds its effective bound");
    return explicit;
  }
  const first = (reason.split(/\r\n|\r|\n/u).find(line => line.trim().length > 0)?.trim() ?? "Review").replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ");
  let title = "", bytes = 0;
  for (const point of first.trim() || "Review") { bytes += Buffer.byteLength(point); if (bytes > maximum) break; title += point; }
  if (title.length === 0) title = "Review".slice(0, maximum);
  return title;
}
/** A no-effect resolution is not a synthetic attestation. It is persisted only
 * as protected original-invocation evidence, never sent to attest.record. */
export interface CollaborationExistingPreparation {
  readonly kind: "collaboration.existing";
  readonly target: Extract<CollaborationTarget, { kind: "proposal" }>;
}
/** Validate exact original relationships before the caller reads or stages a
 * candidate. This is shared with final input construction, not a second policy. */
export function collaborationSubmissionContext(tool: "oma_merge" | "oma_challenge", raw: unknown, actor: string, role: "resident" | "principal",
  subjectBytes: number, proposal?: CollaborationTarget, applied?: CollaborationTarget, metadata?: CollaborationProposalMetadata): { readonly args: ReturnType<typeof collaborationArguments> & { readonly reason: string }; readonly tier: "LOW" | "MEDIUM" | "HIGH" } {
  const args = collaborationArguments(tool, raw);
  if (role !== "resident" || actor === "principal") throw new StoreError("CAPABILITY_DENIED", "only a Worker submits or challenges a change");
  if (typeof args.reason !== "string" || !["LOW", "MEDIUM", "HIGH"].includes(String(args.tier))) throw new StoreError("INVALID_REQUEST", "invalid submission reason or tier");
  const tier = args.tier;
  if (tier !== "LOW" && tier !== "MEDIUM" && tier !== "HIGH") throw new StoreError("INVALID_REQUEST", "invalid submission tier");
  if (tool === "oma_challenge" && tier === "MEDIUM") throw new StoreError("INVALID_REQUEST", "challenge tier must be LOW or HIGH");
  if (Object.hasOwn(args, "proposal") !== (proposal !== undefined))
    throw new StoreError("INVALID_REQUEST", "resubmission requires the exact original proposal reference");
  if (proposal !== undefined) {
    encodeCollaborationTarget(proposal);
    if (proposal.kind !== "proposal") throw new StoreError("INVALID_REQUEST", "WRONG_TARGET_KIND: resubmission requires an exact proposal target");
    if (proposal.requester !== actor || !metadata || metadata.request !== proposal.request || metadata.requestName !== proposal.requestName ||
        metadata.kind !== (tool === "oma_merge" ? "merge" : "challenge")) throw new StoreError("CAPABILITY_DENIED", "proposal belongs to another requester or request kind");
    if (tier !== proposal.tier) throw new StoreError("INVALID_REQUEST", "resubmission must supply its recorded tier");
    if (Object.hasOwn(args, "title") && args.title !== metadata.title) throw new StoreError("INVALID_REQUEST", "resubmission cannot change the original title");
  }
  if (tool === "oma_challenge") {
    if (!applied || applied.kind !== "applied" || !applied.requestName.startsWith("merge-"))
      throw new StoreError("INVALID_REQUEST", "WRONG_TARGET_KIND: challenge requires an exact applied merge target");
    encodeCollaborationTarget(applied);
    if (proposal && (metadata?.original?.request !== applied.request || metadata.original.integration !== applied.integration))
      throw new StoreError("INVALID_REQUEST", "a challenge cannot change its original applied merge");
  }
  if (proposal === undefined) submissionTitle(args.reason, args.title, subjectBytes);
  return { args: { ...args, reason: args.reason, tier }, tier };
}
/** Local revision publication remains the caller's protected source driver. */
export function collaborationSubmissionInput(tool: "oma_merge" | "oma_challenge", raw: unknown, actor: string, role: "resident" | "principal",
  subjectBytes: number, proposal?: CollaborationTarget, applied?: CollaborationTarget, metadata?: CollaborationProposalMetadata): ReviewInput | CollaborationExistingPreparation {
  const { args, tier } = collaborationSubmissionContext(tool, raw, actor, role, subjectBytes, proposal, applied, metadata);
  const change = tool === "oma_merge" ? args.change : args.replacement;
  let source: { base: string; candidate: string } | undefined;
  if (change !== undefined) {
    if (!change || typeof change !== "object" || Array.isArray(change) || typeof change.candidate !== "string")
      throw new StoreError("INVALID_REQUEST", "invalid committed submission source");
    const base = change.base ?? (proposal?.kind === "proposal" ? proposal.source.base : undefined);
    if (!isValidFullOid(base) || !isValidFullOid(change.candidate))
      throw new StoreError("UNSUPPORTED_PROFILE", "local revision/default-base publication requires its protected source driver");
    source = { base, candidate: change.candidate };
  } else if (proposal?.kind === "proposal") source = proposal.source;
  if (proposal?.kind === "proposal") {
    if (!source) throw new StoreError("INVALID_REQUEST", "resubmission has no frozen source");
    if (source.base !== proposal.source.base || source.candidate !== proposal.source.candidate) {
      if (proposal.expectedAttempt !== null && proposal.settledFailure?.kind !== "integration")
        throw new StoreError("INTEGRATION_CONDITIONS", "the original pending or unknown integration must settle before source revision");
      return { kind: "review.revise", name: proposal.requestName, expectedRevision: proposal.revision, ...source, reason: args.reason };
    }
    if (proposal.settledFailure !== null)
      return { kind: "review.retry", name: proposal.requestName, expectedRevision: proposal.revision, expectedAttempt: proposal.expectedAttempt, reason: args.reason };
    return { kind: "collaboration.existing", target: proposal };
  }
  const title = submissionTitle(args.reason, args.title, subjectBytes);
  if (tool === "oma_merge") {
    if (!source) throw new StoreError("UNSUPPORTED_PROFILE", "HEAD/default-base submission requires its protected source publication driver");
    return { kind: "merge.open", tier, title, reason: args.reason, ...source };
  }
  if (tier === "MEDIUM" || !applied) throw new StoreError("INVALID_REQUEST", "invalid challenge source or tier");
  return { kind: "challenge.open", merge: applied.requestName, tier, title, reason: args.reason, ...(source ?? {}) };
}
