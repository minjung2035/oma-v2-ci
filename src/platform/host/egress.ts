/** The host's end of egress (macos-platform §4.7, §7): the pool of
 * connections it keeps open to the guest, and a relay per run.
 *
 * Nothing about a provider is decided in the guest. A run's placeholder is
 * made here from the credential this host resolved with its own engine state
 * (MAC-704), and each connection an engine opens reaches the provider through
 * the existing `InferenceRelay` -- the same key substitution, header rules,
 * concurrency limit and tripwire as on Linux -- created for that run and
 * listening nowhere: the pool hands it its connections.
 */
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { encodeFrame } from "../../frame.js";
import { InferenceRelay, type RelayLimits } from "../../runtime/inference-relay.js";
import { makePublicDial, type ConnectDial, type EgressAudit } from "../../runtime/connect-proxy.js";
import { placeholderFor, type EngineAuth } from "../../runtime/engine-auth.js";
import { platformFailure, readLeadingFrame } from "../rpc.js";
import {
  egressConnectProblem, egressOpenProblem, egressPlaceholderProblem, requestProblem,
  type EgressConnectParams, type EgressOpenParams, type EgressPlaceholderParams, type EgressPlaceholderResult,
} from "../../protocol/host-guest.js";
import { StoreError } from "../../domain/errors.js";

export interface EgressHostOptions {
  /** Opens one egress connection to the guest and completes its hello. */
  readonly open: (signal: AbortSignal) => Promise<{ readonly socket: Socket; readonly rest: Buffer }>;
  /** MAC-704: this host's engine state, never the guest's. */
  readonly resolve: (credentialRef: string, provider: string, model: string) => Promise<EngineAuth>;
  /** Resolves and pins a target on the host network, including literal/private
   * addresses and arbitrary ports. Closing its run cancels the owned dial. */
  readonly dial?: ConnectDial;
  /** One record per connect decision -- actor, target, verdict, reason. */
  readonly audit?: (entry: EgressAudit) => void;
  readonly limits: RelayLimits;
  readonly frameBytes: number;
  /** The most connections kept waiting, whatever the runs ask (MAC-225). */
  readonly maxPool: number;
  /** Transport recovery cadence, independent of run/request budgets. */
  readonly retry?: { readonly initialMs: number; readonly maxMs: number };
}

type Run = { readonly relay: InferenceRelay; readonly params: EgressPlaceholderParams; readonly lease: Socket | null;
  readonly tunnels: Set<Socket> };

export class EgressHost {
  private readonly runs = new Map<string, Run>();
  private readonly idle = new Set<Socket>();
  private filling: { readonly boot: number; readonly promise: Promise<void> } | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryMs: number;
  private readonly retry: { readonly initialMs: number; readonly maxMs: number };
  private enabled = true;
  private stopped = false;
  /** MAC-211: which guest boot the runs belong to. A placeholder request that
   * outlives the boot it was asked in creates nothing (AV-14). */
  private boot = 0;
  private bootAbort = new AbortController();

  constructor(private readonly options: EgressHostOptions) {
    // Start at the existing handshake retry cadence; cap only retry delay,
    // not attempts or run lifetime. A healthy guest recovers without traffic.
    this.retry = options.retry ?? { initialMs: 250, maxMs: 5000 };
    if (!Number.isFinite(this.retry.initialMs) || this.retry.initialMs <= 0 ||
        !Number.isFinite(this.retry.maxMs) || this.retry.maxMs < this.retry.initialMs || this.retry.maxMs > 0x7fffffff)
      throw new StoreError("INVALID_REQUEST", "invalid egress recovery delays");
    this.retryMs = this.retry.initialMs;
  }

  /** MAC-225: two spare, and the existing relay's four per run. */
  get target(): number { return Math.min(2 + 4 * this.runs.size, this.options.maxPool); }
  get pooled(): number { return this.idle.size; }
  get activeRuns(): number { return this.runs.size; }

  /** Exactly one fill loop per boot. A failed open owns its next attempt. */
  fill(): Promise<void> {
    if (this.stopped || !this.enabled || this.retryTimer !== null) return Promise.resolve();
    if (this.filling?.boot === this.boot) return this.filling.promise;
    const boot = this.boot;
    const promise = this.fillBoot(boot);
    const held = { boot, promise };
    this.filling = held;
    void promise.finally(() => { if (this.filling === held) this.filling = null; }).catch(() => undefined);
    return promise;
  }

  private async fillBoot(boot: number): Promise<void> {
    while (!this.stopped && this.enabled && boot === this.boot && this.idle.size < this.target && this.retryTimer === null) {
      let opened: { socket: Socket; rest: Buffer };
      try { opened = await this.options.open(this.bootAbort.signal); }
      catch { if (boot === this.boot) this.retryFill(); return; }
      if (this.stopped || !this.enabled || boot !== this.boot) { opened.socket.destroy(); return; }
      this.retryMs = this.retry.initialMs;
      void this.await(opened.socket, opened.rest, boot);
    }
  }

  private retryFill(): void {
    if (this.stopped || !this.enabled || this.retryTimer !== null) return;
    const boot = this.boot;
    const timer = setTimeout(() => {
      if (this.retryTimer !== timer) return;
      this.retryTimer = null;
      if (boot === this.boot) void this.fill();
    }, this.retryMs);
    this.retryTimer = timer; timer.unref();
    this.retryMs = Math.min(this.retry.maxMs, this.retryMs * 2);
  }

  resume(): void { if (!this.stopped) this.enabled = true; }
  async pause(): Promise<void> { this.enabled = false; await this.forgetBoot(); }

  private async await(socket: Socket, rest: Buffer, boot: number): Promise<void> {
    socket.on("error", () => { socket.destroy(); });
    if (rest.length > 0) socket.unshift(rest);
    this.idle.add(socket);
    let first: { frame: Record<string, unknown>; rest: Buffer };
    try { first = await readLeadingFrame(socket, this.options.frameBytes, Number.POSITIVE_INFINITY); }
    catch {
      this.idle.delete(socket); socket.destroy();
      if (boot === this.boot) this.retryFill();
      return;
    }
    this.idle.delete(socket);
    if (this.stopped || !this.enabled || boot !== this.boot) { socket.destroy(); return; }
    void this.fill();
    const frame = first.frame;
    const problem = requestProblem(frame);
    if (problem !== null || frame.key !== undefined) { socket.destroy(); return; }
    if (frame.method === "egress.placeholder") { await this.placeholder(socket, frame.id as string, frame.params, first.rest).catch(() => socket.destroy()); return; }
    if (frame.method === "egress.open") {
      // connect() runs synchronously at dispatch: a throw inside it -- the
      // run's relay refusing the socket -- ends the connection the same way
      // the async arms' .catch does; a rejection here would reach the
      // process unhandled, because this reader is void-dispatched.
      try { this.connect(socket, frame.params, first.rest); }
      catch { socket.destroy(); }
      return;
    }
    if (frame.method === "egress.connect") {
      // The dispatch boundary owns the failure: a throw inside the request --
      // a dead socket write, a journal that refused its record -- ends the
      // connection and is never an unhandled rejection on the host.
      await this.connectTunnel(socket, frame.id as string, frame.params, first.rest).catch(() => socket.destroy());
      return;
    }
    socket.destroy();
  }

  /** `rest` is whatever rode in after the request frame: the connection is
   * read once, so any such byte is speech before an answer -- on a held
   * lease it ends the connection before a run can stand. */
  private async placeholder(socket: Socket, id: string, params: unknown, rest: Buffer): Promise<void> {
    const answer = (value: Record<string, unknown>): void => { socket.end(encodeFrame({ v: 1, id, ...value })); };
    const problem = egressPlaceholderProblem(params);
    if (problem !== null) { answer({ ok: false, error: { code: "INVALID_REQUEST", message: problem, retry: "never" } }); return; }
    const asked = params as EgressPlaceholderParams;
    const boot = this.boot;
    try {
      const auth = await this.options.resolve(asked.credentialRef, asked.provider, asked.model);
      // AV-14: the resolution outlived the boot it was asked in -- a stop or a
      // reboot already released what it made, or the asker itself is gone.
      // Nothing is created from it now; the asker learns of the end from the
      // connection, not from an answer.
      if (this.stopped || boot !== this.boot || socket.destroyed) { socket.destroy(); return; }
      const placeholder = placeholderFor(auth.apiKey);
      const relay = InferenceRelay.detached({ origin: auth.origin, headers: auth.headers, substitute: { placeholder, secret: auth.apiKey } },
        { ...this.options.limits, timeoutMs: asked.inferenceSeconds === undefined ? this.options.limits.timeoutMs : asked.inferenceSeconds * 1000 });
      const placeholderId = randomUUID();
      // A held connection is the run's lease (§4.7 v5): the run ends when it
      // ends -- a run's own close, or a guest gone without a word. Anything it
      // says after the answer is not a message; the run ends the same way.
      const lease = asked.hold === true ? socket : null;
      this.runs.set(placeholderId, { relay, params: asked, lease, tunnels: new Set() });
      const result: EgressPlaceholderResult = { placeholderId, placeholder, provider: auth.provider, model: auth.model };
      if (lease === null) {
        answer({ ok: true, result });
      } else {
        socket.once("close", () => { void this.release(placeholderId).catch(() => undefined); });
        socket.on("data", () => { socket.destroy(); });
        // Bytes that rode with the request are the same break seen from a
        // later segment: the connection dies unanswered, the run with it
        // (the "close" listener above releases it).
        if (rest.length > 0) { socket.destroy(); return; }
        socket.write(encodeFrame({ v: 1, id, ok: true, result }));
        // readLeadingFrame left the socket paused; a "data" listener alone
        // does not resume it, so speech in a later segment would never have
        // been heard. The lease flows now that its listeners stand.
        socket.resume();
      }
      void this.fill();
    } catch (error) {
      answer({ ok: false, error: platformFailure(error) });
    }
  }

  private connect(socket: Socket, params: unknown, rest: Buffer): void {
    const run = egressOpenProblem(params) === null ? this.runs.get((params as EgressOpenParams).placeholderId) : undefined;
    // A placeholder this host did not issue in this boot opens nothing (MAC-712).
    if (run === undefined) { socket.destroy(); return; }
    const opened = params as EgressOpenParams;
    if (opened.society !== run.params.run.society || opened.actor !== run.params.run.actor || opened.incarnation !== run.params.run.incarnation) {
      socket.destroy();
      return;
    }
    run.relay.accept(socket, rest);
  }

  /** DR37: the host permits network destinations for a live, host-issued run.
   * Guest role/allow fields are compatibility metadata, not host policy.
   * The host resolves and dials the requested host and port. An answered `ok` makes the
   * connection the tunnel; a refusal is a framed error, and either way the
   * pooled connection ends -- like `egress.open`, a second request on it is
   * not possible. Every tunnel a run still holds dies with the run. */
  private async connectTunnel(socket: Socket, id: string, params: unknown, rest: Buffer): Promise<void> {
    const audit = (actor: string, role: string, target: string, decision: EgressAudit["decision"], reason: string): void =>
      this.options.audit?.({ actor, role, target, decision, reason });
    const answer = (value: Record<string, unknown>): void => { socket.end(encodeFrame({ v: 1, id, ...value })); };
    const problem = egressConnectProblem(params);
    if (problem !== null) { audit("?", "?", "", "refuse", problem); answer({ ok: false, error: { code: "INVALID_REQUEST", message: problem, retry: "never" } }); return; }
    const asked = params as EgressConnectParams;
    const target = `${asked.host}:${asked.port}`;
    const run = this.runs.get(asked.placeholderId);
    if (run === undefined || asked.run.society !== run.params.run.society || asked.run.actor !== run.params.run.actor ||
        asked.run.incarnation !== run.params.run.incarnation) {
      audit(asked.run.actor, asked.role, target, "refuse", "not this boot's run");
      answer({ ok: false, error: { code: "STALE_RUN", message: "not this boot's run", retry: "never" } });
      return;
    }
    await this.dialTunnel(run, socket, id, asked, target, rest);
  }

  /** The run owns every project tunnel until both halves close. */
  private async dialTunnel(run: Run, socket: Socket, id: string, asked: EgressConnectParams, target: string,
    rest: Buffer): Promise<void> {
    const audit = (actor: string, role: string, decision: EgressAudit["decision"], reason: string): void =>
      this.options.audit?.({ actor, role, target, decision, reason });
    const answer = (value: Record<string, unknown>): void => { socket.end(encodeFrame({ v: 1, id, ...value })); };
    run.tunnels.add(socket);
    const owner = new AbortController();
    // Closing a client cancels its pending dial and releases run ownership.
    // A socket already closed reports `closed` without another close event.
    socket.once("close", () => { owner.abort(); run.tunnels.delete(socket); });
    if (socket.closed) { owner.abort(); run.tunnels.delete(socket); return; }
    const dial = this.options.dial ?? makePublicDial();
    let upstream: Socket;
    try { upstream = await dial(asked.host, asked.port, owner.signal); }
    catch (error) {
      // Invalid endpoint requests are refusals; transport errors are failures.
      const refused = error instanceof StoreError && error.code === "INVALID_REQUEST";
      audit(asked.run.actor, asked.role, refused ? "refuse" : "fail",
        (error instanceof Error ? error.message : String(error)).slice(0, 120));
      answer(refused
        ? { ok: false, error: { code: "INVALID_REQUEST", message: (error as Error).message, retry: "never" } }
        : { ok: false, error: platformFailure(error) });
      return;
    }
    // From here anything that throws -- a dead socket write, a journal that
    // refused its record -- ends both halves; a dialed connection is never
    // orphaned to failure bookkeeping.
    try {
      if (!this.runs.has(asked.placeholderId) || socket.destroyed) {
        // The run ended under the dial, or its connection did; the tunnel
        // it would have owned is dropped, and the decision is still
        // written once.
        const runGone = !this.runs.has(asked.placeholderId);
        upstream.destroy();
        socket.destroy();
        audit(asked.run.actor, asked.role, "fail",
          runGone ? "the run ended during the dial" : "the connection closed during the dial");
        return;
      }
      audit(asked.run.actor, asked.role, "allow", "connected");
      socket.write(encodeFrame({ v: 1, id, ok: true, result: {} }));
      if (rest.length > 0) upstream.write(rest);
      socket.once("close", () => { upstream.destroy(); });
      upstream.once("close", () => { socket.destroy(); });
      socket.once("error", () => socket.destroy());
      upstream.once("error", () => upstream.destroy());
      socket.pipe(upstream); upstream.pipe(socket);
    } catch {
      upstream.destroy();
      socket.destroy();
    }
  }

  /** The run ended -- its lease closed, the guest rebooted, or the service
   * stopped: its placeholder opens nothing more and its tunnels die with it. */
  async release(placeholderId: string): Promise<void> {
    const run = this.runs.get(placeholderId);
    if (run === undefined) return;
    this.runs.delete(placeholderId);
    run.lease?.destroy();
    for (const socket of run.tunnels) socket.destroy();
    await run.relay.close();
  }

  /** MAC-211: a new bootId means no placeholder of the last boot is valid. */
  async forgetBoot(): Promise<void> {
    // The boot boundary first, so a resolution completing during the release
    // is already the last boot's and creates nothing (AV-14).
    this.boot += 1;
    this.bootAbort.abort(); this.bootAbort = new AbortController();
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null; this.retryMs = this.retry.initialMs;
    for (const socket of this.idle) socket.destroy();
    this.idle.clear();
    await Promise.all([...this.runs.keys()].map(id => this.release(id)));
    if (!this.stopped && this.enabled) void this.fill();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.enabled = false;
    await this.forgetBoot();
  }
}
