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
const tieredFields = {
  repositoryFloor: riskTierCheck, highPeerFloor: checkInt({ min: 1 }), principalDelegated: checkBool(),
  rules: checkArray(checkObject({ path: protectedPathCheck, tier: riskTierCheck,
    statuses: checkArray(checkEnum(["A", "M", "D", "T"]), { min: 1 }) })),
};
/** I48: the mail review protocol is the only review grammar — `review` may
 * only ever say "mail-v1", and its absence in a live policy still selects it
 * (there is nothing else a tiered society could mean). */
export const tieredPolicyCheck = checkObject({ review: checkOptional(checkEnum(["mail-v1"])), ...tieredFields });
/** Evidence retained inside an accepted plan decodes under the grammar the row
 * was accepted with: `review` predates its mandatory form, so historical rows
 * without it remain what they were. */
const tieredPolicyEvidenceCheck = tieredPolicyCheck;

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
  timeoutSeconds: checkInt({ min: 0 }), tmpBytes: checkOptional(checkInt({ min: 0 })),
  resources: checkOptional(resourceLimitsCheck),
});

export const integrationPolicyEvidenceCheck = checkObject({
  tiered: tieredPolicyEvidenceCheck, protectedPaths: checkArray(protectedPathCheck), checks: checkArray(integrationCheckCheck),
});
