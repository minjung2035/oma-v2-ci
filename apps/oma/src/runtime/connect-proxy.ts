/** Delivery-owned HTTP/CONNECT forwarding. Full destination/port access;
 * host resolution pins one address per dial without excluding local networks.
 * Plain HTTP forwards payload and destination authentication, while stripping
 * proxy authentication. CONNECT carries raw bytes after its response. Neither
 * path imposes concurrency or elapsed-time limits. Close owns both halves.
 * Audit records contain destination authority only, never query/credentials. */
import { Agent, createServer, request, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import { lookup as dnsLookup } from "node:dns";
import { chmodSync } from "node:fs";
import { parseConnectTarget } from "@oma/domain/egress";
import { clearSocketName } from "@oma/storage/socket-name";
import { StoreError } from "@oma/domain/errors";

/** Production has no tunnel concurrency cap. An explicitly supplied finite
 * test/embedding limit queues excess connections instead of rejecting them. */
export const CONNECT_TUNNELS = Number.POSITIVE_INFINITY;
/** Zero disables the production handshake deadline. */
export const CONNECT_HANDSHAKE_MS = 0;
/** Zero disables the production idle deadline. */
export const CONNECT_IDLE_MS = 0;
/** Zero disables the production dial deadline. */
export const CONNECT_DIAL_MS = 0;
/** CONNECT needs no headers beyond Host; this still admits a verbose client. */
const CONNECT_HEADER_BYTES = 8192;
/** Backstop for an idle keep-alive socket: every response path already sends
 * `Connection: close`, so nothing legitimately reaches this state -- a
 * socket that somehow does is still bounded rather than free to wedge a
 * `maxConnections` slot forever. */
const CONNECT_KEEPALIVE_MS = 5_000;

export interface EgressAudit {
  readonly actor: string;
  /** `host:port` normalized, or a fixed marker when the request's own bytes
   * never parsed as an authority -- caller content never lands here. */
  readonly target: string;
  readonly decision: "allow" | "refuse" | "fail";
  /** One machine word or refusal sentence; never bytes the caller sent. */
  readonly reason: string;
}

/** One upstream connection: a name + port in, a connected socket out. The
 * production dialer resolves once and pins; on macOS the runner substitutes the
 * host's `egress.connect` request, and tests inject an oracle. */
export type ConnectDial = (host: string, port: number, signal?: AbortSignal) => Promise<Socket>;

/* ---- the pinned dial -------------------------------------------- */

export interface PublicDialSeams {
  /** One resolver answer set: [{address, family}]. Tests inject oracles;
   * production is dns.lookup({all, verbatim}) so resolver order is kept. */
  readonly lookup?: (host: string) => Promise<readonly { address: string; family: number }[]>;
  /** TCP connect to one literal address; production is net.connect. */
  readonly connect?: ConnectDial;
  readonly timeoutMs?: number;
}

function defaultLookup(host: string): Promise<readonly { address: string; family: number }[]> {
  return new Promise((resolve, reject) =>
    dnsLookup(host, { all: true, verbatim: true }, (error, addresses) =>
      error === null ? resolve(addresses) : reject(error)));
}

function defaultConnect(timeoutMs: number): ConnectDial {
  return (address, port, signal) => new Promise((resolve, reject) => {
    const socket = netConnect({ host: address, port, ...(signal ? { signal } : {}) });
    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => { socket.destroy(); reject(new StoreError("DEADLINE_EXCEEDED", `egress connect to ${address}:${port} timed out`)); });
    socket.once("connect", () => { socket.setTimeout(0); resolve(socket); });
    socket.once("error", reject);
  });
}

/** Resolve once, then dial the returned addresses in resolver order. Public,
 * private and loopback destinations use the same path; empty resolution and
 * actual connection failures are reported as observed. */
export function makePublicDial(seams: PublicDialSeams = {}): ConnectDial {
  const lookup = seams.lookup ?? defaultLookup;
  const connect = seams.connect ?? defaultConnect(seams.timeoutMs ?? CONNECT_DIAL_MS);
  return async (host, port, signal) => {
    signal?.throwIfAborted();
    const answers = await lookup(host);
    signal?.throwIfAborted();
    if (answers.length === 0)
      throw new StoreError("BROKER_UNAVAILABLE", `egress destination ${host} resolves to no address`);
    let last: unknown;
    for (const { address } of answers) {
      signal?.throwIfAborted();
      try { return await connect(address, port, signal); }
      catch (error) { last = error; }
    }
    throw last instanceof Error ? last : new StoreError("BROKER_UNAVAILABLE", `egress connect to ${host}:${port} failed`);
  };
}

/* ---- the proxy ----------------------------------------------------------- */

export interface ConnectProxyOptions {
  readonly socketPath: string;
  readonly actor: string;
  readonly dial: ConnectDial;
  readonly tunnels?: number;
  readonly handshakeMs?: number;
  readonly idleMs?: number;
  readonly audit?: (entry: EgressAudit) => void;
}

/** The journal's target field. Only two spellings ever appear: a parsed
 * authority in its normalized `host:port`, or a fixed marker. The request's
 * own bytes are caller content -- a URL's query, an authority's userinfo, a
 * credential -- and never reach the journal. */
function auditTarget(url: unknown, fallback: string): string {
  const { target } = parseConnectTarget(url);
  return target === null ? fallback : `${target.host}:${target.port}`;
}
/** The target marker for a request that never produced a parseable
 * authority: what was refused, redacted down to the decision itself. */
const AUDIT_NO_TARGET = "(request-target redacted)";

/** A refused socket gets its whole answer, then dies: the writable side ends
 * with the response and the socket is destroyed once the bytes have flushed,
 * so no refusal can idle holding a listener slot. A socket already ended --
 * one pipelined behind a refused request -- is destroyed without a write. */
function refuse(socket: Socket, status: number): void {
  const text = status === 403 ? "Forbidden" : status === 405 ? "Method Not Allowed" : "Bad Gateway";
  if (socket.destroyed || socket.writableEnded) { socket.destroy(); return; }
  socket.once("finish", () => socket.destroy());
  try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); }
  catch { socket.destroy(); }
}

export class ConnectProxy {
  private constructor(readonly socketPath: string, private readonly server: Server,
    private readonly tunnels: Set<Socket>, private readonly queued: Set<Socket>) {}

  /** CONNECTs still waiting for a tunnel slot; the count callers may report. */
  get queuedTunnels(): number { return this.queued.size; }

  /** The count callers may report; never a liveness claim about the peers. */
  get activeTunnels(): number { return this.tunnels.size; }

  static async open(options: ConnectProxyOptions): Promise<ConnectProxy> {
    const audit = (target: string, decision: EgressAudit["decision"], reason: string): void =>
      options.audit?.({ actor: options.actor, target, decision, reason });
    clearSocketName(options.socketPath);
    const server = createServer({
      // The request must arrive whole promptly, then the socket is raw. These
      // bounds keep a stalled or drip-fed head from holding a slot.
      maxHeaderSize: CONNECT_HEADER_BYTES,
      headersTimeout: options.handshakeMs ?? CONNECT_HANDSHAKE_MS,
      requestTimeout: options.handshakeMs ?? CONNECT_HANDSHAKE_MS,
      // Not infinite: a refusal always ends its connection, so keep-alive
      // state is only a backstop -- and backstops still have a bound.
      keepAliveTimeout: CONNECT_KEEPALIVE_MS,
      insecureHTTPParser: false,
    });
    // Capacity is never the refusal: requests past the working set wait in
    // `waiting`, each claim owned by its own client socket, and a socket
    // that leaves while queued withdraws the claim it held.
    const limit = options.tunnels ?? CONNECT_TUNNELS;
    const tunnels = new Set<Socket>();
    const waiting: { client: Socket; grant: () => void }[] = [];
    const queued = new Set<Socket>();
    /** Grants every queued claim the working set has room for, in order. A
     * claim whose socket went away is already withdrawn by its close. */
    const offer = (): void => {
      while (waiting.length > 0 && tunnels.size < limit) waiting.shift()!.grant();
    };
    /** Resolves once the claim holds a tunnel slot; false when the client
     * went away while waiting -- its request was abandoned, not refused. A
     * socket that already closed (its 'close' preceded claim's listener)
     * takes neither kind of slot: it can never be granted, so it must never
     * stand in the queue. */
    const claim = (client: Socket): Promise<boolean> => {
      if (client.destroyed || client.closed || client.writableEnded) return Promise.resolve(false);
      if (waiting.length === 0 && tunnels.size < limit) { tunnels.add(client); return Promise.resolve(true); }
      return new Promise<boolean>(resolve => {
        const entry = { client, grant: () => {
          client.off("close", gone); client.off("end", gone); client.off("error", gone);
          queued.delete(client);
          tunnels.add(client); resolve(true);
        } };
        const gone = (): void => {
          const at = waiting.indexOf(entry);
          if (at >= 0) waiting.splice(at, 1);
          queued.delete(client);
          resolve(false);
        };
        // 'close' alone is not enough: under the HTTP server's half-open
        // policy a departed client is an 'end' (its FIN) or an 'error' long
        // before the socket's own 'close' ever comes.
        client.once("close", gone); client.once("end", gone); client.once("error", gone);
        waiting.push(entry); queued.add(client);
      });
    };
    // The "request" and "upgrade" listeners run synchronously inside
    // `server.emit`: a throw escapes it whole and takes the runner -- the
    // same class the host's dispatch boundary already owns for egress
    // (host/egress). So the journal is best-effort at these boundaries: a
    // sink that throws neither vetoes the refusal nor reaches the process,
    // and whatever else fails inside one ends the connection, never the
    // process.
    server.on("request", (req: IncomingMessage, res: ServerResponse) => {
      const owner = new AbortController();
      tunnels.add(req.socket);
      const gone = (): void => { owner.abort(); tunnels.delete(req.socket); };
      req.socket.once("close", gone);
      res.once("close", gone);
      void (async () => {
        let upstream: Socket | undefined;
        try {
          const url = new URL(req.url ?? "");
          if (url.protocol !== "http:" || url.username || url.password) throw new Error("HTTP proxy requests need an absolute http URL without userinfo");
          const port = Number(url.port || 80), host = url.hostname.replace(/^\[|\]$/g, "");
          upstream = await options.dial(host, port, owner.signal);
          if (req.destroyed || res.destroyed) { upstream.destroy(); return; }
          const agent = new Agent();
          agent.createConnection = () => upstream!;
          const headers: IncomingHttpHeaders = { ...req.headers, host: url.host };
          delete headers["proxy-authorization"]; delete headers["proxy-connection"];
          const outgoing = request({ hostname: host, port, path: `${url.pathname}${url.search}`,
            method: req.method, headers, agent }, response => {
            res.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(res);
          });
          tunnels.add(req.socket);
          res.once("close", () => { tunnels.delete(req.socket); outgoing.destroy(); agent.destroy(); });
          outgoing.on("error", () => { if (!res.headersSent) res.writeHead(502, { Connection: "close" }); res.end(); agent.destroy(); });
          req.once("aborted", () => { outgoing.destroy(); agent.destroy(); });
          req.pipe(outgoing);
          try { audit(`${host}:${port}`, "allow", "HTTP connected"); } catch { /* diagnostics */ }
        } catch {
          upstream?.destroy();
          if (!res.headersSent) res.writeHead(502, { Connection: "close" });
          res.end();
        }
      })();
    });
    // An `Upgrade:` request is not a CONNECT and there is no protocol to
    // switch to -- destroy the socket rather than let it linger.
    server.on("upgrade", (req: IncomingMessage, socket: Socket) => {
      try { audit(auditTarget(req.url, "(upgrade)"), "refuse", "an upgrade is not a CONNECT request"); }
      catch { /* a journal that refused its record does not stop the refusal */ }
      socket.destroy();
    });
    server.on("clientError", (_error, socket) => socket.destroy());
    // The same boundary for the listener itself: once the startup
    // once-listener below is removed, an accept-class error (EMFILE/ENFILE)
    // meets zero 'error' listeners and escapes its emit as the runner's
    // death -- this delivery's tunnels and relay with it. The record goes
    // to the audit channel and the socket stays bound: the kernel retries
    // the accept, while a close would unlink the name the sandbox's bridge
    // still dials. The journal is best-effort -- a sink that throws neither
    // vetoes nor escapes.
    server.on("error", error => {
      try { audit("(listener)", "fail", error.message.slice(0, 120)); }
      catch { /* a journal that refused its record does not stop the listener */ }
    });
    server.on("connect", (req: IncomingMessage, client: Socket, head: Buffer) => {
      const idleMs = options.idleMs ?? CONNECT_IDLE_MS;
      // The socket is the proxy's from this event, not the server's: a late
      // error on it must never surface unhandled. `upstream` outlives the
      // dial's own scope so the catch can end a connection that was already
      // opened when a later step (audit, the 200 write) threw.
      let upstream: Socket | undefined;
      const owner = new AbortController();
      const drop = (): void => { owner.abort(); client.destroy(); upstream?.destroy(); };
      client.on("error", drop);
      client.once("close", () => { owner.abort(); tunnels.delete(client); upstream?.destroy(); offer(); });
      void (async () => {
        const { target, problem } = parseConnectTarget(req.url);
        if (problem !== null) {
          audit(AUDIT_NO_TARGET, "refuse", problem);
          return refuse(client, 403);
        }
        const name = `${target.host}:${target.port}`;
        // Node emits a pipelined request even on a socket the refusal before
        // it already closed: the CONNECT is still judged, but a dead socket
        // dials nothing.
        if (client.destroyed || client.writableEnded) {
          audit(name, "refuse", "the connection was already closed");
          client.destroy();
          return;
        }
        // The working set full is a wait, never a refusal: the claim is the
        // socket's own and its close withdraws it. Granted, the request is
        // dialed exactly as one that never queued.
        if (!await claim(client)) { client.destroy(); return; }
        let dialed: Socket;
        try { dialed = await options.dial(target.host, target.port, owner.signal); }
        catch (error) {
          const reason = error instanceof StoreError && error.code === "INVALID_REQUEST" ? error.message : "dial failed";
          audit(name, error instanceof StoreError && error.code === "INVALID_REQUEST" ? "refuse" : "fail", reason.slice(0, 120));
          return refuse(client, error instanceof StoreError && error.code === "INVALID_REQUEST" ? 403 : 502);
        }
        upstream = dialed;
        // The client may have died under the dial; its tunnel is dropped.
        if (client.destroyed || client.writableEnded) {
          audit(name, "fail", "the connection closed during the dial");
          dialed.destroy();
          return;
        }
        audit(name, "allow", "connected");
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) dialed.write(head);
        // Silence ends the tunnel; each side's end ends the pair. P0-4: the
        // proxy owns both halves of every tunnel it opened.
        client.setTimeout(idleMs); dialed.setTimeout(idleMs);
        client.once("timeout", drop); dialed.once("timeout", drop);
        dialed.once("error", () => dialed.destroy());
        // The target's end is the tunnel's too: without this a dead upstream
        // left the client half holding its `tunnels` slot until the idle
        // budget ran out -- a slot the run could never reuse sooner.
        dialed.once("close", () => client.destroy());
        // The claim already reserved the slot; adding again is a no-op kept
        // for the path that never queued.
        tunnels.add(client);
        dialed.pipe(client); client.pipe(dialed);
      })().catch(drop);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.socketPath, () => { server.off("error", reject); resolve(); });
    });
    // Only this user may speak to the proxy; the sandbox runs as the same
    // user. P0-4/AV-20261003-28: the listener and its name are this opener's
    // until the proxy is handed back, so a permission failure returns both
    // rather than leaving an ownerless server behind.
    try { chmodSync(options.socketPath, 0o600); }
    catch (error) {
      for (const socket of tunnels) socket.destroy();
      for (const socket of queued) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>(resolve => { server.close(() => resolve()); });
      throw error;
    }
    return new ConnectProxy(options.socketPath, server, tunnels, queued);
  }

  async close(): Promise<void> {
    const server = this.server;
    // The tunnels are this proxy's: an upgraded socket is not always among a
    // server's tracked connections, so end each explicitly (its own close
    // takes the upstream half with it) -- and a queued claim's socket the
    // same way, since its request never reached the dial. close() then
    // removes the unix name it owns (P0V-114), not a stale file a next
    // proxy would trip on.
    for (const socket of this.tunnels) socket.destroy();
    for (const socket of this.queued) socket.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => { server.close(() => resolve()); });
  }
}
