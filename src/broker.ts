// MUST [AUTH-001..003]/[IPC-*]/[REC-007]: authenticated transport and lifetime handoff.
import { createServer, type Socket, type Server } from "node:net";
import { mkdirSync } from "node:fs";
import { clearSocketName } from "./storage/socket-name.js";
import { removeOwnedFile } from "./storage/directory.js";
import { join } from "node:path";
import type { Actor, AuthContext, Failure, ProtocolLimits, Request, RunLease } from "../implementation/contracts.js";
import { Store } from "./store.js";
import { StoreError, publicFailure, errorCodeOf } from "./domain/errors.js";
import { AdmissionGate, bindAdmissionGate, type ResourceGate } from "./domain/admission.js";
import { actorSocketDirectoryAt, actorSocketPathAt } from "./storage/paths.js";
import { encodeFrame } from "./frame.js";
import { RpcConnection, NODE_ALARMS } from "./broker/connection.js";
import { PeerAuthenticator, type BoundPeer } from "./broker/peer-authenticator.js";
import { PublicDispatcher } from "./broker/public-dispatcher.js";
import { InternalDispatcher, admitInternal, type InternalAdmission } from "./broker/internal-dispatcher.js";
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
import { RECONCILE_INTERVAL_MS, ReconcileModule } from "./reconcile.js";
import { ViewsModule } from "./views.js";
import { STATUS_REFRESH_MS, statusViewPath } from "./protocol/status-view.js";
import { StatusRefresh } from "./views/status-refresh.js";
import { PrincipalEndpoint, PrincipalHostEndpoint, type PrincipalHostChannel } from "./broker/principal-endpoint.js";
import { resolvedSpecOf } from "./authority.js";
import { StorageAdmission } from "./storage/quota.js";
export { boundedLogOutput } from "./broker/logs.js";
export { peerCgroup } from "./broker/peer-authenticator.js";

export interface BrokerPaths {
  stateRoot: string; runRoot: string; society: string; hasGoal: () => boolean; storageBytes?: number;
  /** The process's storage owner when composition shares it with recovery. */
  storage?: StorageAdmission;
  /** D03: a broker no fixed unit binds its Residents to stops them itself on
   * drain, after every dispatched task settles and before its Store closes. */
  quiesceOnDrain?: () => void;
  /** REC-002, D03: a broker no reconcile timer unit serves runs the periodic
   * sweep itself, for exactly its own lifetime. */
  periodicReconcile?: boolean;
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
/** Concurrent connections one actor socket serves. A Resident's CLI holds one
 * connection per call. */
export const ACTOR_CONNECTIONS = 16;

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
  /** Listener closes still in progress. P0V-52, P0-4: one that has finished
   * leaves the set, so a long-lived broker does not keep every close it ever
   * made (one per run endpoint it revoked). */
  private readonly listenerCloses = new Set<Promise<void>>();
  private standaloneLock: ProcessLock | null = null;
  private running = false;
  private draining = false;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private lastSweepFailure: string | null = null;
  private starting: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private readonly runLeases = new RunRegistry();
  private readonly health = new AdmissionGate();
  private readonly storage: StorageAdmission;
  private readonly admitResource: ResourceGate;
  private readonly peers: PeerAuthenticator;
  private readonly publicDispatcher: PublicDispatcher;
  private readonly internalDispatcher: InternalDispatcher;
  /** One admission for internal methods, whichever endpoint serves them. */
  private readonly internalAdmission: InternalAdmission;
  /** WP23: every status observation -- status.get, the published view, the
   * timer -- shares this one bounded refresh. */
  private readonly statusRefresh: StatusRefresh;
  constructor(
    private readonly store: Store, mail: MailModule, private readonly units: UnitsModule,
    private readonly views: ViewsModule, lifecycle: LifecycleModule,
    git: GitModule | null, private readonly reconcile: ReconcileModule | null,
    private readonly paths: BrokerPaths, private readonly limits: ProtocolLimits = DEFAULT_LIMITS,
    private readonly processLock?: ProcessLock,
    private readonly principalHost?: PrincipalHostChannel,
  ) {
    this.mail = mail;
    bindAdmissionGate(store, this.health);
    this.storage = paths.storage ?? new StorageAdmission(paths.stateRoot, paths.storageBytes, limits.frameBytes);
    this.admitResource = category => this.storage.admit(category);
    this.peers = new PeerAuthenticator(store, units, this.runLeases, paths.society, error => this.cleanupError(error));
    this.statusRefresh = new StatusRefresh(() => this.store.agentNames(), agents => this.units.observeStatus(agents));
    const publicPorts = createPublicDispatchPorts(this.store, mail, this.statusRefresh, this.views, lifecycle, git, limits);
    this.publicDispatcher = new PublicDispatcher({ ...publicPorts,
      isDraining: () => this.draining, assertAdmission: () => this.health.assertAdmission(), admitResource: this.admitResource,
      failureAnswer: (id, error) => this.failureAnswer(id, error), refreshViews: () => this.refreshViews(),
      readLogs: (agent, sinceSeconds) => this.readLogs(agent, sinceSeconds) });
    const internalPorts = createInternalDispatchPorts(this.store, mail, reconcile, paths.stateRoot, {
      requireRunnerUnit: (peer, agent, invocationId) => this.requireRunnerUnit(peer, agent, invocationId),
      requireHostUnit: (peer, kind) => this.requireHostUnit(peer, kind), runnerActor: peer => this.runnerActor(peer),
      runnerAuth: (agent, incarnation, peer) => this.runnerAuth(agent, incarnation, peer),
    });
    this.internalAdmission = { isDraining: () => this.draining, assertAdmission: () => this.health.assertAdmission(), admitResource: this.admitResource };
    this.internalDispatcher = new InternalDispatcher({ ...internalPorts, ...this.internalAdmission,
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
      if (this.paths.periodicReconcile === true && this.reconcile !== null) {
        this.reconcileTimer = setInterval(() => { this.periodicSweep(); }, RECONCILE_INTERVAL_MS);
        this.reconcileTimer.unref();
      }
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
    clearSocketName(path);
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
      principalContext: (peer: BoundPeer, live: () => boolean) => this.peers.principalContext(peer, live),
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
      // P0V-57: the same admission the runner channel gives these methods.
      prepare: async auth => {
        const release = admitInternal("batch.prepare", this.internalAdmission);
        try { return await this.mail.prepare(auth); } finally { release(); }
      },
      complete: async (auth, evidence) => {
        const release = admitInternal("batch.complete", this.internalAdmission);
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
    clearSocketName(path);
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
  /** REC-002: one sweep per interval. A sweep still running is joined, not
   * doubled (`ReconcileModule.sweep`), and the drain waits for it like any
   * dispatched task. A failure is reported once until it changes: the next
   * interval is the retry, and the Human's terminal is not a log to fill. */
  private periodicSweep(): void {
    const reconcile = this.reconcile;
    if (reconcile === null || !this.running || this.draining) return;
    try { this.health.assertAdmission(); } catch { return; }
    const task = reconcile.sweep().then(() => { this.lastSweepFailure = null; this.refreshViews(); }, (error: unknown) => {
      this.health.observe(error);
      const code = errorCodeOf(error);
      if (code !== this.lastSweepFailure) console.error(JSON.stringify({ event: "reconcile.sweep", code }));
      this.lastSweepFailure = code;
    });
    this.executingTasks.add(task);
    void task.finally(() => { this.executingTasks.delete(task); });
  }
  /** TUI-021: unit state changes without a broker transaction, so the status
   * view is also republished on a timer. A failure here is reported and left:
   * the view is derived, and a stale one is visibly stale to its reader.
   * WP23: it is written when the shared refresh answers; nothing waits for it,
   * and no request's outcome depends on it. */
  private publishStatus(): void {
    if (this.draining) return;
    // P0V-70, P0-2: publishing reads the ledger before it writes a file, so a
    // failure here may be an integrity observation. Like every other failure
    // this broker catches, it reaches the fence, which reads it normalized:
    // corruption closes admission, a view file that failed to write does not.
    const failed = (error: unknown): void => {
      this.health.observe(error);
      console.error("status view publish failed:", error instanceof Error ? error.message : String(error));
    };
    void this.statusRefresh.request().then(snapshot => {
      if (this.draining) return;
      try { this.views.publishStatus(snapshot); } catch (error) { failed(error); }
    }, failed);
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
    clearSocketName(path);
    const sockets = new Set<Socket>(); let revoked = false;
    const server = createServer({ allowHalfOpen: true }, socket => {
      if (revoked || this.draining) return this.fail(socket, { code: "STALE_RUN", message: "run endpoint revoked", retry: "never" });
      sockets.add(socket); socket.once("close", () => sockets.delete(socket));
      this.handleActor(socket, actor, incarnation);
    });
    // INV10: a Resident reaches only its own actor socket, and every connection
    // costs this process a socket and a peer pidfd. Past the bound the kernel
    // connection is closed before it is handled, so a Resident flooding its
    // socket exhausts its own endpoint, not the broker's descriptors.
    server.maxConnections = ACTOR_CONNECTIONS;
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
    const closing: Promise<void> = ready.then(() => new Promise<void>(resolve => {
      try { server.close(() => resolve()); } catch { resolve(); }
    }), () => { try { server.close(); } catch { /* failed bind has no listening handle */ } });
    this.listenerCloses.add(closing);
    void closing.then(() => { this.listenerCloses.delete(closing); });
  }
  private bindPeer(socket: Socket): BoundPeer | null { return this.peers.bind(socket); }
  private trustedContext(actor: Actor, peer: BoundPeer, channel: "actor" | "trusted-runner" = "actor"): AuthContext | null {
    return this.peers.context(actor, peer, channel);
  }
  private handleActor(socket: Socket, actor: Actor, incarnation: number): void {
    let peer: BoundPeer | null = null; let transferred = false;
    try {
      if (this.draining) throw new StoreError("BROKER_UNAVAILABLE", "broker is draining", { details: { reason: "draining" } });
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
      if (this.draining) throw new StoreError("BROKER_UNAVAILABLE", "broker is draining", { details: { reason: "draining" } });
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
    // first its transport copy, then its accepted copy. P0V-50, P0-4: it has
    // one owner at a time. The connection holds it while it receives; once the
    // request is handed to its execution, the execution holds it until it
    // settles -- a caller that goes away does not stop the accepted copy from
    // being written, so it cannot give back the bytes that copy will take.
    let releaseReservation = (): void => {};
    let executing = false;
    const connection = new RpcConnection({ socket, peer, limits: this.limits, stagingRoot: join(this.paths.stateRoot, "staging"),
      handle: async (raw, body) => {
        executing = true;
        try { return await handle(raw, body); } catch (error) { this.health.observe(error); throw error; }
        finally { executing = false; releaseReservation(); }
      },
      preflight: raw => {
        try {
          preflight(raw);
          releaseReservation();
          releaseReservation = this.storage.reserve(this.streamReservationBytes(raw));
        } catch (error) { this.health.observe(error); throw error; }
      },
      onClosed: () => { if (!executing) releaseReservation(); this.connections.delete(socket); }, onCleanupError: error => this.cleanupError(error),
      onTask: task => {
        this.executingTasks.add(task);
        void task.then(() => this.executingTasks.delete(task), error => { this.health.observe(error); this.executingTasks.delete(task); });
      },
    });
    this.connections.set(socket, connection);
  }
  private fail(socket: Socket, error: Failure): void {
    const connection = this.connections.get(socket);
    // P0V-33: restated with the facts its code may carry, as it was answered.
    const details = error.details !== null && typeof error.details === "object" && !Array.isArray(error.details)
      ? error.details as Readonly<Record<string, unknown>> : undefined;
    if (connection) { connection.reject(new StoreError(error.code, error.message, details === undefined ? undefined : { details })); return; }
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
    // P0V-93 (R6-16): the GOAL question's one owner, which every composition
    // passes. A fallback here read EACCES or EIO as "no GOAL".
    if (!this.paths.hasGoal()) throw new StoreError("GOAL_REQUIRED", "shared GOAL not published yet");
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
    let endpoint: { socketHostPath: string; done: () => void } | null = null;
    try {
      // D01/WP07: settle the prepared batches from their own receipts before the
      // new run exists, under the opening run's quiescence. DR9: the batches
      // left -- receipt proven absent -- are not rewritten; the new lease is
      // simply their next delivery attempt.
      const absent = this.settlePreviousIncarnation(actor);
      // P0V-113 (G03-broker-r2-01): the new incarnation's endpoint is made
      // before the incarnation is committed, so nothing that can fail comes
      // after the commit: a failed open leaves the incarnation where it was.
      // Until the commit it serves nobody (handleActor refuses an incarnation
      // the ledger does not hold).
      endpoint = this.listenActor(actor, next);
      this.store.transaction(tx => {
        this.health.assertAdmission();
        const current = this.store.getAgent(actor);
        if (!current || current.incarnation !== agent.incarnation || current.desired !== "enabled") throw new StoreError("STALE_RUN", "run admission changed before incarnation commit");
        const prepared = this.store.preparedBatches(actor).map(row => row.id).sort();
        if (prepared.length !== absent.length || prepared.some((id, index) => id !== absent[index]))
          throw new StoreError("STALE_RUN", "prepared batches changed between settlement and rollover");
        tx.updateAgent({ name: actor, incarnation: next });
      });
      const lease = record.publish(endpoint); this.refreshViews(); return lease;
    } catch (error) {
      try { endpoint?.done(); } catch (cleanup) { this.cleanupError(cleanup); }
      try { record.revoke(); } catch (cleanup) { this.cleanupError(cleanup); }
      throw error;
    }
  }
  /** D01/WP07 rollover boundary. `begin` has proven the previous invocation's
   * cgroup empty or removed (or this broker's startup quiesced every unit and
   * has run none since), and the opening run has no endpoint yet: that is what
   * makes an absent receipt final for the run now ending. What each receipt
   * means is the receipt decision's (P0-2): a verified receipt of any of the
   * batch's attempts completes it; an absent one leaves the batch for the next
   * attempt; a hold opens nothing, keeps the evidence, and the run must be
   * retried by a new invocation. Startup and every later open share this path. */
  private settlePreviousIncarnation(actor: Actor): string[] {
    const quiescence = this.runLeases.settlementQuiescence(actor);
    const absent: string[] = [];
    for (const row of this.store.preparedBatches(actor)) {
      const outcome = this.mail.settleFromReceipt(quiescence, row.id);
      switch (outcome.kind) {
        case "settled": case "completed": break;
        case "present": absent.push(row.id); break;
        case "hold": throw outcome.error;
      }
    }
    return absent.sort();
  }
  closeAdmission(): void {
    if (this.draining) return;
    this.draining = true; this.running = false; this.health.close();
    if (this.statusTimer !== null) { clearInterval(this.statusTimer); this.statusTimer = null; }
    if (this.reconcileTimer !== null) { clearInterval(this.reconcileTimer); this.reconcileTimer = null; }
    // Absence is the truthful status of a broker that is going away; an old
    // file left behind would read as a broker that is merely quiet.
    try { removeOwnedFile(statusViewPath(this.paths.stateRoot)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.cleanupError(error); }
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
      // each death are still readable. A failure is no reason to leave the
      // Store and lock held -- P0V-58, P0-5: nor is it a drain that finished.
      // A Resident whose end was not proven may still run, so the drain ends
      // with that failure once everything this broker holds is given back.
      let unproven: { readonly error: unknown } | null = null;
      try { this.paths.quiesceOnDrain?.(); } catch (error) { this.cleanupError(error); unproven = { error }; }
      // No Store or pinned lease closes before all dispatched task owners settle.
      try { this.runLeases.close(); } catch (error) { this.cleanupError(error); }
      this.actorServers.clear(); this.store.close();
      this.standaloneLock?.close(); this.standaloneLock = null;
      if (unproven !== null) throw unproven.error;
    })();
    return this.closing;
  }
}
