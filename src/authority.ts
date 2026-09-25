// AUTH-001..003/CREATE-002: identity facts are not a reusable effect permission.
// Durable capabilities and the live lease must both grant a conditional action.
import type { AuthContext } from "../implementation/contracts/runtime.js";
import type { Capability } from "../implementation/contracts/identity.js";
import type { ResolvedAgentSpec } from "../implementation/contracts/host.js";
import type { StoreReads, AgentRow } from "./store.js";
import { StoreError } from "./domain/errors.js";
import { decodeAgentSpec } from "./storage/rows.js";
import { resolvedSpecDigest } from "./domain/spec-identity.js";

type AuthorityReader = Pick<StoreReads, "getAgent">;

export function resolvedSpecOf(agent: { name: string; profile: string; specJson: string; specHash?: string }): ResolvedAgentSpec {
  const spec = decodeAgentSpec(agent.specJson);
  if (spec.name !== agent.name || spec.profile !== agent.profile ||
      (agent.specHash !== undefined && resolvedSpecDigest(spec) !== agent.specHash))
    throw new StoreError("STORE_CORRUPT", `resolved identity mismatch for ${agent.name}`);
  return spec;
}

/** Corruption is not an empty permission set and must remain distinguishable. */
export function capabilitiesOf(agent: { specJson: string }): ReadonlySet<Capability> {
  return new Set(decodeAgentSpec(agent.specJson).capabilities);
}

/** Identity-only check: deliberately does not authorize a new physical effect. */
export function assertActorIdentity(store: AuthorityReader, auth: AuthContext): AgentRow {
  const actor = store.getAgent(auth.actor);
  if (!actor || actor.role !== auth.role) throw new StoreError("AUTH_FAILED", "actor identity changed");
  if (!Number.isSafeInteger(auth.incarnation) || auth.incarnation < 0 || actor.incarnation !== auth.incarnation)
    throw new StoreError("STALE_RUN", "actor incarnation changed");
  resolvedSpecOf(actor);
  return actor;
}

/** Call again after every asynchronous preparation, inside acceptance/reservation. */
export function assertCurrentActor(store: AuthorityReader, auth: AuthContext, need?: Capability): AgentRow {
  const actor = assertActorIdentity(store, auth);
  if (actor.desired !== "enabled") throw new StoreError("STALE_RUN", "actor stopped, retired or is not ready");
  // Access the getter at the decision point; never retain its Set across an await.
  if (need && (!auth.capabilities.has(need) || !capabilitiesOf(actor).has(need)))
    throw new StoreError("CAPABILITY_DENIED", `${need} was revoked before acceptance`, { details: { capability: need } });
  return actor;
}

/** Immediate resolution input only, not an admission token valid until commit. */
export function effectiveCapabilitiesOf(auth: AuthContext, actor: { specJson: string }): readonly Capability[] {
  return [...capabilitiesOf(actor)].filter(capability => auth.capabilities.has(capability));
}

/** A retained guard re-reads both the ledger and lease on every invocation. */
export function currentAuthorityGuard(store: AuthorityReader, auth: AuthContext): (need?: Capability) => AgentRow {
  return need => assertCurrentActor(store, auth, need);
}
