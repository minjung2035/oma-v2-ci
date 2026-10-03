/** INF-005/006/007/008: the host end of a confined Resident's provider access.
 *
 * A confined Resident has no credential (PR-004) and no network (SB-004). This
 * relay is how the engine inside it still reaches a provider without either
 * being opened: the sandbox speaks plain HTTP to a bind-mounted unix socket,
 * and this process attaches the real credential and forwards to the one
 * endpoint the host declared.
 *
 * It is a byte relay. It does not read the stream, reassemble messages, count
 * tokens or price anything — those stay with the engine (INF-001). What it does
 * own is the chokepoint: the destination is fixed, the caller cannot choose its
 * own authorization, and a request whose outcome is unclear is never resent
 * (INF-004).
 *
 * The engine inside the sandbox builds its requests with a placeholder key of
 * the same shape as the real one, so provider code that inspects the key (an
 * OAuth token's claims, for instance) behaves exactly as it would on the host.
 * INF-007 (no credential in the sandbox, in any form) over INF-005: the relay
 * writes the real key into the places a provider reads a key
 * from -- an authority header that holds the key or `Bearer <key>`, and the
 * `key` query parameter -- and nowhere else. A placeholder anywhere else is a
 * request to put the credential where the provider may repeat it (a 404 that
 * names the path, a header echoed back), and it is refused. And the key never
 * travels back: a response whose bytes carry it is cut off before they reach
 * the sandbox, so the relay asks for responses it can see (no compression).
 */
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { Transform, type Duplex } from "node:stream";
import type { Socket } from "node:net";
import { chmodSync } from "node:fs";
import { clearSocketName } from "../storage/socket-name.js";
import { StoreError } from "../domain/errors.js";
import { alarm, type Timer } from "./pi-rpc.js";
import { trustedAbsolutePath } from "../protocol/run-lease.js";

/** Headers that belong to one hop and must not be copied onto the next. */
const HOP_BY_HOP = Object.freeze(new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host",
]));

/** An upgrade keeps its negotiation headers; everything else hop-by-hop goes. */
const UPGRADE_KEPT = Object.freeze(new Set(["connection", "upgrade"]));

/** Headers a caller could use to choose its own authorization. One that does
 * not carry the placeholder is dropped rather than forwarded. */
const CALLER_AUTHORITY = Object.freeze(new Set([
  "authorization", "x-api-key", "api-key", "x-goog-api-key",
]));

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const UNSAFE_VALUE = /[\r\n\0]/;

/** Open connections the relay keeps per request it may carry at once. */
export const RELAY_CONNECTIONS_PER_REQUEST = 4;

export interface RelaySubstitution {
  /** What the sandbox was given in place of the key. */
  readonly placeholder: string;
  /** The key the engine resolved on the host. Never logged. */
  readonly secret: string;
}

export interface RelayTarget {
  /** Absolute origin of the declared provider, e.g. `https://api.example.com`.
   * It comes from the host's model profile, never from the request. */
  readonly origin: string;
  /** Headers the engine resolved on the host, applied last. Never logged. */
  readonly headers: Readonly<Record<string, string>>;
  readonly substitute?: RelaySubstitution | undefined;
}

export interface RelayLimits {
  /** Requests allowed to be in flight at once. Beyond it the relay refuses
   * rather than queueing, so a stuck provider cannot accumulate sockets. */
  readonly concurrent: number;
  /** Milliseconds without provider progress, including connection setup and
   * upgraded streams. This is not a whole-request or whole-delivery limit. */
  readonly timeoutMs: number;
}

export interface RelayObservation {
  readonly accepted: number;
  readonly refused: number;
  readonly failed: number;
  readonly inFlight: number;
}

function parsedOrigin(origin: string): URL {
  let url: URL;
  try { url = new URL(origin); }
  catch { throw new StoreError("UNSUPPORTED_PROFILE", "provider origin is not a URL"); }
  if (url.protocol !== "https:")
    throw new StoreError("UNSUPPORTED_PROFILE", "provider origin must be https");
  if (url.search.length > 0 || url.hash.length > 0)
    throw new StoreError("UNSUPPORTED_PROFILE", "provider origin carries a query or fragment");
  return url;
}

/** Why a request was refused before anything was sent. */
class Refusal extends Error {
  constructor(readonly status: number, reason: string) { super(reason); }
}
const OUTSIDE_SLOT = "the credential placeholder is outside a credential slot";

/** INF-007: the key's bytes in a response. The tail of each chunk is kept so a key
 * split across two chunks is seen too. Nothing is rewritten: a response either
 * passes unchanged or is cut off. */
class CredentialTripwire {
  private tail = Buffer.alloc(0);
  constructor(private readonly secret: Buffer) {}
  /** True once the key has appeared in what was inspected so far. */
  seen(chunk: Buffer): boolean {
    const window = Buffer.concat([this.tail, chunk]);
    if (window.indexOf(this.secret) >= 0) return true;
    this.tail = window.subarray(Math.max(0, window.length - (this.secret.length - 1)));
    return false;
  }
}

/** The origin a request is resolved against to canonicalise it. Nothing is sent
 * here; it exists so the URL parser applies a server's own dot-segment removal
 * and the result can be compared with the declared endpoint. */
const CANONICAL_ORIGIN = "https://relay.invalid";

/** Joins the declared origin's path with the request's, refusing anything that
 * could climb out of it. The destination is the host's decision, so a request
 * path is only ever allowed to extend it.
 *
 * Checking the request's spelling is not enough: `..`, `%2e%2e`, `%2e.` and
 * `.%2e` all name the parent segment, and a list of spellings is a list that
 * will be incomplete. The joined path is canonicalised first and the check is
 * made on the canonical form, so any spelling that resolves out of the declared
 * endpoint is refused by the same test. An encoded separator is refused
 * outright: canonicalisation keeps it encoded, the provider may not, and then
 * the two ends would disagree about which path was authorised.
 */
function targetPath(base: string, requestPath: string | undefined): string {
  if (requestPath === undefined || !requestPath.startsWith("/")) return "";
  if (/%2f|%5c/i.test(requestPath) || requestPath.includes("\\") || requestPath.includes("//")) return "";
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  let resolved: URL;
  try { resolved = new URL(`${prefix}${requestPath}`, CANONICAL_ORIGIN); }
  catch { return ""; }
  if (resolved.origin !== CANONICAL_ORIGIN || resolved.hash.length > 0) return "";
  if (prefix.length > 0 && resolved.pathname !== prefix && !resolved.pathname.startsWith(`${prefix}/`)) return "";
  return `${resolved.pathname}${resolved.search}`;
}

export class InferenceRelay {
  private readonly server: Server;
  private accepted = 0;
  private refused = 0;
  private failed = 0;
  private inFlight = 0;
  private closed = false;
  private readonly tunnels = new Set<Duplex>();

  private constructor(
    private readonly origin: URL,
    private readonly target: RelayTarget,
    private readonly limits: RelayLimits,
  ) {
    this.server = createServer((incoming, outgoing) => { this.forward(incoming, outgoing); });
    this.server.on("upgrade", (incoming: IncomingMessage, socket: Duplex, head: Buffer) => {
      this.tunnel(incoming, socket, head);
    });
    // A relay that silently drops a client error would look like a provider
    // failure from inside, so the socket is destroyed instead.
    this.server.on("clientError", (_error, socket) => { socket.destroy(); });
    // WP27: connections are bounded as well as requests; idle ones would
    // otherwise pile up in this process for as long as the sandbox keeps them.
    this.server.maxConnections = RELAY_CONNECTIONS_PER_REQUEST * limits.concurrent;
  }

  /** Sockets handed in through `accept` and still open. net.Server enforces
   * `maxConnections` only inside its own accept path; a socket emitted onto
   * the HTTP server directly passes no admission check, so a detached relay
   * counts its own (AV-20261003-16: the same bound on both paths). */
  private detachedConnections = 0;

  static async open(
    socketPath: string, target: RelayTarget, limits: RelayLimits,
  ): Promise<InferenceRelay> {
    if (!trustedAbsolutePath(socketPath))
      throw new StoreError("UNSUPPORTED_PROFILE", "relay socket path is not a trusted absolute path");
    const relay = new InferenceRelay(InferenceRelay.checked(target, limits), target, limits);
    // A leftover socket from a killed run would make listen fail; it belongs to
    // this incarnation's run root, so removing it is removing our own artefact.
    clearSocketName(socketPath);
    await new Promise<void>((resolve, reject) => {
      relay.server.once("error", reject);
      relay.server.listen(socketPath, () => { relay.server.off("error", reject); resolve(); });
    });
    // Only this user may speak to the relay; the sandbox runs as the same user.
    // AV-20261003-13, P0-4: the listener and its name are this opener's until
    // the relay is handed back, so a failure here returns them -- a rejected
    // open leaves nothing running and no socket name behind.
    try { chmodSync(socketPath, 0o600); }
    catch (error) { await relay.close(); throw error; }
    return relay;
  }

  /** macos-platform §4.7: the same relay, listening nowhere. The macOS host
   * hands it each egress connection the guest opened for this run's engine;
   * everything a connection carries is then this relay's, exactly as if it
   * had arrived on its socket. */
  static detached(target: RelayTarget, limits: RelayLimits): InferenceRelay {
    return new InferenceRelay(InferenceRelay.checked(target, limits), target, limits);
  }

  /** One connection for a detached relay, with what already arrived on it.
   * The caller read a message off it first and left it paused; the HTTP
   * server takes it from here, so it is let flow again after the hand-over
   * (the same order as any server that sniffs a connection's first bytes). */
  accept(socket: Socket, head: Buffer = Buffer.alloc(0)): void {
    if (this.closed) { socket.destroy(); return; }
    // The same bound the listen path gets from net.Server: a connection over
    // it is destroyed, never queued for nobody. A socket already gone is not
    // counted: its "close" event can never arrive to decrement.
    if (socket.destroyed || socket.closed ||
        this.detachedConnections >= this.server.maxConnections) { socket.destroy(); return; }
    this.detachedConnections += 1;
    socket.once("close", () => { this.detachedConnections -= 1; });
    if (head.length > 0) socket.unshift(head);
    this.server.emit("connection", socket);
    socket.resume();
  }

  private static checked(target: RelayTarget, limits: RelayLimits): URL {
    if (!Number.isSafeInteger(limits.concurrent) || limits.concurrent <= 0 ||
      !Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs <= 0)
      throw new StoreError("UNSUPPORTED_PROFILE", "relay limits are invalid");
    for (const [name, value] of Object.entries(target.headers))
      if (!HEADER_NAME.test(name) || typeof value !== "string" || UNSAFE_VALUE.test(value))
        throw new StoreError("UNSUPPORTED_PROFILE", "relay credential header is invalid");
    const swap = target.substitute;
    if (swap !== undefined && (swap.placeholder.length < 16 || swap.secret.length === 0 ||
      swap.placeholder === swap.secret || UNSAFE_VALUE.test(swap.placeholder) || UNSAFE_VALUE.test(swap.secret)))
      throw new StoreError("UNSUPPORTED_PROFILE", "relay substitution is invalid");
    return parsedOrigin(target.origin);
  }

  observe(): RelayObservation {
    return Object.freeze({
      accepted: this.accepted, refused: this.refused,
      failed: this.failed, inFlight: this.inFlight,
    });
  }

  private carriesPlaceholder(value: string): boolean {
    const substitute = this.target.substitute;
    return substitute !== undefined && value.includes(substitute.placeholder);
  }

  /** The value an authority header carries once the key is in it, or null when
   * the header is not a credential slot: the whole value is the placeholder,
   * or `Bearer ` and the placeholder. */
  private slotted(value: string): string | null {
    const substitute = this.target.substitute;
    if (substitute === undefined) return null;
    if (value === substitute.placeholder) return substitute.secret;
    const bearer = /^bearer /i.exec(value);
    return bearer !== null && value.slice(bearer[0].length) === substitute.placeholder
      ? `${bearer[0]}${substitute.secret}` : null;
  }

  /** The request target with the key in its one query slot. The placeholder in
   * the path, or in any other query parameter, is refused. */
  private slottedTarget(requestPath: string): string {
    const query = requestPath.indexOf("?");
    const path = query < 0 ? requestPath : requestPath.slice(0, query);
    if (this.carriesPlaceholder(path)) throw new Refusal(403, OUTSIDE_SLOT);
    if (query < 0) return path;
    const parameters = requestPath.slice(query + 1).split("&").map(parameter => {
      if (!this.carriesPlaceholder(parameter)) return parameter;
      if (parameter === `key=${this.target.substitute!.placeholder}`) return `key=${this.target.substitute!.secret}`;
      throw new Refusal(403, OUTSIDE_SLOT);
    });
    return `${path}?${parameters.join("&")}`;
  }

  /** The outbound headers: hop-by-hop stripped, the caller's own authority
   * dropped unless it is the placeholder in its slot, the placeholder anywhere
   * else refused, host headers last. Responses are asked for uncompressed so
   * the tripwire reads the bytes the sandbox will. */
  private outboundHeaders(incoming: IncomingHttpHeaders, upgrade: boolean): Record<string, string | string[]> {
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(incoming)) {
      const lowered = name.toLowerCase();
      if (value === undefined) continue;
      if (HOP_BY_HOP.has(lowered) && !(upgrade && UPGRADE_KEPT.has(lowered))) continue;
      if (lowered === "accept-encoding" || lowered === "sec-websocket-extensions") continue;
      const values = Array.isArray(value) ? value : [value];
      if (CALLER_AUTHORITY.has(lowered)) {
        const slotted = values.map(entry => this.slotted(entry));
        if (slotted.every(entry => entry !== null)) headers[name] = Array.isArray(value) ? slotted as string[] : slotted[0]!;
        else if (values.some(entry => this.carriesPlaceholder(entry))) throw new Refusal(403, OUTSIDE_SLOT);
        continue;
      }
      if (values.some(entry => this.carriesPlaceholder(entry)) || this.carriesPlaceholder(name)) throw new Refusal(403, OUTSIDE_SLOT);
      headers[name] = value;
    }
    if (this.target.substitute !== undefined) headers["accept-encoding"] = "identity";
    // Applied last: the host's resolved headers are not something the caller
    // can shadow.
    for (const [name, value] of Object.entries(this.target.headers)) headers[name] = value;
    return headers;
  }

  /** A tripwire for one response, or null when this relay holds no key. */
  private tripwire(): CredentialTripwire | null {
    const secret = this.target.substitute?.secret;
    return secret === undefined ? null : new CredentialTripwire(Buffer.from(secret, "utf8"));
  }

  /** Whether response header lines already carry the key. */
  private headersCarryKey(rawHeaders: readonly string[], statusMessage = ""): boolean {
    const secret = this.target.substitute?.secret;
    return secret !== undefined && [statusMessage, ...rawHeaders].some(value => value.includes(secret));
  }

  /** The response body on its way to the sandbox, unchanged unless it carries
   * the key, in which case `cut` ends both sides before that byte is written. */
  private guarded(cut: () => void): Transform {
    const wire = this.tripwire();
    const guard = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        if (wire !== null && wire.seen(chunk)) { done(new Error("the credential is in the response")); return; }
        done(null, chunk);
      },
    });
    guard.on("error", cut);
    return guard;
  }

  private refuse(outgoing: ServerResponse, status: number, reason: string): void {
    this.refused += 1;
    outgoing.writeHead(status, { "content-type": "text/plain" });
    outgoing.end(reason);
  }

  private refuseTunnel(socket: Duplex, status: number, reason: string): void {
    this.refused += 1;
    socket.end(`HTTP/1.1 ${status} ${reason}\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\n`);
  }

  /** The request's outbound path and headers, or why it is refused. Everything
   * that can refuse runs here, before a request is counted or sent. */
  private admit(incoming: IncomingMessage, upgrade: boolean):
    { path: string; headers: Record<string, string | string[]> } | { status: number; reason: string } {
    if (this.closed) return { status: 503, reason: "relay is closed" };
    if (this.inFlight >= this.limits.concurrent) return { status: 503, reason: "relay concurrency limit reached" };
    try {
      const requestPath = incoming.url;
      const path = targetPath(this.origin.pathname, requestPath === undefined ? undefined : this.slottedTarget(requestPath));
      if (path.length === 0) return { status: 403, reason: "path is outside the declared provider endpoint" };
      return { path, headers: this.outboundHeaders(incoming.headers, upgrade) };
    } catch (error) {
      if (error instanceof Refusal) return { status: error.status, reason: error.message };
      throw error;
    }
  }

  private upstreamOptions(method: string, path: string, headers: Record<string, string | string[]>) {
    return {
      protocol: this.origin.protocol, hostname: this.origin.hostname,
      ...(this.origin.port.length > 0 ? { port: Number(this.origin.port) } : {}),
      method, path, headers,
    };
  }

  private forward(incoming: IncomingMessage, outgoing: ServerResponse): void {
    const admitted = this.admit(incoming, false);
    if ("status" in admitted) { this.refuse(outgoing, admitted.status, admitted.reason); return; }

    this.accepted += 1;
    this.inFlight += 1;
    let settled = false;
    let silence: Timer | null = null;
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      silence?.cancel();
      this.inFlight -= 1;
      return true;
    };

    const upstream = httpsRequest(this.upstreamOptions(incoming.method ?? "POST", admitted.path,
      admitted.headers), response => {
      progress();
      response.on("data", progress);
      // INF-007: a response that carries the key back is cut off, never delivered.
      // Counted once, whether or not the response had already ended upstream.
      let cutOff = false;
      const cut = (): void => {
        if (cutOff) return;
        cutOff = true; settle(); this.failed += 1; upstream.destroy(); outgoing.destroy();
      };
      if (this.headersCarryKey(response.rawHeaders, response.statusMessage)) { cut(); return; }
      // Status and headers travel verbatim; the engine interprets them.
      const replied: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(response.headers))
        if (value !== undefined && !HOP_BY_HOP.has(name.toLowerCase())) replied[name] = value;
      outgoing.writeHead(response.statusCode ?? 502, replied);
      response.pipe(this.guarded(cut)).pipe(outgoing);
      response.on("end", () => { settle(); });
      response.on("error", () => { if (settle()) this.failed += 1; outgoing.destroy(); });
    });
    // One monotonic clock covers DNS/connect/TLS and response silence. A
    // socket-only timeout starts too late and overflows for large budgets.
    const progress = (): void => {
      if (settled) return;
      silence?.cancel();
      silence = alarm(this.limits.timeoutMs / 1000, () => {
        if (!settle()) return;
        this.failed += 1;
        upstream.destroy();
        if (!outgoing.headersSent) this.refuse(outgoing, 504, "provider did not answer in time");
        else outgoing.destroy();
      });
    };
    upstream.once("finish", progress);
    progress();
    upstream.on("error", () => {
      if (settle()) this.failed += 1;
      if (!outgoing.headersSent) this.refuse(outgoing, 502, "provider request failed");
      else outgoing.destroy();
    });
    incoming.on("error", () => { upstream.destroy(); });
    // P0V-34, P0-4: the request, its answer and the provider call are one
    // owner's. An engine that goes away before the answer ends takes the
    // provider call with it -- nothing is left running for nobody, and the slot
    // is given back after the call is cut, not while it still streams. The
    // call is cut, never retried: whether the provider did the work stays the
    // engine's to judge (INF-001, INF-004).
    outgoing.once("close", () => {
      if (outgoing.writableFinished) return;
      upstream.destroy();
      settle();
    });
    incoming.pipe(upstream);
  }

  /** A WebSocket upgrade is tunnelled the same way: rewritten once at the
   * handshake, then carried as bytes in both directions. The frames that
   * follow are not read, so the relay learns nothing about their contents. */
  private tunnel(incoming: IncomingMessage, socket: Duplex, head: Buffer): void {
    const admitted = this.admit(incoming, true);
    if ("status" in admitted) { this.refuseTunnel(socket, admitted.status, admitted.reason); return; }

    this.accepted += 1;
    this.inFlight += 1;
    let settled = false;
    let silence: Timer | null = null;
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      silence?.cancel();
      this.inFlight -= 1;
      return true;
    };
    this.tunnels.add(socket);
    // P0V-34, P0-4: either side ending ends the tunnel, before its slot is
    // given back -- a provider connection with no engine left is closed, not
    // left for the provider to end.
    let provider: Duplex | null = null;
    const upstream = httpsRequest(this.upstreamOptions(incoming.method ?? "GET", admitted.path, admitted.headers));
    socket.once("close", () => { this.tunnels.delete(socket); upstream.destroy(); provider?.destroy(); settle(); });
    socket.on("error", () => { socket.destroy(); });

    let cutOff = false;
    const cut = (): void => {
      if (cutOff) return;
      cutOff = true; settle(); this.failed += 1; upstream.destroy(); socket.destroy();
    };
    const progress = (): void => {
      if (settled) return;
      silence?.cancel();
      silence = alarm(this.limits.timeoutMs / 1000, () => {
        if (!settle()) return;
        this.failed += 1;
        upstream.destroy(); provider?.destroy(); socket.destroy();
      });
    };
    upstream.once("finish", progress);
    progress();
    upstream.on("upgrade", (response, providerSocket, providerHead) => {
      progress();
      if (this.headersCarryKey(response.rawHeaders, response.statusMessage)) { providerSocket.destroy(); cut(); return; }
      const lines = [`HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? "Switching Protocols"}`];
      for (let index = 0; index < response.rawHeaders.length; index += 2)
        lines.push(`${response.rawHeaders[index]!}: ${response.rawHeaders[index + 1]!}`);
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      provider = providerSocket;
      providerSocket.on("data", progress);
      if (socket.destroyed) { providerSocket.destroy(); return; }
      const guard = this.guarded(() => { providerSocket.destroy(); cut(); });
      if (head.length > 0) providerSocket.write(head);
      this.tunnels.add(providerSocket);
      providerSocket.once("close", () => { this.tunnels.delete(providerSocket); socket.destroy(); });
      providerSocket.on("error", () => { if (settle()) this.failed += 1; socket.destroy(); });
      if (providerHead.length > 0) guard.write(providerHead);
      providerSocket.pipe(guard).pipe(socket);
      socket.pipe(providerSocket);
    });
    // A provider that refuses the upgrade answers with an ordinary response;
    // it travels back verbatim so the engine can fall back as it would on the host.
    upstream.on("response", response => {
      progress();
      response.on("data", progress);
      response.once("end", settle);
      response.once("error", cut);
      if (this.headersCarryKey(response.rawHeaders, response.statusMessage)) { cut(); return; }
      const lines = [`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? ""}`.trimEnd()];
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        const name = response.rawHeaders[index]!;
        if (HOP_BY_HOP.has(name.toLowerCase())) continue;
        lines.push(`${name}: ${response.rawHeaders[index + 1]!}`);
      }
      lines.push("connection: close");
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      response.pipe(this.guarded(cut)).pipe(socket);
    });
    upstream.on("error", () => {
      if (settle()) this.failed += 1;
      this.refuseTunnel(socket, 502, "provider request failed");
    });
    upstream.end();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const tunnel of this.tunnels) tunnel.destroy();
    this.tunnels.clear();
    // The server's own close removes its name (P0V-114).
    await new Promise<void>(resolve => { this.server.close(() => { resolve(); }); this.server.closeAllConnections(); });
  }
}
