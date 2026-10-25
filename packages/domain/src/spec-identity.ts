/** CREATE-002 / DB-009: identity of an already validated frozen resolved spec.
 * This is the existing hash domain; it neither resolves current defaults nor
 * rewrites capabilities/model references in the stored spec.
 */
import { createHash } from "node:crypto";
import type { ResolvedAgentSpec } from "@oma/contracts/host";
import { canonicalJson } from "./canonical-json.js";

export function resolvedSpecDigest(spec: ResolvedAgentSpec): string {
  return createHash("sha256").update(canonicalJson({
    ...spec,
    capabilities: [...new Set(spec.capabilities)].sort(),
  })).digest("hex");
}

/** One intrinsic relation between an accepted row's identity and its frozen spec. */
export function resolvedSpecIdentityMatches(spec: ResolvedAgentSpec,
  identity: { readonly name: string; readonly profile: string; readonly specHash: string }): boolean {
  return spec.name === identity.name && spec.profile === identity.profile && resolvedSpecDigest(spec) === identity.specHash;
}
