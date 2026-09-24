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
 * This relay swaps the placeholder for the real key on the way out, in headers
 * and in the request path, and nowhere else.
 */
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import { chmodSync, rmSync } from "node:fs";
import { StoreError } from "../domain/errors.js";
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
  /** Milliseconds a forwarded request may take before it is abandoned. */
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
    private readonly socketPath: string,
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

  static async open(
    socketPath: string, target: RelayTarget, limits: RelayLimits,
  ): Promise<InferenceRelay> {
    if (!trustedAbsolutePath(socketPath))
      throw new StoreError("UNSUPPORTED_PROFILE", "relay socket path is not a trusted absolute path");
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
    const relay = new InferenceRelay(socketPath, parsedOrigin(target.origin), target, limits);
    // A leftover socket from a killed run would make listen fail; it belongs to
    // this incarnation's run root, so removing it is removing our own artefact.
    rmSync(socketPath, { force: true });
    await new Promise<void>((resolve, reject) => {
      relay.server.once("error", reject);
      relay.server.listen(socketPath, () => { relay.server.off("error", reject); resolve(); });
    });
    // Only this user may speak to the relay; the sandbox runs as the same user.
    chmodSync(socketPath, 0o600);
    return relay;
  }

  observe(): RelayObservation {
    return Object.freeze({
      accepted: this.accepted, refused: this.refused,
      failed: this.failed, inFlight: this.inFlight,
    });
  }

  private swap(value: string): string {
    const substitute = this.target.substitute;
    return substitute === undefined ? value : value.split(substitute.placeholder).join(substitute.secret);
  }

  private carriesPlaceholder(value: string): boolean {
    const substitute = this.target.substitute;
    return substitute !== undefined && value.includes(substitute.placeholder);
  }

  /** The outbound headers: hop-by-hop stripped, the caller's own authority
   * dropped unless it is the placeholder being swapped, host headers last. */
  private outboundHeaders(incoming: IncomingHttpHeaders, upgrade: boolean): Record<string, string | string[]> {
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(incoming)) {
      const lowered = name.toLowerCase();
      if (value === undefined) continue;
      if (HOP_BY_HOP.has(lowered) && !(upgrade && UPGRADE_KEPT.has(lowered))) continue;
      const values = Array.isArray(value) ? value : [value];
      if (CALLER_AUTHORITY.has(lowered) && !values.every(entry => this.carriesPlaceholder(entry))) continue;
      const swapped = values.map(entry => this.swap(entry));
      headers[name] = Array.isArray(value) ? swapped : swapped[0]!;
    }
    // Applied last: the host's resolved headers are not something the caller
    // can shadow.
    for (const [name, value] of Object.entries(this.target.headers)) headers[name] = value;
    return headers;
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

  private admit(requestPath: string | undefined): { path: string } | { status: number; reason: string } {
    if (this.closed) return { status: 503, reason: "relay is closed" };
    if (this.inFlight >= this.limits.concurrent) return { status: 503, reason: "relay concurrency limit reached" };
    const path = targetPath(this.origin.pathname, requestPath === undefined ? undefined : this.swap(requestPath));
    if (path.length === 0) return { status: 403, reason: "path is outside the declared provider endpoint" };
    return { path };
  }

  private upstreamOptions(method: string, path: string, headers: Record<string, string | string[]>) {
    return {
      protocol: this.origin.protocol, hostname: this.origin.hostname,
      ...(this.origin.port.length > 0 ? { port: Number(this.origin.port) } : {}),
      method, path, headers,
    };
  }

  private forward(incoming: IncomingMessage, outgoing: ServerResponse): void {
    const admitted = this.admit(incoming.url);
    if ("status" in admitted) { this.refuse(outgoing, admitted.status, admitted.reason); return; }

    this.accepted += 1;
    this.inFlight += 1;
    let settled = false;
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      this.inFlight -= 1;
      return true;
    };

    const upstream = httpsRequest(this.upstreamOptions(incoming.method ?? "POST", admitted.path,
      this.outboundHeaders(incoming.headers, false)), response => {
      // Status and headers travel verbatim; the engine interprets them.
      const replied: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(response.headers))
        if (value !== undefined && !HOP_BY_HOP.has(name.toLowerCase())) replied[name] = value;
      outgoing.writeHead(response.statusCode ?? 502, replied);
      response.pipe(outgoing);
      response.on("end", () => { settle(); });
      response.on("error", () => { if (settle()) this.failed += 1; outgoing.destroy(); });
    });
    upstream.setTimeout(this.limits.timeoutMs, () => {
      // An abandoned request is reported as unclear, not retried (INF-004).
      if (settle()) this.failed += 1;
      upstream.destroy();
      if (!outgoing.headersSent) this.refuse(outgoing, 504, "provider did not answer in time");
      else outgoing.destroy();
    });
    upstream.on("error", () => {
      if (settle()) this.failed += 1;
      if (!outgoing.headersSent) this.refuse(outgoing, 502, "provider request failed");
      else outgoing.destroy();
    });
    incoming.on("error", () => { upstream.destroy(); });
    incoming.pipe(upstream);
  }

  /** A WebSocket upgrade is tunnelled the same way: rewritten once at the
   * handshake, then carried as bytes in both directions. The frames that
   * follow are not read, so the relay learns nothing about their contents. */
  private tunnel(incoming: IncomingMessage, socket: Duplex, head: Buffer): void {
    const admitted = this.admit(incoming.url);
    if ("status" in admitted) { this.refuseTunnel(socket, admitted.status, admitted.reason); return; }

    this.accepted += 1;
    this.inFlight += 1;
    let settled = false;
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      this.inFlight -= 1;
      return true;
    };
    this.tunnels.add(socket);
    socket.once("close", () => { this.tunnels.delete(socket); settle(); });
    socket.on("error", () => { socket.destroy(); });

    const upstream = httpsRequest(this.upstreamOptions(incoming.method ?? "GET", admitted.path,
      this.outboundHeaders(incoming.headers, true)));
    upstream.setTimeout(this.limits.timeoutMs, () => {
      if (settle()) this.failed += 1;
      upstream.destroy();
      socket.destroy();
    });
    upstream.on("upgrade", (response, providerSocket, providerHead) => {
      upstream.setTimeout(0);
      const lines = [`HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? "Switching Protocols"}`];
      for (let index = 0; index < response.rawHeaders.length; index += 2)
        lines.push(`${response.rawHeaders[index]!}: ${response.rawHeaders[index + 1]!}`);
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (providerHead.length > 0) socket.write(providerHead);
      if (head.length > 0) providerSocket.write(head);
      this.tunnels.add(providerSocket);
      providerSocket.once("close", () => { this.tunnels.delete(providerSocket); socket.destroy(); });
      providerSocket.on("error", () => { if (settle()) this.failed += 1; socket.destroy(); });
      providerSocket.pipe(socket);
      socket.pipe(providerSocket);
    });
    // A provider that refuses the upgrade answers with an ordinary response;
    // it travels back verbatim so the engine can fall back as it would on the host.
    upstream.on("response", response => {
      upstream.setTimeout(0);
      const lines = [`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? ""}`.trimEnd()];
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        const name = response.rawHeaders[index]!;
        if (HOP_BY_HOP.has(name.toLowerCase())) continue;
        lines.push(`${name}: ${response.rawHeaders[index + 1]!}`);
      }
      lines.push("connection: close");
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      response.pipe(socket);
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
    await new Promise<void>(resolve => { this.server.close(() => { resolve(); }); this.server.closeAllConnections(); });
    rmSync(this.socketPath, { force: true });
  }
}
