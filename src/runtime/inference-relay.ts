/** INF-005/006/007: the host end of a confined Resident's provider access.
 *
 * A confined Resident has no credential (PR-004) and no network (SB-004). This
 * relay is how the engine inside it still reaches a provider without either
 * being opened: the sandbox speaks plain HTTP to a bind-mounted unix socket,
 * and this process attaches the real credential and forwards to the one
 * endpoint the host declared.
 *
 * It is a byte relay. It does not read the stream, reassemble messages, count
 * tokens or price anything — those stay with the engine (INF-001). What it does
 * own is the chokepoint: the destination is fixed, the caller's own
 * authorization headers are dropped rather than forwarded, and a request whose
 * outcome is unclear is never resent (INF-004).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { chmodSync, rmSync } from "node:fs";
import { StoreError } from "../domain/errors.js";
import { trustedAbsolutePath } from "../protocol/run-lease.js";

/** Headers that belong to one hop and must not be copied onto the next. */
const HOP_BY_HOP = Object.freeze(new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host",
]));

/** Anything the sandbox might send that looks like a credential. The value
 * inside is a placeholder, so forwarding it would at best confuse the provider
 * and at worst let a model choose its own authorization. */
const CALLER_AUTHORITY = Object.freeze(new Set([
  "authorization", "x-api-key", "api-key", "x-goog-api-key",
]));

export interface RelayTarget {
  /** Absolute origin of the declared provider, e.g. `https://api.example.com`.
   * It comes from the host's model profile, never from the request. */
  readonly origin: string;
  /** Credential headers resolved by the engine on the host. Never logged. */
  readonly headers: Readonly<Record<string, string>>;
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

/** Joins the declared origin's path with the request's, refusing anything that
 * could climb out of it. The destination is the host's decision, so a request
 * path is only ever allowed to extend it. */
function targetPath(base: string, requestPath: string | undefined): string {
  if (requestPath === undefined || !requestPath.startsWith("/")) return "";
  // A relative segment or an encoded one must not be able to re-root the path.
  const lowered = requestPath.toLowerCase();
  if (requestPath.includes("..") || lowered.includes("%2e%2e") || requestPath.includes("//")) return "";
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${prefix}${requestPath}`;
}

export class InferenceRelay {
  private readonly server: Server;
  private accepted = 0;
  private refused = 0;
  private failed = 0;
  private inFlight = 0;
  private closed = false;

  private constructor(
    private readonly socketPath: string,
    private readonly origin: URL,
    private readonly target: RelayTarget,
    private readonly limits: RelayLimits,
  ) {
    this.server = createServer((incoming, outgoing) => { this.forward(incoming, outgoing); });
    // A relay that silently drops a client error would look like a provider
    // failure from inside, so the socket is destroyed instead.
    this.server.on("clientError", (_error, socket) => { socket.destroy(); });
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
      if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || typeof value !== "string" || /[\r\n\0]/.test(value))
        throw new StoreError("UNSUPPORTED_PROFILE", "relay credential header is invalid");
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

  private refuse(outgoing: ServerResponse, status: number, reason: string): void {
    this.refused += 1;
    outgoing.writeHead(status, { "content-type": "text/plain" });
    outgoing.end(reason);
  }

  private forward(incoming: IncomingMessage, outgoing: ServerResponse): void {
    if (this.closed) { this.refuse(outgoing, 503, "relay is closed"); return; }
    if (this.inFlight >= this.limits.concurrent) {
      this.refuse(outgoing, 503, "relay concurrency limit reached");
      return;
    }
    const path = targetPath(this.origin.pathname, incoming.url);
    if (path.length === 0) { this.refuse(outgoing, 403, "path is outside the declared provider endpoint"); return; }

    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(incoming.headers)) {
      const lowered = name.toLowerCase();
      if (value === undefined || HOP_BY_HOP.has(lowered) || CALLER_AUTHORITY.has(lowered)) continue;
      headers[name] = value;
    }
    // Applied last: the host's credential is not something the caller can shadow.
    for (const [name, value] of Object.entries(this.target.headers)) headers[name] = value;

    this.accepted += 1;
    this.inFlight += 1;
    let settled = false;
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      this.inFlight -= 1;
      return true;
    };

    const upstream = httpsRequest({
      protocol: this.origin.protocol, hostname: this.origin.hostname,
      ...(this.origin.port.length > 0 ? { port: Number(this.origin.port) } : {}),
      method: incoming.method ?? "POST", path, headers,
    }, response => {
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

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await new Promise<void>(resolve => { this.server.close(() => { resolve(); }); });
    this.server.closeAllConnections();
    rmSync(this.socketPath, { force: true });
  }
}
