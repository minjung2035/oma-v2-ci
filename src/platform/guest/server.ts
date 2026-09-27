/** The guest end of every host connection: one unix socket, the handshake,
 * and the handler of the channel the hello names.
 *
 * In the guest a host connection arrives through the vsock bridge (one
 * socket-activated instance per connection, MAC-202), so by the time it is
 * here it is a unix-socket stream from a peer the bridge identified as the
 * host. Which process connected is asked of the kernel (SO_PEERCRED), not
 * inferred from the socket file's mode: the bridge runs as its own user and
 * nothing else is served, because a process of this service's own user could
 * open a socket this user owns, and a file's mode is no boundary within one
 * uid (FS-005, AUTH-003). This server still checks everything the host says
 * (MAC-230): the hello's shape, the VM instance it names (MAC-211) and the
 * protocol.
 */
import { createServer, type Server, type Socket } from "node:net";
import { chmodSync, chownSync, existsSync, unlinkSync } from "node:fs";
import { peerCred, socketDescriptor } from "../../leaf.js";
import { FramedPeer, readHello } from "../rpc.js";
import { productText } from "../product-text.js";
import { ERROR_METADATA, StoreError, errorCodeOf } from "../../domain/errors.js";
import {
  negotiate, requestProblem, HOST_GUEST_PROTOCOL,
  type Channel, type HelloParams, type HelloResult, type PlatformErrorCode,
} from "../../protocol/host-guest.js";

export interface GuestIdentity {
  /** The VM instance this guest's state disk was made for (MAC-211). */
  readonly instanceId: string;
  readonly guestImage: string;
  readonly bootId: string;
  readonly stateSchema: HelloResult["stateSchema"];
  readonly capabilities: readonly string[];
}

export interface ChannelContext {
  readonly peer: FramedPeer;
  readonly hello: HelloParams;
}
/** A JSON channel: requests arrive on the peer after the hello was answered.
 * A byte channel (egress, stream) takes the raw socket instead. */
export type ChannelHandler =
  | { readonly kind: "json"; serve(context: ChannelContext): void }
  | { readonly kind: "bytes"; serve(socket: Socket, hello: HelloParams): void };

export interface GuestServerOptions {
  readonly socketPath: string;
  /** The vsock bridge's user: the only peer this server answers (MAC-202). */
  readonly bridge: { readonly uid: number; readonly gid: number };
  readonly identity: () => GuestIdentity;
  readonly channels: Partial<Record<Channel, ChannelHandler>>;
  readonly frameBytes: number;
  readonly helloDeadlineMs: number;
  readonly requestTimeoutMs: number;
}

export function startGuestServer(options: GuestServerOptions): Promise<Server> {
  if (existsSync(options.socketPath)) unlinkSync(options.socketPath);
  const server = createServer({ allowHalfOpen: true }, socket => { void accept(socket, options); });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      // The bridge's group may connect; who did is checked per connection.
      try {
        if (options.bridge.gid !== process.getgid?.()) chownSync(options.socketPath, -1, options.bridge.gid);
        chmodSync(options.socketPath, 0o660);
      } catch (error) { server.close(); reject(error as Error); return; }
      server.off("error", reject);
      resolve(server);
    });
  });
}

async function accept(socket: Socket, options: GuestServerOptions): Promise<void> {
  socket.on("error", () => { socket.destroy(); });
  // Closed unread: a peer that is not the bridge learns nothing, not even
  // that a hello would have been refused.
  const fd = socketDescriptor(socket);
  const credentials = fd === null ? null : peerCred(fd);
  if (credentials === null || credentials.uid !== options.bridge.uid) { socket.destroy(); return; }
  const peer = new FramedPeer(socket, { frameBytes: options.frameBytes, requestTimeoutMs: options.requestTimeoutMs });
  let hello: { readonly id: string; readonly params: HelloParams };
  try { hello = await readHello(peer, options.helloDeadlineMs); }
  catch { return; }
  const identity = options.identity();
  const refuse = (code: "INVALID_REQUEST" | "UNSUPPORTED_VERSION" | "AUTH_FAILED", message: string): void => {
    try { peer.refuse(hello.id, { code, message, retry: "never" }); } catch { /* closing anyway */ }
    peer.closeAfterFlush(message);
  };
  // MAC-211: a host that names another VM instance is talking to the wrong
  // disk; nothing it asks is done here.
  if (hello.params.instanceId !== identity.instanceId) { refuse("AUTH_FAILED", "this guest belongs to another VM instance"); return; }
  const protocol = negotiate(hello.params.protocol, HOST_GUEST_PROTOCOL);
  if (protocol === null) { refuse("UNSUPPORTED_VERSION", `this guest speaks protocol ${HOST_GUEST_PROTOCOL}`); return; }
  const handler = options.channels[hello.params.channel];
  if (handler === undefined) { refuse("INVALID_REQUEST", `this service does not serve the ${hello.params.channel} channel`); return; }
  const result: HelloResult = { protocol, guestImage: identity.guestImage, bootId: identity.bootId,
    stateSchema: identity.stateSchema, capabilities: identity.capabilities };
  peer.answer(hello.id, result as unknown as Record<string, unknown>);
  if (handler.kind === "json") { handler.serve({ peer, hello: hello.params }); return; }
  // A byte channel leaves the framed peer behind: from here the socket is the
  // channel's. The peer has consumed nothing past the hello, because the host
  // sends nothing else until the hello is answered.
  handler.serve(peer.detach(), hello.params);
}

/** Runs one JSON request at a time for a channel and answers it. A handler
 * that throws a StoreError is refused with that code; anything else is an
 * internal error. The words of a refusal leave the guest only when they say
 * nothing of Linux (MAC-231); otherwise the code alone speaks. */
export function serveRequests(peer: FramedPeer,
  handle: (method: string, params: Record<string, unknown>, key: string | undefined) => Promise<Record<string, unknown>>): void {
  let chain = Promise.resolve();
  peer.onFrame(frame => {
    chain = chain.then(async () => {
      const id = typeof frame.id === "string" ? frame.id : "x";
      const problem = requestProblem(frame);
      if (problem !== null) { safeRefuse(peer, id, "INVALID_REQUEST", problem); return; }
      try { peer.answer(id, await handle(frame.method as string, frame.params as Record<string, unknown>, frame.key as string | undefined)); }
      catch (error) {
        const code = errorCodeOf(error);
        const category = ERROR_METADATA[code].category;
        const retry = category === "transient" || category === "ambiguous" || category === "internal" ? "same-key" : "never";
        const words = error instanceof StoreError && code !== "INTERNAL_ERROR" && productText(error.message) ? error.message : code;
        safeRefuse(peer, id, code, words, retry);
      }
    });
  });
}
function safeRefuse(peer: FramedPeer, id: string, code: PlatformErrorCode, message: string, retry: "never" | "same-key" = "never"): void {
  try { peer.refuse(id, { code, message: message.slice(0, 1024), retry }); } catch { /* the connection is gone */ }
}
