// MUST [AUTH-001..003]/[IPC-*]/[REC-007]: broker core — singleton lock, actor
// listener auth (SO_PEERCRED + cgroup), public dispatch, runner channel.
import { createServer, type Socket } from "node:net";
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
  Capability,
  Request,
  Receipt,
  RunLease,
} from "../implementation/contracts.js";
import { Store, StoreError } from "./store.js";
import {
  isValidActorName,
  isValidRequestKey,
  isValidTopicName,
} from "./ids.js";
import { FrameParser, FrameError } from "./frame.js";
import { createHash } from "node:crypto";
import { MailModule, StopSignal } from "./mail.js";
import { UnitsModule } from "./units.js";
import { peerCred, tryFlock, sdNotifyReady } from "./leaf.js";
import { LifecycleModule } from "./lifecycle.js";
import { GitModule } from "./git.js";
import { ViewsModule } from "./views.js";
import { batchOf } from "./mail.js";
import { unitName } from "./units.js";

export interface BrokerPaths {
  stateRoot: string; // S
  runRoot: string; // R
  society: string;
}

/** /proc/<pid>/cgroup path of a peer (cgroup v2 path is the last segment after ':'). */
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

/** SAFETY: Node does not expose the unix-socket fd; S-01 verified `sock._handle.fd`
 * is the stable private accessor (peer identity comes from SO_PEERCRED on it). */
function socketFd(sock: Socket): number {
  // SAFETY: Node hides the unix-socket fd; S-01 verified `_handle.fd` is the
  // stable private accessor and peer identity comes from SO_PEERCRED on it.
  const handle = (sock as unknown as { _handle?: { fd?: number } })._handle;
  const fd = handle?.fd;
  if (typeof fd !== "number" || fd < 0)
    throw new StoreError("AUTH_FAILED", "no socket fd");
  return fd;
}

export class Broker {
  private adminServer: ReturnType<typeof createServer> | null = null;
  private lockFd: number | null = null;
  private running = false;

  constructor(
    private readonly store: Store,
    private readonly mail: MailModule,
    private readonly units: UnitsModule,
    private readonly views: ViewsModule,
    private readonly lifecycle: LifecycleModule,
    private readonly git: GitModule | null,
    private readonly paths: BrokerPaths,
  ) {}

  /** MUST [REC-007]: process-lifetime lock before any DB use; admin socket bind. */
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

  /** MUST [UNIT-004]: READY=1 after recovery and endpoints are prepared. */
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
    return { socketHostPath: path, done: () => srv.close() };
  }

  // -------------------------------------------------------------------------
  // actor endpoint (AUTH-003): the listener pins actor+incarnation; payload never does.
  // -------------------------------------------------------------------------

  private handleActor(sock: Socket, actor: Actor, incarnation: number): void {
    void incarnation;
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
    this.serveFrames(sock, (raw) => this.dispatch(auth, raw as Request));
  }

  /** MUST [AUTH-003]: cgroup-mapped identity; fail closed on ambiguity. */
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
    if (!peerCg.startsWith(unitCg)) return null;
    return {
      actor,
      incarnation: agent.incarnation,
      role: agent.role,
      channel: "actor",
      capabilities: relevantCapabilities(agent),
      peer: { pid: cred.pid, uid: cred.uid, gid: cred.gid, cgroup: peerCg },
    };
  }

  /** runner channel (IPC-009): internal methods on the host admin socket. */
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
    this.serveFrames(sock, (raw) => this.dispatchInternal(raw, cred));
  }

  private pendingStream: AsyncIterable<Uint8Array> | null = null;

  /** MUST [IPC-002]: a metadata frame with a body descriptor switches this
   * connection to raw-byte collection of exactly descriptor.bytes (no JSON
   * frames interleaved), then dispatches with the collected bytes. */
  private serveFrames(
    sock: Socket,
    handle: (raw: Record<string, unknown>) => Promise<unknown> | unknown,
  ): void {
    const parser = new FrameParser(256 * 1024);
    const write = (obj: unknown) => sock.write(JSON.stringify(obj) + "\n");
    let streamMode: { remaining: number; chunks: Uint8Array[]; total: number; sha: ReturnType<typeof createHash>; onDone: (all: Uint8Array) => void } | null = null;
    sock.on("data", (chunk: Buffer) => {
      if (streamMode) {
        streamMode.chunks.push(chunk);
        streamMode.total += chunk.length;
        streamMode.sha.update(chunk);
        if (streamMode.total > streamMode.remaining) {
          write(Broker.errorAnswer("x", { code: "STREAM_INVALID", message: "stream exceeds descriptor.bytes", retry: "same-key" }));
          streamMode = null;
          return;
        }
        if (streamMode.total === streamMode.remaining) {
          const done = streamMode.onDone;
          const all = Buffer.concat(streamMode.chunks);
          streamMode = null;
          done(all);
        }
        return;
      }
      let frames: { raw: unknown; text: string }[];
      try {
        frames = parser.feed(Buffer.from(chunk));
      } catch (e) {
        if (e instanceof FrameError) {
          write(
            Broker.errorAnswer("x", {
              code: e.code,
              message: e.message,
              retry: "never",
            }),
          );
        } else {
          write(
            Broker.errorAnswer("x", {
              code: "INVALID_REQUEST",
              message: "frame error",
              retry: "never",
            }),
          );
        }
        return;
      }
      for (const f of frames) {
        const raw = f.raw as Record<string, unknown>;
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
        const desc = (typeof p.bundle === "object" && p.bundle !== null ? p.bundle : typeof p.content === "object" && p.content !== null ? p.content : null) as Record<string, unknown> | null;
        const wantsStream = method === "git.submit" || method === "context.publish";
        if (wantsStream && desc && typeof desc.bytes === "number") {
          streamMode = {
            remaining: desc.bytes,
            chunks: [],
            total: 0,
            sha: createHash("sha256"),
            onDone: (all) => {
              this.pendingStream = (async function* () { yield all; })();
              Promise.resolve(handle(raw)).then(
                (r) => write(r),
                (e) =>
                  write(
                    Broker.errorAnswer(id, {
                      code: e instanceof StoreError ? e.code : "INTERNAL_ERROR",
                      message: (e as Error).message,
                      retry: "same-key",
                    }),
                  ),
              ).finally(() => { this.pendingStream = null; });
            },
          };
          return;
        }
        Promise.resolve(handle(raw)).then(
          (r) => write(r),
          (e) =>
            write(
              Broker.errorAnswer(id, {
                code: e instanceof StoreError ? e.code : "INTERNAL_ERROR",
                message: (e as Error).message,
                retry: "never",
              }),
            ),
        );
      }
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
    sock.end(JSON.stringify(Broker.errorAnswer("x", error)));
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

  /** MUST [M-003]/[IPC-009]: runtime params validation at the trust boundary. */
  private checkParams(
    method: string,
    rawParams: unknown,
  ): Record<string, unknown> | null {
    const p =
      typeof rawParams === "object" &&
      rawParams !== null &&
      !Array.isArray(rawParams)
        ? (rawParams as Record<string, unknown>)
        : {};
    switch (method) {
      case "operation.get":
        return typeof p.key === "string" && isValidRequestKey(p.key)
          ? { key: p.key }
          : null;
      case "status.get":
        return p.agent === undefined ||
          (typeof p.agent === "string" && isValidActorName(p.agent))
          ? {}
          : null;
      case "mail.ack":
        return typeof p.message === "string" &&
          /^m-[0-9a-f-]{36}-\d+$/.test(p.message)
          ? { message: p.message }
          : null;
      case "route.follow":
      case "route.unfollow":
        return typeof p.topic === "string" && isValidTopicName(p.topic)
          ? { topic: p.topic }
          : null;
      case "agent.start":
      case "agent.stop":
        return typeof p.agent === "string" && isValidActorName(p.agent)
          ? { agent: p.agent }
          : null;
      case "agent.continue":
        return typeof p.note === "string" &&
          p.note.length > 0 &&
          p.note.length <= 65536
          ? { note: p.note }
          : null;
      case "agent.create":
        // MUST [CREATE-001]: only name/from/brief; profile/capabilities are forbidden
        if (Object.keys(p).some((k) => !["name", "from", "brief"].includes(k)))
          return null;
        if (typeof p.name !== "string" || !isValidActorName(p.name))
          return null;
        if (
          typeof p.from !== "string" ||
          !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(p.from)
        )
          return null;
        if (
          typeof p.brief !== "string" ||
          p.brief.length === 0 ||
          p.brief.length > 8192
        )
          return null;
        return { name: p.name, from: p.from, brief: p.brief };
      case "mail.send": {
        // mail.send enters through MailModule.send which revalidates shape+limits
        return p;
      }
      case "agent.wait":
        return Object.keys(p).length === 0 ? {} : null;
      default:
        return null;
    }
  }

  /** MUST [IPC-009]: dispatch only the closed public method set. */
  async dispatch(auth: AuthContext, req: Request): Promise<object> {
    const id = req.id;
    // SAFETY: the frame parser already rejected non-object roots; the method key
    // is narrowed by the switch below and params are runtime-checked.
    const method = (req as unknown as { method: string }).method;
    // SAFETY: params shape is runtime-checked by checkParams() before use;
    // the cast only widens the envelope so the validator can read it.
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
        case "status.get":
          return Broker.okAnswer(id, await this.views.status());
        case "operation.get": {
          const op = this.store.getOperation(
            auth.actor,
            (params as { key: string }).key,
          );
          return Broker.okAnswer(id, op ? receiptOfRow(op) : receiptNotFound);
        }
        case "mail.send": {
          // mail.send params are revalidated inside MailModule.send (limits+shape)
          return Broker.okAnswer(
            id,
            await this.mail.send(auth, keyOf(req), params as never),
          );
        }
        case "mail.ack":
          return Broker.okAnswer(
            id,
            this.lifecycle.ack(
              auth,
              (params as { message: string }).message as never,
            ),
          );
        case "route.follow":
          return Broker.okAnswer(
            id,
            this.lifecycle.follow(
              auth,
              (params as { topic: string }).topic,
              true,
            ),
          );
        case "route.unfollow":
          return Broker.okAnswer(
            id,
            this.lifecycle.follow(
              auth,
              (params as { topic: string }).topic,
              false,
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
            await this.mail.send(auth, keyOf(req), {
              to: [auth.actor],
              subject: "continue",
              kind: "message",
              body: (params as { note: string }).note,
            }),
          );
        case "agent.wait":
          return Broker.okAnswer(id, { accepted: true }); // memory intent; runner applies at the safe boundary
        case "git.known": {
          if (!this.git) throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          const r = this.git.knownRefs();
          return Broker.okAnswer(id, { hasCandidate: r.published.includes((params as { candidate: string }).candidate), prerequisites: [...r.published] });
        }
        case "git.submit": {
          if (!this.git) throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          const bytes = this.pendingStream ?? emptyStream();
          const receipt = await this.git.submit(auth, keyOf(req), params as never, bytes);
          return Broker.okAnswer(id, receipt);
        }
        case "git.integrate": {
          if (!this.git) throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          const p = params as { candidate: string; expected: string };
          return Broker.okAnswer(id, await this.git.integrate(auth, keyOf(req), { candidate: p.candidate, expected: p.expected }, "policy-rev-1", []));
        }
        case "context.publish": {
          if (!this.git) throw new StoreError("SPIKE_UNRESOLVED", "context module unavailable");
          const bytes = this.pendingStream ?? emptyStream();
          const receipt = await this.git.publishContext(auth, keyOf(req), params as never, bytes);
          return Broker.okAnswer(id, receipt);
        }
        case "logs.read":
          throw new StoreError(
            "SPIKE_UNRESOLVED",
            "logs.read needs the phase 8 observability module",
          );
        default:
          return Broker.errorAnswer(id, {
            code:
              method in KNOWN_METHODS ? "CAPABILITY_DENIED" : "UNKNOWN_METHOD",
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

  /** MUST [IPC-009]/[AUTH-003]: runner-channel identity = peer cgroup inside the
   * resident unit. Fail closed when the caller is not that unit's descendant. */
  private requireRunnerUnit(pid: number, agent: Actor): void {
    const unit = unitName(this.paths.society, agent, "service");
    const unitCg = this.units.observe(agent).cgroup;
    const peerCg = peerCgroup(pid);
    if (!unitCg || !peerCg || !peerCg.startsWith(unitCg)) {
      throw new StoreError("AUTH_FAILED", `caller is not inside ${unit}`);
    }
  }

  private async dispatchInternal(
    raw: Record<string, unknown>,
    peer: { pid: number; uid: number; gid: number },
  ): Promise<object> {
    const method = raw.method as string;
    const params = (raw.params ?? {}) as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : "x";
    switch (method) {
      case "runner.open": {
        if (
          typeof params.agent !== "string" ||
          !isValidActorName(params.agent)
        ) {
          return Broker.errorAnswer(id, {
            code: "INVALID_REQUEST",
            message: "runner.open needs an agent",
            retry: "never",
          });
        }
        this.requireRunnerUnit(peer.pid, params.agent);
        return Broker.okAnswer(id, this.openRun(params.agent));
      }
      case "batch.prepare": {
        const agent = typeof params.agent === "string" ? params.agent : "";
        if (!isValidActorName(agent)) {
          return Broker.errorAnswer(id, {
            code: "INVALID_REQUEST",
            message: "batch.prepare needs an agent",
            retry: "never",
          });
        }
        this.requireRunnerUnit(peer.pid, agent);
        const auth = this.runnerAuth(
          agent,
          this.store.getAgent(agent)?.incarnation ?? 0,
        );
        const batch = await this.mail.prepare(auth);
        return Broker.okAnswer(id, batch);
      }
      case "batch.stage": {
        const agent = typeof params.agent === "string" ? params.agent : "";
        const batchId =
          typeof params.batchId === "string" ? params.batchId : "";
        if (!isValidActorName(agent) || !/^b-[0-9a-f-]{36}$/.test(batchId)) {
          return Broker.errorAnswer(id, {
            code: "INVALID_REQUEST",
            message: "batch.stage args invalid",
            retry: "never",
          });
        }
        this.requireRunnerUnit(peer.pid, agent);
        const batch = this.store.getBatch(batchId);
        if (!batch || batch.agent !== agent) {
          return Broker.errorAnswer(id, {
            code: "BATCH_CONFLICT",
            message: "batch ownership mismatch",
            retry: "same-key",
          });
        }
        const ids = safeList(batch.messageIdsJson, batchId);
        this.mail.moveToCur(agent, ids);
        const prepared = batchOf(
          {
            id: batch.id,
            incarnation: batch.incarnation,
            messageIds: ids,
            sessionPath: batch.sessionPath,
          },
          agent,
        );
        const viewDir = join(
          this.paths.stateRoot,
          "agents",
          agent,
          "runner",
          "view",
        );
        mkdirSync(viewDir, { recursive: true });
        const view = {
          id: prepared.id,
          agent: prepared.agent,
          incarnation: prepared.incarnation,
          deliveryMode: prepared.deliveryMode,
          notice: prepared.notice,
          messageIds: prepared.messageIds,
        };
        writeViewSheet(
          join(viewDir, `batch-${batchId}.json`),
          JSON.stringify(view),
        );
        this.views.publishInbox(prepared);
        // the extension reads the notice from the view manifest
        writeViewSheet(
          join(viewDir, `batch-${batchId}.json`),
          JSON.stringify({ ...view, notice: prepared.notice }),
        );
        return Broker.okAnswer(id, { staged: true });
      }
      case "batch.complete": {
        const agent = typeof params.agent === "string" ? params.agent : "";
        if (!isValidActorName(agent)) {
          return Broker.errorAnswer(id, {
            code: "INVALID_REQUEST",
            message: "batch.complete needs an agent",
            retry: "never",
          });
        }
        this.requireRunnerUnit(peer.pid, agent);
        const auth = this.runnerAuth(
          agent,
          this.store.getAgent(agent)?.incarnation ?? 0,
        );
        const evidence = params as {
          batchId: string;
          incarnation: number;
          sessionPath: string;
          adapterRevision: string;
          receiptPath: string;
        };
        if (
          typeof evidence.batchId !== "string" ||
          !/^b-[0-9a-f-]{36}$/.test(evidence.batchId)
        ) {
          return Broker.errorAnswer(id, {
            code: "INVALID_REQUEST",
            message: "bad evidence",
            retry: "never",
          });
        }
        try {
          await this.mail.complete(auth, evidence);
          return Broker.okAnswer(id, { completed: true });
        } catch (e) {
          return Broker.errorAnswer(id, {
            code: e instanceof StoreError ? e.code : "INTERNAL_ERROR",
            message: (e as Error).message,
            retry: "same-key",
          });
        }
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
        const rep = await this.mail.reconcilePending();
        return Broker.okAnswer(id, rep);
      }
      default:
        return Broker.errorAnswer(id, {
          code: "UNKNOWN_METHOD",
          message: `internal ${method}`,
          retry: "never",
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
      capabilities: new Set<Capability>(["mail.send", "agent.manage.self"]),
      peer: { pid: 0, uid: -1, gid: -1, cgroup: null },
    };
  }

  /** MUST [LIFE-004]/[T-run-open]: fence previous incarnation, then issue a lease. */
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
    const ls = this.listenActor(actor);
    return { actor, incarnation: next, socketHostPath: ls.socketHostPath };
  }

  drainAndClose(): void {
    this.adminServer?.close();
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

function safeList(json: string, what: string): string[] {
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v) && v.every((x) => typeof x === "string"))
      return v as string[];
  } catch {
    /* fallthrough */
  }
  throw new StoreError("STORE_CORRUPT", `${what} has corrupt message list`);
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
  return (async function* () { /* no bytes */ })();
}

function keyOf(req: { request?: string }): string {
  if (typeof req.request !== "string" || req.request.length === 0) {
    throw new StoreError("INVALID_REQUEST", "mutation requires a request key");
  }
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

function relevantCapabilities(agent: {
  role: string;
  desired: string;
}): ReadonlySet<Capability> {
  if (agent.role === "principal") {
    return new Set<Capability>([
      "mail.send",
      "route.follow",
      "context.publish",
    ]);
  }
  return new Set<Capability>([
    "mail.send",
    "route.follow",
    "agent.manage.self",
    "git.submit",
  ]);
}

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
