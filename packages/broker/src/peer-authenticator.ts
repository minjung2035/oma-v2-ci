// AUTH-001..003: identity observation and live authority; never caches a copied capability grant.
import type { Duplex } from "node:stream";
import type { Actor, AuthContext, Capability } from "@oma/contracts";
import type { BrokerLedger, BrokerUnits, BoundPeer, BrokerEffects } from "./ports.js";
import { descendsFrom } from "./process-ancestry.js";
import type { RunRegistry } from "./run-registry.js";
import { StoreError } from "@oma/domain/errors";
import { capabilitiesOf } from "@oma/domain/authority";
import { SharedPeerPin, type ConnectionPeerPin } from "./peer-pin.js";

/** Every received byte range must name the still-pinned original connector.
 * Descriptor possession and a caller's claimed PID are not sender evidence. */
export function matchesPinnedSender(peer: Pick<BoundPeer, "sameSender" | "alive">, sender: unknown): boolean {
  return peer.sameSender(sender) && peer.alive();
}
export class PeerAuthenticator {
  constructor(private readonly store: Pick<BrokerLedger, "getAgent" | "listAgents" | "societyOpen">, private readonly units: Pick<BrokerUnits, "observe" | "scopeRoot" | "runnerAlive">, private readonly runs: RunRegistry,
    private readonly society: string, private readonly cleanupError: (error: unknown) => void,
    private readonly pinPeer: BrokerEffects["pinPeer"]) {}
  bind(socket: Duplex): BoundPeer | null {
    const pinned = this.pinPeer(socket);
    if (pinned === null) return null;
    // Only an answered "running" keeps the peer's authority (INV06); "exited"
    // and "failed" both refuse, and neither is used as proof of death (INV02).
    const owner = new SharedPeerPin(() => pinned.alive(), () => pinned.close());
    if (!owner.alive()) { owner.releaseConnection(); return null; }
    socket.once("close", () => { try { owner.releaseConnection(); } catch (error) { this.cleanupError(error); } });
    return { pid: pinned.pid, uid: pinned.uid, gid: pinned.gid, sameSender: sender => pinned.sameSender(sender),
      alive: () => owner.alive(), retainForExecution: () => owner.retainForExecution(), releaseConnection: () => owner.releaseConnection() };
  }
  context(actor: Actor, credentials: BoundPeer, channel: "actor" | "trusted-runner" = "actor"): AuthContext | null {
    const agent = this.store.getAgent(actor);
    if (!agent || credentials.uid !== (process.getuid?.() ?? -1)) return null;
    const run = this.runs.get(actor); const lease = run?.lease;
    if (!run || !lease || lease.incarnation !== agent.incarnation) return null;
    const currentCapabilities = (): ReadonlySet<Capability> => {
      if (!this.store.societyOpen() || !credentials.alive() || this.runs.get(actor) !== run || run.lease !== lease) return new Set<Capability>();
      const current = this.store.getAgent(actor);
      if (!current || current.desired !== "enabled" || current.incarnation !== lease.incarnation || current.role !== agent.role || current.specHash !== agent.specHash) return new Set<Capability>();
      if (!this.matchesScope(actor, credentials, run.invocationId) || !run.matches(this.units.observe(actor).scope)) return new Set<Capability>();
      return capabilitiesOf(current);
    };
    const observed = this.units.observe(actor);
    if (!this.store.societyOpen() || agent.desired !== "enabled" || !this.matchesScope(actor, credentials, run.invocationId) || !run.matches(observed.scope)) return null;
    if (channel === "trusted-runner" && (credentials.inheritedRunner?.actor !== actor || credentials.inheritedRunner.invocationId !== run.invocationId)) return null;
    return { actor, incarnation: agent.incarnation, role: agent.role, channel,
      get capabilities() { return currentCapabilities(); },
      peer: { pid: credentials.pid, uid: credentials.uid, gid: credentials.gid } };
  }
  private matchesScope(actor: Actor, peer: BoundPeer, invocationId: string): boolean {
    const observed = this.units.observe(actor), root = this.units.scopeRoot(actor);
    return peer.alive() && this.units.runnerAlive(actor) && observed.activeState !== "unknown" &&
      observed.invocationId === invocationId && !!observed.scope && root !== null && descendsFrom(peer.pid, root) && peer.alive();
  }
  /** AUTH-003 / architecture §23.5: the Principal's live authority.
   *
   * A Resident is authorised by its pinned execution scope. The Principal has
   * none — the product starts its engine itself, in the Human's terminal — so
   * the scope and run-lease checks a Resident passes could only ever fail
   * here, and lowering them to "same user" would make every desktop process of
   * this user the Principal. The broker's own per-run credential stands in for
   * the scope, and is checked by the caller before this is reached; everything
   * else is unchanged, including re-deriving the capabilities on every read so
   * that a row edited mid-connection takes effect at once rather than leaving a
   * copied grant behind.
   */
  principalContext(credentials: BoundPeer, live: () => boolean): AuthContext | null {
    const agent = this.store.getAgent("principal");
    if (!agent || agent.role !== "principal" || agent.desired !== "enabled") return null;
    if (credentials.uid !== (process.getuid?.() ?? -1) || !credentials.alive() || !live()) return null;
    const currentCapabilities = (): ReadonlySet<Capability> => {
      // P0V-60, P0-2: what stands in for a Resident's run lease -- the
      // registration the caller was authorised under -- is re-checked on every
      // read, as the lease is. A request that awaited while its registration
      // was retired reaches acceptance with nothing to act with.
      if (!credentials.alive() || !live()) return new Set<Capability>();
      const current = this.store.getAgent("principal");
      if (!current || current.desired !== "enabled" || current.role !== agent.role ||
        current.specHash !== agent.specHash || current.incarnation !== agent.incarnation) return new Set<Capability>();
      return capabilitiesOf(current);
    };
    return { actor: "principal", incarnation: agent.incarnation, role: agent.role, channel: "actor",
      get capabilities() { return currentCapabilities(); },
      peer: { pid: credentials.pid, uid: credentials.uid, gid: credentials.gid } };
  }
  requireRunnerPeer(peer: BoundPeer, agent: Actor, invocationId?: string): void {
    const grant = peer.inheritedRunner;
    if (!grant || grant.actor !== agent || invocationId !== undefined && grant.invocationId !== invocationId ||
        !this.matchesScope(agent, peer, grant.invocationId))
      throw new StoreError("AUTH_FAILED", "caller does not hold the current inherited runner channel");
  }
  runnerActor(peer: BoundPeer): Actor {
    const grant = peer.inheritedRunner;
    if (!grant) throw new StoreError("AUTH_FAILED", "runner has no inherited grant");
    this.requireRunnerPeer(peer, grant.actor, grant.invocationId); return grant.actor;
  }
  runnerAuth(agent: Actor, incarnation: number, peer: BoundPeer): AuthContext {
    const auth = this.context(agent, peer, "trusted-runner");
    if (!auth || auth.incarnation !== incarnation) throw new StoreError("STALE_RUN", "runner has no current live lease");
    return auth;
  }
}
