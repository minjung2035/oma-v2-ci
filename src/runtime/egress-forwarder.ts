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
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { FrameParser, encodeFrame } from "../frame.js";
import {
  EGRESS_ENGINE_MANAGED, egressPlaceholderResultProblem,
  type EgressOpenParams, type EgressPlaceholderParams, type EgressPlaceholderResult,
} from "../protocol/host-guest.js";

/** The environment name the guest image sets (environment.d) for the egress
 * service's socket. Its absence is the Linux distribution. */
export const EGRESS_SOCKET_ENV = "OMA_EGRESS_SOCKET";

export interface EgressAsk {
  readonly socket: string;
  readonly frameBytes: number;
  readonly deadlineMs: number;
}

/** One frame from a connection that then ends. */
function oneFrame(socket: Socket, frameBytes: number, deadlineMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const parser = new FrameParser(frameBytes);
    const timer = setTimeout(() => { done(new StoreError("BROKER_UNAVAILABLE", "the egress service did not answer in time")); }, deadlineMs);
    timer.unref();
    const done = (error: Error | null, frame?: Record<string, unknown>): void => {
      clearTimeout(timer);
      socket.removeAllListeners("data");
      socket.destroy();
      if (error !== null) reject(error); else resolve(frame!);
    };
    socket.on("data", (chunk: Buffer) => {
      let frames;
      try { frames = parser.feed(chunk); } catch (error) { done(error as Error); return; }
      if (frames.length > 0) done(null, frames[0]!.raw);
    });
    socket.once("error", () => { done(new StoreError("BROKER_UNAVAILABLE", "the egress service is unavailable")); });
    socket.once("close", () => { done(new StoreError("BROKER_UNAVAILABLE", "the egress service closed without an answer")); });
  });
}

/** The run's placeholder, issued by the host for this society, actor and
 * incarnation and for the engine-managed credential. */
export async function requestEgressPlaceholder(ask: EgressAsk, run: EgressPlaceholderParams["run"], provider: string,
  model: string): Promise<EgressPlaceholderResult> {
  const socket = connect(ask.socket);
  const params: EgressPlaceholderParams = { credentialRef: EGRESS_ENGINE_MANAGED, provider, model, run };
  socket.once("connect", () => { socket.write(encodeFrame({ v: 1, id: randomUUID(), method: "egress.placeholder", params })); });
  const answer = await oneFrame(socket, ask.frameBytes, ask.deadlineMs);
  if (answer.ok !== true) {
    const error = answer.error as { code?: unknown; message?: unknown } | undefined;
    throw new StoreError(error?.code === "UNSUPPORTED_PROFILE" ? "UNSUPPORTED_PROFILE" : "BROKER_UNAVAILABLE",
      `the host issued no placeholder for this run: ${typeof error?.message === "string" ? error.message : "no reason given"}`);
  }
  const problem = egressPlaceholderResultProblem(answer.result);
  if (problem !== null) throw new StoreError("BROKER_UNAVAILABLE", `the host's placeholder answer is malformed (${problem})`);
  return answer.result as unknown as EgressPlaceholderResult;
}

/** The engine's provider socket, forwarding each connection to one egress
 * connection for this run. At most `concurrent` at a time; one more is
 * refused, as the relay refuses at its limit and the engine retries. */
export class EgressForwarder {
  private readonly open = new Set<Socket>();
  private closing: Promise<void> | null = null;
  private constructor(private readonly server: Server, readonly socketPath: string) {}

  static listen(socketPath: string, egressSocket: string, run: EgressOpenParams, concurrent: number): Promise<EgressForwarder> {
    if (!Number.isSafeInteger(concurrent) || concurrent < 1) throw new StoreError("UNSUPPORTED_PROFILE", "the forwarder's connection bound is invalid");
    if (existsSync(socketPath)) unlinkSync(socketPath);
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
    forwarder = new EgressForwarder(server, socketPath);
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        chmodSync(socketPath, 0o600);
        resolve(forwarder);
      });
    });
  }

  /** Stops listening and ends every forwarded connection: the run is over. */
  close(): Promise<void> {
    this.closing ??= new Promise(resolve => {
      for (const socket of this.open) socket.destroy();
      this.server.close(() => {
        try { unlinkSync(this.socketPath); } catch { /* already gone */ }
        resolve();
      });
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
  readonly model: string; readonly modelProfile: string; readonly frameBytes: number; readonly deadlineMs: number;
  readonly env: Readonly<Record<string, string | undefined>> }): Promise<PrincipalEgress | null> {
  const egress = options.env[EGRESS_SOCKET_ENV];
  if (egress === undefined || egress.length === 0) return null;
  const run = { society: options.society, actor: "principal", incarnation: 0 };
  const issued = await requestEgressPlaceholder({ socket: egress, frameBytes: options.frameBytes, deadlineMs: options.deadlineMs },
    run, options.provider, options.model);
  const socketPath = join(options.runRoot, "principal-inference.sock");
  const forwarder = await EgressForwarder.listen(socketPath, egress,
    { placeholderId: issued.placeholderId, ...run, modelProfile: options.modelProfile }, 4);
  const port = await freeLoopbackPort();
  return Object.freeze({
    env: Object.freeze({ OMA_INFERENCE_SOCKET: socketPath, OMA_INFERENCE_PROVIDER: issued.provider,
      OMA_INFERENCE_PORT: String(port), OMA_INFERENCE_KEY: issued.placeholder }),
    close: () => forwarder.close(),
  });
}
