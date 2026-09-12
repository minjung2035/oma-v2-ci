// MUST [AUTH-001..003]/[IPC-*]/[REC-007]: broker core — singleton lock, actor
// listener auth (SO_PEERCRED + cgroup), public dispatch, runner channel.
import { createServer, type Socket } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  createReadStream,
  openSync,
  mkdirSync,
  unlinkSync,
  existsSync,
  readFileSync,
  closeSync,
  readdirSync,
  fstatSync,
  statSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import { join } from "node:path";
import type {
  Actor,
  AuthContext,
  BoundaryEvidence,
  Capability,
  PublicMethod,
  InternalMethods,
  ProtocolLimits,
  Request,
  Receipt,
  RunLease,
} from "../implementation/contracts.js";
import { Store, StoreError } from "./store.js";
import { isValidActorName, isValidRequestKey, parseBatchId } from "./ids.js";
import { actorSocketDirectoryAt, actorSocketPathAt } from "./storage/paths.js";
import { ConnectionDecoder, encodeFrame } from "./frame.js";
import { spawnSync, spawn } from "node:child_process";
import { MailModule } from "./mail.js";
import { UnitsModule, unitName } from "./units.js";
import { peerCred, peerPidFd, peerPidAlive, type PeerCred, tryFlock, sdNotifyReady } from "./leaf.js";
import { LifecycleModule } from "./lifecycle.js";
import { GitModule } from "./git.js";
import { ReconcileModule } from "./reconcile.js";
import { ViewsModule } from "./views.js";
import { capabilitiesOf, resolvedSpecOf } from "./authority.js";
import {
  agentActionParamsCheck,
  agentContinueParamsCheck,
  agentCreateParamsCheck,
  agentWaitParamsCheck,
  contextPublishParamsCheck,
  gitIntegrateParamsCheck,
  gitSubmitParamsCheck,
  logsReadParamsCheck,
  mailAckParamsCheck,
  mailParamsCheck,
  operationGetParamsCheck,
  operationResultCheck,
  routeParamsCheck,
  statusGetParamsCheck,
  checkObject,
  checkOid,
} from "./validate.js";

export interface BrokerPaths {
  stateRoot: string;
  runRoot: string;
  society: string;
  hasGoal?: () => boolean;
}

const DEFAULT_LIMITS: ProtocolLimits = {
  frameBytes: 256 * 1024,
  mailBodyBytes: 256 * 1024,
  subjectBytes: 512,
  addresses: 64,
  replyReferences: 64,
  contextFiles: 256,
  contextBytes: 8 * 1024 * 1024,
  bundleBytes: 256 * 1024 * 1024,
  logBytes: 1024 * 1024,
  batchMaxMessages: 24,
  idleStreamSeconds: 30,
  receiptWaitSeconds: 30,
};

/** VIEW-003: turn an already-bounded byte prefix into bounded UTF-8 text. */
export function boundedLogOutput(
  bytes: Buffer,
  maxBytes: number,
  forcedTruncated = false,
): { text: string; truncated: boolean } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new StoreError("INTERNAL_ERROR", "invalid log byte limit");
  const prefix = bytes.subarray(0, Math.min(bytes.length, maxBytes));
  let text = prefix.toString("utf8");
  let truncated = forcedTruncated || bytes.length > maxBytes;
  // An incomplete/invalid UTF-8 sequence can expand to U+FFFD. Keep the
  // returned UTF-8 encoding within the configured byte limit as well.
  while (Buffer.byteLength(text, "utf8") > maxBytes && text.length > 0) {
    text = text.slice(0, -1);
    truncated = true;
  }
  return { text, truncated };
}

export function peerCgroup(pid: number): string | null {
  try {
    const text = readFileSync(`/proc/${pid}/cgroup`, "utf8");
    const line = text.split("\n").find(Boolean);
    if (!line) return null;
    const idx = line.lastIndexOf(":");
    return idx < 0 ? null : line.slice(idx + 1);
  } catch {
    return null;
  }
}

function socketFd(sock: Socket): number {
  const handle = (sock as unknown as { _handle?: { fd?: number } })._handle;
  const fd = handle?.fd;
  if (typeof fd !== "number" || fd < 0)
    throw new StoreError("AUTH_FAILED", "no socket fd");
  return fd;
}

const INTERNAL_CHANNEL = {
  "runner.open": "runner", "runner.pending": "runner", "batch.prepare": "runner",
  "batch.complete": "runner", "runner.observe": "runner", "batch.read": "extension",
  "principal.attach": "extension", "principal.detach": "extension",
  "host.principalRelay": "host", "host.reconcile": "host",
} as const satisfies Record<keyof InternalMethods, "runner" | "host" | "extension">;

type BoundPeer = PeerCred & { alive: () => boolean };

export class Broker {
  private adminServer: ReturnType<typeof createServer> | null = null;
  private hostServer: ReturnType<typeof createServer> | null = null;
  private actorServers: Set<ReturnType<typeof createServer>> = new Set();
  private lockFd: number | null = null;
  private running = false;

  private runLeases = new Map<
    Actor,
    { invocationId: string; cgroupFd: number; lease: RunLease | null; revoke: () => void; done: () => void }
  >();
  constructor(
    private readonly store: Store,
    private readonly mail: MailModule,
    private readonly units: UnitsModule,
    private readonly views: ViewsModule,
    private readonly lifecycle: LifecycleModule,
    private readonly git: GitModule | null,
    private readonly reconcile: ReconcileModule | null,
    private readonly paths: BrokerPaths,
    private readonly limits: ProtocolLimits = DEFAULT_LIMITS,
  ) {}

  start(): void {
    if (this.running) return;
    mkdirSync(this.paths.runRoot, { recursive: true });
    const lockPath = join(this.paths.runRoot, "broker.lock");
    this.lockFd = openSync(lockPath, "w", 0o600);
    if (!tryFlock(this.lockFd)) {
      closeSync(this.lockFd);
      this.lockFd = null;
      throw new StoreError(
        "BROKER_UNAVAILABLE",
        "another broker holds the society lock",
      );
    }
    this.units.onRevokeRun = (actor) => this.runLeases.get(actor)?.revoke();
    this.views.refreshWorld();
    this.adminServer = this.listenInternal(
      join(this.paths.runRoot, "admin.sock"),
      "runner",
    );
    this.hostServer = this.listenInternal(
      join(this.paths.runRoot, "host.sock"),
      "host",
    );
    this.running = true;
  }

  notifyReady(): boolean {
    return sdNotifyReady(process.env.NOTIFY_SOCKET ?? "");
  }

  private listenInternal(
    path: string,
    channel: "runner" | "host",
  ): ReturnType<typeof createServer> {
    if (existsSync(path)) unlinkSync(path);
    const srv = createServer((sock) => this.handleInternal(sock, channel));
    srv.listen(path);
    return srv;
  }

  private refreshViews(): void {
    try { this.views.refreshWorld(); } catch (error) {
      // Derived views can be rebuilt; their failure must not replace a durable receipt.
      console.error("world view refresh failed:", error instanceof Error ? error.message : String(error));
    }
  }

  private actorSocketDirectory(actor: Actor, incarnation: number): string {
    const dir = actorSocketDirectoryAt(this.paths.runRoot, actor, incarnation);
    if (Buffer.byteLength(actorSocketPathAt(this.paths.runRoot, actor, incarnation)) > 107)
      throw new StoreError("UNSUPPORTED_PROFILE", "actor socket path exceeds Linux sun_path");
    return dir;
  }

  private listenActor(actor: Actor, incarnation = this.store.getAgent(actor)?.incarnation ?? 0): {
    socketHostPath: string;
    done: () => void;
  } {
    const dir = this.actorSocketDirectory(actor, incarnation);
    const path = actorSocketPathAt(this.paths.runRoot, actor, incarnation);
    mkdirSync(dir, { recursive: true });
    if (existsSync(path)) unlinkSync(path);
    const sockets = new Set<Socket>();
    let revoked = false;
    const srv = createServer((sock) => {
      if (revoked) return this.fail(sock, { code: "STALE_RUN", message: "run endpoint revoked", retry: "never" });
      sockets.add(sock);
      sock.once("close", () => sockets.delete(sock));
      this.handleActor(sock, actor, incarnation);
    });
    srv.once("error", () => {
      const run = this.runLeases.get(actor);
      if (run?.lease?.incarnation === incarnation) run.revoke();
    });
    srv.listen(path);
    this.actorServers.add(srv);
    return {
      socketHostPath: path,
      done: () => {
        if (revoked) return;
        revoked = true;
        for (const socket of sockets) this.fail(socket, { code: "STALE_RUN", message: "run endpoint revoked", retry: "never" });
        this.actorServers.delete(srv);
        srv.close();
      },
    };
  }

  private bindPeer(sock: Socket): BoundPeer | null {
    const fd = socketFd(sock);
    const cred = peerCred(fd);
    if (!cred) return null;
    const pinned = peerPidFd(fd);
    if (pinned === null) return null;
    if (!peerPidAlive(pinned)) { closeSync(pinned); return null; }
    let closed = false;
    sock.once("close", () => { closed = true; closeSync(pinned); });
    return { ...cred, alive: () => !closed && peerPidAlive(pinned) };
  }

  private handleActor(sock: Socket, actor: Actor, incarnation: number): void {
    if (this.store.getAgent(actor)?.incarnation !== incarnation) {
      this.fail(sock, {
        code: "STALE_RUN",
        message: "actor incarnation is stale",
        retry: "never",
      });
      return;
    }
    const cred = this.bindPeer(sock);
    if (!cred) {
      this.fail(sock, {
        code: "AUTH_FAILED",
        message: "no peer credentials",
        retry: "never",
      });
      return;
    }
    const auth = this.trustedContext(actor, cred);
    if (!auth) {
      this.fail(sock, {
        code: "AUTH_FAILED",
        message: "cgroup mismatch",
        retry: "never",
      });
      return;
    }
    this.serveFrames(
      sock,
      (raw, stream) => this.dispatch(auth, raw as Request, stream ?? null),
      (raw) => this.preflightPublicStream(auth, raw),
    );
  }

  private trustedContext(
    actor: Actor,
    cred: BoundPeer,
  ): AuthContext | null {
    const agent = this.store.getAgent(actor);
    if (!agent) return null;
    if (cred.uid !== (process.getuid?.() ?? -1)) return null;
    const run = this.runLeases.get(actor);
    if (!run?.lease || run.lease.incarnation !== agent.incarnation) return null;
    const observed = this.units.observe(actor);
    if (observed.invocationId !== run.invocationId) return null;
    const unitCg = observed.cgroup;
    const peerCg = peerCgroup(cred.pid);
    if (!unitCg || !peerCg) return null;
    const prefix = unitCg.endsWith("/") ? unitCg : `${unitCg}/`;
    if (peerCg !== unitCg && !peerCg.startsWith(prefix)) return null;
    try {
      const pinned = fstatSync(run.cgroupFd, { bigint: true });
      const current = statSync(join("/sys/fs/cgroup", unitCg), { bigint: true });
      if (!pinned.isDirectory() || pinned.dev !== current.dev || pinned.ino !== current.ino) return null;
    } catch { return null; }
    if (!cred.alive()) return null; // Validate the original peer after cgroup observations.
    const lease = run.lease;
    const granted = capabilitiesOf(agent);
    const currentCapabilities = () => cred.alive() && this.runLeases.get(actor) === run && run.lease === lease ? granted : new Set<Capability>();
    return {
      actor,
      incarnation: agent.incarnation,
      role: agent.role,
      channel: "actor",
      // Revocation also fences requests already awaiting body/render before acceptance.
      get capabilities() { return currentCapabilities(); },
      peer: { pid: cred.pid, uid: cred.uid, gid: cred.gid, cgroup: peerCg },
    };
  }

  private handleInternal(sock: Socket, channel: "runner" | "host"): void {
    const cred = this.bindPeer(sock);
    if (!cred || cred.uid !== (process.getuid?.() ?? -1)) {
      this.fail(sock, {
        code: "AUTH_FAILED",
        message: "invalid internal peer credentials",
        retry: "never",
      });
      return;
    }
    this.serveFrames(sock, (raw, stream) =>
      this.dispatchInternal(raw, cred, stream ?? null, channel),
    );
  }

  private serveFrames(
    sock: Socket,
    handle: (
      raw: Record<string, unknown>,
      stream: AsyncIterable<Uint8Array> | null,
    ) => Promise<unknown> | unknown,
    preflightStream?: (raw: Record<string, unknown>) => object | null,
  ): void {
    type Spool = {
      raw: Record<string, unknown>;
      id: string;
      path: string;
      fd: number | null;
      hash: ReturnType<typeof createHash>;
      total: number;
      expectedBytes: number;
      expectedSha: string;
    };
    const stagingDir = join(this.paths.stateRoot, "staging");
    mkdirSync(stagingDir, { recursive: true });
    let activeSpool: Spool | null = null;
    const cleanupSpool = (spool: Spool | null, remove = true): void => {
      if (!spool) return;
      if (spool.fd !== null) {
        try { closeSync(spool.fd); } catch { /* already closed */ }
        spool.fd = null;
      }
      if (remove) {
        try { unlinkSync(spool.path); } catch { /* absent */ }
      }
    };
    const dec = new ConnectionDecoder(this.limits.frameBytes, (chunk) => {
      const spool = activeSpool;
      if (!spool || spool.fd === null)
        throw new StoreError("INTERNAL_ERROR", "stream sink has no active spool");
      spool.total += chunk.length;
      if (spool.total > spool.expectedBytes)
        throw new StoreError("STREAM_INVALID", "stream exceeds descriptor bytes");
      spool.hash.update(chunk);
      writeFileSync(spool.fd, chunk);
    });
    const write = (obj: unknown) => sock.write(encodeFrame(obj));
    let streamFrame: { raw: Record<string, unknown>; id: string; spool: Spool } | null = null;
    let pendingStream: { raw: Record<string, unknown>; id: string; path: string } | null = null;
    let busy = false;
    const units: Array<{
      raw: Record<string, unknown>;
      id: string;
      streamPath: string | null;
      retry: "never" | "same-key";
    }> = [];

    const respond = (
      id: string,
      p: Promise<unknown> | unknown,
      retry: "never" | "same-key",
    ): Promise<void> =>
      Promise.resolve(p).then(
        (r) => void write(r),
        (e) =>
          void write(
            Broker.errorAnswer(id, {
              code: e instanceof StoreError ? e.code : "INTERNAL_ERROR",
              message: (e as Error).message,
              retry,
            }),
          ),
      );

    const pump = (): void => {
      if (busy) return;
      const u = units.shift();
      if (!u) return;
      busy = true;
      const iter = u.streamPath ? createReadStream(u.streamPath) : null;
      respond(u.id, handle(u.raw, iter), u.retry).finally(() => {
        if (u.streamPath) {
          try { unlinkSync(u.streamPath); } catch { /* absent */ }
        }
        busy = false;
        const more = dec.resumeParsing();
        processEvents(more);
        pump();
      });
    };

    const rejectStream = (id: string, message: string): void => {
      cleanupSpool(activeSpool);
      activeSpool = null;
      if (pendingStream) {
        try { unlinkSync(pendingStream.path); } catch { /* absent */ }
        pendingStream = null;
      }
      write(
        Broker.errorAnswer(id, {
          code: "STREAM_INVALID",
          message,
          retry: "same-key",
        }),
      );
      sock.destroy();
    };

    const settlePendingStream = (
      events: import("./frame.js").DecoderEvent[],
    ): boolean => {
      if (!pendingStream) return true;
      if (events.some((ev) => ev.kind === "invalid")) {
        const id = pendingStream.id;
        try { unlinkSync(pendingStream.path); } catch { /* absent */ }
        pendingStream = null;
        rejectStream(id, "stream has excess bytes");
        return false;
      }
      if (events.some((ev) => ev.kind === "frame" || ev.kind === "stream")) {
        units.push({ ...pendingStream, streamPath: pendingStream.path, retry: "same-key" });
        pendingStream = null;
        return true;
      }
      if (dec.excessStatus() === "excess") {
        const id = pendingStream.id;
        try { unlinkSync(pendingStream.path); } catch { /* absent */ }
        pendingStream = null;
        rejectStream(id, "stream has excess bytes");
        return false;
      }
      return true;
    };

    const processEvents = (
      events: import("./frame.js").DecoderEvent[],
    ): void => {
      for (const ev of events) {
        if (ev.kind === "invalid") {
          write(
            Broker.errorAnswer("x", {
              code: ev.code,
              message: ev.message,
              retry: "never",
            }),
          );
          sock.destroy();
          return;
        }
        if (ev.kind === "stream") {
          const sf = streamFrame;
          streamFrame = null;
          const spool = sf?.spool ?? null;
          activeSpool = null;
          if (!sf || !spool || spool.fd === null) {
            cleanupSpool(spool);
            sock.destroy();
            return;
          }
          try {
            fsyncSync(spool.fd);
            closeSync(spool.fd);
            spool.fd = null;
          } catch (error) {
            cleanupSpool(spool);
            write(
              Broker.errorAnswer(sf.id, {
                code: (error as NodeJS.ErrnoException).code === "ENOSPC" ? "LIMIT_EXCEEDED" : "INTERNAL_ERROR",
                message: `stream spool failed: ${(error as Error).message}`,
                retry: "same-key",
              }),
            );
            sock.destroy();
            return;
          }
          if (
            spool.total !== spool.expectedBytes ||
            spool.hash.digest("hex") !== spool.expectedSha
          ) {
            cleanupSpool(spool);
            rejectStream(sf.id, "stream digest/bytes mismatch");
            return;
          }
          const status = dec.excessStatus();
          if (status === "excess") {
            cleanupSpool(spool);
            rejectStream(sf.id, "stream has excess bytes");
            return;
          }
          if (status === "pending") {
            pendingStream = { raw: sf.raw, id: sf.id, path: spool.path };
          } else {
            units.push({
              raw: sf.raw,
              id: sf.id,
              streamPath: spool.path,
              retry: "same-key",
            });
          }
          continue;
        }
        const raw = ev.frame.raw as Record<string, unknown>;
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
          write(
            Broker.errorAnswer("x", {
              code: "INVALID_REQUEST",
              message: "frame root must be an object",
              retry: "never",
            }),
          );
          sock.destroy();
          return;
        }
        const id = typeof raw.id === "string" ? raw.id : "x";
        const method = raw.method as string;
        const p = (raw.params ?? {}) as Record<string, unknown>;
        const desc = (
          typeof p.bundle === "object" && p.bundle !== null
            ? p.bundle
            : typeof p.content === "object" && p.content !== null
              ? p.content
              : null
        ) as Record<string, unknown> | null;
        const wantsStream =
          method === "git.submit" || method === "context.publish";
        const streamLimit =
          method === "git.submit"
            ? this.limits.bundleBytes
            : this.limits.contextBytes;
        if (wantsStream && desc && typeof desc.bytes === "number") {
          if (
            !Number.isSafeInteger(desc.bytes) ||
            desc.bytes < 0 ||
            desc.bytes > streamLimit
          ) {
            write(
              Broker.errorAnswer(id, {
                code: "INVALID_REQUEST",
                message: "stream descriptor exceeds host limits",
                retry: "never",
              }),
            );
            sock.destroy();
            return;
          }
          const rejected = preflightStream?.(raw) ?? null;
          if (rejected) {
            write(rejected);
            sock.destroy();
            return;
          }
          if (desc.bytes > 0) {
            const expectedSha = typeof desc.sha256 === "string" ? desc.sha256 : "";
            const path = join(stagingDir, `.wire-${randomUUID()}.stream`);
            let fd: number;
            try {
              fd = openSync(
                path,
                constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
                0o600,
              );
            } catch (error) {
              write(
                Broker.errorAnswer(id, {
                  code: (error as NodeJS.ErrnoException).code === "ENOSPC" ? "LIMIT_EXCEEDED" : "INTERNAL_ERROR",
                  message: `cannot create stream spool: ${(error as Error).message}`,
                  retry: "same-key",
                }),
              );
              sock.destroy();
              return;
            }
            const spool: Spool = {
              raw,
              id,
              path,
              fd,
              hash: createHash("sha256"),
              total: 0,
              expectedBytes: desc.bytes,
              expectedSha,
            };
            activeSpool = spool;
            streamFrame = { raw, id, spool };
            try {
              const more = dec.beginStream(desc.bytes);
              if (more.length > 0) processEvents(more);
            } catch (error) {
              cleanupSpool(spool);
              activeSpool = null;
              streamFrame = null;
              write(
                Broker.errorAnswer(id, {
                  code: error instanceof StoreError ? error.code : "INTERNAL_ERROR",
                  message: (error as Error).message,
                  retry: "same-key",
                }),
              );
              sock.destroy();
            }
            continue;
          }
        }
        units.push({ raw, id, streamPath: null, retry: "never" });
      }
    };

    sock.on("data", (chunk: Buffer) => {
      let events: import("./frame.js").DecoderEvent[];
      try {
        events = dec.push(chunk);
      } catch (error) {
        const id = streamFrame?.id ?? "x";
        cleanupSpool(activeSpool);
        activeSpool = null;
        streamFrame = null;
        write(
          Broker.errorAnswer(id, {
            code: (error as NodeJS.ErrnoException).code === "ENOSPC" ? "LIMIT_EXCEEDED" : error instanceof StoreError ? error.code : "INTERNAL_ERROR",
            message: (error as Error).message,
            retry: "same-key",
          }),
        );
        sock.destroy();
        return;
      }
      if (!settlePendingStream(events)) return;
      processEvents(events);
      pump();
    });
    sock.setTimeout(this.limits.idleStreamSeconds * 1000, () => {
      if (!dec.streaming() && !pendingStream) return;
      const id = streamFrame?.id ?? pendingStream?.id ?? "x";
      cleanupSpool(activeSpool);
      activeSpool = null;
      streamFrame = null;
      if (pendingStream) {
        try { unlinkSync(pendingStream.path); } catch { /* absent */ }
        pendingStream = null;
      }
      rejectStream(id, "stream timed out before acceptance");
    });
    sock.on("end", () => {
      if (dec.streaming()) {
        const id = streamFrame?.id ?? "x";
        cleanupSpool(activeSpool);
        activeSpool = null;
        streamFrame = null;
        write(
          Broker.errorAnswer(id, {
            code: "STREAM_INVALID",
            message: "stream ended before descriptor.bytes",
            retry: "same-key",
          }),
        );
      } else if (pendingStream) {
        const id = pendingStream.id;
        try { unlinkSync(pendingStream.path); } catch { /* absent */ }
        pendingStream = null;
        rejectStream(id, "stream ended with an incomplete next frame");
        return;
      }
      sock.destroy();
    });
    sock.on("error", () => sock.destroy());
    sock.once("close", () => {
      cleanupSpool(activeSpool);
      activeSpool = null;
      if (pendingStream) {
        try { unlinkSync(pendingStream.path); } catch { /* absent */ }
        pendingStream = null;
      }
      for (const unit of units) {
        if (unit.streamPath) {
          try { unlinkSync(unit.streamPath); } catch { /* absent */ }
        }
      }
      units.length = 0;
    });
  }

  private fail(
    sock: Socket,
    error: {
      code: string;
      message: string;
      retry: "never" | "same-key" | "after-repair";
    },
  ): void {
    sock.end(encodeFrame(Broker.errorAnswer("x", error)));
    sock.destroy();
  }

  static errorAnswer(
    id: string,
    error: {
      code: string;
      message: string;
      retry: "never" | "same-key" | "after-repair";
    },
  ): object {
    return { v: 1, id, ok: false, error };
  }

  static okAnswer(id: string, result: unknown): object {
    return { v: 1, id, ok: true, result };
  }

  private checkParams(
    method: string,
    rawParams: unknown,
  ): Record<string, unknown> | null {
    if (
      typeof rawParams !== "object" ||
      rawParams === null ||
      Array.isArray(rawParams)
    ) return null;
    const p = rawParams as Record<string, unknown>;
    const actorNames = new Set(this.store.listAgents().map((a) => a.name));
    let check: ((v: unknown) => string | null) | null = null;
    switch (method) {
      case "operation.get": check = operationGetParamsCheck; break;
      case "status.get": check = statusGetParamsCheck; break;
      case "mail.ack": check = mailAckParamsCheck; break;
      case "route.follow":
      case "route.unfollow": check = routeParamsCheck; break;
      case "agent.start":
      case "agent.stop": check = agentActionParamsCheck; break;
      case "agent.continue": check = agentContinueParamsCheck; break;
      case "agent.create": check = agentCreateParamsCheck; break;
      case "agent.wait": check = agentWaitParamsCheck; break;
      case "mail.send": check = mailParamsCheck(actorNames, this.limits); break;
      case "git.known": check = checkObject({ candidate: checkOid }); break;
      case "git.submit": check = gitSubmitParamsCheck(actorNames, this.limits); break;
      case "git.integrate": check = gitIntegrateParamsCheck; break;
      case "context.publish": check = contextPublishParamsCheck(this.limits); break;
      case "logs.read": check = logsReadParamsCheck; break;
      default: return null;
    }
    return check(p) === null ? p : null;
  }

  private preflightPublicStream(
    auth: AuthContext,
    envelope: Record<string, unknown>,
  ): object | null {
    const id = typeof envelope.id === "string" ? envelope.id : "x";
    const method = typeof envelope.method === "string" ? envelope.method : "";
    const reject = (code: string, message: string) =>
      Broker.errorAnswer(id, { code, message, retry: "never" as const });
    if (
      typeof envelope.id !== "string" ||
      typeof envelope.method !== "string" ||
      !Object.keys(envelope).every((key) =>
        ["v", "id", "method", "params", "request"].includes(key),
      )
    ) return reject("INVALID_REQUEST", "invalid request envelope");
    if (envelope.v !== 1)
      return reject("UNSUPPORTED_VERSION", "unsupported protocol version");
    if (method !== "git.submit" && method !== "context.publish")
      return reject("INVALID_REQUEST", "method does not accept a stream body");
    if (!isValidRequestKey(envelope.request))
      return reject("INVALID_REQUEST", "mutation requires a valid request key");
    const actor = this.store.getAgent(auth.actor);
    if (
      auth.channel === "actor" &&
      (actor?.incarnation !== auth.incarnation || actor.desired !== "enabled")
    ) return reject("STALE_RUN", "actor incarnation is stale");
    const need = METHOD_CAPABILITY[method as PublicMethod];
    if (
      need &&
      (!auth.capabilities.has(need) || !actor || !capabilitiesOf(actor).has(need))
    ) return reject("CAPABILITY_DENIED", `missing capability ${need}`);
    if (!this.checkParams(method, envelope.params))
      return reject("INVALID_REQUEST", `invalid params for ${method}`);
    return null;
  }

  private readLogs(
    agent: string,
    sinceSeconds: number,
  ): Promise<{ text: string; truncated: boolean; observedAtMs: number }> {
    const svc = unitName(this.paths.society, agent, "service");
    return new Promise((resolve, reject) => {
      const child = spawn(
        "journalctl",
        [
          "--user",
          "--unit",
          svc,
          "--since",
          `${sinceSeconds}s ago`,
          "--no-pager",
          "--output=cat",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const chunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let total = 0;
      let stderrTotal = 0;
      let truncated = false;
      let timedOut = false;
      let spawnError: Error | null = null;
      const limit = this.limits.logBytes;
      const diagnosticLimit = 16 * 1024;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 30_000);

      child.stdout.on("data", (chunk: Buffer) => {
        if (truncated) return;
        const part = Buffer.from(chunk);
        const remaining = Math.max(0, limit - total);
        if (part.length <= remaining) {
          chunks.push(part);
          total += part.length;
          return;
        }
        if (remaining > 0) {
          chunks.push(part.subarray(0, remaining));
          total += remaining;
        }
        truncated = true;
        child.kill("SIGKILL");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const part = Buffer.from(chunk);
        const remaining = Math.max(0, diagnosticLimit - stderrTotal);
        if (remaining > 0) {
          const keep = part.subarray(0, remaining);
          stderrChunks.push(keep);
          stderrTotal += keep.length;
        }
      });
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new StoreError("DEADLINE_EXCEEDED", "journalctl timed out"));
          return;
        }
        if (spawnError) {
          reject(new StoreError("INTERNAL_ERROR", `journalctl spawn failed: ${spawnError.message}`));
          return;
        }
        const output = boundedLogOutput(Buffer.concat(chunks, total), limit, truncated);
        if (truncated) {
          resolve({ ...output, observedAtMs: Date.now() });
          return;
        }
        if (signal || code !== 0) {
          const stderr = Buffer.concat(stderrChunks, stderrTotal).toString("utf8");
          reject(new StoreError(
            "INTERNAL_ERROR",
            `journalctl exited unsuccessfully: ${stderr.slice(0, 300)}`,
          ));
          return;
        }
        resolve({ ...output, observedAtMs: Date.now() });
      });
    });
  }

  async dispatch(
    auth: AuthContext,
    req: Request,
    stream: AsyncIterable<Uint8Array> | null,
  ): Promise<object> {
    const envelope = req as unknown as Record<string, unknown>;
    const id = typeof envelope.id === "string" ? envelope.id : "x";
    const method = typeof envelope.method === "string" ? envelope.method : "";
    if (
      typeof envelope.id !== "string" ||
      typeof envelope.method !== "string" ||
      !Object.keys(envelope).every((k) =>
        ["v", "id", "method", "params", "request"].includes(k),
      )
    ) {
      return Broker.errorAnswer(id, {
        code: "INVALID_REQUEST",
        message: "invalid request envelope",
        retry: "never",
      });
    }
    const actor = this.store.getAgent(auth.actor);
    if (
      auth.channel === "actor" &&
      (actor?.incarnation !== auth.incarnation || actor.desired !== "enabled")
    ) {
      return Broker.errorAnswer(id, {
        code: "STALE_RUN",
        message: "actor incarnation is stale",
        retry: "never",
      });
    }
    if (envelope.v !== 1) {
      return Broker.errorAnswer(id, {
        code: "UNSUPPORTED_VERSION",
        message: "unsupported protocol version",
        retry: "never",
      });
    }
    if (!KNOWN_METHODS.has(method)) {
      return Broker.errorAnswer(id, {
        code: "UNKNOWN_METHOD",
        message: `unknown method ${method}`,
        retry: "never",
      });
    }
    if (MUTATION_METHODS.has(method) && !isValidRequestKey(envelope.request)) {
      return Broker.errorAnswer(id, {
        code: "INVALID_REQUEST",
        message: "mutation requires a valid request key",
        retry: "never",
      });
    }
    const readOrEphemeral =
      method === "operation.get" ||
      method === "status.get" ||
      method === "logs.read" ||
      method === "git.known" ||
      method === "agent.wait";
    if (
      readOrEphemeral &&
      Object.prototype.hasOwnProperty.call(envelope, "request")
    ) {
      return Broker.errorAnswer(id, {
        code: "INVALID_REQUEST",
        message: "read/ephemeral requests forbid a top-level request key",
        retry: "never",
      });
    }
    const need = METHOD_CAPABILITY[method as PublicMethod];
    if (need && (!auth.capabilities.has(need) || !actor || !capabilitiesOf(actor).has(need))) {
      return Broker.errorAnswer(id, {
        code: "CAPABILITY_DENIED",
        message: `missing capability ${need}`,
        retry: "never",
      });
    }
    const rawParams = (req as unknown as { params: unknown }).params;
    const params = this.checkParams(method, rawParams);
    if (!params) {
      return Broker.errorAnswer(id, {
        code: "INVALID_REQUEST",
        message: `invalid params for ${method}`,
        retry: "never",
      });
    }
    try {
      switch (method) {
        case "status.get": {
          const obs = (a: string) => {
            const o = this.units.observe(a);
            return {
              activeState: o.activeState,
              subState: o.subState,
              result: o.result,
              execMainStatus: o.execMainStatus,
            };
          };
          const agent = (params as { agent?: string }).agent;
          return Broker.okAnswer(id, this.views.status(agent, obs));
        }
        case "operation.get": {
          const op = this.store.getOperation(
            auth.actor,
            (params as { key: string }).key,
          );
          return Broker.okAnswer(id, op ? receiptOfRow(op) : receiptNotFound);
        }
        case "mail.send": {
          const mail = params as unknown as import("../implementation/contracts.js").MailInput;
          if (mail.approvalFor && !this.store.getOperation(auth.actor, keyOf(req)) &&
            !this.git?.isPublished(mail.approvalFor.candidate))
            throw new StoreError("CANDIDATE_NOT_PUBLISHED", "approval request requires a published candidate");
          return Broker.okAnswer(
            id,
            await this.mail.send(auth, keyOf(req), mail),
          );
        }
        case "mail.ack":
          return Broker.okAnswer(
            id,
            this.lifecycle.ack(
              auth,
              (params as { message: string }).message as never,
              keyOf(req),
            ),
          );
        case "route.follow":
          return Broker.okAnswer(
            id,
            this.lifecycle.follow(
              auth,
              (params as { topic: string }).topic,
              true,
              keyOf(req),
            ),
          );
        case "route.unfollow":
          return Broker.okAnswer(
            id,
            this.lifecycle.follow(
              auth,
              (params as { topic: string }).topic,
              false,
              keyOf(req),
            ),
          );
        case "agent.start":
          return Broker.okAnswer(
            id,
            this.lifecycle.start(
              auth,
              (params as { agent: string }).agent as never,
              keyOf(req),
            ),
          );
        case "agent.stop":
          return Broker.okAnswer(
            id,
            this.lifecycle.stop(
              auth,
              (params as { agent: string }).agent as never,
              keyOf(req),
            ),
          );
        case "agent.create":
          return Broker.okAnswer(
            id,
            await this.lifecycle.create(auth, params as never, keyOf(req)),
          );
        case "agent.continue":
          return Broker.okAnswer(
            id,
            await this.mail.send(
              auth,
              keyOf(req),
              {
                to: [auth.actor],
                subject: "continue",
                kind: "message",
                body: (params as { note: string }).note,
              },
              {
                kind: "agent.continue",
                params: { note: (params as { note: string }).note },
              },
            ),
          );
        case "agent.wait":
          return Broker.okAnswer(id, { accepted: true });
        case "git.known": {
          if (!this.git)
            throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          const refs = this.git.knownRefs();
          return Broker.okAnswer(id, {
            hasCandidate: refs.published.includes(
              (params as { candidate: string }).candidate,
            ),
            prerequisites: [...refs.published],
          });
        }
        case "git.submit": {
          if (!this.git)
            throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          return Broker.okAnswer(
            id,
            await this.git.submit(
              auth,
              keyOf(req),
              params as never,
              stream ?? emptyStream(),
            ),
          );
        }
        case "git.integrate": {
          if (!this.git)
            throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          const p = params as { candidate: string; expected: string };
          return Broker.okAnswer(
            id,
            await this.git.integrate(auth, keyOf(req), {
              candidate: p.candidate,
              expected: p.expected,
            }),
          );
        }
        case "context.publish": {
          if (!this.git)
            throw new StoreError(
              "SPIKE_UNRESOLVED",
              "context module unavailable",
            );
          return Broker.okAnswer(
            id,
            await this.git.publishContext(
              auth,
              keyOf(req),
              params as never,
              stream ?? emptyStream(),
            ),
          );
        }
        case "logs.read": {
          const p = params as { agent: string; sinceSeconds: number };
          return Broker.okAnswer(id, await this.readLogs(p.agent, p.sinceSeconds));
        }
        default:
          return Broker.errorAnswer(id, {
            code: "UNKNOWN_METHOD",
            message: `unhandled method ${method}`,
            retry: "never",
          });
      }
    } catch (e) {
      return Broker.errorAnswer(id, {
        code: e instanceof StoreError ? e.code : "INTERNAL_ERROR",
        message: (e as Error).message,
        retry: "never",
      });
    } finally {
      if (MUTATION_METHODS.has(method)) this.refreshViews();
    }
  }

  private requireRunnerUnit(
    peer: BoundPeer,
    agent: Actor,
    invocationId?: string,
  ): void {
    const unit = unitName(this.paths.society, agent, "service");
    const observed = this.units.observe(agent);
    const peerCg = peerCgroup(peer.pid);
    const prefix = observed.cgroup?.endsWith("/")
      ? observed.cgroup
      : `${observed.cgroup}/`;
    if (
      !peer.alive() ||
      !observed.cgroup ||
      !peerCg ||
      (peerCg !== observed.cgroup && !peerCg.startsWith(prefix)) ||
      (invocationId !== undefined && observed.invocationId !== invocationId)
    ) {
      throw new StoreError("AUTH_FAILED", `caller is not the current ${unit} invocation`);
    }
  }

  private requireHostUnit(
    peer: BoundPeer,
    kind: "principal-relay" | "reconcile",
  ): void {
    const unitCg = this.units.unitCgroup(kind);
    const peerCg = peerCgroup(peer.pid);
    const prefix = unitCg.endsWith("/") ? unitCg : `${unitCg}/`;
    if (!peer.alive() || !unitCg || !peerCg || (peerCg !== unitCg && !peerCg.startsWith(prefix)))
      throw new StoreError("AUTH_FAILED", `caller is not inside the ${kind} service`);
  }

  /** Resolve the runner actor from physical cgroup identity, never request params. */
  private runnerActor(peer: BoundPeer): Actor {
    const peerCg = peerCgroup(peer.pid);
    if (!peerCg) throw new StoreError("AUTH_FAILED", "runner cgroup unavailable");
    const matches: Actor[] = [];
    for (const row of this.store.listAgents()) {
      if (row.role !== "resident" || row.desired === "retired") continue;
      const unitCg = this.units.observe(row.name).cgroup;
      if (!unitCg) continue;
      const prefix = unitCg.endsWith("/") ? unitCg : `${unitCg}/`;
      if (peerCg === unitCg || peerCg.startsWith(prefix)) matches.push(row.name);
    }
    if (matches.length !== 1 || !peer.alive())
      throw new StoreError("AUTH_FAILED", "runner cgroup identity is ambiguous");
    return matches[0]!;
  }

  private async dispatchInternal(
    raw: Record<string, unknown>,
    peer: BoundPeer,
    _stream: AsyncIterable<Uint8Array> | null,
    channel: "runner" | "host",
  ): Promise<object> {
    const id = typeof raw.id === "string" ? raw.id : "x";
    const method = typeof raw.method === "string" ? raw.method : "";
    const paramsRaw = raw.params;
    if (
      raw.v !== 1 ||
      typeof raw.id !== "string" ||
      typeof raw.method !== "string" ||
      typeof paramsRaw !== "object" ||
      paramsRaw === null ||
      Array.isArray(paramsRaw) ||
      !Object.keys(raw).every((k) => ["v", "id", "method", "params"].includes(k))
    ) {
      return Broker.errorAnswer(id, {
        code: "INVALID_REQUEST",
        message: "invalid internal envelope",
        retry: "never",
      });
    }
    const params = paramsRaw as Record<string, unknown>;
    try {
      if (!Object.hasOwn(INTERNAL_CHANNEL, method))
        throw new StoreError("UNKNOWN_METHOD", `internal ${method}`);
      if (INTERNAL_CHANNEL[method as keyof InternalMethods] !== channel)
        throw new StoreError("AUTH_FAILED", `method ${method} is not allowed on ${channel} channel`);
      switch (method) {
        case "runner.open": {
          if (
            typeof params.agent !== "string" ||
            !isValidActorName(params.agent) ||
            typeof params.invocationId !== "string" ||
            !/^[0-9a-f]{32}$/.test(params.invocationId) ||
            !Object.keys(params).every((k) =>
              ["agent", "invocationId"].includes(k),
            )
          ) {
            throw new StoreError("INVALID_REQUEST", "runner.open args invalid");
          }
          this.requireRunnerUnit(peer, params.agent, params.invocationId);
          return Broker.okAnswer(
            id,
            this.openRun(params.agent, params.invocationId),
          );
        }
        case "runner.pending": {
          if (Object.keys(params).length) throw new StoreError("INVALID_REQUEST", "runner.pending takes no params");
          const agent = this.runnerActor(peer);
          this.runnerAuth(agent, this.store.getAgent(agent)!.incarnation);
          return Broker.okAnswer(id, {
            pending: this.store.pendingDeliveries(agent).length,
            recoverableBatchIds: this.store.preparedBatches(agent).map(batch => batch.id),
          });
        }
        case "runner.observe": {
          if (!Object.keys(params).every(key => ["reason", "toolName", "observedAtMs"].includes(key)) ||
            typeof params.reason !== "string" || !Number.isSafeInteger(params.observedAtMs) ||
            (params.observedAtMs as number) < 0 || (params.toolName !== undefined && typeof params.toolName !== "string"))
            throw new StoreError("INVALID_REQUEST", "runner.observe args invalid");
          const agent = this.runnerActor(peer);
          this.runnerAuth(agent, this.store.getAgent(agent)!.incarnation);
          throw new StoreError("SPIKE_UNRESOLVED", "S-03 observation adapter is not pinned");
        }
        case "batch.prepare": {
          if (Object.keys(params).length !== 0)
            throw new StoreError("INVALID_REQUEST", "batch.prepare takes no params");
          const agent = this.runnerActor(peer);
          const row = this.store.getAgent(agent);
          if (!row) throw new StoreError("AUTH_FAILED", "runner identity missing");
          const batch = await this.mail.prepare(
            this.runnerAuth(agent, row.incarnation),
          );
          return Broker.okAnswer(id, batch);
        }
        case "batch.complete": {
          const allowed = [
            "batchId",
            "incarnation",
            "sessionPath",
            "adapterRevision",
            "receiptPath",
          ];
          if (!Object.keys(params).every((k) => allowed.includes(k)))
            throw new StoreError("INVALID_REQUEST", "batch.complete args invalid");
          const evidence = params as unknown as BoundaryEvidence;
          // ID-002: validate canonical grammar before existence/ownership queries.
          if (
            parseBatchId(evidence.batchId) === null ||
            !Number.isSafeInteger(evidence.incarnation) ||
            typeof evidence.sessionPath !== "string" ||
            typeof evidence.adapterRevision !== "string" ||
            typeof evidence.receiptPath !== "string"
          ) {
            throw new StoreError("INVALID_REQUEST", "bad boundary evidence");
          }
          const batch = this.store.getBatch(evidence.batchId);
          if (!batch)
            throw new StoreError("BATCH_CONFLICT", `unknown batch ${evidence.batchId}`);
          const agent = batch.agent;
          this.requireRunnerUnit(peer, agent);
          const row = this.store.getAgent(agent);
          if (!row || row.incarnation !== evidence.incarnation)
            throw new StoreError("BATCH_CONFLICT", "runner incarnation mismatch");
          await this.mail.complete(
            this.runnerAuth(agent, row.incarnation),
            evidence,
          );
          return Broker.okAnswer(id, { completed: true });
        }
        case "host.principalRelay": {
          if (Object.keys(params).length) throw new StoreError("INVALID_REQUEST", "host.principalRelay takes no params");
          this.requireHostUnit(peer, "principal-relay");
          const principal = this.store.getAgent("principal");
          if (!principal) return Broker.okAnswer(id, { moved: 0, pending: 0 });
          const newFiles = readdirSync(
            join(this.paths.stateRoot, "mail", "inboxes", "principal", "new"),
          );
          const moved = this.mail.moveToCur("principal", newFiles);
          return Broker.okAnswer(id, {
            moved,
            pending: this.store.pendingDeliveries("principal").length,
          });
        }
        case "host.reconcile": {
          if (Object.keys(params).length) throw new StoreError("INVALID_REQUEST", "host.reconcile takes no params");
          this.requireHostUnit(peer, "reconcile");
          const rep = this.reconcile
            ? await this.reconcile.sweep()
            : await this.mail.reconcilePending();
          this.refreshViews();
          return Broker.okAnswer(id, rep);
        }
        default:
          return Broker.errorAnswer(id, {
            code: "UNKNOWN_METHOD",
            message: `internal ${method}`,
            retry: "never",
          });
      }
    } catch (e) {
      return Broker.errorAnswer(id, {
        code: e instanceof StoreError ? e.code : "INTERNAL_ERROR",
        message: (e as Error).message,
        retry: "same-key",
      });
    }
  }

  private runnerAuth(agent: Actor, incarnation: number): AuthContext {
    const row = this.store.getAgent(agent);
    const run = this.runLeases.get(agent);
    if (!row || row.desired !== "enabled" || !run?.lease ||
      run.lease.incarnation !== incarnation || row.incarnation !== incarnation ||
      this.units.observe(agent).invocationId !== run.invocationId)
      throw new StoreError("STALE_RUN", "runner has no current live lease");
    return {
      actor: agent,
      incarnation,
      role: row.role,
      channel: "trusted-runner",
      capabilities: capabilitiesOf(row),
      peer: { pid: 0, uid: -1, gid: -1, cgroup: null },
    };
  }

  private openRun(actor: Actor, invocationId: string): RunLease {
    const agent = this.store.getAgent(actor);
    if (!agent) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${actor}`);
    resolvedSpecOf(agent);
    if (agent.desired === "provisioning")
      throw new StoreError("AGENT_NOT_READY", `${actor} is provisioning`);
    if (agent.desired === "stopped")
      throw new StoreError("STALE_RUN", `${actor} is stopped`);
    if (agent.desired === "retired")
      throw new StoreError("AGENT_RETIRED", `${actor} is retired`);
    const hasGoal =
      this.paths.hasGoal?.() ??
      existsSync(join(this.paths.stateRoot, "world", "context", "current"));
    if (!hasGoal)
      throw new StoreError("GOAL_REQUIRED", "shared GOAL not published yet");
    const active = this.runLeases.get(actor);
    if (active?.invocationId === invocationId) {
      if (!active.lease) throw new StoreError("STALE_RUN", "run endpoint is revoked or failed");
      return active.lease;
    }
    if (active) {
      let dead = false;
      try {
        dead = /^populated 0$/m.test(readFileSync(`/proc/self/fd/${active.cgroupFd}/cgroup.events`, "utf8"));
      } catch (error) {
        dead = (error as NodeJS.ErrnoException).code === "ENOENT";
      }
      if (!dead) throw new StoreError("RUN_TERMINATION_UNKNOWN", "previous invocation cgroup is not proven empty");
    }
    const observation = this.units.observe(actor);
    if (observation.invocationId !== invocationId || !observation.cgroup)
      throw new StoreError("AUTH_FAILED", "runner invocation changed during open");
    const cgroupFd = openSync(join("/sys/fs/cgroup", observation.cgroup), "r");
    try {
      if (!/^populated 1$/m.test(readFileSync(`/proc/self/fd/${cgroupFd}/cgroup.events`, "utf8")))
        throw new StoreError("AUTH_FAILED", "current runner cgroup is not populated");
      active?.done();
      this.runLeases.delete(actor);
      const next = agent.incarnation + 1;
      if (!Number.isSafeInteger(next)) throw new StoreError("STORE_CORRUPT", "incarnation exhausted");
      this.actorSocketDirectory(actor, next);
      this.store.transaction((_tx) => {
        this.store.updateAgent({ name: actor, incarnation: next });
        this.store.reassignPreparedBatches(actor, next);
      });
      let listener: ReturnType<Broker["listenActor"]> | undefined;
      let closed = false;
      const record = {
        invocationId, cgroupFd, lease: null as RunLease | null,
        revoke: () => { record.lease = null; listener?.done(); },
        done: () => {
          if (closed) return;
          closed = true;
          try { record.revoke(); } finally { closeSync(cgroupFd); }
        },
      };
      // Keep the failed invocation fenced and its kernel identity pinned until death.
      this.runLeases.set(actor, record);
      listener = this.listenActor(actor, next);
      record.lease = { actor, incarnation: next, socketHostPath: listener.socketHostPath };
      this.refreshViews();
      return record.lease;
    } catch (error) {
      if (this.runLeases.get(actor)?.cgroupFd !== cgroupFd) closeSync(cgroupFd);
      throw error;
    }
  }

  drainAndClose(): void {
    this.adminServer?.close();
    this.hostServer?.close();
    for (const run of this.runLeases.values()) run.done();
    for (const srv of this.actorServers) {
      try {
        srv.close();
      } catch {
        /* already closed */
      }
    }
    this.actorServers.clear();
    this.runLeases.clear();
    this.store.close();
    if (this.lockFd !== null) {
      try {
        closeSync(this.lockFd);
      } catch {
        /* already closed */
      }
      this.lockFd = null;
    }
  }
}

function emptyStream(): AsyncIterable<Uint8Array> {
  return (async function* () {})();
}

function keyOf(req: { request?: string }): string {
  if (!isValidRequestKey(req.request))
    throw new StoreError("INVALID_REQUEST", "mutation requires a request key");
  return req.request;
}

function receiptOfRow(op: {
  id: string;
  kind: string;
  state: string;
  resultJson: string | null;
  errorCode: string | null;
}): Receipt {
  if (!(["pending", "succeeded", "failed", "unknown"] as const).includes(op.state as never))
    throw new StoreError("STORE_CORRUPT", `operation ${op.id} has invalid state`);
  const rec: Receipt = {
    operation: op.id,
    state: op.state as Receipt["state"],
  };
  if (op.state === "succeeded") {
    if (!op.resultJson)
      throw new StoreError("STORE_CORRUPT", `succeeded operation ${op.id} has no result`);
    let result: unknown;
    try {
      result = JSON.parse(op.resultJson);
    } catch {
      throw new StoreError("STORE_CORRUPT", `operation ${op.id} has corrupt result JSON`);
    }
    const invalid = operationResultCheck(op.kind)(result);
    if (invalid)
      throw new StoreError("STORE_CORRUPT", `operation ${op.id} result: ${invalid}`);
    rec.result = result as Exclude<Receipt["result"], undefined>;
  } else if (op.resultJson !== null) {
    throw new StoreError("STORE_CORRUPT", `non-success operation ${op.id} has a result`);
  }
  if (op.state === "failed" && !op.errorCode)
    throw new StoreError("STORE_CORRUPT", `failed operation ${op.id} has no error code`);
  if (op.errorCode && op.state !== "failed")
    throw new StoreError("STORE_CORRUPT", `non-failed operation ${op.id} has an error code`);
  if (op.errorCode) {
    rec.error = {
      code: op.errorCode as never,
      message: op.errorCode,
      retry: "never",
    };
  }
  return rec;
}

const METHOD_CAPABILITY: Readonly<Partial<Record<PublicMethod, Capability>>> = {
  "mail.send": "mail.send",
  "route.follow": "route.follow",
  "route.unfollow": "route.follow",
  "agent.create": "agent.create",
  "agent.continue": "mail.send",
  "git.submit": "git.submit",
  "git.integrate": "code.integrate",
  "context.publish": "context.publish",
};

const receiptNotFound: Receipt = {
  operation: "",
  state: "failed",
  error: {
    code: "REQUEST_NOT_FOUND",
    message: "no such request",
    retry: "same-key",
  },
};

const KNOWN_METHODS: ReadonlySet<string> = new Set([
  "mail.send",
  "mail.ack",
  "route.follow",
  "route.unfollow",
  "agent.create",
  "agent.start",
  "agent.stop",
  "agent.continue",
  "agent.wait",
  "git.known",
  "git.submit",
  "git.integrate",
  "context.publish",
  "operation.get",
  "status.get",
  "logs.read",
]);

const MUTATION_METHODS: ReadonlySet<string> = new Set([
  "mail.send",
  "mail.ack",
  "route.follow",
  "route.unfollow",
  "agent.create",
  "agent.start",
  "agent.stop",
  "agent.continue",
  "git.submit",
  "git.integrate",
  "context.publish",
]);
