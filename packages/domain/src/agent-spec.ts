/** Frozen accepted spec interpretation. No current defaults or I/O. */
import type { ResolvedAgentSpec } from "@oma/contracts/host";
import { StoreError } from "./errors.js";
import { resolvedSpecCheck } from "./durable.js";
import { resolvedSpecIdentityMatches } from "./spec-identity.js";

export function decodeAgentSpec(specJson: string): ResolvedAgentSpec {
  let parsed: unknown;
  try { parsed = JSON.parse(specJson); }
  catch { throw new StoreError("STORE_CORRUPT", "agent spec is not valid JSON"); }
  const invalid = resolvedSpecCheck(parsed);
  if (invalid) throw new StoreError("STORE_CORRUPT", `invalid frozen agent spec: ${invalid}`);
  return parsed as ResolvedAgentSpec;
}

/** P0V-91: the accepted hash is mandatory; a caller cannot silently retarget it. */
export function resolvedSpecOf(agent: { name: string; profile: string; specJson: string; specHash: string }): ResolvedAgentSpec {
  const spec = decodeAgentSpec(agent.specJson);
  if (!resolvedSpecIdentityMatches(spec, agent))
    throw new StoreError("STORE_CORRUPT", `resolved identity mismatch for ${agent.name}`);
  return spec;
}
