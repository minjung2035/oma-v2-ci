// CREATE-002/003: parent lease ∩ frozen parent authority ∩ host delegation ∩ child profile,
// and the capabilities only the host gives (DR4).
import type { Capability, ResolvedAgentSpec } from "@oma/contracts";
import { StoreError } from "./errors.js";

export interface ParentAuthoritySnapshot {
  readonly name: string; readonly profile: string; readonly capabilities: readonly Capability[];
}
export interface ChildPolicySnapshot {
  readonly agentProfiles: Readonly<Record<string, {
    readonly modelProfile: string; readonly capabilities: readonly Capability[];
    readonly delegable: readonly Capability[]; readonly childProfile: string | null;
  }>>;
  readonly modelProfiles: Readonly<Record<string, unknown>>;
}
export interface ChildSpecInput { readonly name: string; readonly from: string; readonly brief: string }

/** DR4, A-002: `code.integrate` is the host's to give, by the child's profile;
 * no agent delegates it, so a parent's holding or `delegable` has no effect on
 * it. Every other capability is the intersection below. */
export const HOST_GRANTED: readonly Capability[] = Object.freeze(["code.integrate"]);

export function resolveChildSpec(
  cfg: ChildPolicySnapshot, parent: ParentAuthoritySnapshot, input: ChildSpecInput,
): { spec: ResolvedAgentSpec } | null {
  const parentProfile = Object.hasOwn(cfg.agentProfiles, parent.profile) ? cfg.agentProfiles[parent.profile] : undefined;
  if (!parentProfile) throw new StoreError("UNSUPPORTED_PROFILE", `parent profile ${parent.profile} is not configured`);
  const childName = parentProfile.childProfile;
  if (childName === null) return null;
  const child = Object.hasOwn(cfg.agentProfiles, childName) ? cfg.agentProfiles[childName] : undefined;
  if (!child || !Object.hasOwn(cfg.modelProfiles, child.modelProfile))
    throw new StoreError("UNSUPPORTED_PROFILE", `child profile ${childName} or its model profile is not configured`);
  const intersection = parent.capabilities.filter(capability => !HOST_GRANTED.includes(capability) &&
    parentProfile.delegable.includes(capability) && child.capabilities.includes(capability));
  const granted = child.capabilities.filter(capability => HOST_GRANTED.includes(capability));
  return { spec: {
    name: input.name, from: input.from, brief: input.brief, profile: childName,
    capabilities: [...new Set([...intersection, ...granted])].sort(), modelProfile: child.modelProfile,
  } };
}
