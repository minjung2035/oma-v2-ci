// MUST [AUTH-001..003]/[IPC-*]/[REC-007]: broker core and authenticated listeners.
import { createServer, type Socket } from "node:net";
import { openSync, mkdirSync, unlinkSync, existsSync, readFileSync, closeSync, readdirSync, fstatSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { Actor, AuthContext, BoundaryEvidence, Capability, Failure, ProtocolLimits, Request, RunLease } from "../implementation/contracts.js";
import { Store } from "./store.js";
import { StoreError, publicFailure } from "./domain/errors.js";
import { receiptOfOperation, receiptNotFound } from "./protocol/receipts.js";
import { isValidRequestKey } from "./ids.js";
import { actorSocketDirectoryAt, actorSocketPathAt } from "./storage/paths.js";
import { encodeFrame } from "./frame.js";
import { RpcConnection, NODE_ALARMS } from "./broker/connection.js";
import { SharedPeerPin, type ConnectionPeerPin } from "./broker/peer-pin.js";
import { MailModule } from "./mail.js";
import { UnitsModule, unitName } from "./units.js";
import { peerCred, peerPidFd, peerPidAlive, type PeerCred, tryFlock, sdNotifyReady } from "./leaf.js";
import { LifecycleModule } from "./lifecycle.js";
import { GitModule } from "./git.js";
import { ReconcileModule } from "./reconcile.js";
import { ViewsModule } from "./views.js";
import { capabilitiesOf, resolvedSpecOf } from "./authority.js";
import { PUBLIC_METHODS, INTERNAL_METHODS, isPublicMethod, isInternalMethod, decodePublicParams } from "./protocol/methods.js";

export interface BrokerPaths { stateRoot: string; runRoot: string; society: string; hasGoal?: () => boolean }
const DEFAULT_LIMITS: ProtocolLimits = {
  frameBytes: 256 * 1024, mailBodyBytes: 256 * 1024, subjectBytes: 512, addresses: 64,
  replyReferences: 64, contextFiles: 256, contextBytes: 8 * 1024 * 1024,
  bundleBytes: 256 * 1024 * 1024, logBytes: 1024 * 1024, batchMaxMessages: 24,
  idleStreamSeconds: 30, receiptWaitSeconds: 30,
};
export function boundedLogOutput(bytes: Buffer, maxBytes: number, forcedTruncated = false): { text: string; truncated: boolean } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new StoreError("INTERNAL_ERROR", "invalid log byte limit");
  const prefix = bytes.subarray(0, Math.min(bytes.length, maxBytes));
  let text = prefix.toString("utf8");
  let truncated = forcedTruncated || bytes.length > maxBytes;
  while (Buffer.byteLength(text, "utf8") > maxBytes && text.length > 0) { text = text.slice(0, -1); truncated = true; }
  return { text, truncated };
}
export function peerCgroup(pid: number): string | null {
  try {
    const line = readFileSync(`/proc/${pid}/cgroup`, "utf8").split("\n").find(Boolean);
    if (!line) return null;
    const index = line.lastIndexOf(":");
    return index < 0 ? null : line.slice(index + 1);
  } catch { return null; }
}
function socketFd(socket: Socket): number {
  const handle = (socket as unknown as { _handle?: { fd?: number } })._handle;
  const fd = handle?.fd;
  if (typeof fd !== "number" || fd < 0) throw new StoreError("AUTH_FAILED", "no socket fd");
  return fd;
}
type BoundPeer = PeerCred & ConnectionPeerPin;

export class Broker {
  private adminServer: ReturnType<typeof createServer> | null = null;
  private hostServer: ReturnType<typeof createServer> | null = null;
  private actorServers = new Set<ReturnType<typeof createServer>>();
  private readonly connections = new Map<Socket, RpcConnection>();
  private readonly executingTasks = new Set<Promise<void>>();
  private lockFd: number | null = null;
  private running = false;
  private runLeases = new Map<Actor, { invocationId: string; cgroupFd: number; lease: RunLease | null; revoke: () => void; done: () => void }>();
  constructor(
    private readonly store: Store, private readonly mail: MailModule, private readonly units: UnitsModule,
    private readonly views: ViewsModule, private readonly lifecycle: LifecycleModule,
    private readonly git: GitModule | null, private readonly reconcile: ReconcileModule | null,
    private readonly paths: BrokerPaths, private readonly limits: ProtocolLimits = DEFAULT_LIMITS,
  ) {}
  start(): void {
    if (this.running) return;
    mkdirSync(this.paths.runRoot, { recursive: true });
    this.lockFd = openSync(join(this.paths.runRoot, "broker.lock"), "w", 0o600);
    if (!tryFlock(this.lockFd)) {
      closeSync(this.lockFd); this.lockFd = null;
      throw new StoreError("BROKER_UNAVAILABLE", "another broker holds the society lock");
    }
    this.units.onRevokeRun = actor => this.runLeases.get(actor)?.revoke();
    this.views.refreshWorld();
    this.adminServer = this.listenInternal(join(this.paths.runRoot, "admin.sock"), "runner");
    this.hostServer = this.listenInternal(join(this.paths.runRoot, "host.sock"), "host");
    this.running = true;
  }
  notifyReady(): boolean { return sdNotifyReady(process.env.NOTIFY_SOCKET ?? ""); }
  private listenInternal(path: string, channel: "runner" | "host"): ReturnType<typeof createServer> {
    if (existsSync(path)) unlinkSync(path);
    const server = createServer({ allowHalfOpen: true }, socket => this.handleInternal(socket, channel));
    server.listen(path); return server;
  }
  private refreshViews(): void {
    try { this.views.refreshWorld(); }
    catch (error) { console.error("world view refresh failed:", error instanceof Error ? error.message : String(error)); }
  }
  private actorSocketDirectory(actor: Actor, incarnation: number): string {
    const dir = actorSocketDirectoryAt(this.paths.runRoot, actor, incarnation);
    if (Buffer.byteLength(actorSocketPathAt(this.paths.runRoot, actor, incarnation)) > 107)
      throw new StoreError("UNSUPPORTED_PROFILE", "actor socket path exceeds Linux sun_path");
    return dir;
  }
  private listenActor(actor: Actor, incarnation = this.store.getAgent(actor)?.incarnation ?? 0): { socketHostPath: string; done: () => void } {
    const dir = this.actorSocketDirectory(actor, incarnation);
    const path = actorSocketPathAt(this.paths.runRoot, actor, incarnation);
    mkdirSync(dir, { recursive: true });
    if (existsSync(path)) unlinkSync(path);
    const sockets = new Set<Socket>();
    let revoked = false;
    const server = createServer({ allowHalfOpen: true }, socket => {
      if (revoked) return this.fail(socket, { code: "STALE_RUN", message: "run endpoint revoked", retry: "never" });
      sockets.add(socket); socket.once("close", () => sockets.delete(socket));
      this.handleActor(socket, actor, incarnation);
    });
    server.once("error", () => {
      const run = this.runLeases.get(actor);
      if (run?.lease?.incarnation === incarnation) run.revoke();
    });
    server.listen(path); this.actorServers.add(server);
    return { socketHostPath: path, done: () => {
      if (revoked) return;
      revoked = true;
      for (const socket of sockets) this.fail(socket, { code: "STALE_RUN", message: "run endpoint revoked", retry: "never" });
      this.actorServers.delete(server); server.close();
    } };
  }
  private bindPeer(socket: Socket): BoundPeer | null {
    const fd = socketFd(socket);
    const credentials = peerCred(fd);
    if (!credentials) return null;
    const pinned = peerPidFd(fd);
    if (pinned === null) return null;
    const owner = new SharedPeerPin(() => peerPidAlive(pinned), () => closeSync(pinned));
    if (!owner.alive()) { owner.releaseConnection(); return null; }
    return { ...credentials, alive: () => owner.alive(),
      retainForExecution: () => owner.retainForExecution(), releaseConnection: () => owner.releaseConnection() };
  }
  private handleActor(socket: Socket, actor: Actor, incarnation: number): void {
    let peer: BoundPeer | null = null;
    let transferred = false;
    try {
      if (this.store.getAgent(actor)?.incarnation !== incarnation) throw new StoreError("STALE_RUN", "actor incarnation is stale");
      peer = this.bindPeer(socket);
      if (!peer) throw new StoreError("AUTH_FAILED", "no peer credentials");
      const auth = this.trustedContext(actor, peer);
      if (!auth) throw new StoreError("AUTH_FAILED", "cgroup mismatch");
      this.serveFrames(socket, peer, (raw, stream) => this.dispatch(auth, raw as Request, stream), raw => this.preflightPublicStream(auth, raw));
      transferred = true;
    } catch (error) { this.fail(socket, publicFailure(error)); }
    finally { if (!transferred) { try { peer?.releaseConnection(); } catch (error) { this.cleanupError(error); } } }
  }
  private trustedContext(actor: Actor, credentials: BoundPeer): AuthContext | null {
    const agent = this.store.getAgent(actor);
    if (!agent || credentials.uid !== (process.getuid?.() ?? -1)) return null;
    const run = this.runLeases.get(actor);
    if (!run?.lease || run.lease.incarnation !== agent.incarnation) return null;
    const observed = this.units.observe(actor);
    if (observed.invocationId !== run.invocationId) return null;
    const unitCgroup = observed.cgroup;
    const peerGroup = peerCgroup(credentials.pid);
    if (!unitCgroup || !peerGroup) return null;
    const prefix = unitCgroup.endsWith("/") ? unitCgroup : `${unitCgroup}/`;
    if (peerGroup !== unitCgroup && !peerGroup.startsWith(prefix)) return null;
    try {
      const pinned = fstatSync(run.cgroupFd, { bigint: true });
      const current = statSync(join("/sys/fs/cgroup", unitCgroup), { bigint: true });
      if (!pinned.isDirectory() || pinned.dev !== current.dev || pinned.ino !== current.ino) return null;
    } catch { return null; }
    if (!credentials.alive()) return null;
    const lease = run.lease;
    const granted = capabilitiesOf(agent);
    const currentCapabilities = () => credentials.alive() && this.runLeases.get(actor) === run && run.lease === lease ? granted : new Set<Capability>();
    return { actor, incarnation: agent.incarnation, role: agent.role, channel: "actor",
      get capabilities() { return currentCapabilities(); },
      peer: { pid: credentials.pid, uid: credentials.uid, gid: credentials.gid, cgroup: peerGroup } };
  }
  private handleInternal(socket: Socket, channel: "runner" | "host"): void {
    let peer: BoundPeer | null = null;
    let transferred = false;
    try {
      peer = this.bindPeer(socket);
      if (!peer || peer.uid !== (process.getuid?.() ?? -1)) throw new StoreError("AUTH_FAILED", "invalid internal peer credentials");
      const credentials = peer;
      this.serveFrames(socket, peer, (raw, stream) => this.dispatchInternal(raw, credentials, stream, channel), () => {
        throw new StoreError("INVALID_REQUEST", "internal methods do not accept raw stream bodies");
      });
      transferred = true;
    } catch (error) { this.fail(socket, publicFailure(error)); }
    finally { if (!transferred) { try { peer?.releaseConnection(); } catch (error) { this.cleanupError(error); } } }
  }
  private cleanupError(error: unknown): void {
    console.error("RPC cleanup failed:", error instanceof Error ? error.message : String(error));
  }
  private serveFrames(socket: Socket, peer: BoundPeer,
    handle: (raw: Record<string, unknown>, stream: AsyncIterable<Uint8Array> | null) => Promise<object>,
    preflight: (raw: Record<string, unknown>) => void,
  ): void {
    const connection = new RpcConnection({ socket, peer, limits: this.limits,
      stagingRoot: join(this.paths.stateRoot, "staging"), handle, preflight,
      onClosed: () => this.connections.delete(socket), onCleanupError: error => this.cleanupError(error),
      onTask: task => {
        this.executingTasks.add(task);
        void task.then(() => this.executingTasks.delete(task), () => this.executingTasks.delete(task));
      },
    });
    this.connections.set(socket, connection);
  }
  private fail(socket: Socket, error: Failure): void {
    const connection = this.connections.get(socket);
    if (connection) { connection.reject(new StoreError(error.code, error.message)); return; }
    if (socket.destroyed) return;
    // Even authentication failures own their bounded final write and deadline.
    const alarm = NODE_ALARMS.after(this.limits.idleStreamSeconds, () => socket.destroy());
    socket.once("close", () => alarm.cancel());
    socket.once("error", () => socket.destroy());
    try {
      const frame = encodeFrame(Broker.errorAnswer("x", error));
      if (frame.length > Math.min(this.limits.frameBytes, 0xffffffff) + 4) socket.destroy();
      else socket.end(frame);
    } catch { socket.destroy(); }
  }
  static errorAnswer(id: string, error: { code: string; message: string; retry: "never" | "same-key" | "after-repair" }): object { return { v: 1, id, ok: false, error }; }
  static okAnswer(id: string, result: unknown): object { return { v: 1, id, ok: true, result }; }
  private checkParams(method: string, rawParams: unknown): Record<string, unknown> | null {
    if (!isPublicMethod(method)) return null;
    return decodePublicParams(method, rawParams, { actorNames: new Set(this.store.listAgents().map(agent => agent.name)), limits: this.limits }) as Record<string, unknown> | null;
  }
  private preflightPublicStream(auth: AuthContext, envelope: Record<string, unknown>): void {
    const method = typeof envelope.method === "string" ? envelope.method : "";
    if (typeof envelope.id !== "string" || typeof envelope.method !== "string" || !Object.keys(envelope).every(key => ["v", "id", "method", "params", "request"].includes(key)))
      throw new StoreError("INVALID_REQUEST", "invalid request envelope");
    if (envelope.v !== 1) throw new StoreError("UNSUPPORTED_VERSION", "unsupported protocol version");
    if (!isPublicMethod(method) || PUBLIC_METHODS[method].stream === "none") throw new StoreError("INVALID_REQUEST", "method does not accept a stream body");
    const descriptor = PUBLIC_METHODS[method];
    if (descriptor.key === "required" && !isValidRequestKey(envelope.request)) throw new StoreError("INVALID_REQUEST", "mutation requires a valid request key");
    const actor = this.store.getAgent(auth.actor);
    if (auth.channel === "actor" && (actor?.incarnation !== auth.incarnation || actor.desired !== "enabled")) throw new StoreError("STALE_RUN", "actor incarnation is stale");
    const need = descriptor.capability;
    if (need && (!auth.capabilities.has(need) || !actor || !capabilitiesOf(actor).has(need))) throw new StoreError("CAPABILITY_DENIED", `missing capability ${need}`);
    if (!this.checkParams(method, envelope.params)) throw new StoreError("INVALID_REQUEST", `invalid params for ${method}`);
  }
  private readLogs(agent: string, sinceSeconds: number): Promise<{ text: string; truncated: boolean; observedAtMs: number }> {
    const service = unitName(this.paths.society, agent, "service");
    return new Promise((resolve, reject) => {
      const child = spawn("journalctl", ["--user", "--unit", service, "--since", `${sinceSeconds}s ago`, "--no-pager", "--output=cat"], { stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = []; const stderrChunks: Buffer[] = [];
      let total = 0; let stderrTotal = 0; let truncated = false; let timedOut = false; let spawnError: Error | null = null;
      const limit = this.limits.logBytes; const diagnosticLimit = 16 * 1024;
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 30000);
      child.stdout.on("data", (chunk: Buffer) => {
        if (truncated) return;
        const part = Buffer.from(chunk); const remaining = Math.max(0, limit - total);
        if (part.length <= remaining) { chunks.push(part); total += part.length; return; }
        if (remaining > 0) { chunks.push(part.subarray(0, remaining)); total += remaining; }
        truncated = true; child.kill("SIGKILL");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const part = Buffer.from(chunk); const remaining = Math.max(0, diagnosticLimit - stderrTotal);
        if (remaining > 0) { const keep = part.subarray(0, remaining); stderrChunks.push(keep); stderrTotal += keep.length; }
      });
      child.once("error", error => { spawnError = error; });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (timedOut) { reject(new StoreError("DEADLINE_EXCEEDED", "journalctl timed out")); return; }
        if (spawnError) { reject(new StoreError("INTERNAL_ERROR", `journalctl spawn failed: ${spawnError.message}`)); return; }
        const output = boundedLogOutput(Buffer.concat(chunks, total), limit, truncated);
        if (truncated) { resolve({ ...output, observedAtMs: Date.now() }); return; }
        if (signal || code !== 0) {
          const stderr = Buffer.concat(stderrChunks, stderrTotal).toString("utf8");
          reject(new StoreError("INTERNAL_ERROR", `journalctl exited unsuccessfully: ${stderr.slice(0, 300)}`)); return;
        }
        resolve({ ...output, observedAtMs: Date.now() });
      });
    });
  }
  async dispatch(auth: AuthContext, request: Request, stream: AsyncIterable<Uint8Array> | null): Promise<object> {
    const envelope = request as unknown as Record<string, unknown>;
    const id = typeof envelope.id === "string" ? envelope.id : "x";
    const method = typeof envelope.method === "string" ? envelope.method : "";
    if (typeof envelope.id !== "string" || typeof envelope.method !== "string" || !Object.keys(envelope).every(key => ["v", "id", "method", "params", "request"].includes(key)))
      return Broker.errorAnswer(id, { code: "INVALID_REQUEST", message: "invalid request envelope", retry: "never" });
    const actor = this.store.getAgent(auth.actor);
    if (auth.channel === "actor" && (actor?.incarnation !== auth.incarnation || actor.desired !== "enabled")) return Broker.errorAnswer(id, { code: "STALE_RUN", message: "actor incarnation is stale", retry: "never" });
    if (envelope.v !== 1) return Broker.errorAnswer(id, { code: "UNSUPPORTED_VERSION", message: "unsupported protocol version", retry: "never" });
    if (!isPublicMethod(method)) return Broker.errorAnswer(id, { code: "UNKNOWN_METHOD", message: `unknown method ${method}`, retry: "never" });
    const descriptor = PUBLIC_METHODS[method];
    if (descriptor.key === "required" && !isValidRequestKey(envelope.request)) return Broker.errorAnswer(id, { code: "INVALID_REQUEST", message: "mutation requires a valid request key", retry: "never" });
    if (descriptor.key === "forbidden" && Object.prototype.hasOwnProperty.call(envelope, "request")) return Broker.errorAnswer(id, { code: "INVALID_REQUEST", message: "read/ephemeral requests forbid a top-level request key", retry: "never" });
    const need = descriptor.capability;
    if (need && (!auth.capabilities.has(need) || !actor || !capabilitiesOf(actor).has(need))) return Broker.errorAnswer(id, { code: "CAPABILITY_DENIED", message: `missing capability ${need}`, retry: "never" });
    const params = this.checkParams(method, envelope.params);
    if (!params) return Broker.errorAnswer(id, { code: "INVALID_REQUEST", message: `invalid params for ${method}`, retry: "never" });
    if (stream && (descriptor.stream === "none" || (descriptor.stream === "optional-bundle" && !Object.hasOwn(params, "bundle")))) return Broker.errorAnswer(id, { code: "INVALID_REQUEST", message: "method does not accept this stream body", retry: "never" });
    try {
      switch (method) {
        case "status.get": {
          const observe = (agent: string) => { const value = this.units.observe(agent); return { activeState: value.activeState, subState: value.subState, result: value.result, execMainStatus: value.execMainStatus }; };
          return Broker.okAnswer(id, this.views.status((params as { agent?: string }).agent, observe));
        }
        case "operation.get": {
          const operation = this.store.getOperation(auth.actor, (params as { key: string }).key);
          return Broker.okAnswer(id, operation ? receiptOfOperation(operation) : receiptNotFound);
        }
        case "mail.send": {
          const mail = params as unknown as import("../implementation/contracts.js").MailInput;
          if (mail.approvalFor && !this.store.getOperation(auth.actor, keyOf(request)) && !this.git?.isPublished(mail.approvalFor.candidate)) throw new StoreError("CANDIDATE_NOT_PUBLISHED", "approval request requires a published candidate");
          return Broker.okAnswer(id, await this.mail.send(auth, keyOf(request), mail));
        }
        case "mail.ack": return Broker.okAnswer(id, this.lifecycle.ack(auth, (params as { message: string }).message, keyOf(request)));
        case "route.follow": return Broker.okAnswer(id, this.lifecycle.follow(auth, (params as { topic: string }).topic, true, keyOf(request)));
        case "route.unfollow": return Broker.okAnswer(id, this.lifecycle.follow(auth, (params as { topic: string }).topic, false, keyOf(request)));
        case "agent.start": return Broker.okAnswer(id, this.lifecycle.start(auth, (params as { agent: string }).agent, keyOf(request)));
        case "agent.stop": return Broker.okAnswer(id, this.lifecycle.stop(auth, (params as { agent: string }).agent, keyOf(request)));
        case "agent.create": return Broker.okAnswer(id, await this.lifecycle.create(auth, params as never, keyOf(request)));
        case "agent.continue": return Broker.okAnswer(id, await this.mail.send(auth, keyOf(request), { to: [auth.actor], subject: "continue", kind: "message", body: (params as { note: string }).note }, { kind: "agent.continue", params: { note: (params as { note: string }).note } }));
        case "agent.wait": return Broker.okAnswer(id, { accepted: true });
        case "git.known": {
          if (!this.git) throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          const refs = this.git.knownRefs();
          return Broker.okAnswer(id, { hasCandidate: refs.published.includes((params as { candidate: string }).candidate), prerequisites: [...refs.published] });
        }
        case "git.submit": {
          if (!this.git) throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          return Broker.okAnswer(id, await this.git.submit(auth, keyOf(request), params as never, stream ?? emptyStream()));
        }
        case "git.integrate": {
          if (!this.git) throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          const input = params as { candidate: string; expected: string };
          return Broker.okAnswer(id, await this.git.integrate(auth, keyOf(request), { candidate: input.candidate, expected: input.expected }));
        }
        case "context.publish": {
          if (!this.git) throw new StoreError("SPIKE_UNRESOLVED", "context module unavailable");
          return Broker.okAnswer(id, await this.git.publishContext(auth, keyOf(request), params as never, stream ?? emptyStream()));
        }
        case "logs.read": { const input = params as { agent: string; sinceSeconds: number }; return Broker.okAnswer(id, await this.readLogs(input.agent, input.sinceSeconds)); }
        default: return Broker.errorAnswer(id, { code: "UNKNOWN_METHOD", message: `unhandled method ${method}`, retry: "never" });
      }
    } catch (error) { return Broker.errorAnswer(id, publicFailure(error)); }
    finally { if (descriptor.mode === "mutation") this.refreshViews(); }
  }
  private requireRunnerUnit(peer: BoundPeer, agent: Actor, invocationId?: string): void {
    const unit = unitName(this.paths.society, agent, "service");
    const observed = this.units.observe(agent);
    const peerGroup = peerCgroup(peer.pid);
    const prefix = observed.cgroup?.endsWith("/") ? observed.cgroup : `${observed.cgroup}/`;
    if (!peer.alive() || !observed.cgroup || !peerGroup || (peerGroup !== observed.cgroup && !peerGroup.startsWith(prefix)) || (invocationId !== undefined && observed.invocationId !== invocationId)) throw new StoreError("AUTH_FAILED", `caller is not the current ${unit} invocation`);
  }
  private requireHostUnit(peer: BoundPeer, kind: "principal-relay" | "reconcile"): void {
    const unitGroup = this.units.unitCgroup(kind);
    const peerGroup = peerCgroup(peer.pid);
    const prefix = unitGroup.endsWith("/") ? unitGroup : `${unitGroup}/`;
    if (!peer.alive() || !unitGroup || !peerGroup || (peerGroup !== unitGroup && !peerGroup.startsWith(prefix))) throw new StoreError("AUTH_FAILED", `caller is not inside the ${kind} service`);
  }
  private runnerActor(peer: BoundPeer): Actor {
    const peerGroup = peerCgroup(peer.pid);
    if (!peerGroup) throw new StoreError("AUTH_FAILED", "runner cgroup unavailable");
    const matches: Actor[] = [];
    for (const row of this.store.listAgents()) {
      if (row.role !== "resident" || row.desired === "retired") continue;
      const unitGroup = this.units.observe(row.name).cgroup;
      if (!unitGroup) continue;
      const prefix = unitGroup.endsWith("/") ? unitGroup : `${unitGroup}/`;
      if (peerGroup === unitGroup || peerGroup.startsWith(prefix)) matches.push(row.name);
    }
    if (matches.length !== 1 || !peer.alive()) throw new StoreError("AUTH_FAILED", "runner cgroup identity is ambiguous");
    return matches[0]!;
  }
  private async dispatchInternal(raw: Record<string, unknown>, peer: BoundPeer, stream: AsyncIterable<Uint8Array> | null, channel: "runner" | "host"): Promise<object> {
    const id = typeof raw.id === "string" ? raw.id : "x";
    const method = typeof raw.method === "string" ? raw.method : "";
    const paramsRaw = raw.params;
    if (raw.v !== 1 || typeof raw.id !== "string" || typeof raw.method !== "string" || typeof paramsRaw !== "object" || paramsRaw === null || Array.isArray(paramsRaw) || !Object.keys(raw).every(key => ["v", "id", "method", "params"].includes(key))) return Broker.errorAnswer(id, { code: "INVALID_REQUEST", message: "invalid internal envelope", retry: "never" });
    const params = paramsRaw as Record<string, unknown>;
    try {
      if (!isInternalMethod(method)) throw new StoreError("UNKNOWN_METHOD", `internal ${method}`);
      const descriptor = INTERNAL_METHODS[method];
      if (descriptor.channel !== channel) throw new StoreError("AUTH_FAILED", `method ${method} is not allowed on ${channel} channel`);
      if (stream) throw new StoreError("INVALID_REQUEST", "internal methods do not accept stream bodies");
      const invalid = descriptor.paramsCheck(params);
      if (invalid) throw new StoreError("INVALID_REQUEST", `${method}: ${invalid}`);
      switch (method) {
        case "runner.open": {
          const input = params as { agent: string; invocationId: string };
          this.requireRunnerUnit(peer, input.agent, input.invocationId);
          return Broker.okAnswer(id, this.openRun(input.agent, input.invocationId));
        }
        case "runner.pending": {
          const agent = this.runnerActor(peer); this.runnerAuth(agent, this.store.getAgent(agent)!.incarnation);
          return Broker.okAnswer(id, { pending: this.store.pendingDeliveries(agent).length, recoverableBatchIds: this.store.preparedBatches(agent).map(batch => batch.id) });
        }
        case "runner.observe": {
          const agent = this.runnerActor(peer); this.runnerAuth(agent, this.store.getAgent(agent)!.incarnation);
          throw new StoreError("SPIKE_UNRESOLVED", "S-03 observation adapter is not pinned");
        }
        case "batch.prepare": {
          const agent = this.runnerActor(peer); const row = this.store.getAgent(agent);
          if (!row) throw new StoreError("AUTH_FAILED", "runner identity missing");
          return Broker.okAnswer(id, await this.mail.prepare(this.runnerAuth(agent, row.incarnation)));
        }
        case "batch.complete": {
          const evidence = params as unknown as BoundaryEvidence;
          const batch = this.store.getBatch(evidence.batchId);
          if (!batch) throw new StoreError("BATCH_CONFLICT", `unknown batch ${evidence.batchId}`);
          const agent = batch.agent; this.requireRunnerUnit(peer, agent); const row = this.store.getAgent(agent);
          if (!row || row.incarnation !== evidence.incarnation) throw new StoreError("BATCH_CONFLICT", "runner incarnation mismatch");
          await this.mail.complete(this.runnerAuth(agent, row.incarnation), evidence);
          return Broker.okAnswer(id, { completed: true });
        }
        case "host.principalRelay": {
          this.requireHostUnit(peer, "principal-relay");
          const principal = this.store.getAgent("principal");
          if (!principal) return Broker.okAnswer(id, { moved: 0, pending: 0 });
          const newFiles = readdirSync(join(this.paths.stateRoot, "mail", "inboxes", "principal", "new"));
          return Broker.okAnswer(id, { moved: this.mail.moveToCur("principal", newFiles), pending: this.store.pendingDeliveries("principal").length });
        }
        case "host.reconcile": {
          this.requireHostUnit(peer, "reconcile");
          const report = this.reconcile ? await this.reconcile.sweep() : await this.mail.reconcilePending();
          this.refreshViews(); return Broker.okAnswer(id, report);
        }
        default: return Broker.errorAnswer(id, { code: "UNKNOWN_METHOD", message: `internal ${method}`, retry: "never" });
      }
    } catch (error) { return Broker.errorAnswer(id, publicFailure(error)); }
  }
  private runnerAuth(agent: Actor, incarnation: number): AuthContext {
    const row = this.store.getAgent(agent);
    const run = this.runLeases.get(agent);
    if (!row || row.desired !== "enabled" || !run?.lease || run.lease.incarnation !== incarnation || row.incarnation !== incarnation || this.units.observe(agent).invocationId !== run.invocationId) throw new StoreError("STALE_RUN", "runner has no current live lease");
    return { actor: agent, incarnation, role: row.role, channel: "trusted-runner", capabilities: capabilitiesOf(row), peer: { pid: 0, uid: -1, gid: -1, cgroup: null } };
  }
  private openRun(actor: Actor, invocationId: string): RunLease {
    const agent = this.store.getAgent(actor);
    if (!agent) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${actor}`);
    resolvedSpecOf(agent);
    if (agent.desired === "provisioning") throw new StoreError("AGENT_NOT_READY", `${actor} is provisioning`);
    if (agent.desired === "stopped") throw new StoreError("STALE_RUN", `${actor} is stopped`);
    if (agent.desired === "retired") throw new StoreError("AGENT_RETIRED", `${actor} is retired`);
    const hasGoal = this.paths.hasGoal?.() ?? existsSync(join(this.paths.stateRoot, "world", "context", "current"));
    if (!hasGoal) throw new StoreError("GOAL_REQUIRED", "shared GOAL not published yet");
    const active = this.runLeases.get(actor);
    if (active?.invocationId === invocationId) {
      if (!active.lease) throw new StoreError("STALE_RUN", "run endpoint is revoked or failed");
      return active.lease;
    }
    if (active) {
      let dead = false;
      try { dead = /^populated 0$/m.test(readFileSync(`/proc/self/fd/${active.cgroupFd}/cgroup.events`, "utf8")); }
      catch (error) { dead = (error as NodeJS.ErrnoException).code === "ENOENT"; }
      if (!dead) throw new StoreError("RUN_TERMINATION_UNKNOWN", "previous invocation cgroup is not proven empty");
    }
    const observation = this.units.observe(actor);
    if (observation.invocationId !== invocationId || !observation.cgroup) throw new StoreError("AUTH_FAILED", "runner invocation changed during open");
    const cgroupFd = openSync(join("/sys/fs/cgroup", observation.cgroup), "r");
    try {
      if (!/^populated 1$/m.test(readFileSync(`/proc/self/fd/${cgroupFd}/cgroup.events`, "utf8"))) throw new StoreError("AUTH_FAILED", "current runner cgroup is not populated");
      active?.done(); this.runLeases.delete(actor);
      const next = agent.incarnation + 1;
      if (!Number.isSafeInteger(next)) throw new StoreError("STORE_CORRUPT", "incarnation exhausted");
      this.actorSocketDirectory(actor, next);
      this.store.transaction(tx => { tx.updateAgent({ name: actor, incarnation: next }); tx.reassignPreparedBatches(actor, next); });
      let listener: ReturnType<Broker["listenActor"]> | undefined;
      let closed = false;
      const record = {
        invocationId, cgroupFd, lease: null as RunLease | null,
        revoke: () => { record.lease = null; listener?.done(); },
        done: () => { if (closed) return; closed = true; try { record.revoke(); } finally { closeSync(cgroupFd); } },
      };
      this.runLeases.set(actor, record); listener = this.listenActor(actor, next);
      record.lease = { actor, incarnation: next, socketHostPath: listener.socketHostPath };
      this.refreshViews(); return record.lease;
    } catch (error) { if (this.runLeases.get(actor)?.cgroupFd !== cgroupFd) closeSync(cgroupFd); throw error; }
  }
  drainAndClose(): void {
    this.adminServer?.close(); this.hostServer?.close();
    for (const run of this.runLeases.values()) run.done();
    for (const connection of this.connections.values()) connection.close();
    for (const server of this.actorServers) { try { server.close(); } catch { /* already closed */ } }
    this.actorServers.clear(); this.runLeases.clear(); this.store.close();
    if (this.lockFd !== null) { try { closeSync(this.lockFd); } catch { /* already closed */ } this.lockFd = null; }
  }
}
function emptyStream(): AsyncIterable<Uint8Array> { return (async function* () {})(); }
function keyOf(request: { request?: string }): string {
  if (!isValidRequestKey(request.request)) throw new StoreError("INVALID_REQUEST", "mutation requires a request key");
  return request.request;
}
