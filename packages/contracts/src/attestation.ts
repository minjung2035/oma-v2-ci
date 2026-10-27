/** DR27/S-08/S-10: explicit authenticated facts, never inferred from mail. */
import type { Actor, MessageId, Oid, OperationId } from "./identity.js";
import type { ExactCandidateIdentity, RiskTier } from "./values.js";

/** Caller input of attest.record for the mail-v1 review policy. */
export type ReviewInput =
  | { kind: "merge.open"; tier: RiskTier; title: string; reason: string; candidate: Oid; base: Oid }
  | { kind: "challenge.open"; merge: string; tier: "LOW" | "HIGH"; title: string; reason: string; candidate?: Oid; base?: Oid }
  | { kind: "review"; name: string; body: string }
  | { kind: "vote"; name: string; verdict: "approve" | "reject"; body: string; approval?: MessageId }
  | { kind: "cancel"; name: string; reason: string };

export type AttestationInput = ReviewInput;

/** Frozen by the broker at acceptance (plan.fact); never caller-supplied as-is. */
export type ReviewFact =
  | { kind: "merge.open"; version: 1; name: string; title: string; reason: string; tier: RiskTier;
      identity: ExactCandidateIdentity; submitters: Actor[] }
  | { kind: "challenge.open"; version: 1; name: string; title: string; reason: string; tier: "LOW" | "HIGH";
      identity: ExactCandidateIdentity; submitters: Actor[]; prepared: boolean;
      target: { name: string; request: OperationId; integration: OperationId; identity: ExactCandidateIdentity; tier: RiskTier } }
  | { kind: "review"; version: 1; request: OperationId; body: string }
  | { kind: "vote"; version: 1; request: OperationId; verdict: "approve" | "reject"; body: string; approval: MessageId | null }
  | { kind: "cancel"; version: 1; request: OperationId; reason: string }
  | { kind: "refresh"; version: 1; request: OperationId; main: Oid | null };
