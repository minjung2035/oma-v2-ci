// TEST-002: shared resolved-spec JSON for seeding agents in actor-channel
// tests. Production never imports this file; the broker reads capabilities
// ONLY from agents.spec_json, so fixtures must store a realistic spec.
import type { Capability } from "../../implementation/contracts.js";

/** Every public capability — the default test actor's resolved spec. */
export const ALL_CAPS: readonly Capability[] = [
  "mail.send",
  "route.follow",
  "agent.create",
  "agent.manage.self",
  "agent.manage.descendants",
  "git.submit",
  "code.integrate",
  "context.publish",
];

/** ResolvedAgentSpec JSON: capabilities are the broker-authorized set. */
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
