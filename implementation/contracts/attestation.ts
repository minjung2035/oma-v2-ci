/** DR27/S-08/S-10: explicit authenticated facts, never inferred from mail. */
import type { OperationId } from "./identity.js";
import type { ExactCandidateIdentity } from "./values.js";

export type AttestationInput =
  | { kind: "peer"; identity: ExactCandidateIdentity; verdict: "APPROVE" | "OBJECT"; evidence: string }
  | { kind: "decision"; identity: ExactCandidateIdentity; verdict: "ACCEPT" | "REQUEST_REVISION" | "REJECT"; evidence: string }
  | { kind: "revoke"; attestation: OperationId; evidence: string }
  | { kind: "challenge"; integration: OperationId; identity: ExactCandidateIdentity; evidence: string }
  | { kind: "finding"; challenge: OperationId; valid: boolean; floor: "MEDIUM" | "HIGH" | null; scope: string; evidence: string }
  | { kind: "scope"; finding: OperationId; identity: ExactCandidateIdentity; applies: boolean; evidence: string };
