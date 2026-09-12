// TEST-002: shared resolved-spec JSON for seeding agents in actor-channel
// tests. Production never imports this file; the broker reads capabilities
// ONLY from agents.spec_json, so fixtures must store a realistic spec.
import { CAPABILITIES, type Capability } from "../../src/domain/capabilities.js";

/** Every public capability. An independent literal inventory lives in domain-policy tests. */
export const ALL_CAPS: readonly Capability[] = CAPABILITIES;

/** ResolvedAgentSpec JSON: capabilities are the broker-authorized set.
 * Resource numbers below are test reference values, never production defaults.
 */
export function resolvedSpec(
  capabilities: readonly Capability[],
  profile: string,
  name: string,
): string {
  return JSON.stringify({
    name,
    modelProfile: "md",
    resources: {
      memoryBytes: 3221225472, tasks: 128, cpuQuotaPercent: 200, tmpBytes: 1048576,
      workspaceBytes: 1048576, stagingBytes: 1048576, checkTimeoutSeconds: 30,
    },
    from: "0000000000000000000000000000000000000000",
    brief: "test",
    profile,
    capabilities: [...capabilities],
  });
}
