/** UX-08, DR34 (the SB-004 exception): a small HTTP CONNECT proxy on one unix
 * socket, owned by the runner for the length of one delivery. It is the only
 * thing a confined Resident's HTTP_PROXY/HTTPS_PROXY/ALL_PROXY point at, via
 * the extension's loopback forwarder; on macOS its `dial` is the host's
 * `egress.connect`, on Linux a direct pinned dial.
 *
 * The proxy is the policy point:
 *  - the request must be CONNECT authority-form (parseConnectTarget); every
 *    other request, malformed framing and oversized heads are refused or
 *    destroyed, and after the 200 the socket is raw -- nothing re-parses it,
 *    so a second request cannot hide behind the first.
 *  - the port is the wire's, not the caller's: only 443 tunnels (HTTPS;
 *    SSH/22, SOCKS and raw TCP stay out of v0.1).
 *  - the name must be on the role's resolved allowlist; literals cannot match
 *    because no entry can name one.
 *  - the dial resolves the name here, screens every answer, and pins the
 *    chosen address -- a rebinding answer after the check connects nowhere.
 *  - headers end at the proxy: nothing of the CONNECT request reaches the
 *    target, so no credential a Resident was given (or invented) crosses.
 *
 * Audit: one record per CONNECT, allow or refuse, carrying actor, role,
 * target and reason -- never request bytes, headers or credentials.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as netConnect, isIP, type Socket } from "node:net";
import { lookup as dnsLookup } from "node:dns";
import { chmodSync } from "node:fs";
import { allowsEgressEndpoint, parseConnectTarget, type EgressPolicy } from "../domain/egress.js";
import { clearSocketName } from "../storage/socket-name.js";
import { StoreError } from "../domain/errors.js";

/** The only destination port a tunnel may open: HTTPS, end to end. */
export const EGRESS_CONNECT_PORT = 443;
/** Tunnels one delivery's proxy holds at once -- the same per-run bound the
 * egress pool provisions for (host/egress's four spare connections per run). */
export const CONNECT_TUNNELS = 4;
/** A CONNECT request must be complete and its target answered within this
 * budget; the request itself is a few hundred bytes, so this is generous. */
export const CONNECT_HANDSHAKE_MS = 15_000;
/** Silence budget of an established tunnel. */
export const CONNECT_IDLE_MS = 120_000;
/** Per-address dial deadline once a name has resolved. */
export const CONNECT_DIAL_MS = 15_000;
/** CONNECT needs no headers beyond Host; this still admits a verbose client. */
const CONNECT_HEADER_BYTES = 8192;
/** Backstop for an idle keep-alive socket: every response path already sends
 * `Connection: close`, so nothing legitimately reaches this state -- a
 * socket that somehow does is still bounded rather than free to wedge a
 * `maxConnections` slot forever. */
const CONNECT_KEEPALIVE_MS = 5_000;

export interface EgressAudit {
  readonly actor: string;
  readonly role: string;
  /** `host:port` normalized, or a fixed marker when the request's own bytes
   * never parsed as an authority -- caller content never lands here. */
  readonly target: string;
  readonly decision: "allow" | "refuse" | "fail";
  /** One machine word or refusal sentence; never bytes the caller sent. */
  readonly reason: string;
}

/** One upstream connection: a name + port in, a connected socket out. The
 * production dialer resolves and screens; on macOS the runner substitutes the
 * host's `egress.connect` request, and tests inject an oracle. */
export type ConnectDial = (host: string, port: number) => Promise<Socket>;

/* ---- the SSRF screen ---------------------------------------------------- */

/** IPv4 ranges a tunnel may never open, as [prefix, bits]. This-node, RFC1918,
 * CGNAT, link-local, loopback, IETF protocol assignments, AS112, benchmark,
 * documentation, multicast, reserved and broadcast space. */
const V4_REFUSED: readonly (readonly [number, number])[] = Object.freeze([
  [0x00000000, 8],  // 0.0.0.0/8 "this host"
  [0x0a000000, 8],  // 10.0.0.0/8 private
  [0x64400000, 10], // 100.64.0.0/10 CGNAT
  [0x7f000000, 8],  // 127.0.0.0/8 loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local
  [0xac100000, 12], // 172.16.0.0/12 private
  [0xc0000000, 24], // 192.0.0.0/24 IETF protocol assignments
  [0xc0000200, 24], // 192.0.2.0/24 documentation
  [0xc01fc400, 24], // 192.31.196.0/24 AS112-v4
  [0xc034c100, 24], // 192.52.193.0/24 AMT
  [0xc0586300, 24], // 192.88.99.0/24 6to4 relay anycast (deprecated)
  [0xc0a80000, 16], // 192.168.0.0/16 private
  [0xc0af3000, 24], // 192.175.48.0/24 AS112
  [0xc6120000, 15], // 198.18.0.0/15 benchmarking
  [0xc6336400, 24], // 198.51.100.0/24 documentation
  [0xcb007100, 24], // 203.0.113.0/24 documentation
  [0xe0000000, 4],  // 224.0.0.0/4 multicast
  [0xf0000000, 4],  // 240.0.0.0/4 reserved, includes the broadcast address
]);

function v4Private(a: number, b: number, c: number, d: number): boolean {
  const value = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  return V4_REFUSED.some(([base, bits]) => (value >>> (32 - bits)) === (base >>> (32 - bits)));
}

function v4AddressPrivate(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4 || !parts.every(part => /^[0-9]{1,3}$/.test(part))) return true;
  return v4Private(...parts.map(Number) as [number, number, number, number]);
}

/** A validated IPv6 spelling (isIP already accepted it) as 16 bytes, with an
 * embedded dotted-quad in the tail position expanded to its two hextets. */
function v6Bytes(ip: string): number[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const groups = (half: string): string[] => (half === "" ? [] : half.split(":"));
  const head = groups(halves[0] ?? "");
  const tail = groups(halves[1] ?? "");
  const out: number[] = [];
  const push = (group: string): boolean => {
    if (group.includes(".")) {
      const parts = group.split(".");
      if (parts.length !== 4 || !parts.every(part => /^[0-9]{1,3}$/.test(part) && Number(part) <= 255)) return false;
      out.push((Number(parts[0]) << 8) | Number(parts[1]), (Number(parts[2]) << 8) | Number(parts[3]));
      return true;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return false;
    out.push(parseInt(group, 16));
    return true;
  };
  for (const group of head) if (!push(group)) return null;
  const headCount = out.length;
  for (const group of tail) if (!push(group)) return null;
  if (halves.length === 1 ? out.length !== 8 : out.length > 7) return null;
  const zeros = 8 - out.length;
  const expanded = [...out.slice(0, headCount), ...Array<number>(zeros).fill(0), ...out.slice(headCount)];
  if (expanded.length !== 8) return null;
  return expanded.flatMap(hextet => [(hextet >> 8) & 0xff, hextet & 0xff]);
}

/** Whether an address a resolver returned may be dialed for a Resident. This
 * is the rebinding and encoding backstop: whatever name was asked, the
 * address actually connected is screened here. An unparseable or
 * unrecognizable answer is not public.
 *
 * The v6 model is fail-closed allowlist, not denylist (DR34): embedded-IPv4
 * carrier formats are unwrapped and judged by their embedded address first
 * (Teredo excepted -- its two embedded fields and tunnel-state-dependent
 * reachability make it unscreenable, so it is refused outright), then only
 * `2000::/3` -- global unicast -- is admitted, minus the
 * special-purpose ranges the IANA registry assigns inside it. Everything
 * outside `2000::/3` dies at the gate: `::/8` (unspecified, loopback and the
 * deprecated v4-compatible space), `64:ff9b:1::/48` (RFC 8215 local-use
 * NAT64 -- it exists to translate non-global answers, so it can never name a
 * public destination), `100::/64` discard, `5f00::/16` SRv6 SIDs, `fc00::/7`
 * ULA, `fe80::/10` link-local, `fec0::/10` site-local and `ff00::/8`
 * multicast. Anything the rules below do not recognize is refused. */
export function isPublicConnectAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !v4AddressPrivate(address);
  if (family !== 6) return false;
  const b = v6Bytes(address);
  if (b === null) return false;
  // v6Bytes proves sixteen bytes; the index is exact, not unchecked input.
  const at = (index: number): number => b[index]!;
  const last4 = `${at(12)}.${at(13)}.${at(14)}.${at(15)}`;
  // Embedded-IPv4 carriers are the IPv4 answer in another spelling; the
  // embedded address decides, never the carrier.
  // ::ffff:0:0/96 v4-mapped.
  if (b.slice(0, 10).every(byte => byte === 0) && at(10) === 0xff && at(11) === 0xff)
    return !v4AddressPrivate(last4);
  // 64:ff9b::/96 NAT64 well-known prefix: the embedded IPv4 decides.
  if (at(0) === 0x00 && at(1) === 0x64 && at(2) === 0xff && at(3) === 0x9b && b.slice(4, 12).every(byte => byte === 0))
    return !v4AddressPrivate(last4);
  // The admission gate: only global unicast is ever a public destination.
  if ((at(0) & 0xe0) !== 0x20) return false;
  // Inside 2000::/3, special-purpose space is refused or unwrapped:
  // 2001:0000::/32 Teredo is refused outright, not unwrapped -- it embeds
  // TWO IPv4 fields (the server in bytes 4..7 and the bits-inverted client
  // in the tail), and which host a Teredo name actually reaches depends on
  // the host's tunnel state, so screening both fields is fragile. A
  // deprecated carrier no public HTTPS endpoint is reached through simply
  // dies here, ahead of the 2001::/23 arm that would catch it anyway.
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0x00 && at(3) === 0x00) return false;
  // 2001::/23 IETF protocol assignments: benchmark 2001:2::/48, AMT
  // 2001:3::/32, AS112 2001:4:112::/48, ORCHID 2001:10::/28 and ORCHIDv2
  // 2001:20::/28, the anycast stubs and every sibling -- none names a host a
  // Resident may reach.
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) <= 0x01) return false;
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0x0d && at(3) === 0xb8) return false; // 2001:db8::/32 documentation
  // 2002::/16 6to4: the site's IPv4 sits in bytes 2..5.
  if (at(0) === 0x20 && at(1) === 0x02)
    return !v4AddressPrivate(`${at(2)}.${at(3)}.${at(4)}.${at(5)}`);
  // 2620:4f:8000::/48 direct-delegation AS112 and 3fff::/20 documentation.
  if (at(0) === 0x26 && at(1) === 0x20 && at(2) === 0x00 && at(3) === 0x4f && at(4) === 0x80 && at(5) === 0x00) return false;
  if (at(0) === 0x3f && (at(1) & 0xf0) === 0xf0) return false;
  return true;
}

/* ---- the pinned public dial -------------------------------------------- */

export interface PublicDialSeams {
  /** One resolver answer set: [{address, family}]. Tests inject oracles;
   * production is dns.lookup({all, verbatim}) so resolver order is kept. */
  readonly lookup?: (host: string) => Promise<readonly { address: string; family: number }[]>;
  /** TCP connect to one literal address; production is net.connect. */
  readonly connect?: (address: string, port: number) => Promise<Socket>;
  readonly timeoutMs?: number;
}

function defaultLookup(host: string): Promise<readonly { address: string; family: number }[]> {
  return new Promise((resolve, reject) =>
    dnsLookup(host, { all: true, verbatim: true }, (error, addresses) =>
      error === null ? resolve(addresses) : reject(error)));
}

function defaultConnect(timeoutMs: number): (address: string, port: number) => Promise<Socket> {
  return (address, port) => new Promise((resolve, reject) => {
    const socket = netConnect({ host: address, port });
    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => { socket.destroy(); reject(new StoreError("DEADLINE_EXCEEDED", `egress connect to ${address}:${port} timed out`)); });
    socket.once("connect", () => { socket.setTimeout(0); resolve(socket); });
    socket.once("error", reject);
  });
}

/** The production CONNECT dialer: resolve once here (never inside the target
 * socket), screen every answer, then pin -- connect(2) gets the literal
 * address, so an answer that changed after the check connects nowhere.
 * All-private answers refuse as INVALID_REQUEST; a name with no answers fails
 * as BROKER_UNAVAILABLE the way the resolver reports it. */
export function makePublicDial(seams: PublicDialSeams = {}): ConnectDial {
  const lookup = seams.lookup ?? defaultLookup;
  const connect = seams.connect ?? defaultConnect(seams.timeoutMs ?? CONNECT_DIAL_MS);
  return async (host, port) => {
    const answers = await lookup(host);
    const usable = answers.filter(answer => isPublicConnectAddress(answer.address));
    if (usable.length === 0) {
      if (answers.length === 0)
        throw new StoreError("BROKER_UNAVAILABLE", `egress destination ${host} resolves to no address`);
      throw new StoreError("INVALID_REQUEST", `egress destination ${host} resolves only to private or special-use addresses`);
    }
    let last: unknown;
    for (const { address } of usable) {
      try { return await connect(address, port); }
      catch (error) { last = error; }
    }
    throw last instanceof Error ? last : new StoreError("BROKER_UNAVAILABLE", `egress connect to ${host}:${port} failed`);
  };
}

/* ---- the proxy ----------------------------------------------------------- */

export interface ConnectProxyOptions {
  readonly socketPath: string;
  readonly policy: EgressPolicy;
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
    private readonly tunnels: Set<Socket>) {}

  /** The count callers may report; never a liveness claim about the peers. */
  get activeTunnels(): number { return this.tunnels.size; }

  static async open(options: ConnectProxyOptions): Promise<ConnectProxy> {
    const policy = options.policy;
    const audit = (target: string, decision: EgressAudit["decision"], reason: string): void =>
      options.audit?.({ actor: options.actor, role: policy.role, target, decision, reason });
    clearSocketName(options.socketPath);
    const tunnels = new Set<Socket>();
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
    // The same per-delivery bound the pool provisions for: sockets beyond it
    // are refused by the kernel listener rather than queued into memory.
    server.maxConnections = options.tunnels ?? CONNECT_TUNNELS;
    server.on("request", (req: IncomingMessage, res: ServerResponse) => {
      // Only CONNECT exists here: a plain request gets a refusal with words,
      // and the socket goes with it -- an unanswered connection idling in
      // keep-alive would wedge a listener slot for as long as the peer wants.
      audit(auditTarget(req.url, req.method ?? AUDIT_NO_TARGET), "refuse", "not a CONNECT request");
      res.writeHead(405, { "Connection": "close", "Content-Length": 0 });
      res.end();
      // The response is flushed, then the socket is destroyed -- pipelined
      // bytes behind a refused request die unread with it.
      req.socket.destroySoon();
    });
    // An `Upgrade:` request is not a CONNECT and there is no protocol to
    // switch to -- destroy the socket rather than let it linger.
    server.on("upgrade", (req: IncomingMessage, socket: Socket) => {
      audit(auditTarget(req.url, "(upgrade)"), "refuse", "an upgrade is not a CONNECT request");
      socket.destroy();
    });
    server.on("clientError", (_error, socket) => socket.destroy());
    server.on("connect", (req: IncomingMessage, client: Socket, head: Buffer) => {
      const idleMs = options.idleMs ?? CONNECT_IDLE_MS;
      // The socket is the proxy's from this event, not the server's: a late
      // error on it must never surface unhandled. `upstream` outlives the
      // dial's own scope so the catch can end a connection that was already
      // opened when a later step (audit, the 200 write) threw.
      let upstream: Socket | undefined;
      const drop = (): void => { client.destroy(); upstream?.destroy(); };
      client.on("error", drop);
      client.once("close", () => { tunnels.delete(client); upstream?.destroy(); });
      void (async () => {
        const { target, problem } = parseConnectTarget(req.url);
        if (problem !== null) {
          audit(AUDIT_NO_TARGET, "refuse", problem);
          return refuse(client, 403);
        }
        const name = `${target.host}:${target.port}`;
        if (target.literal) { audit(name, "refuse", "address literal"); return refuse(client, 403); }
        if (target.port !== EGRESS_CONNECT_PORT) { audit(name, "refuse", "port other than 443"); return refuse(client, 403); }
        if (!allowsEgressEndpoint(policy, target.host)) { audit(name, "refuse", "not on the egress allowlist"); return refuse(client, 403); }
        // Node emits a pipelined request even on a socket the refusal before
        // it already closed: the CONNECT is still judged, but a dead socket
        // dials nothing.
        if (client.destroyed || client.writableEnded) {
          audit(name, "refuse", "the connection was already closed");
          client.destroy();
          return;
        }
        let dialed: Socket;
        try { dialed = await options.dial(target.host, target.port); }
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
      server.closeAllConnections();
      await new Promise<void>(resolve => { server.close(() => resolve()); });
      throw error;
    }
    return new ConnectProxy(options.socketPath, server, tunnels);
  }

  async close(): Promise<void> {
    const server = this.server;
    // The tunnels are this proxy's: an upgraded socket is not always among a
    // server's tracked connections, so end each explicitly (its own close
    // takes the upstream half with it). close() then removes the unix name
    // it owns (P0V-114), not a stale file a next proxy would trip on.
    for (const socket of this.tunnels) socket.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => { server.close(() => resolve()); });
  }
}
