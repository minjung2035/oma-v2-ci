/** DR27/S-08/S-10: explicit authenticated facts, never inferred from mail. */
import type { Actor, MessageId, Oid, OperationId } from "./identity.js";
import type { ExactCandidateIdentity, RiskTier } from "./values.js";

/** Caller input of attest.record for the mail-v1 review policy. */
export interface ReviewPolicyEvidence { maxWorkers: number; highPeerFloor: number; authorSlots: number }
export interface ReviewQualification { role: "resident" | "principal"; incarnation: number; specHash: string; capability: "mail.send" }
type OpenVersion = { version: 1 } | { version: 2 | 3; reviewPolicy: ReviewPolicyEvidence };
type VoteVersion = { version: 1 } | { version: 2; qualification: ReviewQualification } | { version: 3; qualification: ReviewQualification; revision: number; scope: OperationId | null };
export type ReviewInput =
  | { kind: "merge.open"; tier: RiskTier; title: string; reason: string; candidate: Oid; base: Oid }
  | { kind: "challenge.open"; merge: string; tier: "LOW" | "HIGH"; title: string; reason: string; candidate?: Oid; base?: Oid }
  | { kind: "review"; name: string; body: string }
  | { kind: "vote"; name: string; verdict: "approve" | "reject"; body: string; approval?: MessageId }
  | { kind: "cancel"; name: string; reason: string }
  | { kind: "review.withdraw"; name: string; vote: OperationId; reason: string }
  | { kind: "review.invalidate"; name: string; vote: OperationId; reason: string }
  | { kind: "review.adopt"; name: string; reason: string }
  | { kind: "review.retry"; name: string; expectedAttempt: OperationId | null; expectedRevision?: number; reason: string }
  | { kind: "review.revise"; name: string; expectedRevision: number; base: Oid; candidate: Oid; reason: string };

export type AttestationInput = ReviewInput;

/** Frozen by the broker at acceptance (plan.fact); never caller-supplied as-is. */
export type ReviewFact =
  | OpenVersion & { kind: "merge.open"; name: string; title: string; reason: string; tier: RiskTier;
      identity: ExactCandidateIdentity; submitters: Actor[] }
  | OpenVersion & { kind: "challenge.open"; name: string; title: string; reason: string; tier: "LOW" | "HIGH";
      identity: ExactCandidateIdentity; submitters: Actor[]; prepared: boolean;
      target: { name: string; request: OperationId; integration: OperationId; identity: ExactCandidateIdentity; tier: RiskTier } }
  | { kind: "review"; version: 1; request: OperationId; body: string }
  | VoteVersion & { kind: "vote"; request: OperationId; verdict: "approve" | "reject"; body: string; approval: MessageId | null }
  | { kind: "cancel"; version: 1; request: OperationId; reason: string }
  | { kind: "refresh"; version: 1; request: OperationId; main: Oid | null }
  | { kind: "review.withdraw" | "review.invalidate"; version: 2; request: OperationId; vote: OperationId; reason: string }
  | { kind: "review.adopt"; version: 2; request: OperationId; reviewPolicy: ReviewPolicyEvidence; reason: string }
  | { kind: "review.adopt"; version: 3; request: OperationId; revision: number; attemptNumber: number; identity: ExactCandidateIdentity; submitters: Actor[]; reviewPolicy: ReviewPolicyEvidence; reason: string }
  | { kind: "review.retry"; version: 2 | 3; host?: boolean; request: OperationId; expectedAttempt: OperationId | null; attemptNumber: number; reason: string }
  | ({ version: 2 } | { version: 3; main: Oid | null; revision: number; policyRevision: string }) & { kind: "review.preparation-failed"; request: OperationId; attemptNumber: number; reason: string; code: string }
  | { kind: "review.revise"; version: 3; request: OperationId; revision: number; attemptNumber: number; identity: ExactCandidateIdentity; submitters: Actor[]; tier: RiskTier; reviewPolicy: ReviewPolicyEvidence; reason: string }
  | { kind: "review.integration"; version: 3; request: OperationId; revision: number; identity: ExactCandidateIdentity; source: ExactCandidateIdentity; sourceOperation: OperationId; preparedRef: string | null; context: boolean; tier: RiskTier; checkProfileDigest: string; policyIdentity: string; reviewPolicy: ReviewPolicyEvidence; diff: import("./files.js").ReviewDiffArtifact }
  | { kind: "review.supersede"; version: 3; request: OperationId; attemptNumber: number; expectedAttempt: OperationId | null; main: Oid; reason: string }
  | { kind: "review.included"; version: 3; request: OperationId; revision: number; candidate: Oid; main: Oid };
