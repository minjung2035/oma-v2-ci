/** DR18 (D-10): a run's provider path inside the macOS guest.
 *
 * In the guest there is no provider credential (it stays in the host's
 * Keychain, MAC-701) and no route to a provider. The guest's own egress
 * service (macos-platform §4.7) is the way out: asked once per run, the host
 * issues a placeholder for that run; asked once per engine connection, it
 * hands over a connection the host relays with the real key. This module is
 * the product's side of that in the guest: it asks for the run's placeholder
 * and opens, at the socket the engine is given, a forwarder that turns each
 * engine connection into one egress connection -- bytes unread, as the
 * relay's own socket would carry them. Where the guest's environment names
 * no egress socket (`OMA_EGRESS_SOCKET`), none of this runs: the run resolves
 * its credential and opens its own relay, as on Linux.
 */
import { randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { clearSocketName } from "../storage/socket-name.js";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { isErrorCode, StoreError } from "../domain/errors.js";
import { FrameError, FrameParser, encodeFrame } from "../frame.js";
import { alarm, type Timer } from "./pi-rpc.js";
import {
  EGRESS_ENGINE_MANAGED, egressPlaceholderResultProblem,
  type EgressConnectParams, type EgressOpenParams, type EgressPlaceholderParams, type EgressPlaceholderResult,
} from "../protocol/host-guest.js";
import type { EgressPolicy } from "../domain/egress.js";

/** The environment name the guest image sets (environment.d) for the egress
 * service's socket. Its absence is the Linux distribution. */
export const EGRESS_SOCKET_ENV = "OMA_EGRESS_SOCKET";

export interface EgressAsk {
  readonly socket: string;
  readonly frameBytes: number;
  readonly deadlineMs: number;
}

/** One frame from a connection, and every byte that rode in after it. The
 * protocol is one answer per request, so what follows the frame is never a
 * second frame: tunnel payload for `egress.connect`, or the host speaking on
 * a lease that reads no more -- the caller decides what the bytes mean, and
 * none are lost or fed back to the parser. The answered connection is the
 * caller's afterwards (§4.7 v5: the run's lease). An error always destroys
 * it. */
function oneFrame(socket: Socket, frameBytes: number, deadlineMs: number): Promise<{ readonly frame: Record<string, unknown>; readonly rest: Buffer }> {
  return new Promise((resolve, reject) => {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) { socket.destroy(); reject(new RangeError("Invalid egress observation deadline")); return; }
    let buffered = Buffer.alloc(0);
    let timer: Timer | undefined, settled = false;
    const done = (error: Error | null, value?: { frame: Record<string, unknown>; rest: Buffer }): void => {
      if (settled) return;
      settled = true;
      timer?.cancel();
      socket.removeAllListeners("data");
      socket.pause();
      if (error !== null) { socket.destroy(); reject(error); } else resolve(value!);
    };
    socket.on("data", (chunk: Buffer) => {
      // Only the frame's own bytes are parsed; the declared length is checked
      // before the body is awaited, so a lie cannot grow the buffer, and a
      // socket read cannot grow it past one frame plus what arrived with it.
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;
      const length = buffered.readUInt32BE(0);
      if (length > frameBytes) { done(new FrameError("FRAME_TOO_LARGE", `frame length ${length} exceeds max ${frameBytes}`)); return; }
      if (buffered.length < 4 + length) return;
      let frame: Record<string, unknown>;
      try { frame = new FrameParser(frameBytes).feed(buffered.subarray(0, 4 + length))[0]!.raw; }
      catch (error) { done(error as Error); return; }
      done(null, { frame, rest: buffered.subarray(4 + length) });
    });
    socket.once("error", () => { done(new StoreError("BROKER_UNAVAILABLE", "the egress service is unavailable")); });
    socket.once("close", () => { done(new StoreError("BROKER_UNAVAILABLE", "the egress service closed without an answer")); });
    timer = alarm(deadlineMs / 1000, () => done(new StoreError("BROKER_UNAVAILABLE", "the egress service did not answer in time")), true);
  });
}

/** The run's placeholder, as the host issued it, and the lease that ends it:
 * the connection the answer came on. `release` ends the run on the host --
 * its relay, its placeholder, the credential that stood behind them; the
 * host's own end of the run ends it from this side, and `ended` is how a
 * holder learns the run is over whichever way it ended (AV-15). */
export interface EgressLease extends EgressPlaceholderResult {
  release(): void;
  /** Fires once the lease has ended -- the run's own release, or the host's.
   * A listener registered after the end still hears it. */
  ended(listener: () => void): void;
}

/** The run's placeholder, issued by the host for this society, actor and
 * incarnation and for the engine-managed credential. The connection is asked
 * to stay open (v5 `hold`) so the host learns of the run's end from it. */
export async function requestEgressPlaceholder(ask: EgressAsk, run: EgressPlaceholderParams["run"], provider: string,
  model: string, inferenceSeconds: number): Promise<EgressLease> {
  const socket = connect(ask.socket);
  const params: EgressPlaceholderParams = { credentialRef: EGRESS_ENGINE_MANAGED, provider, model, run, inferenceSeconds, hold: true };
  socket.once("connect", () => { socket.write(encodeFrame({ v: 1, id: randomUUID(), method: "egress.placeholder", params })); });
  const { frame: answer, rest } = await oneFrame(socket, ask.frameBytes, ask.deadlineMs);
  if (answer.ok !== true) {
    socket.destroy();
    const error = answer.error as { code?: unknown; message?: unknown } | undefined;
    throw new StoreError(error?.code === "UNSUPPORTED_PROFILE" ? "UNSUPPORTED_PROFILE" : "BROKER_UNAVAILABLE",
      `the host issued no placeholder for this run: ${typeof error?.message === "string" ? error.message : "no reason given"}`);
  }
  const problem = egressPlaceholderResultProblem(answer.result);
  if (problem !== null) { socket.destroy(); throw new StoreError("BROKER_UNAVAILABLE", `the host's placeholder answer is malformed (${problem})`); }
  // The lease is read no more: anything the host says after the answer ends it
  // -- bytes that rode inside the answer's own segment included, and bytes
  // that arrive in a later segment, which reach the listener only if the
  // socket flows again: oneFrame hands it back paused, and a "data" listener
  // alone does not resume it.
  if (rest.length > 0) { socket.destroy(); }
  // Its end -- however it came, a break included -- is the run's end (AV-15).
  socket.on("data", () => { socket.destroy(); });
  socket.once("error", () => { socket.destroy(); });
  if (!socket.destroyed) socket.resume();
  const endListeners = new Set<() => void>();
  socket.once("close", () => { const listeners = [...endListeners]; endListeners.clear(); for (const listener of listeners) listener(); });
  return { ...(answer.result as unknown as EgressPlaceholderResult),
    release: () => { socket.destroy(); },
    ended: listener => { if (socket.destroyed) queueMicrotask(listener); else endListeners.add(listener); } };
}

/** DR34/UX-08: one CONNECT through the host for the run the lease stands for.
 * The service hands a pooled egress connection, carries the request, and
 * relays the host's answer: `ok` makes this socket the raw tunnel to the
 * already-dialed target, a refusal carries the host's own error code.
 * `policy` is this role's resolved allowlist -- it travels with the request
 * because the host cannot read the guest's configuration; the host checks
 * its grammar, enforces it verbatim, and screens the resolved address with
 * its own resolver on top. */
export async function requestEgressConnect(ask: EgressAsk, lease: { readonly placeholderId: string },
  run: EgressConnectParams["run"], host: string, port: number, policy: EgressPolicy): Promise<Socket> {
  const socket = connect(ask.socket);
  const params: EgressConnectParams = { placeholderId: lease.placeholderId, run, host, port, role: policy.role, allow: [...policy.allow] };
  socket.once("connect", () => { socket.write(encodeFrame({ v: 1, id: randomUUID(), method: "egress.connect", params })); });
  const { frame: answer, rest } = await oneFrame(socket, ask.frameBytes, ask.deadlineMs);
  if (answer.ok !== true) {
    socket.destroy();
    const error = answer.error as { code?: unknown; message?: unknown } | undefined;
    throw new StoreError(isErrorCode(error?.code) ? error.code : "BROKER_UNAVAILABLE",
      `the host refused the egress tunnel to ${host}:${port}: ${typeof error?.message === "string" ? error.message : "no reason given"}`);
  }
  socket.once("error", () => { socket.destroy(); });
  // Bytes that rode with the ok frame are the tunnel's first payload; they go
  // back on the socket so the reader sees them as ordinary data.
  if (rest.length > 0) socket.unshift(rest);
  socket.resume();
  return socket;
}

/** The engine's provider socket, forwarding each connection to one egress
 * connection for this run. At most `concurrent` at a time; one more is
 * refused, as the relay refuses at its limit and the engine retries. */
export class EgressForwarder {
  private readonly open = new Set<Socket>();
  private closing: Promise<void> | null = null;
  private constructor(private readonly server: Server, readonly socketPath: string,
    private readonly lease: { release(): void; ended?(listener: () => void): void } | null) {}

  /** The run's lease is the forwarder's from here: an answer it could not
   * give ends the run the same as its close does (P0-4, AV-15). And the
   * lease's end -- the run's own close, or the host's end of the run, a
   * reboot or a stop included -- is the forwarder's end too: the run it
   * served is over, so its provider path stops accepting. */
  static listen(socketPath: string, egressSocket: string, run: EgressOpenParams, concurrent: number,
    lease: { release(): void; ended?(listener: () => void): void } | null = null): Promise<EgressForwarder> {
    if (!Number.isSafeInteger(concurrent) || concurrent < 1) { lease?.release(); throw new StoreError("UNSUPPORTED_PROFILE", "the forwarder's connection bound is invalid"); }
    // A refused listen ends the run the same as an answer it could not give:
    // the lease is this forwarder's only once the socket name is cleared.
    try { clearSocketName(socketPath); }
    catch (error) { lease?.release(); throw error; }
    let forwarder: EgressForwarder;
    const server = createServer(engine => {
      if (forwarder.closing !== null || forwarder.open.size >= concurrent) { engine.destroy(); return; }
      forwarder.open.add(engine);
      const upstream = connect(egressSocket);
      const drop = (): void => { engine.destroy(); upstream.destroy(); };
      engine.once("close", () => { forwarder.open.delete(engine); upstream.destroy(); });
      engine.on("error", drop);
      upstream.on("error", drop);
      upstream.once("close", () => { engine.destroy(); });
      upstream.once("connect", () => {
        upstream.write(encodeFrame({ v: 1, id: randomUUID(), method: "egress.open", params: run }));
        engine.pipe(upstream);
        upstream.pipe(engine);
      });
    });
    forwarder = new EgressForwarder(server, socketPath, lease);
    return new Promise((resolve, reject) => {
      // From listener creation through permission setting, a failure is this
      // construction's own to clean up: the bound socket and the run's lease.
      const failed = (error: Error): void => { forwarder.lease?.release(); server.close(() => reject(error)); };
      server.once("error", failed);
      server.listen(socketPath, () => {
        server.off("error", failed);
        // P0-4: until the forwarder is handed back it is this opener's; a
        // permission failure returns the listener and the socket name rather
        // than leaving an ownerless server running (AV-20261003-28).
        try { chmodSync(socketPath, 0o600); }
        catch (error) { failed(error as Error); return; }
        // AV-15: armed once the forwarder owns the lease; a lease that ended
        // before here still closes the forwarder, from the microtask.
        lease?.ended?.(() => { void forwarder.close(); });
        resolve(forwarder);
      });
    });
  }

  /** Stops listening and ends every forwarded connection: the run is over,
   * and the host hears it on the lease (AV-15). */
  close(): Promise<void> {
    this.closing ??= new Promise(resolve => {
      this.lease?.release();
      for (const socket of this.open) socket.destroy();
      // The server's own close removes its name (P0V-114).
      this.server.close(() => { resolve(); });
    });
    return this.closing;
  }
}

/** The Principal's provider path in the guest (DR18, D-4 with D-10): the
 * engine `oma` starts is given, through the trusted extension's bridge
 * (INF-006), a loopback port that reaches this forwarder, the run's
 * placeholder, and the provider the host resolved. Opened once for the
 * `oma` process and kept across engine restarts; null where the environment
 * names no egress socket (Linux: the engine reads its own directory). */
export interface PrincipalEgress {
  readonly env: Readonly<Record<string, string>>;
  close(): Promise<void>;
}

/** What a society tenure does with a provider path it paid for (P0V-114):
 * hold it while the lease stands, close it otherwise. */
export interface EgressTenure {
  hold(holding: { close(): Promise<void> }): Promise<boolean>;
}

/** A free loopback port for the extension's bridge. The Principal's engine is
 * not in a network namespace of its own, so a fixed port could collide with
 * another society's. */
function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => { port > 0 ? resolve(port) : reject(new StoreError("BROKER_UNAVAILABLE", "no loopback port for the provider bridge")); });
    });
  });
}

export async function openPrincipalEgress(options: { readonly society: string; readonly runRoot: string; readonly provider: string;
  readonly model: string; readonly modelProfile: string; readonly frameBytes: number; readonly deadlineMs: number; readonly inferenceSeconds: number;
  readonly env: Readonly<Record<string, string | undefined>> }): Promise<PrincipalEgress | null> {
  const egress = options.env[EGRESS_SOCKET_ENV];
  if (egress === undefined || egress.length === 0) return null;
  const run = { society: options.society, actor: "principal", incarnation: 0 };
  const issued = await requestEgressPlaceholder({ socket: egress, frameBytes: options.frameBytes, deadlineMs: options.deadlineMs },
    run, options.provider, options.model, options.inferenceSeconds);
  const socketPath = join(options.runRoot, "principal-inference.sock");
  // The lease is the forwarder's now: its close is the run's end on the host.
  const forwarder = await EgressForwarder.listen(socketPath, egress,
    { placeholderId: issued.placeholderId, ...run, modelProfile: options.modelProfile }, 4, issued);
  // P0-4: the forwarder is this call's until it is handed back inside the result.
  let port: number;
  try { port = await freeLoopbackPort(); }
  catch (error) { await forwarder.close(); throw error; }
  return Object.freeze({
    env: Object.freeze({ OMA_INFERENCE_SOCKET: socketPath, OMA_INFERENCE_PROVIDER: issued.provider,
      OMA_INFERENCE_PORT: String(port), OMA_INFERENCE_KEY: issued.placeholder }),
    close: () => forwarder.close(),
  });
}

/** Whether an environment demands the egress path: where it names the
 * service's socket (the guest image sets it by environment.d), the engine
 * has no provider path of its own -- egress is the only way out, so an open
 * that fails must fail closed, not degrade. Where it names none (Linux),
 * the engine resolves its own credential and egress is optional. */
export function egressRequired(env: Readonly<Record<string, string | undefined>>): boolean {
  const socket = env[EGRESS_SOCKET_ENV];
  return socket !== undefined && socket.length > 0;
}

/** DR18 adoption (G04-01): the opened provider path is the tenure's from
 * here -- held while the lease stands, closed by `hold` if the lease ended
 * while it was opening. A configured egress (`OMA_EGRESS_SOCKET` names a
 * service) that cannot open is a start failure, not a degradable notice:
 * in the guest the engine has no other provider path (MAC-701 keeps the
 * credential on the host), so the failure propagates with its own code
 * rather than starting an engine that can only fail against it. An
 * unconfigured environment still answers null -- no service was promised,
 * and a path that does not exist cannot fail. */
export async function adoptPrincipalEgress(owner: EgressTenure,
  options: Parameters<typeof openPrincipalEgress>[0]): Promise<PrincipalEgress | null> {
  const opened = await openPrincipalEgress(options);
  return opened !== null && await owner.hold(opened) ? opened : null;
}
