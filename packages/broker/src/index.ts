import type { BrokerDependencies, BrokerLedger, BrokerMail, BrokerUnits, BrokerViews, BrokerReconcile, BrokerStatusRefresh } from "./ports.js";
// MUST [AUTH-001..003]/[IPC-*]/[REC-007]: authenticated transport and lifetime handoff.
import type { Duplex } from "node:stream";
import type { BrokerListener } from "./ports.js";
import { join } from "node:path";
import type { Actor, AuthContext, Failure, ProtocolLimits, Request, RunLease } from "@oma/contracts";
import { StoreError, publicFailure, errorCodeOf } from "@oma/domain/errors";
import { AdmissionGate } from "@oma/domain/admission";
import { actorSocketDirectoryAt, actorSocketPathAt } from "@oma/domain/paths";
import { encodeFrame } from "@oma/protocol/frame";
import { BrokerListeners } from "./listeners.js";
import { RpcConnection, NODE_ALARMS } from "./connection.js";
import { PeerAuthenticator, matchesPinnedSender } from "./peer-authenticator.js";
import { type BoundPeer } from "./ports.js";
import { PublicDispatcher } from "./public-dispatcher.js";
import { InternalDispatcher, assertInternalAdmission, projectInternalPeers } from "./internal-dispatcher.js";
import { type InternalAdmission } from "./ports.js";
import { errorAnswer, okAnswer } from "./replies.js";
import { RunRegistry } from "./run-registry.js";
import { CoalescedWake } from "@oma/process/coalesced-wake";
import { ProcessLock } from "@oma/native/process-lock";
import { settleWithin } from "./lifetime.js";
import { RECONCILE_INTERVAL_MS } from "@oma/domain/recovery-policy";
import { STATUS_REFRESH_MS } from "@oma/protocol/status-view";
import { PrincipalEndpoint, PrincipalHostEndpoint, type PrincipalHostChannel } from "./principal-endpoint.js";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
export { boundedLogOutput } from "./logs.js";

export interface BrokerPaths {
  stateRoot: string; runRoot: string; society: string; hasGoal: () => boolean;
  /** D03: the broker's Residents are bound to no fixed unit, so it stops them
   * itself on drain, after every dispatched task settles and before its Store
   * closes. */
  quiesceOnDrain?: () => void | Promise<void>;
}

/** PR-001: a broker no host started opens no Principal endpoint at all, so
 * there is nothing for an unregistered caller to attach to. The contract
 * itself lives with the endpoints that enforce it. */
export type { PrincipalHostChannel } from "./principal-endpoint.js";
/** Concurrent connections one actor socket serves. A Resident's CLI holds one
 * connection per call. */
export const ACTOR_CONNECTIONS = 16;

export class Broker {
  private adminServer: BrokerListener | null = null;
  private principalServer: BrokerListener | null = null;
  private principalHostServer: BrokerListener | null = null;
  private principalEndpoint: PrincipalEndpoint | null = null;
  private principalHostEndpoint: PrincipalHostEndpoint | null = null;
  private readonly mail: BrokerMail;
  private readonly store: BrokerLedger;
  private readonly units: BrokerUnits;
  private readonly views: BrokerViews;
  private readonly reconcile: BrokerReconcile | null;

  private readonly connections = new Map<Duplex, RpcConnection>();
  private readonly executingTasks = new Set<Promise<void>>();
  private readonly listeners = new BrokerListeners(error => {
    this.health.observe(error); this.cleanupError(error);
  });
  private running = false;
  private draining = false;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private lastSweepFailure: string | null = null;
  private readonly sweepWake = new CoalescedWake(() => this.performSweep());
  private sweepTask: Promise<void> | null = null;
  private readonly statusWake = new CoalescedWake(() => this.performStatusPublication());
  private statusTask: Promise<void> | null = null;
  private starting: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private readonly runLeases: RunRegistry;
  private readonly health = new AdmissionGate();
  private readonly peers: PeerAuthenticator;
  private readonly publicDispatcher: PublicDispatcher;
  private readonly internalDispatcher: InternalDispatcher;
  /** One admission for internal methods, whichever endpoint serves them. */
  private readonly internalAdmission: InternalAdmission;
  /** WP23: every status observation -- status.get, the published view, the
   * timer -- shares this one bounded refresh. */
  private readonly statusRefresh: BrokerStatusRefresh;
  constructor(
    private readonly dependencies: BrokerDependencies,
    private readonly paths: BrokerPaths, private readonly limits: ProtocolLimits,
    private readonly processLock: ProcessLock,
    private readonly principalHost?: PrincipalHostChannel,
  ) {
    if (typeof processLock?.assertHeld !== "function")
      throw new StoreError("BROKER_UNAVAILABLE", "broker requires its owner's held process lock");
    this.runLeases = new RunRegistry(dependencies.acquireRunScope);
    const { ledger: store, mail, units, views, reconcile } = dependencies;
    this.store = store; this.units = units; this.views = views; this.reconcile = reconcile;
    this.mail = mail;
    dependencies.effects.bindAdmission(this.health);
    this.peers = new PeerAuthenticator(store, units, this.runLeases, paths.society,
      error => this.cleanupError(error), socket => dependencies.effects.pinPeer(socket));
    this.statusRefresh = dependencies.status;
    const publicPorts = dependencies.public;
    this.publicDispatcher = new PublicDispatcher({ ...publicPorts, limits,
      waitRun: (auth, observe) => {
        if (auth.role !== "resident" || auth.channel !== "actor")
          throw new StoreError("CAPABILITY_DENIED", "wait is a Resident's own run intent");
        const run = this.runLeases.get(auth.actor);
        if (!run) throw new StoreError("STALE_RUN", "wait requires a live run");
        return run.wait(auth.incarnation, observe);
      },
      isDraining: () => this.draining, assertAdmission: () => this.health.assertAdmission(),
      failureAnswer: (id, error) => this.failureAnswer(id, error), refreshViews: () => this.refreshViews(),
      readLogs: (agent, sinceSeconds) => this.readLogs(agent, sinceSeconds) });
    const internalPorts = { ...dependencies.internal, peers: projectInternalPeers(this.peers) };
    this.internalAdmission = { isDraining: () => this.draining, assertAdmission: () => this.health.assertAdmission() };
    this.internalDispatcher = new InternalDispatcher({ ...internalPorts, ...this.internalAdmission,
      failureAnswer: (id, error) => this.failureAnswer(id, error), refreshViews: () => this.refreshViews(),
      openRun: (actor, invocationId) => this.openRun(actor, invocationId) });
    // runner.observe's consumer: the dispatcher keeps the memory-only
    // diagnostic, and the status projection shows its timestamp -- never a
    // receipt, admission input or lifecycle decision.
    this.views.observeRunnerSource(agent => this.internalDispatcher.runnerObservation(agent));
  }
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.health.assertAdmission();
    // P0-8/DR32: the run root is oma's own (`dirname(runRoot)` is oma's, the
    // runtime directory above it is the user's); a damaged leaf is repaired.
    this.dependencies.effects.ensureRunRoot();
    const lockPath = join(this.paths.runRoot, "broker.lock");
    const lock = this.processLock;
    lock.assertHeld(lockPath);
    this.units.bindRunRevoker(actor => this.runLeases.get(actor)?.revoke());
    this.views.refreshWorld();
    this.adminServer = this.listenOn(join(this.paths.runRoot, "admin.sock"), socket => socket.destroy());
    if (this.principalHost !== undefined) this.listenPrincipal(this.principalHost);
    const principalListeners = [this.principalServer, this.principalHostServer]
      .filter((server): server is BrokerListener => server !== null).map(server => this.listeners.ready(server));
    this.starting = Promise.all([this.listeners.ready(this.adminServer),
      ...principalListeners]).then(() => {
      this.health.assertAdmission(); this.running = true;
      // Only now: a host told "ready" can register its session and expect both
      // endpoints to be there.
      this.principalHost?.ready();
      this.publishStatus();
      this.statusTimer = setInterval(() => { this.publishStatus(); }, STATUS_REFRESH_MS);
      this.statusTimer.unref();
      // REC-002, D03: the broker runs the periodic sweep itself, for exactly
      // its own lifetime -- there is no external reconcile unit.
      if (this.reconcile !== null) {
        this.reconcileTimer = setInterval(() => { this.periodicSweep(); }, RECONCILE_INTERVAL_MS);
        this.reconcileTimer.unref();
      }
    });
    // A readiness failure closes admission while the authoritative start
    // Promise still rejects to its lifetime owner.
    void this.starting.catch(error => { this.health.observe(error); this.closeAdmission(); });
    return this.starting;
  }
  notifyReady(): void {
    if (!this.running || this.draining) throw new StoreError("BROKER_UNAVAILABLE", "listeners are not ready");
    this.health.assertAdmission();
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
      bindPeer: (socket: Duplex) => this.bindPeer(socket),
      principalContext: (peer: BoundPeer, live: () => boolean) => this.peers.principalContext(peer, live),
      serveFrames: (socket: Duplex, peer: BoundPeer,
        handle: (raw: Record<string, unknown>, stream: AsyncIterable<Uint8Array> | null) => Promise<object>,
        preflight: (raw: Record<string, unknown>) => void) => this.serveFrames(socket, peer, handle, preflight),
      fail: (socket: Duplex, failure: Failure) => this.fail(socket, failure),
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
        assertInternalAdmission("batch.prepare", this.internalAdmission);
        return this.mail.prepare(auth);
      },
      complete: async (auth, evidence) => {
        assertInternalAdmission("batch.complete", this.internalAdmission);
        await this.mail.complete(auth, evidence);
        this.refreshViews();
      },
      registeredEngine: () => endpoint.registeredEngine,
    });
    this.principalEndpoint = endpoint;
    this.principalHostEndpoint = hostEndpoint;
    this.principalServer = this.listenOn(join(this.paths.runRoot, "principal.sock"), socket => endpoint.serve(socket));
    this.principalHostServer = this.listenOn(join(this.paths.runRoot, "principal-host.sock"), socket => hostEndpoint.serve(socket));
  }
  private listenOn(path: string, serve: (socket: Duplex) => void): BrokerListener {
    this.dependencies.effects.prepareEndpoint(path);
    const { listener: server, prepare } = this.dependencies.effects.openListener(socket => {
      if (this.draining) { socket.destroy(); return; }
      serve(socket);
    });
    this.listeners.listen(server, path, prepare);
    return server;
  }
  private refreshViews(): void {
    try { this.views.refreshWorld(); }
    catch (error) { this.health.observe(error); console.error("world view refresh failed:", error instanceof Error ? error.message : String(error)); }
    this.publishStatus();
  }
  /** A committed materialization supplies a hint, never activation authority.
   * Reconcile reads current ledger/GOAL/desired/incarnation and native status. */
  hintWork(): void { this.periodicSweep(); }

  private async performSweep(): Promise<void> {
    const reconcile = this.reconcile;
    if (reconcile === null || !this.running || this.draining) return;
    try { this.health.assertAdmission(); } catch { return; }
    await reconcile.sweep();
    this.lastSweepFailure = null;
    this.refreshViews();
  }

  /** One active task and one pending hint, regardless of caller count. A hint
   * during a sweep requests one fresh pass after it; the drain owns that task. */
  private periodicSweep(): void {
    const reconcile = this.reconcile;
    if (reconcile === null || !this.running || this.draining) return;
    try { this.health.assertAdmission(); } catch { return; }
    const task = this.sweepWake.request();
    if (this.sweepTask === task) return;
    this.sweepTask = task;
    this.executingTasks.add(task);
    const release = (): void => {
      this.executingTasks.delete(task);
      if (this.sweepTask === task) this.sweepTask = null;
    };
    void task.then(release, (error: unknown) => {
      try {
        this.health.observe(error);
        const code = errorCodeOf(error);
        if (code !== this.lastSweepFailure) console.error(JSON.stringify({ event: "reconcile.sweep", code }));
        this.lastSweepFailure = code;
      } finally { release(); }
    });
  }
  /** TUI-021: unit state changes without a broker transaction, so the status
   * view is also republished on a timer. A failure here is reported and left:
   * the view is derived, and a stale one is visibly stale to its reader.
   * WP23: it is written when the shared refresh answers; nothing waits for it,
   * and no request's outcome depends on it. */
  private publishStatus(): void {
    if (this.draining) return;
    const task = this.statusWake.request();
    if (this.statusTask === task) return;
    this.statusTask = task;
    this.executingTasks.add(task);
    const release = (): void => {
      this.executingTasks.delete(task);
      if (this.statusTask === task) this.statusTask = null;
    };
    void task.then(release, (error: unknown) => {
      try {
        // Derived publication can still reveal corruption; observe it through
        // the same admission owner without changing an accepted outcome.
        this.health.observe(error);
        console.error("status view publish failed:", error instanceof Error ? error.message : String(error));
      } finally { release(); }
    });
  }
  private async performStatusPublication(): Promise<void> {
    const snapshot = await this.statusRefresh.request();
    if (this.draining) return;
    const agents = await this.dependencies.public.views.status(undefined, snapshot);
    if (!this.draining) this.views.publishStatus(snapshot, agents);
  }
  private actorSocketDirectory(actor: Actor, incarnation: number): string {
    const dir = actorSocketDirectoryAt(this.paths.runRoot, actor, incarnation);
    this.dependencies.effects.assertEndpoint(actorSocketPathAt(this.paths.runRoot, actor, incarnation));
    return dir;
  }
  private listenActor(actor: Actor, incarnation = this.store.getAgent(actor)?.incarnation ?? 0): { socketHostPath: string; ready: Promise<void>; done: () => void } {
    this.actorSocketDirectoryAfterAdmission(actor, incarnation);
    const path = actorSocketPathAt(this.paths.runRoot, actor, incarnation);
    // P0-8/DR32: the actor socket directory is oma's own under the run root.
    this.dependencies.effects.ensureActorDirectory(actor, incarnation);
    this.dependencies.effects.prepareEndpoint(path);
    const sockets = new Set<Duplex>(); let revoked = false;
    const { listener: server, prepare } = this.dependencies.effects.openListener(socket => {
      if (revoked || this.draining) return this.fail(socket, { code: "STALE_RUN", message: "run endpoint revoked", retry: "never" });
      sockets.add(socket); socket.once("close", () => sockets.delete(socket));
      this.handleActor(socket, actor, incarnation);
    }, ACTOR_CONNECTIONS);
    // INV10: a Resident reaches only its own actor socket, and every connection
    // costs this process a channel and an OS peer pin. Past the bound the
    // connection is closed before it is handled, so a Resident flooding its
    // socket exhausts its own endpoint, not the broker's descriptors.
    server.on("error", () => {
      const run = this.runLeases.get(actor);
      if (run?.identity.incarnation === incarnation) { try { run.revoke(); } catch (error) { this.cleanupError(error); } }
    });
    this.listeners.listen(server, path, prepare);
    return { socketHostPath: path, ready: this.listeners.ready(server), done: () => {
      if (revoked) return;
      revoked = true;
      for (const socket of sockets) this.fail(socket, { code: "STALE_RUN", message: "run endpoint revoked", retry: "never" });
      this.listeners.close(server);
    } };
  }
  private actorSocketDirectoryAfterAdmission(actor: Actor, incarnation: number): string {
    this.health.assertAdmission(); return this.actorSocketDirectory(actor, incarnation);
  }
  private bindPeer(socket: Duplex): BoundPeer | null { return this.peers.bind(socket); }
  private trustedContext(actor: Actor, peer: BoundPeer, channel: "actor" | "trusted-runner" = "actor"): AuthContext | null {
    return this.peers.context(actor, peer, channel);
  }
  private handleActor(socket: Duplex, actor: Actor, incarnation: number): void {
    let peer: BoundPeer | null = null; let transferred = false;
    try {
      if (this.draining) throw new StoreError("BROKER_UNAVAILABLE", "broker is draining", { details: { reason: "draining" } });
      if (this.store.getAgent(actor)?.incarnation !== incarnation) throw new StoreError("STALE_RUN", "actor incarnation is stale");
      peer = this.bindPeer(socket);
      if (!peer) throw new StoreError("AUTH_FAILED", "no peer credentials");
      const auth = this.trustedContext(actor, peer);
      if (!auth) throw new StoreError("AUTH_FAILED", "execution scope mismatch");
      this.serveFrames(socket, peer, (raw, stream) => this.dispatch(auth, raw as Request, stream), raw => this.preflightPublicStream(auth, raw));
      transferred = true;
    } catch (error) { this.health.observe(error); this.fail(socket, publicFailure(error)); }
    finally { if (!transferred) { try { peer?.releaseConnection(); } catch (error) { this.cleanupError(error); } } }
  }
  /** Only App composition can supply this directly owned socket and kernel
   * pin. No request, UID or pathname can mint an inherited runner grant. */
  attachRunner(socket: Duplex, peer: BoundPeer): void {
    if (this.draining || !this.running || peer.inheritedRunner === undefined) {
      socket.destroy(); peer.releaseConnection();
      throw new StoreError("BROKER_UNAVAILABLE", "runner control owner is not ready");
    }
    socket.once("close", () => {
      try { this.runLeases.get(peer.inheritedRunner!.actor)?.revoke(); }
      catch (error) { this.cleanupError(error); }
    });
    this.serveFrames(socket, peer, (raw, stream) => this.dispatchInternal(raw, peer, stream, "runner"), () => {
      throw new StoreError("INVALID_REQUEST", "runner control does not accept stream bodies");
    }, true);
    socket.resume();
  }
  residentIncarnation(actor: Actor, invocationId: string): number | null {
    const run = this.runLeases.get(actor);
    return run?.invocationId === invocationId ? run.lease?.incarnation ?? null : null;
  }
  private cleanupError(error: unknown): void {
    this.health.observe(error);
    // Best-effort journal: several callers reach this inside an 'error'
    // emit -- the permanent listener in `listen`, the run-revoke path in
    // `listenActor` -- and a dead stderr throwing here escapes that emit as
    // the broker's death, the same death the listener exists to absorb.
    try { console.error("RPC cleanup failed:", error instanceof Error ? error.message : String(error)); }
    catch { /* nowhere left to say it */ }
  }
  private serveFrames(socket: Duplex, peer: BoundPeer,
    handle: (raw: Record<string, unknown>, stream: AsyncIterable<Uint8Array> | null) => Promise<object>,
    preflight: (raw: Record<string, unknown>) => void,
    inheritedControl = false,
  ): void {
    const transport = inheritedControl ? socket : this.dependencies.effects.peerStream(socket, sender => matchesPinnedSender(peer, sender));
    const connection = new RpcConnection({ socket: transport, peer, inheritedControl, limits: this.limits, makeSpool: descriptor => this.dependencies.effects.makeSpool(descriptor),
      handle: async (raw, body) => {
        try { return await handle(raw, body); } catch (error) { this.health.observe(error); throw error; }
      },
      preflight: raw => {
        try {
          preflight(raw);
          if (socket.destroyed || this.draining) throw new StoreError("BROKER_UNAVAILABLE", "stream admission owner closed");
        } catch (error) { this.health.observe(error); throw error; }
      },
      onClosed: () => { this.connections.delete(socket); }, onCleanupError: error => this.cleanupError(error),
      onTask: task => {
        this.executingTasks.add(task);
        void task.then(() => this.executingTasks.delete(task), error => { this.health.observe(error); this.executingTasks.delete(task); });
      },
    });
    this.connections.set(socket, connection);
  }
  private fail(socket: Duplex, error: Failure): void {
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
  private preflightPublicStream(auth: AuthContext, envelope: Record<string, unknown>): void {
    this.publicDispatcher.preflight(auth, envelope);
  }
  private readLogs(agent: string, sinceSeconds: number): Promise<{ text: string; truncated: boolean; observedAtMs: number }> {
    return this.units.readLogs(agent, sinceSeconds, this.limits.logBytes);
  }
  async dispatch(auth: AuthContext, request: Request, stream: AsyncIterable<Uint8Array> | null): Promise<object> {
    return this.publicDispatcher.dispatch(auth, request, stream);
  }
  private dispatchInternal(raw: Record<string, unknown>, peer: BoundPeer, stream: AsyncIterable<Uint8Array> | null, channel: "runner" | "host"): Promise<object> {
    return this.internalDispatcher.dispatch(raw, peer, stream, channel);
  }
  private async openRun(actor: Actor, invocationId: string): Promise<RunLease> {
    this.health.assertAdmission();
    if (!this.store.societyOpen()) throw new StoreError("AGENT_NOT_READY", "society execution is closed");
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
    if (observation.activeState === "unknown" || observation.invocationId !== invocationId || !observation.scope) throw new StoreError("AUTH_FAILED", "runner invocation changed during open");
    if (active?.invocationId === invocationId) {
      if (!active.lease || active.lease.incarnation !== agent.incarnation || !active.matches(observation.scope)) throw new StoreError("STALE_RUN", "run endpoint is revoked, replaced or failed");
      return active.lease;
    }
    const next = agent.incarnation + 1;
    if (!Number.isSafeInteger(next)) throw new StoreError("STORE_CORRUPT", "incarnation exhausted");
    this.actorSocketDirectory(actor, next);
    const record = this.runLeases.begin(actor, next, invocationId, observation.scope);
    let endpoint: ReturnType<Broker["listenActor"]> | null = null;
    try {
      // D01/WP07: settle the prepared batches from their own receipts before the
      // new run exists, under the opening run's quiescence. DR9: the batches
      // left -- receipt proven absent -- are not rewritten; the new lease is
      // simply their next delivery attempt.
      const absent = this.settlePreviousIncarnation(actor);
      // P0V-113 (G03-broker-r2-01): a pathname is not a listening endpoint.
      // Until readiness and commit it serves nobody; neither synchronous nor
      // asynchronous preparation failure consumes an incarnation.
      endpoint = this.listenActor(actor, next);
      await endpoint.ready;
      this.health.assertAdmission();
      const currentUnit = this.units.observe(actor);
      if (this.draining || !this.store.societyOpen() || this.runLeases.get(actor) !== record ||
          currentUnit.activeState === "unknown" || currentUnit.invocationId !== invocationId || !currentUnit.scope)
        throw new StoreError("STALE_RUN", "run admission changed while the endpoint was opening");
      record.confirmOpening(currentUnit.scope);
      this.store.transaction(tx => {
        this.health.assertAdmission();
        const current = this.store.getAgent(actor);
        if (!this.store.societyOpen() || !current || current.incarnation !== agent.incarnation || current.desired !== "enabled") throw new StoreError("STALE_RUN", "run admission changed before incarnation commit");
        const prepared = this.store.preparedBatches(actor).map(row => row.id).sort();
        if (prepared.length !== absent.length || prepared.some((id, index) => id !== absent[index]))
          throw new StoreError("STALE_RUN", "prepared batches changed between settlement and rollover");
        tx.updateIncarnation(actor, next);
      });
      const lease = record.publish(endpoint); this.refreshViews(); return lease;
    } catch (error) {
      try { endpoint?.done(); } catch (cleanup) { this.cleanupError(cleanup); }
      try { record.revoke(); } catch (cleanup) { this.cleanupError(cleanup); }
      throw error;
    }
  }
  /** D01/WP07 rollover boundary. `begin` has proven the previous invocation's
   * scope empty (or this broker's startup quiesced every scope and
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
    this.sweepWake.close(); this.statusWake.close();
    if (this.statusTimer !== null) { clearInterval(this.statusTimer); this.statusTimer = null; }
    if (this.reconcileTimer !== null) { clearInterval(this.reconcileTimer); this.reconcileTimer = null; }
    // Absence is the truthful status of a broker that is going away; an old
    // file left behind would read as a broker that is merely quiet.
    try { this.dependencies.effects.removeStatusView(); }
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
    this.listeners.closeAll();
  }
  drainAndClose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closeAdmission();
    this.closing = (async () => {
      await settleWithin([...(this.starting ? [this.starting] : []), ...this.executingTasks, ...this.listeners.pendingCloses], this.limits.receiptWaitSeconds);
      // Stop what nothing else will stop while the incarnations that prove
      // each death are still readable. A failure is no reason to leave the
      // Store and lock held -- P0V-58, P0-5: nor is it a drain that finished.
      // A Resident whose end was not proven may still run, so the drain ends
      // with that failure once everything this broker holds is given back.
      let unproven: { readonly error: unknown } | null = null;
      try { await this.paths.quiesceOnDrain?.(); } catch (error) { this.cleanupError(error); unproven = { error }; }
      // No Store or pinned lease closes before all dispatched task owners settle.
      try { this.runLeases.close(); } catch (error) { this.cleanupError(error); }
      this.dependencies.effects.closeLedger();
      if (unproven !== null) throw unproven.error;
    })();
    return this.closing;
  }
}
