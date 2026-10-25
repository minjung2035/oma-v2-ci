/** Current review risk order; no historical attestation evaluation. */
import type { RiskTier } from "@oma/contracts/values";
import { StoreError } from "./errors.js";
const TIERS: readonly RiskTier[] = ["LOW", "MEDIUM", "HIGH"];
export function maximumTier(...tiers: readonly RiskTier[]): RiskTier {
  if (tiers.length === 0 || tiers.some(tier => !TIERS.includes(tier)))
    throw new StoreError("REF_STATE_UNKNOWN", "integration tier input was not observed");
  return TIERS[Math.max(...tiers.map(tier => TIERS.indexOf(tier)))]!;
}
