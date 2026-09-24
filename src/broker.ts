// MUST [AUTH-001..003]/[IPC-*]/[REC-007]: authenticated transport and lifetime handoff.
import { createServer, type Socket, type Server } from "node:net";
import { mkdirSync, unlinkSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Actor, AuthContext, Failure, ProtocolLimits, Request, RunLease } from "../implementation/contracts.js";
import { Store } from "./store.js";
import { StoreError, publicFailure } from "./domain/errors.js";
import { AdmissionGate, bindAdmissionGate, type ResourceGate } from "./domain/admission.js";
import { actorSocketDirectoryAt, actorSocketPathAt } from "./storage/paths.js";
import { encodeFrame } from "./frame.js";
import { RpcConnection, NODE_ALARMS } from "./broker/connection.js";
import { PeerAuthenticator, type BoundPeer } from "./broker/peer-authenticator.js";
import { PublicDispatcher } from "./broker/public-dispatcher.js";
import { InternalDispatcher } from "./broker/internal-dispatcher.js";
import { createPublicDispatchPorts, createInternalDispatchPorts } from "./broker/composition.js";
import { readUnitLogs } from "./broker/logs.js";
import { errorAnswer, okAnswer } from "./broker/replies.js";
import { RunRegistry } from "./runtime/run-registry.js";
import { ProcessLock } from "./runtime/process-lock.js";
import { settleWithin } from "./runtime/broker-lifetime.js";
import { MailModule } from "./mail.js";
import { UnitsModule } from "./units.js";
import { sdNotifyReady } from "./leaf.js";
import { LifecycleModule } from "./lifecycle.js";
import { GitModule } from "./git.js";
import { ReconcileModule } from "./reconcile.js";
import { ViewsModule } from "./views.js";
import { STATUS_REFRESH_MS, statusViewPath } from "./protocol/status-view.js";
import { INTERNAL_METHODS } from "./protocol/methods.js";
import { PrincipalEndpoint, PrincipalHostEndpoint, type PrincipalHostChannel } from "./broker/principal-endpoint.js";
import { resolvedSpecOf } from "./authority.js";
import { StorageAdmission } from "./storage/quota.js";
export { boundedLogOutput } from "./broker/logs.js";
export { peerCgroup } from "./broker/peer-authenticator.js";

export interface BrokerPaths {
  stateRoot: string; runRoot: string; society: string; hasGoal?: () => boolean; storageBytes?: number;
  /** The process's storage owner when composition shares it with recovery. */
  storage?: StorageAdmission;
  /** D03: a broker no fixed unit binds its Residents to stops them itself on
   * drain, after every dispatched task settles and before its Store closes. */
  quiesceOnDrain?: () => void;
}

/** PR-001: a broker no host started opens no Principal endpoint at all, so
 * there is nothing for an unregistered caller to attach to. The contract
 * itself lives with the endpoints that enforce it. */
export type { PrincipalHostChannel } from "./broker/principal-endpoint.js";
const DEFAULT_LIMITS: ProtocolLimits = {
  frameBytes: 256 * 1024, mailBodyBytes: 256 * 1024, subjectBytes: 512, addresses: 64,
  replyReferences: 64, contextFiles: 256, contextBytes: 8 * 1024 * 1024,
  bundleBytes: 256 * 1024 * 1024, logBytes: 1024 * 1024, batchMaxMessages: 24,
  idleStreamSeconds: 30, receiptWaitSeconds: 30,
};
export class Broker {
  private adminServer: Server | null = null;
  private hostServer: Server | null = null;
  private principalServer: Server | null = null;
  private principalHostServer: Server | null = null;
  private principalEndpoint: PrincipalEndpoint | null = null;
  private principalHostEndpoint: PrincipalHostEndpoint | null = null;
  private readonly mail: MailModule;

  private readonly actorServers = new Set<Server>();
  private readonly connections = new Map<Socket, RpcConnection>();
  private readonly executingTasks = new Set<Promise<void>>();
  private readonly listeners = new Map<Server, Promise<void>>();
  private readonly listenerCloses: Promise<void>[] = [];
  private standaloneLock: ProcessLock | null = null;
  private running = false;
  private draining = false;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private starting: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private readonly runLeases = new RunRegistry();
  private readonly health = new AdmissionGate();
  private readonly storage: StorageAdmission;
  private readonly admitResource: ResourceGate;
  private readonly peers: PeerAuthenticator;
  private readonly publicDispatcher: PublicDispatcher;
  private readonly internalDispatcher: InternalDispatcher;
  constructor(
    private readonly store: Store, mail: MailModule, private readonly units: UnitsModule,
    private readonly views: ViewsModule, lifecycle: LifecycleModule,
    git: GitModule | null, reconcile: ReconcileModule | null,
    private readonly paths: BrokerPaths, private readonly limits: ProtocolLimits = DEFAULT_LIMITS,
    private readonly processLock?: ProcessLock,
    private readonly principalHost?: PrincipalHostChannel,
  ) {
    this.mail = mail;
    bindAdmissionGate(store, this.health);
    this.storage = paths.storage ?? new StorageAdmission(paths.stateRoot, paths.storageBytes, limits.frameBytes);
    this.admitResource = category => this.storage.admit(category);
    this.peers = new PeerAuthenticator(store, units, this.runLeases, paths.society, error => this.cleanupError(error));
    const publicPorts = createPublicDispatchPorts(this.store, mail, this.units, this.views, lifecycle, git, limits);
    this.publicDispatcher = new PublicDispatcher({ ...publicPorts,
      isDraining: () => this.draining, assertAdmission: () => this.health.assertAdmission(), admitResource: this.admitResource,
      failureAnswer: (id, error) => this.failureAnswer(id, error), refreshViews: () => this.refreshViews(),
      readLogs: (agent, sinceSeconds) => this.readLogs(agent, sinceSeconds) });
    const internalPorts = createInternalDispatchPorts(this.store, mail, reconcile, paths.stateRoot, {
      requireRunnerUnit: (peer, agent, invocationId) => this.requireRunnerUnit(peer, agent, invocationId),
      requireHostUnit: (peer, kind) => this.requireHostUnit(peer, kind), runnerActor: peer => this.runnerActor(peer),
      runnerAuth: (agent, incarnation, peer) => this.runnerAuth(agent, incarnation, peer),
    });
    this.internalDispatcher = new InternalDispatcher({ ...internalPorts,
      isDraining: () => this.draining, assertAdmission: () => this.health.assertAdmission(), admitResource: this.admitResource,
      failureAnswer: (id, error) => this.failureAnswer(id, error), refreshViews: () => this.refreshViews(),
      openRun: (actor, invocationId) => this.openRun(actor, invocationId) });
  }
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.health.assertAdmission();
    mkdirSync(this.paths.runRoot, { recursive: true });
    const lockPath = join(this.paths.runRoot, "broker.lock");
    // Compatibility for direct domain/test construction. Production always
    // transfers the lifetime's pre-configuration/pre-Store lock token.
    const lock = this.processLock ?? (this.standaloneLock = ProcessLock.acquire(lockPath));
    lock.assertHeld(lockPath);
    this.units.onRevokeRun = actor => this.runLeases.get(actor)?.revoke();
    this.views.refreshWorld();
    this.adminServer = this.listenInternal(join(this.paths.runRoot, "admin.sock"), "runner");
    this.hostServer = this.listenInternal(join(this.paths.runRoot, "host.sock"), "host");
    if (this.principalHost !== undefined) this.listenPrincipal(this.principalHost);
    const principalListeners = [this.principalServer, this.principalHostServer]
      .filter((server): server is Server => server !== null).map(server => this.listeners.get(server)!);
    this.starting = Promise.all([this.listeners.get(this.adminServer)!, this.listeners.get(this.hostServer)!,
      ...principalListeners]).then(() => {
      this.health.assertAdmission(); this.running = true;
      // Only now: a host told "ready" can register its session and expect both
      // endpoints to be there.
      this.principalHost?.ready();
      this.publishStatus();
      this.statusTimer = setInterval(() => { this.publishStatus(); }, STATUS_REFRESH_MS);
      this.statusTimer.unref();
    });
    // Legacy non-awaiting callers cannot create an unhandled rejection. The
    // authoritative start Promise still rejects and production must await it.
    void this.starting.catch(error => { this.health.observe(error); this.closeAdmission(); });
    return this.starting;
  }
  notifyReady(): boolean {
    if (!this.running || this.draining) throw new StoreError("BROKER_UNAVAILABLE", "listeners are not ready");
    this.health.assertAdmission();
    return sdNotifyReady(process.env.NOTIFY_SOCKET ?? "");
  }
  private listen(server: Server, path: string): void {
    const ready = new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.on("error", error => { this.health.observe(error); reject(error); this.cleanupError(error); });
      try { server.listen(path); } catch (error) { reject(error); }
    });
    this.listeners.set(server, ready);
    void ready.catch(() => undefined);
  }
  private listenInternal(path: string, channel: "runner" | "host"): Server {
    if (existsSync(path)) unlinkSync(path);
    const server = createServer({ allowHalfOpen: true }, socket => {
      if (this.draining) { socket.destroy(); return; }
      this.handleInternal(socket, channel);
    });
    this.listen(server, path); return server;
  }
  /** TUI-004: the endpoint the product's own Pi session reaches the society
   * through. It is a public actor endpoint like a Resident's, with one
   * difference: the connection is nobody until it presents this run's
   * credential, and every request before that is refused. */
  /** PR-001/PR-002: opened only for a host that started this broker, and owned
   * by the endpoints rather than by this file: who the Principal is, and who
   * may deliver to it, are authority decisions, not branches of dispatch. */
  private listenPrincipal(channel: PrincipalHostChannel): void {
    const connection = {
      isDraining: () => this.draining,
      bindPeer: (socket: Socket) => this.bindPeer(socket),
      principalContext: (peer: BoundPeer) => this.peers.principalContext(peer),
      serveFrames: (socket: Socket, peer: BoundPeer,
        handle: (raw: Record<string, unknown>, stream: AsyncIterable<Uint8Array> | null) => Promise<object>,
        preflight: (raw: Record<string, unknown>) => void) => this.serveFrames(socket, peer, handle, preflight),
      fail: (socket: Socket, failure: Failure) => this.fail(socket, failure),
      observe: (error: unknown) => this.health.observe(error),
      cleanupError: (error: unknown) => this.cleanupError(error),
    };
    const endpoint = new PrincipalEndpoint(channel, { ...connection,
      dispatch: (auth, request, stream) => this.dispatch(auth, request, stream),
      preflight: (auth, raw) => this.preflightPublicStream(auth, raw),
    });
    const hostEndpoint = new PrincipalHostEndpoint(channel, { ...connection,
      prepare: async auth => {
        const release = this.admitResource(INTERNAL_METHODS["batch.prepare"].resource);
        try { return await this.mail.prepare(auth); } finally { release(); }
      },
      complete: async (auth, evidence) => {
        const release = this.admitResource(INTERNAL_METHODS["batch.complete"].resource);
        try { await this.mail.complete(auth, evidence); } finally { release(); }
        this.refreshViews();
      },
      registeredEngine: () => endpoint.registeredEngine,
    });
    this.principalEndpoint = endpoint;
    this.principalHostEndpoint = hostEndpoint;
    this.principalServer = this.listenOn(join(this.paths.runRoot, "principal.sock"), socket => endpoint.serve(socket));
    this.principalHostServer = this.listenOn(join(this.paths.runRoot, "principal-host.sock"), socket => hostEndpoint.serve(socket));
  }
  private listenOn(path: string, serve: (socket: Socket) => void): Server {
    if (existsSync(path)) unlinkSync(path);
    const server = createServer({ allowHalfOpen: true }, socket => {
      if (this.draining) { socket.destroy(); return; }
      serve(socket);
    });
    this.listen(server, path);
    return server;
  }
  private refreshViews(): void {
    try { this.views.refreshWorld(); }
    catch (error) { this.health.observe(error); console.error("world view refresh failed:", error instanceof Error ? error.message : String(error)); }
    this.publishStatus();
  }
  /** TUI-021: unit state changes without a broker transaction, so the status
   * view is also republished on a timer. A failure here is reported and left:
   * the view is derived, and a stale one is visibly stale to its reader. */
  private publishStatus(): void {
    if (this.draining) return;
    try {
      this.views.publishStatus(agent => {
        const value = this.units.observe(agent);
        return { activeState: value.activeState, subState: value.subState, result: value.result, execMainStatus: value.execMainStatus };
      });
    } catch (error) { console.error("status view publish failed:", error instanceof Error ? error.message : String(error)); }
  }
  private actorSocketDirectory(actor: Actor, incarnation: number): string {
    const dir = actorSocketDirectoryAt(this.paths.runRoot, actor, incarnation);
    if (Buffer.byteLength(actorSocketPathAt(this.paths.runRoot, actor, incarnation)) > 107)
      throw new StoreError("UNSUPPORTED_PROFILE", "actor socket path exceeds Linux sun_path");
    return dir;
  }
  private listenActor(actor: Actor, incarnation = this.store.getAgent(actor)?.incarnation ?? 0): { socketHostPath: string; done: () => void } {
    const dir = this.actorSocketDirectoryAfterAdmission(actor, incarnation);
    const path = actorSocketPathAt(this.paths.runRoot, actor, incarnation);
    mkdirSync(dir, { recursive: true });
    if (existsSync(path)) unlinkSync(path);
    const sockets = new Set<Socket>(); let revoked = false;
    const server = createServer({ allowHalfOpen: true }, socket => {
      if (revoked || this.draining) return this.fail(socket, { code: "STALE_RUN", message: "run endpoint revoked", retry: "never" });
      sockets.add(socket); socket.once("close", () => sockets.delete(socket));
      this.handleActor(socket, actor, incarnation);
    });
    server.on("error", () => {
      const run = this.runLeases.get(actor);
      if (run?.identity.incarnation === incarnation) { try { run.revoke(); } catch (error) { this.cleanupError(error); } }
    });
    this.listen(server, path); this.actorServers.add(server);
    return { socketHostPath: path, done: () => {
      if (revoked) return;
      revoked = true;
      for (const socket of sockets) this.fail(socket, { code: "STALE_RUN", message: "run endpoint revoked", retry: "never" });
      this.actorServers.delete(server); this.closeListener(server);
    } };
  }
  private actorSocketDirectoryAfterAdmission(actor: Actor, incarnation: number): string {
    this.health.assertAdmission(); return this.actorSocketDirectory(actor, incarnation);
  }
  private closeListener(server: Server): void {
    const ready = this.listeners.get(server);
    if (!ready) return;
    this.listeners.delete(server);
    this.listenerCloses.push(ready.then(() => new Promise<void>(resolve => {
      try { server.close(() => resolve()); } catch { resolve(); }
    }), () => { try { server.close(); } catch { /* failed bind has no listening handle */ } }));
  }
  private bindPeer(socket: Socket): BoundPeer | null { return this.peers.bind(socket); }
  private trustedContext(actor: Actor, peer: BoundPeer, channel: "actor" | "trusted-runner" = "actor"): AuthContext | null {
    return this.peers.context(actor, peer, channel);
  }
  private handleActor(socket: Socket, actor: Actor, incarnation: number): void {
    let peer: BoundPeer | null = null; let transferred = false;
    try {
      if (this.draining) throw new StoreError("BROKER_UNAVAILABLE", "broker is draining");
      if (this.store.getAgent(actor)?.incarnation !== incarnation) throw new StoreError("STALE_RUN", "actor incarnation is stale");
      peer = this.bindPeer(socket);
      if (!peer) throw new StoreError("AUTH_FAILED", "no peer credentials");
      const auth = this.trustedContext(actor, peer);
      if (!auth) throw new StoreError("AUTH_FAILED", "cgroup mismatch");
      this.serveFrames(socket, peer, (raw, stream) => this.dispatch(auth, raw as Request, stream), raw => this.preflightPublicStream(auth, raw));
      transferred = true;
    } catch (error) { this.health.observe(error); this.fail(socket, publicFailure(error)); }
    finally { if (!transferred) { try { peer?.releaseConnection(); } catch (error) { this.cleanupError(error); } } }
  }
  private handleInternal(socket: Socket, channel: "runner" | "host"): void {
    let peer: BoundPeer | null = null; let transferred = false;
    try {
      if (this.draining) throw new StoreError("BROKER_UNAVAILABLE", "broker is draining");
      peer = this.bindPeer(socket);
      if (!peer || peer.uid !== (process.getuid?.() ?? -1)) throw new StoreError("AUTH_FAILED", "invalid internal peer credentials");
      const credentials = peer;
      this.serveFrames(socket, peer, (raw, stream) => this.dispatchInternal(raw, credentials, stream, channel), () => {
        throw new StoreError("INVALID_REQUEST", "internal methods do not accept raw stream bodies");
      });
      transferred = true;
    } catch (error) { this.health.observe(error); this.fail(socket, publicFailure(error)); }
    finally { if (!transferred) { try { peer?.releaseConnection(); } catch (error) { this.cleanupError(error); } } }
  }
  private cleanupError(error: unknown): void {
    this.health.observe(error);
    console.error("RPC cleanup failed:", error instanceof Error ? error.message : String(error));
  }
  private serveFrames(socket: Socket, peer: BoundPeer,
    handle: (raw: Record<string, unknown>, stream: AsyncIterable<Uint8Array> | null) => Promise<object>,
    preflight: (raw: Record<string, unknown>) => void,
  ): void {
    // A streamed request's reservation covers bytes the tree does not show yet:
    // first its transport copy, then its accepted copy. It is held until the
    // execution settles or the connection closes, and released once.
    let releaseReservation = (): void => {};
    const connection = new RpcConnection({ socket, peer, limits: this.limits, stagingRoot: join(this.paths.stateRoot, "staging"),
      handle: async (raw, body) => {
        try { return await handle(raw, body); } catch (error) { this.health.observe(error); throw error; }
        finally { releaseReservation(); }
      },
      preflight: raw => {
        try {
          preflight(raw);
          releaseReservation();
          releaseReservation = this.storage.reserve(this.streamReservationBytes(raw));
        } catch (error) { this.health.observe(error); throw error; }
      },
      onClosed: () => { releaseReservation(); this.connections.delete(socket); }, onCleanupError: error => this.cleanupError(error),
      onTask: task => {
        this.executingTasks.add(task);
        void task.then(() => this.executingTasks.delete(task), error => { this.health.observe(error); this.executingTasks.delete(task); });
      },
    });
    this.connections.set(socket, connection);
  }
  private fail(socket: Socket, error: Failure): void {
    const connection = this.connections.get(socket);
    if (connection) { connection.reject(new StoreError(error.code, error.message)); return; }
    if (socket.destroyed) return;
    const alarm = NODE_ALARMS.after(this.limits.idleStreamSeconds, () => socket.destroy());
    socket.once("close", () => alarm.cancel()); socket.once("error", () => socket.destroy());
    try {
      const frame = encodeFrame(Broker.errorAnswer("x", error));
      if (frame.length > Math.min(this.limits.frameBytes, 0xffffffff) + 4) socket.destroy(); else socket.end(frame);
    } catch { socket.destroy(); }
  }
  static errorAnswer(id: string, error: { code: string; message: string; retry: "never" | "same-key" | "after-repair" }): object { return errorAnswer(id, error); }
  static okAnswer(id: string, result: unknown): object { return okAnswer(id, result); }
  private failureAnswer(id: string, error: unknown): object { this.health.observe(error); return Broker.errorAnswer(id, publicFailure(error)); }
  private streamReservationBytes(envelope: Record<string, unknown>): number {
    const params = envelope.params;
    const record = params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : null;
    const descriptor = record?.bundle ?? record?.content;
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) return 0;
    const bytes = (descriptor as Record<string, unknown>).bytes;
    return typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : 0;
  }
  private preflightPublicStream(auth: AuthContext, envelope: Record<string, unknown>): void {
    this.publicDispatcher.preflight(auth, envelope);
  }
  private readLogs(agent: string, sinceSeconds: number): Promise<{ text: string; truncated: boolean; observedAtMs: number }> {
    return readUnitLogs(this.paths.society, agent, sinceSeconds, this.limits.logBytes);
  }
  async dispatch(auth: AuthContext, request: Request, stream: AsyncIterable<Uint8Array> | null): Promise<object> {
    return this.publicDispatcher.dispatch(auth, request, stream);
  }
  private requireRunnerUnit(peer: BoundPeer, agent: Actor, invocationId?: string): void { this.peers.requireRunnerUnit(peer, agent, invocationId); }
  private requireHostUnit(peer: BoundPeer, kind: "principal-relay" | "reconcile"): void { this.peers.requireHostUnit(peer, kind); }
  private runnerActor(peer: BoundPeer): Actor { return this.peers.runnerActor(peer); }
  private runnerAuth(agent: Actor, incarnation: number, peer: BoundPeer): AuthContext {
    const auth = this.trustedContext(agent, peer, "trusted-runner");
    if (!auth || auth.incarnation !== incarnation) throw new StoreError("STALE_RUN", "runner has no current live lease");
    return auth;
  }
  private dispatchInternal(raw: Record<string, unknown>, peer: BoundPeer, stream: AsyncIterable<Uint8Array> | null, channel: "runner" | "host"): Promise<object> {
    return this.internalDispatcher.dispatch(raw, peer, stream, channel);
  }
  private openRun(actor: Actor, invocationId: string): RunLease {
    this.health.assertAdmission();
    const agent = this.store.getAgent(actor);
    if (!agent) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${actor}`);
    resolvedSpecOf(agent);
    if (agent.desired === "provisioning") throw new StoreError("AGENT_NOT_READY", `${actor} is provisioning`);
    if (agent.desired === "stopped") throw new StoreError("STALE_RUN", `${actor} is stopped`);
    if (agent.desired === "retired") throw new StoreError("AGENT_RETIRED", `${actor} is retired`);
    const hasGoal = this.paths.hasGoal?.() ?? existsSync(join(this.paths.stateRoot, "world", "context", "current"));
    if (!hasGoal) throw new StoreError("GOAL_REQUIRED", "shared GOAL not published yet");
    const active = this.runLeases.get(actor); const observation = this.units.observe(actor);
    if (observation.activeState === "unknown" || observation.invocationId !== invocationId || !observation.cgroup) throw new StoreError("AUTH_FAILED", "runner invocation changed during open");
    if (active?.invocationId === invocationId) {
      if (!active.lease || active.lease.incarnation !== agent.incarnation || !active.matches(observation.cgroup)) throw new StoreError("STALE_RUN", "run endpoint is revoked, replaced or failed");
      return active.lease;
    }
    const next = agent.incarnation + 1;
    if (!Number.isSafeInteger(next)) throw new StoreError("STORE_CORRUPT", "incarnation exhausted");
    this.actorSocketDirectory(actor, next);
    const record = this.runLeases.begin(actor, next, invocationId, observation.cgroup);
    try {
      this.store.transaction(tx => {
        this.health.assertAdmission();
        const current = this.store.getAgent(actor);
        if (!current || current.incarnation !== agent.incarnation || current.desired !== "enabled") throw new StoreError("STALE_RUN", "run admission changed before incarnation commit");
        tx.updateAgent({ name: actor, incarnation: next }); tx.reassignPreparedBatches(actor, next);
      });
      const lease = record.publish(this.listenActor(actor, next)); this.refreshViews(); return lease;
    } catch (error) {
      try { record.revoke(); } catch (cleanup) { this.cleanupError(cleanup); }
      throw error;
    }
  }
  closeAdmission(): void {
    if (this.draining) return;
    this.draining = true; this.running = false; this.health.close();
    if (this.statusTimer !== null) { clearInterval(this.statusTimer); this.statusTimer = null; }
    // Absence is the truthful status of a broker that is going away; an old
    // file left behind would read as a broker that is merely quiet.
    try { rmSync(statusViewPath(this.paths.stateRoot), { force: true }); } catch (error) { this.cleanupError(error); }
    // The credential dies with the broker that minted it, so nothing observed
    // during this run can attach to a later one.
    this.principalEndpoint?.close();
    this.principalHostEndpoint?.close();
    // The supervision channel is this broker's for its lifetime: a broker told
    // to stop on its own must not stay alive holding a descriptor.
    try { this.principalHost?.close(); } catch (error) { this.cleanupError(error); }
    this.principalEndpoint = null;
    this.principalHostEndpoint = null;
    this.principalServer = null;
    this.principalHostServer = null;
    for (const connection of this.connections.values()) connection.close();
    for (const record of this.runLeases.values()) { try { record.revoke(); } catch (error) { this.cleanupError(error); } }
    for (const server of [...this.listeners.keys()]) this.closeListener(server);
  }
  drainAndClose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closeAdmission();
    this.closing = (async () => {
      await settleWithin([...(this.starting ? [this.starting] : []), ...this.executingTasks, ...this.listenerCloses], this.limits.receiptWaitSeconds);
      // Stop what nothing else will stop while the incarnations that prove
      // each death are still readable; a failure is reported, not a reason to
      // leave the Store and lock held.
      try { this.paths.quiesceOnDrain?.(); } catch (error) { this.cleanupError(error); }
      // No Store or pinned lease closes before all dispatched task owners settle.
      try { this.runLeases.close(); } catch (error) { this.cleanupError(error); }
      this.actorServers.clear(); this.store.close();
      this.standaloneLock?.close(); this.standaloneLock = null;
    })();
    return this.closing;
  }
}
