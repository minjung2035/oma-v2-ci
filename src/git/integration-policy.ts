/** INT-004/CREATE-003: pure policy facts, not check execution or authority. */
import type { HostConfigV1, ResourceLimits } from "../../implementation/contracts.js";
import { canonicalJson, sha256Hex } from "../hash.js";
import { resourceLimitsCheck } from "../domain/resources.js";
import { isValidWirePath } from "../ids.js";
import { StoreError } from "../domain/errors.js";
import { checkArray, checkInt, checkObject, checkOptional, checkString, type Check } from "../validate.js";

/** Existing internal configuration shape. No wire or durable fields are added. */
export interface IntegrationPolicy {
  policyRevision: string;
  protectedPaths: string[];
  checks: Array<{
    id: string; argv: string[]; env: Record<string, string>; timeoutSeconds: number;
    tmpBytes?: number; resources?: ResourceLimits;
  }>;
}
export interface FrozenCheck {
  readonly id: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutSeconds: number;
  readonly tmpBytes?: number;
  readonly resources?: Readonly<ResourceLimits>;
}
export interface IntegrationSnapshot {
  readonly policyRevision: string;
  readonly protectedPaths: readonly string[];
  readonly checks: readonly FrozenCheck[];
  /** Existing SHA256(canonicalJson(runtime checks)); do not change this recipe. */
  readonly checkProfileDigest: string;
  /** DR8: the integration facts -- protected paths and checks -- the broker
   * holds for its lifetime (TUI-007). The revision is not part of it: it is the
   * host's current one (CFG-005) and is compared on its own. In-memory only;
   * never persisted as a new identity. */
  readonly policyIdentity: string;
}
/** Revision-only readers remain source-compatible, but production composition
 * returns the full policy so same-revision argv/env/resource/path drift is caught.
 */
export type IntegrationPolicyReader = () => IntegrationPolicy | string;

const commandString: Check = value => {
  const invalid = checkString()(value);
  return invalid ?? (typeof value === "string" && value.includes("\0") ? "command contains NUL" : null);
};
const environment: Check = value => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "expected environment object";
  for (const [key, entry] of Object.entries(value)) {
    if (!key || key.includes("=") || commandString(key) !== null || commandString(entry) !== null)
      return "invalid environment entry";
  }
  return null;
};
const protectedPath: Check = value => {
  if (typeof value !== "string") return "invalid protected path";
  if (value === "/") return null; // the whole tree (DR18)
  const path = value.endsWith("/") ? value.slice(0, -1) : value;
  return isValidWirePath(path) ? null : "invalid protected path";
};
const checkShape = checkObject({
  id: checkString({ min: 1 }), argv: checkArray(commandString, { min: 1 }), env: environment,
  timeoutSeconds: checkInt({ min: 1 }), tmpBytes: checkOptional(checkInt({ min: 1 })),
  resources: checkOptional(resourceLimitsCheck),
});
const policyShape = checkObject({
  policyRevision: checkString({ min: 1 }), protectedPaths: checkArray(protectedPath), checks: checkArray(checkShape),
});

export function integrationPolicyFromConfig(config: HostConfigV1["integration"]): IntegrationPolicy {
  return {
    policyRevision: config.policyRevision,
    protectedPaths: [...config.protectedPaths],
    checks: config.checks.map(check => ({
      id: check.id, argv: [...check.argv], env: { ...check.env },
      timeoutSeconds: check.resources.checkTimeoutSeconds,
      tmpBytes: check.resources.tmpBytes, resources: { ...check.resources },
    })),
  };
}

export function snapshotIntegrationPolicy(policy: IntegrationPolicy): IntegrationSnapshot {
  const invalid = policyShape(policy);
  if (invalid) throw new StoreError("UNSUPPORTED_PROFILE", `invalid integration policy: ${invalid}`);
  const ids = new Set<string>();
  const checks: FrozenCheck[] = policy.checks.map(check => {
    if (!check.argv[0] || ids.has(check.id)) throw new StoreError("UNSUPPORTED_PROFILE", "empty check executable or duplicate check identity");
    ids.add(check.id);
    if (check.resources && (check.timeoutSeconds !== check.resources.checkTimeoutSeconds ||
        (check.tmpBytes !== undefined && check.tmpBytes !== check.resources.tmpBytes)))
      throw new StoreError("UNSUPPORTED_PROFILE", "check runtime limits differ from their resource profile");
    return Object.freeze({
      id: check.id, argv: Object.freeze([...check.argv]), env: Object.freeze({ ...check.env }),
      timeoutSeconds: check.timeoutSeconds,
      ...(check.tmpBytes === undefined ? {} : { tmpBytes: check.tmpBytes }),
      ...(check.resources === undefined ? {} : { resources: Object.freeze({ ...check.resources }) }),
    });
  });
  const protectedPaths = Object.freeze([...policy.protectedPaths]);
  const frozenChecks = Object.freeze(checks);
  return Object.freeze({
    policyRevision: policy.policyRevision, protectedPaths, checks: frozenChecks,
    checkProfileDigest: sha256Hex(canonicalJson(frozenChecks)),
    policyIdentity: sha256Hex(canonicalJson({ protectedPaths, checks: frozenChecks })),
  });
}

/** DR18 (S-01-CANDIDATE closed): this version runs no integration checks of
 * its own. A candidate is tested where it is made -- in its Resident's
 * sandbox, before the submission -- and integration decides by CAS and the
 * protected paths. A configuration that names checks is one this version does
 * not support, said so at the broker's start; the checks are never dropped
 * silently (S-01-CANDIDATE's MUST). */
export function assertSupportedIntegration(snapshot: IntegrationSnapshot): void {
  if (snapshot.checks.length !== 0)
    throw new StoreError("UNSUPPORTED_PROFILE", "integration checks are not run by this version; remove integration.checks from the configuration (Residents test their candidates before they submit)");
}

export function assertSameIntegrationPolicy(expected: IntegrationSnapshot, actual: IntegrationSnapshot): void {
  if (expected.policyIdentity !== actual.policyIdentity)
    throw new StoreError("POLICY_CHANGED", "integration policy facts changed; they apply at the next broker start");
}
