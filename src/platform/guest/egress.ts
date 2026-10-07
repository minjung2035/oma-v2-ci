/** The guest's end of egress (macos-platform §4.7, MAC-225).
 *
 * The host opens egress connections ahead of need; they wait here in a pool.
 * Inside the guest, the product's own processes -- the runner for a Resident,
 * `oma` for the Principal -- ask this service for one of two things over a
 * unix socket of the oma user: a placeholder for a run (answered by the host
 * and relayed back), or a connection for one engine connection (after which
 * the bytes are the engine's HTTP, relayed unread). An empty pool refuses at
 * once, as the relay refuses at its limit: the engine retries (INF-001).
 */
import { createServer, type Server, type Socket } from "node:net";
import { chmodSync } from "node:fs";
import { clearSocketName } from "../../storage/socket-name.js";
import { encodeFrame } from "../../frame.js";
import { readLeadingFrame } from "../rpc.js";
import { egressConnectProblem, egressOpenProblem, egressPlaceholderProblem, requestProblem } from "../../protocol/host-guest.js";

export class EgressPool {
  private readonly idle: Socket[] = [];
  private readonly watchers = new Map<Socket, () => void>();
  private closed = false;

  /** A connection the host opened, after its hello. It is read while it
   * waits, so a host that closes it is noticed; the host sends nothing on it
   * before the guest's first message, so anything that arrives is a broken
   * connection and it is dropped. */
  park(socket: Socket): void {
    if (this.closed) { socket.destroy(); return; }
    const broken = (): void => { socket.destroy(); };
    this.watchers.set(socket, broken);
    socket.on("data", broken);
    socket.once("end", broken);
    socket.on("error", broken);
    socket.once("close", () => {
      this.watchers.delete(socket);
      const at = this.idle.indexOf(socket);
      if (at >= 0) this.idle.splice(at, 1);
    });
    this.idle.push(socket);
    socket.resume();
  }

  /** A waiting connection, handed over paused and no longer watched. */
  take(): Socket | null {
    for (;;) {
      const socket = this.idle.shift();
      if (socket === undefined) return null;
      const broken = this.watchers.get(socket);
      this.watchers.delete(socket);
      if (broken !== undefined) { socket.off("data", broken); socket.off("end", broken); socket.off("error", broken); }
      if (!socket.destroyed && socket.writable) { socket.pause(); return socket; }
    }
  }

  get size(): number { return this.idle.length; }

  /** Closes every waiting connection and any that arrives later: guesthost
   * is stopping. */
  close(): void {
    this.closed = true;
    for (const socket of this.idle.splice(0)) socket.destroy();
  }
}

export interface EgressServiceOptions {
  readonly socketPath: string;
  readonly pool: EgressPool;
  readonly frameBytes: number;
  /** How long a client has to say what it wants, and the host to answer a placeholder. */
  readonly deadlineMs: number;
}

export function startEgressService(options: EgressServiceOptions): Promise<Server> {
  clearSocketName(options.socketPath);
  const server = createServer({ allowHalfOpen: true }, client => { void serve(client, options); });
  // guesthost runs no uncaughtException handler: once the startup
  // once-listener below is removed, an accept-class error (EMFILE/ENFILE)
  // meets zero 'error' listeners and escapes its emit as the unit's death
  // -- the pool and every held lease with it. The permanent listener
  // journals and keeps the socket bound: the kernel retries the accept,
  // while closing would unlink the name the guest's own processes dial.
  // The journal is best-effort -- a dead stderr must not throw out of this
  // emit either.
  server.on("error", error => {
    try { console.error(`guest egress listener error: ${error.message}`); } catch { /* nowhere left to say it */ }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      // The listener and its name are this opener's until the server is
      // handed back; a permission failure returns both (AV-20261003-28).
      try { chmodSync(options.socketPath, 0o600); }
      catch (error) { server.close(); reject(error as Error); return; }
      server.off("error", reject);
      resolve(server);
    });
  });
}

async function serve(client: Socket, options: EgressServiceOptions): Promise<void> {
  client.on("error", () => { client.destroy(); });
  let asked: { frame: Record<string, unknown>; rest: Buffer };
  try { asked = await readLeadingFrame(client, options.frameBytes, options.deadlineMs); }
  catch { client.destroy(); return; }
  const frame = asked.frame;
  const problem = requestProblem(frame) ?? (frame.method === "egress.placeholder" ? egressPlaceholderProblem(frame.params)
    : frame.method === "egress.connect" ? egressConnectProblem(frame.params)
    : frame.method === "egress.open" ? egressOpenProblem(frame.params)
    : "the first message is egress.placeholder, egress.connect or egress.open");
  if (problem !== null || frame.key !== undefined) { client.destroy(); return; }
  // A placeholder request is read once, as on the host: bytes that rode its
  // frame are no message -- the request dies unanswered before a pooled
  // connection is spent on it. (The open and connect arms instead relay
  // `rest`: it is payload there.)
  if (frame.method === "egress.placeholder" && asked.rest.length > 0) { client.destroy(); return; }
  const host = options.pool.take();
  if (host === null) { client.destroy(); return; }
  host.on("error", () => { host.destroy(); client.destroy(); });
  host.write(encodeFrame(frame));
  if (frame.method === "egress.connect") {
    // DR34: the host's answer decides the tunnel. `ok` relays the answer to
    // the client, then this connection is the raw pipe; a refusal relays the
    // framed error and both ends close. Bytes that followed the client's
    // request (the TLS ClientHello racing the answer) go to the host first.
    let connectKept = false;
    try {
      const answer = await readLeadingFrame(host, options.frameBytes, options.deadlineMs);
      if (answer.frame.ok === true) {
        client.write(encodeFrame(answer.frame));
        // Bytes that rode the answer are the tunnel's first payload -- a
        // banner-first upstream speaks before it is spoken to; bytes that
        // rode the request go to the host first. The framed exchange is
        // over on both sides now.
        if (answer.rest.length > 0) client.write(answer.rest);
        if (asked.rest.length > 0) host.write(asked.rest);
        client.pipe(host); host.pipe(client);
        host.resume(); client.resume();
        const drop = (): void => { client.destroy(); host.destroy(); };
        client.once("end", drop); client.once("close", drop);
        host.once("end", drop); host.once("close", drop);
        connectKept = true;
        return;
      }
      // A refused connect still earns its framed answer; bytes that rode a
      // refusal are no tunnel and die with the pair.
      client.end(encodeFrame(answer.frame));
    } catch {
      client.destroy();
    } finally { if (!connectKept) host.destroy(); }
    return;
  }
  if (frame.method === "egress.open") {
    // From here the connection is the engine's; nothing is read or kept.
    if (asked.rest.length > 0) host.write(asked.rest);
    client.pipe(host);
    host.pipe(client);
    host.resume();
    client.resume();
    // allowHalfOpen: a peer's end arrives as "end"; "close" waits for this
    // end's own close. Either ending drops the connection pair.
    const drop = (): void => { client.destroy(); host.destroy(); };
    client.once("end", drop); client.once("close", drop);
    host.once("end", drop); host.once("close", drop);
    return;
  }
  let kept = false;
  try {
    const answer = await readLeadingFrame(host, options.frameBytes, options.deadlineMs);
    // §4.7 v5: a held placeholder keeps both ends of its lease -- the client's
    // and the host's -- so the run ends when either ends: the run's own close,
    // or the host gone (a reboot drops every run of the last boot anyway).
    // allowHalfOpen again: "end" is the other end's end, "close" may never come.
    if (answer.frame.ok === true && (frame.params as { hold?: unknown }).hold === true) {
      if (answer.rest.length > 0) { host.destroy(); client.destroy(); return; }
      client.write(encodeFrame(answer.frame));
      // The lease is read no more, so speech on it is its end too -- and it
      // must be heard: a socket the frame reader left paused fires "end" on
      // a bare FIN, but bytes buffered ahead of a FIN are never read, so a
      // client that spoke and then closed cleanly went unheard. The pair
      // flows now that its listeners stand.
      const endLease = (): void => { client.destroy(); host.destroy(); };
      client.once("end", endLease); client.once("close", endLease); client.on("data", endLease);
      host.once("end", endLease); host.once("close", endLease); host.on("data", endLease);
      client.resume(); host.resume();
      kept = true;
      return;
    }
    client.end(encodeFrame(answer.frame));
  } catch {
    // No answer: what the host did is unknown to the client, which asks again.
    client.destroy();
  } finally { if (!kept) host.destroy(); }
}
