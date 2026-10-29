// CREATE-002/M-004: host I/O occurs before BEGIN, never in spec resolution.
import type { HostConfig, ResolvedAgentSpec } from "@oma/contracts";
import { resolveChildSpec, resolveChildPolicy, type ResolvedChildPolicy, type ChildPolicySnapshot, type ParentAuthoritySnapshot, type ChildSpecInput } from "@oma/domain/child-policy";
import { canonicalJson, sha256Hex } from "@oma/domain/canonical-json";
import { StoreError } from "@oma/domain/errors";

export interface RefreshingSpecResolver {
  (parent: ParentAuthoritySnapshot, input: ChildSpecInput): ResolvedAgentSpec | null;
  refresh(): void;
  revision(): string;
  maxWorkers(): number;
  observe(parent: ParentAuthoritySnapshot): ResolvedChildPolicy | null;
}

function freezePolicy(cfg: HostConfig): ChildPolicySnapshot {
  return Object.freeze({
    maxWorkers: cfg.maxWorkers,
    agentProfiles: Object.freeze(Object.fromEntries(Object.entries(cfg.agentProfiles).map(([name, profile]) => [name, Object.freeze({
      modelProfile: profile.modelProfile, childProfile: profile.childProfile,
      capabilities: Object.freeze([...profile.capabilities]), delegable: Object.freeze([...profile.delegable]),
    })]))),
    modelProfiles: Object.freeze(Object.fromEntries(Object.entries(cfg.modelProfiles).map(([name, profile]) => [name, Object.freeze({ ...profile })]))),
  });
}

/** The revision identifies the last authoritative host observation, not an
 * assertion that filesystem state cannot change in another process afterwards.
 * Lifecycle refreshes again after async preparation and compares this owner in T.
 */
export function createChildSpecResolver(
  readConfig: () => HostConfig,
  inTransaction: () => boolean,
): RefreshingSpecResolver {
  let current: { policy: ChildPolicySnapshot; revision: string } | null = null;
  let boundMaxWorkers: number | null = null;
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
        if (boundMaxWorkers !== null && policy.maxWorkers !== boundMaxWorkers)
          throw new StoreError("POLICY_CHANGED", "Worker capacity changed; restart the broker to apply it");
        boundMaxWorkers = policy.maxWorkers;
        current = Object.freeze({ policy, revision: sha256Hex(canonicalJson(policy)) });
      },
      revision: () => requireCurrent().revision,
      maxWorkers: () => requireCurrent().policy.maxWorkers,
      observe: (parent: ParentAuthoritySnapshot) => resolveChildPolicy(requireCurrent().policy, parent),
    },
  );
  resolver.refresh();
  return Object.freeze(resolver);
}
