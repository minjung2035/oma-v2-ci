// AUTH-001..003: identity observation and live authority; never caches a copied capability grant.
import type { Socket } from "node:net";
import { readFileSync, closeSync } from "node:fs";
import type { Actor, AuthContext, Capability } from "../../implementation/contracts.js";
import type { Store } from "../store.js";
import type { UnitsModule } from "../units.js";
import { unitName } from "../units.js";
import type { RunRegistry } from "../runtime/run-registry.js";
import { StoreError } from "../domain/errors.js";
import { capabilitiesOf } from "../authority.js";
import { peerCred, peerPidFd, pidfdLiveness, socketDescriptor, type PeerCred } from "../leaf.js";
import { SharedPeerPin, type ConnectionPeerPin } from "./peer-pin.js";

export type BoundPeer = PeerCred & ConnectionPeerPin;
export function peerCgroup(pid: number): string | null {
  try {
    const line = readFileSync(`/proc/${pid}/cgroup`, "utf8").split("\n").find(Boolean);
    if (!line) return null;
    const index = line.lastIndexOf(":");
    return index < 0 ? null : line.slice(index + 1);
  } catch { return null; }
}
function socketFd(socket: Socket): number {
  const fd = socketDescriptor(socket);
  if (fd === null) throw new StoreError("AUTH_FAILED", "no socket fd");
  return fd;
}
/** P0V-124 (G03-broker-r2-04), P0-2: the one judgment of whether a peer
 * runs inside a unit's cgroup -- the cgroup itself or one below it. Both
 * must be known; an unknown one contains nothing and is contained by
 * nothing. Every authority check here asks this, so none can drift. */
export function insideCgroup(peerGroup: string | null | undefined, unitGroup: string | null | undefined): boolean {
  if (!peerGroup || !unitGroup) return false;
  return peerGroup === unitGroup || peerGroup.startsWith(unitGroup.endsWith("/") ? unitGroup : `${unitGroup}/`);
}
export class PeerAuthenticator {
  constructor(private readonly store: Store, private readonly units: UnitsModule, private readonly runs: RunRegistry,
    private readonly society: string, private readonly cleanupError: (error: unknown) => void) {}
  bind(socket: Socket): BoundPeer | null {
    const fd = socketFd(socket); const credentials = peerCred(fd);
    if (!credentials) return null;
    const pinned = peerPidFd(fd);
    if (pinned === null) return null;
    // Only an answered "running" keeps the peer's authority (INV06); "exited"
    // and "failed" both refuse, and neither is used as proof of death (INV02).
    const owner = new SharedPeerPin(() => pidfdLiveness(pinned).kind === "running", () => closeSync(pinned));
    if (!owner.alive()) { owner.releaseConnection(); return null; }
    socket.once("close", () => { try { owner.releaseConnection(); } catch (error) { this.cleanupError(error); } });
    return { ...credentials, alive: () => owner.alive(), retainForExecution: () => owner.retainForExecution(), releaseConnection: () => owner.releaseConnection() };
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
      const observed = this.units.observe(actor); const peerGroup = peerCgroup(credentials.pid);
      if (observed.activeState === "unknown" || observed.invocationId !== run.invocationId || !observed.cgroup || !peerGroup) return new Set<Capability>();
      if (!insideCgroup(peerGroup, observed.cgroup) || !run.matches(observed.cgroup) || !credentials.alive()) return new Set<Capability>();
      return capabilitiesOf(current);
    };
    const observed = this.units.observe(actor); const peerGroup = peerCgroup(credentials.pid);
    if (!this.store.societyOpen() || agent.desired !== "enabled" || observed.activeState === "unknown" || observed.invocationId !== run.invocationId || !observed.cgroup || !peerGroup || !insideCgroup(peerGroup, observed.cgroup) || !run.matches(observed.cgroup) || !credentials.alive()) return null;
    return { actor, incarnation: agent.incarnation, role: agent.role, channel,
      get capabilities() { return currentCapabilities(); },
      peer: { pid: credentials.pid, uid: credentials.uid, gid: credentials.gid, cgroup: peerGroup } };
  }
  /** AUTH-003 / architecture §23.5: the Principal's live authority.
   *
   * A Resident is authorised by the systemd scope it runs in. The Principal has
   * none — the product starts its engine itself, in the Human's terminal — so
   * the cgroup and run-lease checks a Resident passes could only ever fail
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
      peer: { pid: credentials.pid, uid: credentials.uid, gid: credentials.gid, cgroup: null } };
  }
  requireRunnerUnit(peer: BoundPeer, agent: Actor, invocationId?: string): void {
    const unit = unitName(this.society, agent, "service");
    const observed = this.units.observe(agent); const peerGroup = peerCgroup(peer.pid);
    if (!peer.alive() || !insideCgroup(peerGroup, observed.cgroup) || (invocationId !== undefined && observed.invocationId !== invocationId)) throw new StoreError("AUTH_FAILED", `caller is not the current ${unit} invocation`);
  }
  requireHostUnit(peer: BoundPeer, kind: "principal-relay" | "reconcile"): void {
    const unitGroup = this.units.unitCgroup(kind); const peerGroup = peerCgroup(peer.pid);
    if (!peer.alive() || !insideCgroup(peerGroup, unitGroup)) throw new StoreError("AUTH_FAILED", `caller is not inside the ${kind} service`);
  }
  runnerActor(peer: BoundPeer): Actor {
    const peerGroup = peerCgroup(peer.pid);
    if (!peerGroup) throw new StoreError("AUTH_FAILED", "runner cgroup unavailable");
    const matches: Actor[] = [];
    for (const row of this.store.listAgents()) {
      if (row.role !== "resident" || row.desired === "retired") continue;
      if (insideCgroup(peerGroup, this.units.observe(row.name).cgroup)) matches.push(row.name);
    }
    if (matches.length !== 1 || !peer.alive()) throw new StoreError("AUTH_FAILED", "runner cgroup identity is ambiguous");
    return matches[0]!;
  }
  runnerAuth(agent: Actor, incarnation: number, peer: BoundPeer): AuthContext {
    const auth = this.context(agent, peer, "trusted-runner");
    if (!auth || auth.incarnation !== incarnation) throw new StoreError("STALE_RUN", "runner has no current live lease");
    return auth;
  }
}
