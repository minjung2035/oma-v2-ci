/** CREATE-002 / DB-009: identity of an already validated frozen resolved spec.
 * This is the existing hash domain; it neither resolves current defaults nor
 * rewrites capabilities/resources in the stored spec.
 */
import { createHash } from "node:crypto";
import type { ResolvedAgentSpec } from "../../implementation/contracts.js";
import { canonicalJson } from "./canonical-json.js";

export function resolvedSpecDigest(spec: ResolvedAgentSpec): string {
  return createHash("sha256").update(canonicalJson({
    ...spec,
    resources: { ...spec.resources },
    capabilities: [...new Set(spec.capabilities)].sort(),
  })).digest("hex");
}
