/** TIER-002/CFG-005: one closed grammar for host and retained policy facts. */
import { isValidWirePath } from "./identifiers.js";
import { resourceLimitsCheck } from "./resources.js";
import { checkArray, checkBool, checkEnum, checkInt, checkObject, checkOptional, checkString, type Check } from "../validate.js";
export const riskTierCheck = checkEnum(["LOW", "MEDIUM", "HIGH"]);
export const protectedPathCheck: Check = value => {
  if (typeof value !== "string") return "invalid protected path";
  if (value === "/") return null;
  return isValidWirePath(value.endsWith("/") ? value.slice(0, -1) : value) ? null : "invalid protected path";
};
export const tieredPolicyCheck = checkObject({
  review: checkOptional(checkEnum(["mail-v1"])),
  repositoryFloor: riskTierCheck, highPeerFloor: checkInt({ min: 1 }), principalDelegated: checkBool(),
  rules: checkArray(checkObject({ path: protectedPathCheck, tier: riskTierCheck,
    statuses: checkArray(checkEnum(["A", "M", "D", "T"]), { min: 1 }) })),
});

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
  timeoutSeconds: checkInt({ min: 1 }), tmpBytes: checkOptional(checkInt({ min: 1 })),
  resources: checkOptional(resourceLimitsCheck),
});

export const integrationPolicyEvidenceCheck = checkObject({
  tiered: tieredPolicyCheck, protectedPaths: checkArray(protectedPathCheck), checks: checkArray(integrationCheckCheck),
});
