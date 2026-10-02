/** DR27/TIER-009: extend the existing review vocabulary, not a task workflow.
 * Explicit identity arguments compare on replay; evidence is frozen once. */
import { attestationProblem } from "../../domain/attestation.js";
import { keyOf, parseArguments, type ParsedArguments } from "../arguments.js";
import { readBody } from "../effects.js";
import { fail } from "../exit.js";
import { effect, randKey } from "../request-service.js";

const COMMON = { "--request": "value", "--file": "value" } as const;
const EXACT = { "--base": "value", "--target": "value", "--policy-revision": "value" } as const;
function identity(parsed: ParsedArguments, candidate: string | null) {
  if (parsed.value("--target") !== "main") fail("--target must be main", 2);
  return { repo: "project", targetRef: "refs/heads/main", candidate, expectedBase: parsed.value("--base"),
    policyRevision: parsed.value("--policy-revision") };
}
function boolean(value: string | null): boolean {
  if (value !== "true" && value !== "false") fail("expected true or false", 2);
  return value === "true";
}
export function runAttestationCommand(command: "approve" | "object" | "revoke" | "challenge", args: string[]): Promise<never> {
  // A mode is selected only after the closed grammar has consumed values.
  const options = command === "revoke" ? COMMON : command === "challenge"
    ? { ...COMMON, ...EXACT, "--candidate": "value", "--valid": "value", "--floor": "value", "--scope": "value", "--applies": "value" } as const
    : { ...COMMON, ...EXACT, ...(command === "approve" ? { "--decision": "value" as const } : {}) };
  const parsed = parseArguments(args, { options, positional: { min: 1, max: 1 } });
  const target = parsed.positional[0]!;
  let fields: Record<string, unknown>;
  if (command === "revoke") fields = { kind: "revoke", attestation: target };
  else if (command === "approve" || command === "object") {
    const decision = command === "approve" ? parsed.value("--decision") : null;
    fields = { kind: decision === null ? "peer" : "decision", identity: identity(parsed, target),
      verdict: decision ?? (command === "approve" ? "APPROVE" : "OBJECT") };
  } else if (parsed.value("--valid") !== null) {
    if (["--candidate", "--base", "--target", "--policy-revision", "--applies"].some(name => parsed.value(name) !== null))
      fail("finding cannot include candidate/scope-assessment flags", 2);
    const valid = boolean(parsed.value("--valid"));
    if (!valid && (parsed.value("--floor") !== null || parsed.value("--scope") !== null)) fail("invalid finding cannot set a floor or scope", 2);
    fields = { kind: "finding", challenge: target, valid, floor: valid ? parsed.value("--floor") : null,
      scope: valid ? parsed.value("--scope") : "" };
  } else {
    if (parsed.value("--floor") !== null || parsed.value("--scope") !== null) fail("floor and scope require --valid", 2);
    fields = parsed.value("--applies") === null
      ? { kind: "challenge", integration: target, identity: identity(parsed, parsed.value("--candidate")) }
      : { kind: "scope", finding: target, identity: identity(parsed, parsed.value("--candidate")), applies: boolean(parsed.value("--applies")) };
  }
  const problem = attestationProblem({ ...fields, evidence: "validation" });
  if (problem !== null) fail(problem, 2);
  const file = parsed.value("--file");
  if (file === null) fail("attestation requires --file evidence", 2);
  return effect("attest.record", keyOf(parsed) ?? randKey(), () => {
    const params = { ...fields, evidence: readBody(file) };
    const problem = attestationProblem(params);
    if (problem !== null) fail(problem, 2);
    return { method: "attest.record", params };
  }, () => fields);
}
