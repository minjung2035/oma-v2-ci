/** TIER-002/CFG-005: one closed grammar for host and retained policy facts. */
import { isValidWirePath } from "./identifiers.js";
import { checkArray, checkBool, checkEnum, checkInt, checkObject, checkOptional, checkString, type Check } from "./validation.js";
export const riskTierCheck = checkEnum(["LOW", "MEDIUM", "HIGH"]);
export const protectedPathCheck: Check = value => {
  if (typeof value !== "string") return "invalid protected path";
  if (value === "/") return null;
  return isValidWirePath(value.endsWith("/") ? value.slice(0, -1) : value) ? null : "invalid protected path";
};
const tieredFields = {
  repositoryFloor: riskTierCheck, highPeerFloor: checkInt({ min: 2 }), principalDelegated: checkBool(),
  rules: checkArray(checkObject({ path: protectedPathCheck, tier: riskTierCheck,
    statuses: checkArray(checkEnum(["A", "M", "D", "T"]), { min: 1 }) })),
};
export const tieredPolicyCheck = checkObject(tieredFields);

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
export const integrationCheckCheck = checkObject({
  id: checkString({ min: 1 }), argv: checkArray(commandString, { min: 1 }), env: environment,
});


/** INT-004/CREATE-003: pure policy facts, not check execution or authority. */
import type { TieredPolicy } from "@oma/contracts/integration";
import type { RiskTier } from "@oma/contracts/values";
import { maximumTier } from "./risk-tier.js";
import { protectedPathMatches } from "./git-facts.js";
import type { ChangedPath } from "@oma/contracts/git";
import type { HostConfig } from "@oma/contracts";
import { canonicalJson, sha256Hex } from "./canonical-json.js";
import { StoreError } from "./errors.js";

/** Existing internal configuration shape. No wire or durable fields are added. */
export interface IntegrationPolicy {
  tiered?: TieredPolicy;
  policyRevision: string;
  protectedPaths: string[];
  checks: Array<{
    id: string; argv: string[]; env: Record<string, string>;
  }>;
}
export type { IntegrationCheckSnapshot as FrozenCheck } from "@oma/contracts/integration";
import type { IntegrationCheckSnapshot as FrozenCheck } from "@oma/contracts/integration";
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
/** Every freshness observation includes all host-owned policy facts. */
export type IntegrationPolicyReader = () => IntegrationPolicy;

const policyShape = checkObject({
  tiered: checkOptional(tieredPolicyCheck),
  policyRevision: checkString({ min: 1 }), protectedPaths: checkArray(protectedPathCheck), checks: checkArray(integrationCheckCheck),
});

export function integrationPolicyFromConfig(config: HostConfig["integration"]): IntegrationPolicy {
  return {
    ...(config.tiered === undefined ? {} : { tiered: config.tiered }),
    policyRevision: config.policyRevision,
    protectedPaths: [...config.protectedPaths],
    checks: config.checks.map(check => ({
      id: check.id, argv: [...check.argv], env: { ...check.env },
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
    return Object.freeze({
      id: check.id, argv: Object.freeze([...check.argv]), env: Object.freeze({ ...check.env }),
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

/** Only validated host-owned commands may reach the isolated check executor. */
export function assertSupportedIntegration(snapshot: IntegrationSnapshot): void {
  for (const check of snapshot.checks) assertIntegrationCheck(check);
  if (snapshot.tiered !== null && snapshot.tiered.highPeerFloor < 2)
    throw new StoreError("UNSUPPORTED_PROFILE", "HIGH integration requires at least two eligible peers; update integration.tiered.highPeerFloor");
}

export function assertIntegrationCheck(check: FrozenCheck): void {
  if (integrationCheckCheck(check) !== null || check.argv[0] === "")
    throw new StoreError("UNSUPPORTED_PROFILE", "integration check profile is invalid");
}

/** Exact checkout and final command share this environment on either OS.
 * Only physical PATH/HOME differ; host check values cannot override the Git
 * hooks, attributes or replacement-object policy used for committed bytes. */
export function integrationCheckEnvironment(check: FrozenCheck, home: string, path: string): Readonly<Record<string, string>> {
  assertIntegrationCheck(check);
  const environment = { ...check.env, HOME: home, PATH: path, LANG: "C", LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_ATTR_NOSYSTEM: "1", GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "core.attributesFile", GIT_CONFIG_VALUE_1: "/dev/null" };
  for (const [key, value] of Object.entries(environment))
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.includes("\0"))
      throw new StoreError("UNSUPPORTED_PROFILE", "integration check environment is invalid");
  return Object.freeze(environment);
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
