// MUST [AUTH-001..003]/[IPC-*]/[REC-007]: broker core — singleton lock, actor
// listener auth (SO_PEERCRED + cgroup), public dispatch, runner channel.
import { createServer, type Socket } from "node:net";
import { createHash } from "node:crypto";
import {
  openSync,
  mkdirSync,
  unlinkSync,
  existsSync,
  readFileSync,
  closeSync,
  readdirSync,
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
  ProtocolLimits,
  Request,
  Receipt,
  RunLease,
} from "../implementation/contracts.js";
import { Store, StoreError } from "./store.js";
import { isValidActorName, isValidRequestKey } from "./ids.js";
import { ConnectionDecoder, encodeFrame } from "./frame.js";
import { spawnSync } from "node:child_process";
import { MailModule, StopSignal } from "./mail.js";
import { UnitsModule, unitName } from "./units.js";
import { peerCred, tryFlock, sdNotifyReady } from "./leaf.js";
import { LifecycleModule } from "./lifecycle.js";
import { GitModule } from "./git.js";
import { ReconcileModule } from "./reconcile.js";
import { ViewsModule } from "./views.js";
import { capabilitiesOf } from "./authority.js";
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
  routeParamsCheck,
  statusGetParamsCheck,
  checkObject,
  checkOid,
} from "./validate.js";

export interface BrokerPaths {
  stateRoot: string;
  runRoot: string;
  society: string;
}

const DEFAULT_LIMITS: ProtocolLimits = {
  frameBytes: 256 * 1024,
  mailBodyBytes: 64 * 1024,
  subjectBytes: 8 * 1024,
  addresses: 64,
  replyReferences: 64,
  contextFiles: 1024,
  contextBytes: 256 * 1024 * 1024,
  bundleBytes: 256 * 1024 * 1024,
  logBytes: 1024 * 1024,
  batchMaxMessages: 24,
  idleStreamSeconds: 60,
  receiptWaitSeconds: 30,
};

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

export class Broker {
  private adminServer: ReturnType<typeof createServer> | null = null;
  private actorServers: Set<ReturnType<typeof createServer>> = new Set();
  private lockFd: number | null = null;
  private running = false;

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
    this.adminServer = this.listenAdmin(join(this.paths.runRoot, "admin.sock"));
    this.running = true;
  }

  notifyReady(): boolean {
    return sdNotifyReady(process.env.NOTIFY_SOCKET ?? "");
  }

  private listenAdmin(path: string): ReturnType<typeof createServer> {
    if (existsSync(path)) unlinkSync(path);
    const srv = createServer((sock) => this.handleAdmin(sock));
    srv.listen(path);
    return srv;
  }

  private listenActor(actor: Actor): {
    socketHostPath: string;
    done: () => void;
  } {
    const incarnation = this.store.getAgent(actor)?.incarnation ?? 0;
    const dir = join(this.paths.runRoot, "actors", actor, String(incarnation));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "control.sock");
    if (existsSync(path)) unlinkSync(path);
    const srv = createServer((sock) =>
      this.handleActor(sock, actor, incarnation),
    );
    srv.listen(path);
    this.actorServers.add(srv);
    return {
      socketHostPath: path,
      done: () => {
        this.actorServers.delete(srv);
        srv.close();
      },
    };
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
    const cred = peerCred(socketFd(sock));
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
    this.serveFrames(sock, (raw, stream) =>
      this.dispatch(auth, raw as Request, stream ?? null),
    );
  }

  private trustedContext(
    actor: Actor,
    cred: { pid: number; uid: number; gid: number },
  ): AuthContext | null {
    const agent = this.store.getAgent(actor);
    if (!agent) return null;
    if (cred.uid !== (process.getuid?.() ?? -1)) return null;
    const unitCg = this.units.observe(actor).cgroup;
    const peerCg = peerCgroup(cred.pid);
    if (!unitCg || !peerCg) return null;
    const prefix = unitCg.endsWith("/") ? unitCg : `${unitCg}/`;
    if (peerCg !== unitCg && !peerCg.startsWith(prefix)) return null;
    return {
      actor,
      incarnation: agent.incarnation,
      role: agent.role,
      channel: "actor",
      capabilities: capabilitiesOf(agent),
      peer: { pid: cred.pid, uid: cred.uid, gid: cred.gid, cgroup: peerCg },
    };
  }

  private handleAdmin(sock: Socket): void {
    const cred = peerCred(socketFd(sock));
    if (!cred) {
      this.fail(sock, {
        code: "AUTH_FAILED",
        message: "no peer credentials",
        retry: "never",
      });
      return;
    }
    this.serveFrames(sock, (raw, stream) =>
      this.dispatchInternal(raw, cred, stream ?? null),
    );
  }

  private serveFrames(
    sock: Socket,
    handle: (
      raw: Record<string, unknown>,
      stream: AsyncIterable<Uint8Array> | null,
    ) => Promise<unknown> | unknown,
  ): void {
    const dec = new ConnectionDecoder(this.limits.frameBytes);
    const write = (obj: unknown) => sock.write(encodeFrame(obj));
    let streamFrame: { raw: Record<string, unknown>; id: string } | null = null;
    let pendingStream: {
      raw: Record<string, unknown>;
      id: string;
      bytes: Uint8Array;
    } | null = null;
    let busy = false;
    const units: Array<{
      raw: Record<string, unknown>;
      id: string;
      bytes: Uint8Array | null;
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
      const iter = u.bytes
        ? (async function* () {
            yield u.bytes!;
          })()
        : null;
      respond(u.id, handle(u.raw, iter), u.retry).finally(() => {
        busy = false;
        processEvents(dec.resumeParsing());
        pump();
      });
    };

    const rejectStream = (id: string, message: string): void => {
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
        pendingStream = null;
        rejectStream(id, "stream has excess bytes");
        return false;
      }
      if (events.some((ev) => ev.kind === "frame" || ev.kind === "stream")) {
        units.push({ ...pendingStream, retry: "same-key" });
        pendingStream = null;
        return true;
      }
      if (dec.excessStatus() === "excess") {
        const id = pendingStream.id;
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
          continue;
        }
        if (ev.kind === "stream") {
          const sf = streamFrame;
          streamFrame = null;
          if (!sf) continue;
          const p = sf.raw.params;
          const rec =
            typeof p === "object" && p !== null && !Array.isArray(p)
              ? (p as Record<string, unknown>)
              : null;
          const desc =
            rec && typeof rec.bundle === "object" && rec.bundle !== null
              ? rec.bundle
              : rec && typeof rec.content === "object" && rec.content !== null
                ? rec.content
                : null;
          const expectedSha =
            desc && typeof (desc as Record<string, unknown>).sha256 === "string"
              ? ((desc as Record<string, unknown>).sha256 as string)
              : null;
          if (
            expectedSha &&
            /^[0-9a-f]{64}$/.test(expectedSha) &&
            createHash("sha256").update(ev.bytes).digest("hex") !== expectedSha
          ) {
            rejectStream(sf.id, "stream digest mismatch");
            return;
          }
          const status = dec.excessStatus();
          if (status === "excess") {
            rejectStream(sf.id, "stream has excess bytes");
            return;
          }
          if (status === "pending") {
            pendingStream = { raw: sf.raw, id: sf.id, bytes: ev.bytes };
          } else {
            units.push({
              raw: sf.raw,
              id: sf.id,
              bytes: ev.bytes,
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
          continue;
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
          if (desc.bytes > 0) {
            streamFrame = { raw, id };
            const more = dec.beginStream(desc.bytes);
            if (more.length > 0) processEvents(more);
            continue;
          }
        }
        units.push({ raw, id, bytes: null, retry: "never" });
      }
    };

    sock.on("data", (chunk: Buffer) => {
      const events = dec.push(chunk);
      if (!settlePendingStream(events)) return;
      processEvents(events);
      pump();
    });
    sock.setTimeout(this.limits.idleStreamSeconds * 1000, () => {
      if (!dec.streaming() && !pendingStream) return;
      const id = streamFrame?.id ?? pendingStream?.id ?? "x";
      streamFrame = null;
      pendingStream = null;
      rejectStream(id, "stream timed out before acceptance");
    });
    sock.on("end", () => {
      if (dec.streaming()) {
        const id = streamFrame?.id ?? "x";
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
        pendingStream = null;
        rejectStream(id, "stream ended with an incomplete next frame");
        return;
      }
      sock.destroy();
    });
    sock.on("error", () => sock.destroy());
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
    if (
      auth.channel === "actor" &&
      this.store.getAgent(auth.actor)?.incarnation !== auth.incarnation
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
    if (need && !auth.capabilities.has(need)) {
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
        case "mail.send":
          return Broker.okAnswer(
            id,
            await this.mail.send(auth, keyOf(req), params as never),
          );
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
              undefined,
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
          const svc = unitName(this.paths.society, p.agent, "service");
          const r = spawnSync(
            "journalctl",
            [
              "--user",
              "--unit",
              svc,
              "--since",
              `${p.sinceSeconds}s ago`,
              "--no-pager",
              "--output=cat",
            ],
            { encoding: "utf8", maxBuffer: this.limits.logBytes },
          );
          const text = (r.stdout ?? "").slice(0, this.limits.logBytes);
          return Broker.okAnswer(id, {
            text,
            truncated: (r.stdout ?? "").length > text.length,
            observedAtMs: Date.now(),
          });
        }
        default:
          return Broker.errorAnswer(id, {
            code: "UNKNOWN_METHOD",
            message: `unhandled method ${method}`,
            retry: "never",
          });
      }
    } catch (e) {
      if (e instanceof StopSignal) throw e;
      return Broker.errorAnswer(id, {
        code: e instanceof StoreError ? e.code : "INTERNAL_ERROR",
        message: (e as Error).message,
        retry: "never",
      });
    }
  }

  private requireRunnerUnit(pid: number, agent: Actor): void {
    const unit = unitName(this.paths.society, agent, "service");
    const unitCg = this.units.observe(agent).cgroup;
    const peerCg = peerCgroup(pid);
    const prefix = unitCg?.endsWith("/") ? unitCg : `${unitCg}/`;
    if (!unitCg || !peerCg || (peerCg !== unitCg && !peerCg.startsWith(prefix)))
      throw new StoreError("AUTH_FAILED", `caller is not inside ${unit}`);
  }

  /** Resolve the runner actor from physical cgroup identity, never request params. */
  private runnerActor(pid: number): Actor {
    const peerCg = peerCgroup(pid);
    if (!peerCg) throw new StoreError("AUTH_FAILED", "runner cgroup unavailable");
    const matches: Actor[] = [];
    for (const row of this.store.listAgents()) {
      if (row.role !== "resident" || row.desired === "retired") continue;
      const unitCg = this.units.observe(row.name).cgroup;
      if (!unitCg) continue;
      const prefix = unitCg.endsWith("/") ? unitCg : `${unitCg}/`;
      if (peerCg === unitCg || peerCg.startsWith(prefix)) matches.push(row.name);
    }
    if (matches.length !== 1)
      throw new StoreError("AUTH_FAILED", "runner cgroup identity is ambiguous");
    return matches[0]!;
  }

  private async dispatchInternal(
    raw: Record<string, unknown>,
    peer: { pid: number; uid: number; gid: number },
    _stream: AsyncIterable<Uint8Array> | null,
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
      switch (method) {
        case "runner.open": {
          if (
            typeof params.agent !== "string" ||
            !isValidActorName(params.agent) ||
            !Object.keys(params).every((k) => ["agent", "invocationId"].includes(k))
          ) {
            throw new StoreError("INVALID_REQUEST", "runner.open args invalid");
          }
          this.requireRunnerUnit(peer.pid, params.agent);
          return Broker.okAnswer(id, this.openRun(params.agent));
        }
        case "batch.prepare": {
          if (Object.keys(params).length !== 0)
            throw new StoreError("INVALID_REQUEST", "batch.prepare takes no params");
          const agent = this.runnerActor(peer.pid);
          const row = this.store.getAgent(agent);
          if (!row) throw new StoreError("AUTH_FAILED", "runner identity missing");
          const batch = await this.mail.prepare(
            this.runnerAuth(agent, row.incarnation),
          );
          if (!batch) return Broker.okAnswer(id, null);
          this.mail.moveToCur(agent, batch.messageIds);
          const viewDir = join(
            this.paths.stateRoot,
            "agents",
            agent,
            "runner",
            "view",
          );
          mkdirSync(viewDir, { recursive: true });
          writeViewSheet(
            join(viewDir, `batch-${batch.id}.json`),
            JSON.stringify({
              id: batch.id,
              agent: batch.agent,
              incarnation: batch.incarnation,
              deliveryMode: batch.deliveryMode,
              notice: batch.notice,
              messageIds: batch.messageIds,
            }),
          );
          this.views.publishInbox(batch);
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
          if (
            typeof evidence.batchId !== "string" ||
            !/^b-[0-9a-f-]{36}$/.test(evidence.batchId) ||
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
          this.requireRunnerUnit(peer.pid, agent);
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
          const principal = this.store.getAgent("principal");
          if (!principal) return Broker.okAnswer(id, { moved: 0, pending: 0 });
          const moved = this.mail.moveToCur("principal", []);
          const pending = this.store.pendingDeliveries("principal").length;
          const newFiles = listNewFiles(
            join(this.paths.stateRoot, "mail", "inboxes", "principal", "new"),
          );
          for (const f of newFiles)
            this.mail.moveToCur("principal", [f as never]);
          return Broker.okAnswer(id, {
            moved: newFiles.length,
            pending: pending + moved,
          });
        }
        case "host.reconcile": {
          const rep = this.reconcile
            ? await this.reconcile.sweep()
            : await this.mail.reconcilePending();
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
    return {
      actor: agent,
      incarnation,
      role: row?.role ?? "resident",
      channel: "trusted-runner",
      capabilities: capabilitiesOf(row ?? { specJson: "{}" }),
      peer: { pid: 0, uid: -1, gid: -1, cgroup: null },
    };
  }

  private openRun(actor: Actor): RunLease {
    const agent = this.store.getAgent(actor);
    if (!agent) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${actor}`);
    if (agent.desired === "stopped")
      throw new StoreError("STALE_RUN", `${actor} is stopped`);
    if (agent.desired === "retired")
      throw new StoreError("AGENT_RETIRED", `${actor} is retired`);
    let next = agent.incarnation;
    this.store.transaction((_tx) => {
      next = this.store.getAgent(actor)!.incarnation + 1;
      this.store.updateAgent({ name: actor, incarnation: next });
    });
    const listener = this.listenActor(actor);
    return { actor, incarnation: next, socketHostPath: listener.socketHostPath };
  }

  drainAndClose(): void {
    this.adminServer?.close();
    for (const srv of this.actorServers) {
      try {
        srv.close();
      } catch {
        /* already closed */
      }
    }
    this.actorServers.clear();
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

function listNewFiles(dir: string): string[] {
  try {
    mkdirSync(dir, { recursive: true });
    return readdirSync(dir).filter((f) => !f.endsWith(":2,"));
  } catch {
    return [];
  }
}

function writeViewSheet(path: string, content: string): void {
  const fd = openSync(path, "w", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
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
  state: string;
  resultJson: string | null;
  errorCode: string | null;
}): Receipt {
  const rec: Receipt = {
    operation: op.id,
    state: op.state as Receipt["state"],
  };
  if (op.resultJson) {
    try {
      rec.result = JSON.parse(op.resultJson);
    } catch {
      /* corrupt result; receipt stays minimal */
    }
  }
  if (op.errorCode) {
    rec.error = {
      code: op.errorCode as never,
      message: op.errorCode,
      retry: "same-key",
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
