/** INT-004/CREATE-003: pure policy facts, not check execution or authority. */
import { integrationCheckCheck as checkShape, protectedPathCheck as protectedPath, tieredPolicyCheck } from "../domain/integration-policy.js";
export { tieredPolicyCheck } from "../domain/integration-policy.js";
import type { TieredPolicy } from "../../implementation/contracts/integration.js";
import type { RiskTier } from "../../implementation/contracts/values.js";
import { maximumTier } from "./approval.js";
import { protectedPathMatches, type ChangedPath } from "./observe.js";
import type { HostConfigV1, ResourceLimits } from "../../implementation/contracts.js";
import { canonicalJson, sha256Hex } from "../hash.js";
import { StoreError } from "../domain/errors.js";
import { checkArray, checkObject, checkOptional, checkString } from "../validate.js";

/** Existing internal configuration shape. No wire or durable fields are added. */
export interface IntegrationPolicy {
  tiered?: TieredPolicy;
  policyRevision: string;
  protectedPaths: string[];
  checks: Array<{
    id: string; argv: string[]; env: Record<string, string>; timeoutSeconds: number;
    tmpBytes?: number; resources?: ResourceLimits;
  }>;
}
export type { IntegrationCheckSnapshot as FrozenCheck } from "../../implementation/contracts/integration.js";
import type { IntegrationCheckSnapshot as FrozenCheck } from "../../implementation/contracts/integration.js";
export interface IntegrationSnapshot {
  readonly tiered: Readonly<TieredPolicy> | null;
  readonly policyRevision: string;
  readonly protectedPaths: readonly string[];
  readonly checks: readonly FrozenCheck[];
  /** Existing SHA256(canonicalJson(runtime checks)); do not change this recipe. */
  readonly checkProfileDigest: string;
  /** DR8: the integration facts -- protected paths and checks -- the broker
   * holds for its lifetime (TUI-007). The revision is not part of it: it is the
   * host's current one (CFG-005) and is compared on its own. Tiered plans
   * retain this digest together with the full accepted policy facts. */
  readonly policyIdentity: string;
}
/** Revision-only readers remain source-compatible, but production composition
 * returns the full policy so same-revision argv/env/resource/path drift is caught.
 */
export type IntegrationPolicyReader = () => IntegrationPolicy | string;

const policyShape = checkObject({
  tiered: checkOptional(tieredPolicyCheck),
  policyRevision: checkString({ min: 1 }), protectedPaths: checkArray(protectedPath), checks: checkArray(checkShape),
});

export function integrationPolicyFromConfig(config: HostConfigV1["integration"]): IntegrationPolicy {
  return {
    ...(config.tiered === undefined ? {} : { tiered: config.tiered }),
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
  const tiered = policy.tiered === undefined ? null : JSON.parse(JSON.stringify(policy.tiered)) as TieredPolicy;
  if (tiered !== null) {
    for (const rule of tiered.rules) { Object.freeze(rule.statuses); Object.freeze(rule); }
    Object.freeze(tiered.rules); Object.freeze(tiered);
  }
  const protectedPaths = Object.freeze([...policy.protectedPaths]);
  const frozenChecks = Object.freeze(checks);
  return Object.freeze({
    tiered, policyRevision: policy.policyRevision, protectedPaths, checks: frozenChecks,
    checkProfileDigest: sha256Hex(canonicalJson(frozenChecks)),
    policyIdentity: sha256Hex(canonicalJson({ protectedPaths, checks: frozenChecks, ...(tiered === null ? {} : { tiered }) })),
  });
}

/** Only complete host-owned limits may reach the isolated check executor.
 * Retained policy decoding keeps historical HIGH floors valid; a new live
 * integration requires the Human's current minimum of two HIGH peers. */
export function assertSupportedIntegration(snapshot: IntegrationSnapshot): void {
  for (const check of snapshot.checks) assertCheckResources(check);
  if (snapshot.tiered !== null && snapshot.tiered.highPeerFloor < 2)
    throw new StoreError("UNSUPPORTED_PROFILE", "HIGH integration requires at least two eligible peers; update integration.tiered.highPeerFloor");
}

export function assertCheckResources(check: FrozenCheck): void {
  if (checkShape(check) !== null || check.argv[0] === "")
    throw new StoreError("UNSUPPORTED_PROFILE", "integration check profile is invalid");
  const resources = check.resources;
  if (resources && (check.timeoutSeconds !== resources.checkTimeoutSeconds ||
      (check.tmpBytes !== undefined && check.tmpBytes !== resources.tmpBytes)))
    throw new StoreError("UNSUPPORTED_PROFILE", "integration checks require their complete resource profile");
  if (!Number.isSafeInteger(check.timeoutSeconds * 1000 + 60_000))
    throw new StoreError("UNSUPPORTED_PROFILE", "integration check deadline cannot be enforced");
}

export function assertSameIntegrationPolicy(expected: IntegrationSnapshot, actual: IntegrationSnapshot): void {
  if (expected.policyIdentity !== actual.policyIdentity)
    throw new StoreError("POLICY_CHANGED", "integration policy facts changed; they apply at the next broker start");
}

export function deterministicTier(policy: Readonly<TieredPolicy>, changes: readonly ChangedPath[]): { tier: RiskTier; reasons: string[] } {
  let tier: RiskTier = "LOW"; const reasons: string[] = [];
  for (const [index, rule] of policy.rules.entries()) if (changes.some(change =>
    protectedPathMatches(change.path, rule.path) && rule.statuses.includes(change.status))) {
    tier = maximumTier(tier, rule.tier); reasons.push(`host rule ${index}: ${rule.path} => ${rule.tier}`);
  }
  return { tier, reasons };
}
