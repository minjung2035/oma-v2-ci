// TEST-002: normal fixtures are contract-valid; corruption belongs in corruption.ts.
import { CAPABILITIES, type Capability } from "../../src/domain/capabilities.js";
import { resolvedSpecDigest } from "../../src/domain/spec-identity.js";
import { resolvedSpecCheck } from "../../src/durable.js";
import type { ResolvedAgentSpec } from "../../implementation/contracts.js";
import type { NewAgent } from "../../src/store.js";

export const ALL_CAPS: readonly Capability[] = CAPABILITIES;
/** Explicit test reference values, never production resource defaults. */
export const TEST_RESOURCES = Object.freeze({
  memoryBytes: 3221225472, tasks: 128, cpuQuotaPercent: 200, tmpBytes: 1048576,
  workspaceBytes: 1048576, stagingBytes: 1048576, checkTimeoutSeconds: 30,
});

export function makeValidResolvedSpec(
  name = "alice", profile = "p", capabilities: readonly Capability[] = ALL_CAPS,
  from = "0000000000000000000000000000000000000000", brief = "test",
): ResolvedAgentSpec {
  const spec: ResolvedAgentSpec = {
    name, modelProfile: "md", resources: { ...TEST_RESOURCES }, from, brief, profile,
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
