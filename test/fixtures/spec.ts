// TEST-002: shape-valid fixtures, not complete HostConfig, live authority or installed runtime.
// resolvedSpecCheck validates this shape; a real Store/Mail fixture must also round-trip it.
// Corruption belongs in corruption.ts, after a validated positive control.
import { CAPABILITIES, type Capability } from "@oma/domain/capabilities";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { resolvedSpecCheck } from "@oma/domain/durable";
import type { ResolvedAgentSpec } from "@oma/contracts";
import type { NewAgent } from "@oma/contracts/ledger";

export const ALL_CAPS: readonly Capability[] = CAPABILITIES;
export function makeValidResolvedSpec(
  name = "alice", profile = "p", capabilities: readonly Capability[] = ALL_CAPS,
  from = "0000000000000000000000000000000000000000", brief = "test",
): ResolvedAgentSpec {
  const spec: ResolvedAgentSpec = {
    name, modelProfile: "md", from, brief, profile,
    capabilities: [...capabilities],
  };
  const invalid = resolvedSpecCheck(spec);
  if (invalid) throw new Error(`invalid normal resolved-spec fixture: ${invalid}`);
  return spec;
}

export function resolvedSpec(capabilities: readonly Capability[], profile: string, name: string): string {
  return JSON.stringify(makeValidResolvedSpec(name, profile, capabilities));
}

/** A stored agent row must carry the digest of its own frozen spec. Building the
 * pair together removes the hand-written hash that decoders now reject. */
export function storedSpec(capabilities: readonly Capability[], profile: string, name: string): { specJson: string; specHash: string } {
  const spec = makeValidResolvedSpec(name, profile, capabilities);
  return { specJson: JSON.stringify(spec), specHash: resolvedSpecDigest(spec) };
}

export function makeValidAgent(
  name = "alice",
  options: Partial<Pick<NewAgent, "desired" | "incarnation" | "profile" | "createdBy">> & {
    capabilities?: readonly Capability[]; from?: string; brief?: string;
  } = {},
): NewAgent {
  const spec = makeValidResolvedSpec(name, options.profile ?? "p", options.capabilities ?? ALL_CAPS, options.from, options.brief);
  return {
    name, specHash: resolvedSpecDigest(spec), role: name === "principal" ? "principal" : "resident",
    desired: options.desired ?? "enabled", incarnation: options.incarnation ?? (name === "principal" ? 0 : 1),
    profile: spec.profile, createdBy: options.createdBy ?? null, specJson: JSON.stringify(spec),
  };
}
