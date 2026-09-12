// CREATE-002/M-004: host I/O occurs before BEGIN, never in spec resolution.
import type { HostConfigV1, ResolvedAgentSpec } from "../../implementation/contracts.js";
import { resolveChildSpec, type ChildPolicySnapshot, type ParentAuthoritySnapshot, type ChildSpecInput } from "../domain/child-policy.js";
import { canonicalJson, sha256Hex } from "../domain/canonical-json.js";
import { StoreError } from "../domain/errors.js";

export interface RefreshingSpecResolver {
  (parent: ParentAuthoritySnapshot, input: ChildSpecInput): ResolvedAgentSpec | null;
  refresh(): void;
  revision(): string;
}

function freezePolicy(cfg: HostConfigV1): ChildPolicySnapshot {
  return Object.freeze({
    agentProfiles: Object.freeze(Object.fromEntries(Object.entries(cfg.agentProfiles).map(([name, profile]) => [name, Object.freeze({
      modelProfile: profile.modelProfile, childProfile: profile.childProfile,
      capabilities: Object.freeze([...profile.capabilities]), delegable: Object.freeze([...profile.delegable]),
      resources: Object.freeze({ ...profile.resources }),
    })]))),
    modelProfiles: Object.freeze(Object.fromEntries(Object.entries(cfg.modelProfiles).map(([name, profile]) => [name, Object.freeze({ ...profile })]))),
  });
}

/** The revision identifies the last authoritative host observation, not an
 * assertion that filesystem state cannot change in another process afterwards.
 * Lifecycle refreshes again after async preparation and compares this owner in T.
 */
export function createChildSpecResolver(
  readConfig: () => HostConfigV1,
  inTransaction: () => boolean,
): RefreshingSpecResolver {
  let current: { policy: ChildPolicySnapshot; revision: string } | null = null;
  const requireCurrent = () => {
    if (current === null) throw new StoreError("UNSUPPORTED_PROFILE", "host child policy has not been observed");
    return current;
  };
  const resolver = Object.assign(
    (parent: ParentAuthoritySnapshot, input: ChildSpecInput) => resolveChildSpec(requireCurrent().policy, parent, input)?.spec ?? null,
    {
      refresh() {
        if (inTransaction()) throw new StoreError("INTERNAL_ERROR", "host policy refresh is forbidden inside a Store transaction");
        // A failed refresh cannot authorize admission using the previous snapshot.
        current = null;
        const policy = freezePolicy(readConfig());
        current = Object.freeze({ policy, revision: sha256Hex(canonicalJson(policy)) });
      },
      revision: () => requireCurrent().revision,
    },
  );
  resolver.refresh();
  return Object.freeze(resolver);
}
