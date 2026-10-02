/** Closed fact grammar shared by wire and immutable ledger decoding. */
import { exactCandidateCheck } from "./mail-values.js";
import type { AttestationInput } from "../../implementation/contracts/attestation.js";
import { isValidOperationId } from "./identifiers.js";
function object(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function attestationProblem(value: unknown, evidenceBytes = Number.MAX_SAFE_INTEGER): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "expected attestation object";
  const row = value as Record<string, unknown>;
  if (typeof row.evidence !== "string" || row.evidence.trim().length === 0 || Buffer.byteLength(row.evidence) > evidenceBytes)
    return "attestation requires bounded, nonempty evidence";
  switch (row.kind) {
    case "peer": case "decision":
      return object(row, ["kind", "identity", "verdict", "evidence"]) && (exactCandidateCheck(row.identity) === null) &&
        (row.kind === "peer" ? ["APPROVE", "OBJECT"] : ["ACCEPT", "REQUEST_REVISION", "REJECT"]).includes(row.verdict as string)
        ? null : "invalid exact review attestation";
    case "revoke": return object(row, ["kind", "attestation", "evidence"]) && isValidOperationId(row.attestation)
      ? null : "invalid attestation revoke";
    case "challenge": return object(row, ["kind", "integration", "identity", "evidence"]) && isValidOperationId(row.integration) && (exactCandidateCheck(row.identity) === null)
      ? null : "invalid integration challenge";
    case "finding": return object(row, ["kind", "challenge", "valid", "floor", "scope", "evidence"]) &&
      isValidOperationId(row.challenge) && typeof row.valid === "boolean" && typeof row.scope === "string" &&
      (row.valid ? (row.floor === "MEDIUM" || row.floor === "HIGH") && row.scope.trim().length > 0 : row.floor === null && row.scope === "")
      ? null : "a valid finding names its persistent floor and semantic scope; an invalid finding creates neither";
    case "scope": return object(row, ["kind", "finding", "identity", "applies", "evidence"]) && isValidOperationId(row.finding) &&
      (exactCandidateCheck(row.identity) === null) && typeof row.applies === "boolean" ? null : "invalid exact scope assessment";
    default: return "unknown attestation kind";
  }
}
export function readAttestation(value: unknown): AttestationInput {
  const problem = attestationProblem(value);
  if (problem !== null) throw new TypeError(problem);
  return value as AttestationInput;
}
