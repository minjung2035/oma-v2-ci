/** The Host API server (MAC-020, MAC-021, MAC-251): the only way the Mac's
 * UIs reach the engine. It answers only connections from this user, asked of
 * the kernel, that present the login token written at this start; within
 * one user the token is not a boundary (§3.4 A4), and nothing more is claimed.
 *
 * `terminal.attach` turns its connection into the society's terminal: after
 * the answer, frames pass through to the guest unchanged (§4.6).
 */
import { createServer, type Server, type Socket } from "node:net";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { StoreError } from "../../domain/errors.js";
import { FramedPeer } from "../rpc.js";
import { HANDOFF, serveRequests, type Answer } from "../guest/server.js";
import { peerUid } from "./peer.js";
import { requestProblem } from "../../protocol/host-guest.js";
import { HOST_API_VERSION, hostApiHelloProblem, type HostApiHello } from "../../protocol/host-api.js";
import type { VmState } from "./lifecycle.js";

export interface HostApiBackend {
  state(): VmState;
  start(): Promise<void>;
  stop(): Promise<"stopped" | "forced">;
  /** A society connection to the running guest. */
  society(): Promise<FramedPeer>;
  terminal(society: string, takeover: boolean): Promise<{ readonly socket: Socket; readonly rest: Buffer }>;
}

export interface HostApiOptions {
  readonly socketPath: string;
  readonly token: string;
  readonly backend: HostApiBackend;
  readonly frameBytes: number;
  readonly helloDeadlineMs: number;
  readonly requestTimeoutMs: number;
  /** The user whose connections are answered: this process's. */
  readonly uid: number;
}

export function startHostApi(options: HostApiOptions): Promise<Server> {
  if (existsSync(options.socketPath)) unlinkSync(options.socketPath);
  const server = createServer({ allowHalfOpen: true }, socket => { void accept(socket, options); });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      chmodSync(options.socketPath, 0o600);
      server.off("error", reject);
      resolve(server);
    });
  });
}

function sameToken(presented: string, token: string): boolean {
  const a = Buffer.from(presented, "utf8"); const b = Buffer.from(token, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function accept(socket: Socket, options: HostApiOptions): Promise<void> {
  socket.on("error", () => { socket.destroy(); });
  if (peerUid(socket) !== options.uid) { socket.destroy(); return; }
  const peer = new FramedPeer(socket, { frameBytes: options.frameBytes, requestTimeoutMs: options.requestTimeoutMs });
  const hello = await new Promise<{ id: string; params: HostApiHello } | null>(resolve => {
    const timer = setTimeout(() => { resolve(null); }, options.helloDeadlineMs);
    timer.unref();
    let first = true;
    peer.onClose(() => { clearTimeout(timer); resolve(null); });
    peer.onFrame(frame => {
      // Only the first frame is the hello; the rest are requests.
      if (!first) return;
      first = false;
      clearTimeout(timer);
      const problem = requestProblem(frame) ?? (frame.method === "hello" ? hostApiHelloProblem(frame.params) : "the first message must be hello");
      if (problem !== null) { refuseAndClose(peer, frame.id, "INVALID_REQUEST", problem); resolve(null); return; }
      resolve({ id: frame.id as string, params: frame.params as unknown as HostApiHello });
    });
  });
  if (hello === null) { peer.close(); return; }
  if (!sameToken(hello.params.token, options.token)) { refuseAndClose(peer, hello.id, "AUTH_FAILED", "the login token is not this service's"); return; }
  if (HOST_API_VERSION < hello.params.api.min || HOST_API_VERSION > hello.params.api.max) {
    refuseAndClose(peer, hello.id, "UNSUPPORTED_VERSION", `this service speaks ${HOST_API_VERSION}`);
    return;
  }
  peer.answer(hello.id, { api: HOST_API_VERSION });
  serve(peer, options.backend);
}

function refuseAndClose(peer: FramedPeer, id: unknown, code: "INVALID_REQUEST" | "AUTH_FAILED" | "UNSUPPORTED_VERSION", message: string): void {
  try { if (typeof id === "string") peer.refuse(id, { code, message, retry: "never" }); } catch { /* closing anyway */ }
  peer.closeAfterFlush(message);
}

function serve(peer: FramedPeer, backend: HostApiBackend): void {
  const forward = async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
    await backend.start();
    const society = await backend.society();
    try { return await society.request(method, params); }
    finally { society.close(); }
  };
  let attached = false;
  serveRequests(peer, async (method, params): Promise<Answer> => {
    if (attached) throw new StoreError("INVALID_REQUEST", "this connection is a terminal now");
    switch (method) {
      case "engine.status": return { state: backend.state() };
      case "engine.start": await backend.start(); return { state: backend.state() };
      case "engine.stop": return { result: await backend.stop() };
      case "society.list": return await forward("society.list", {});
      case "society.open": return await forward("society.open", { society: params.society, projectId: params.projectId });
      case "society.close": return await forward("society.close", { society: params.society, mode: params.mode });
      case "terminal.attach": {
        if (typeof params.society !== "string" || (params.takeover !== undefined && params.takeover !== true))
          throw new StoreError("INVALID_REQUEST", "terminal.attach names a society and may take over");
        await backend.start();
        const guest = await backend.terminal(params.society, params.takeover === true);
        attached = true;
        // After this answer the connection carries the terminal's frames.
        return { attached: true, [HANDOFF]: () => {
          const screen = peer.detach();
          if (guest.rest.length > 0) screen.write(guest.rest);
          screen.pipe(guest.socket);
          guest.socket.pipe(screen);
          screen.once("close", () => { guest.socket.destroy(); });
          guest.socket.once("close", () => { screen.end(); });
          guest.socket.on("error", () => { screen.destroy(); });
          screen.resume();
        } };
      }
      default: throw new StoreError("UNKNOWN_METHOD", `the Host API has no ${method}`);
    }
  });
}
