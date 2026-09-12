// MUST [AUTH-001/002/003, CREATE-002]: single ownership of capability parsing.
// The ONLY authoritative capability source is the broker-resolved spec
// persisted in agents.spec_json; capabilities are never derived from role.
import type { AuthContext, Capability } from "../implementation/contracts.js";
import { StoreError, type Store } from "./store.js";
import type { ResolvedAgentSpec } from "../implementation/contracts.js";
import { checkObject, checkString, checkArray, checkOid } from "./validate.js";
import { capabilityCheck } from "./domain/capabilities.js";
import { resourceLimitsCheck } from "./domain/resources.js";

const resolvedCheck = checkObject({
  name: checkString({ min: 1 }), from: checkOid, brief: checkString({ min: 1 }),
  profile: checkString({ min: 1 }), modelProfile: checkString({ min: 1 }),
  resources: resourceLimitsCheck,
  capabilities: checkArray(capabilityCheck),
});

export function resolvedSpecOf(agent: { name: string; profile: string; specJson: string }): ResolvedAgentSpec {
  let value: unknown;
  try { value = JSON.parse(agent.specJson); }
  catch { throw new StoreError("STORE_CORRUPT", `invalid resolved spec for ${agent.name}`); }
  if (resolvedCheck(value))
    throw new StoreError("UNSUPPORTED_PROFILE", `unsupported stored spec for ${agent.name}; reviewed migration required`);
  const spec = value as ResolvedAgentSpec;
  if (spec.name !== agent.name || spec.profile !== agent.profile)
    throw new StoreError("STORE_CORRUPT", `resolved identity mismatch for ${agent.name}`);
  return spec;
}

/**
 * Parse the capabilities from a resolved spec's spec_json. Fail closed (empty
 * set) when the spec is missing or not a valid ResolvedAgentSpec.
 */
export function capabilitiesOf(agent: {
  specJson: string;
}): ReadonlySet<Capability> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(agent.specJson);
  } catch {
    return new Set();
  }
  if (resolvedCheck(parsed)) return new Set();
  return new Set((parsed as ResolvedAgentSpec).capabilities);
}

/** Recheck after asynchronous preparation, inside the acceptance transaction. */
export function assertCurrentActor(store: Store, auth: AuthContext, need?: Capability) {
  const actor = store.getAgent(auth.actor);
  if (!actor || actor.role !== auth.role) throw new StoreError("AUTH_FAILED", "actor identity changed before acceptance");
  if (actor.incarnation !== auth.incarnation || actor.desired !== "enabled")
    throw new StoreError("STALE_RUN", "actor stopped or incarnation changed before acceptance");
  if (need && (!auth.capabilities.has(need) || !capabilitiesOf(actor).has(need)))
    throw new StoreError("CAPABILITY_DENIED", `${need} was revoked before acceptance`);
  return actor;
}
