/** Darwin rendezvous and endpoint mechanics. Shared Broker/Client owners keep
 * RPC framing, roles, scope, current grants, retries and accepted outcomes.
 * Dynamic bootstrap check-in and this adapter remain Darwin NOT_RUN; product
 * qualification guards are not relaxed by compiling or wiring this module.
 */
import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import { createHash, randomBytes } from "node:crypto";
import { StoreError } from "@oma/domain/errors";
import { deadline } from "@oma/process/deadline";
import type { PacketStream } from "@oma/process/packet-stream";
import {
  createMachEndpoint, inheritedMachPeerEndpoint, isMachAuditSender, listenMachService, lookupMachService,
  type MachMessage, type MachReceiveRight, type MachSendRight, type MachAuditSender,
} from "@oma/native/mach-message";
import { cleanupAll, withAsyncCleanup, withCleanup } from "@oma/native/cleanup";
import { bindMachSender, type MachPeerPin, type MachPeerBinding } from "./audit-peer.js";
import { machStream } from "./mach-stream.js";
import { machPoll } from "./mach-poll.js";
import { machRendezvousName } from "./mach-address.js";
import { pinInheritedDarwinPeer } from "@oma/native/audit-session";
import { peerFromMachReceiver, type DarwinJobPeer } from "./mach-peer-source.js";
import { borrowDarwinPrivateChild, type PrivateParentPin } from "@oma/native/private-parent";

const OPEN = 0x4f4d4101, OPENED = 0x4f4d4104;
const unavailable = (message: string): StoreError => new StoreError("BROKER_UNAVAILABLE", message);
function duration(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(seconds * 1000)) throw new RangeError("invalid Mach handshake deadline");
  return seconds * 1000;
}
type Packet = Extract<MachMessage, { kind: "data" }>;

/** The returned stream immediately owns cancellation, including while the
 * handshake is pending. No bearer/PID from a body becomes peer evidence.
 */
export function dialMachChannel(path: string, handshakeSeconds: number): { readonly socket: Duplex; readonly ready: Promise<void> } {
  machRendezvousName(path); duration(handshakeSeconds);
  return dialExpectedMachChannel(path, handshakeSeconds, pinInheritedDarwinPeer(), () => inheritedMachPeerEndpoint());
}
/** Host composition supplies its own privately acquired, unreaped child.
 * Public lookup only routes the nonce; every reply still needs that exact
 * live kernel sender, including its transferred private connection endpoint. */
export function dialOwnedChildMachChannel(path: string, handshakeSeconds: number, child: PrivateParentPin): { readonly socket: Duplex; readonly ready: Promise<void> } {
  const name = machRendezvousName(path); duration(handshakeSeconds);
  return dialExpectedMachChannel(path, handshakeSeconds, borrowDarwinPrivateChild(child), () => lookupMachService(name));
}
function dialExpectedMachChannel(path: string, handshakeSeconds: number,
  source: { readonly token: readonly number[]; alive(): boolean; close(): void },
  acquire: () => MachSendRight): { readonly socket: Duplex; readonly ready: Promise<void> } {
  const name = machRendezvousName(path), ms = duration(handshakeSeconds);
  const nonce = Buffer.concat([randomBytes(16), createHash("sha256").update(name).digest()]);
  const expires = performance.now() + ms;
  let service: MachSendRight;
  try { service = acquire(); }
  catch (error) { return withCleanup(() => { throw error; }, () => source.close()); }
  const expected = (sender: MachAuditSender): boolean => isMachAuditSender(sender) && source.alive() &&
    sender.token.every((word, index) => word === source.token[index]);
  let local: ReturnType<typeof createMachEndpoint>;
  try { local = createMachEndpoint(); }
  catch (error) { return withCleanup(() => { throw error; }, () => cleanupAll([() => service.close(), () => source.close()])); }
  let remote: MachSendRight | null = null, opened = false, sent = false;
  let poll: ReturnType<typeof machPoll> | undefined, cancel = (): void => {};
  let resolve!: () => void, reject!: (error: unknown) => void;
  const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void ready.catch(() => {}); // Constructor failure can precede a returned endpoint owner.
  const socket = machStream({
    receive: local.receive,
    send: {
      send: (id, bytes, reply) => {
        if (remote === null) return "again";
        if (!source.alive()) throw new StoreError("AUTH_FAILED", "expected Mach peer is no longer live");
        return remote.send(id, bytes, reply);
      },
      destination: () => source.alive() ? remote?.destination() ?? "unknown" : "unknown",
      close: () => remote?.close(),
    },
  }, expected, () => {
    reject(unavailable("Mach connection ended before readiness"));
    cleanupAll([cancel, () => poll?.close(), () => service.close(), () => local.send.close(), () => source.close()]);
  }, () => opened);
  const fail = (error: unknown): void => {
    const failure = error instanceof Error ? error : new Error("Mach connection failed", { cause: error });
    reject(failure); socket.destroy(failure);
  };
  // Retains terminal error ownership even if a caller destroys the pending
  // connector before installing its channel-generation listeners.
  socket.on("error", reject);
  const receive = (): void => {
    if (socket.destroyed || opened) return;
    if (!source.alive()) { fail(new StoreError("AUTH_FAILED", "expected Mach peer ended during connection")); return; }
    if (performance.now() >= expires) { fail(unavailable("Mach rendezvous deadline exceeded")); return; }
    if (!sent) {
      if (service.send(OPEN, nonce, local.send) === "again") return;
      sent = true;
    }
    const message = local.receive.receive();
    if (message.kind === "again") return;
    let transferred = false;
    withCleanup(() => {
      if (message.id !== OPENED || message.reply === null || !message.bytes.equals(nonce) || !expected(message.sender))
        throw new StoreError("AUTH_FAILED", "invalid Mach rendezvous reply");
      remote = message.reply; transferred = true;
      // The selected inherited task-name source already owns the original
      // full token, generation, coalition and process watch. A second generic
      // Security lookup from inside Seatbelt neither establishes the expected
      // Broker nor supplies additional role authority. Every packet still
      // requires genuine kernel provenance, this exact token and a live source.
      cleanupAll([() => service.close(), () => local.send.close(), cancel, () => poll?.close()]);
      opened = true; resolve();
    }, () => { if (!transferred) message.reply?.close(); });
  };
  try {
    poll = machPoll(receive, fail);
    cancel = deadline(Math.max(1, expires - performance.now()), () => fail(unavailable("Mach rendezvous deadline exceeded")));
    poll.request(true);
  } catch (error) { fail(error); }
  return { socket, ready };
}

interface Pending {
  readonly client: MachSendRight; readonly endpoint: ReturnType<typeof createMachEndpoint>;
  readonly pin: MachPeerPin; readonly nonce: Buffer; readonly expires: number; cancel(): void;
}
class MachListener extends EventEmitter {
  private receiver: MachReceiveRight | null = null;
  private releaseReceiver: (() => void) | null = null;
  private purpose: Buffer | null = null;
  private poll: ReturnType<typeof machPoll> | null = null;
  private readonly pending = new Set<Pending>();
  private readonly checking = new Set<Promise<void>>();
  private readonly streams = new Set<PacketStream<MachAuditSender>>();
  private readonly waiters: (() => void)[] = [];
  private started = false;
  private closing = false;
  private closed = false;
  private closeFailure: unknown;
  constructor(private readonly seconds: number, private readonly maximum: number | undefined,
    private readonly accept: (endpoints: { receive: MachReceiveRight; send: MachSendRight }, pin: MachPeerPin) => PacketStream<MachAuditSender>,
    private readonly serve: (socket: Duplex) => void,
    private readonly acquire: (name: string) => { readonly receiver: MachReceiveRight; close(): void }) { super(); duration(seconds); }
  listen(path: string): this {
    if (this.started || this.closing) throw unavailable("Mach listener cannot bind twice");
    this.started = true;
    try {
      const endpoint = this.acquire(machRendezvousName(path));
      this.receiver = endpoint.receiver; this.releaseReceiver = () => endpoint.close();
      this.purpose = createHash("sha256").update(machRendezvousName(path)).digest();
      this.poll = machPoll(() => this.tick(), error => {
        this.poll?.close();
        if (error instanceof AggregateError) this.closeFailure ??= error;
        this.emit("error", error);
      });
      this.poll.request(true);
      queueMicrotask(() => { if (!this.closing) this.emit("listening"); });
    } catch (error) { queueMicrotask(() => this.emit("error", error)); }
    return this;
  }
  /** Borrow this listener's actual owned endpoint for a trusted job launch.
   * No public service lookup is involved in the handoff. */
  peerSource(): DarwinJobPeer {
    if (this.receiver === null || this.closing) throw unavailable("Mach listener has no live peer source");
    return peerFromMachReceiver(this.receiver);
  }
  private discard(ticket: Pending): void {
    if (!this.pending.delete(ticket)) return;
    try { cleanupAll([ticket.cancel, () => ticket.client.close(), () => ticket.endpoint.receive.close(), () => ticket.endpoint.send.close(), () => ticket.pin.close()]); }
    catch (error) { this.closeFailure ??= error; throw error; }
  }
  private request(message: Packet): void {
    const task = this.prepareRequest(message);
    this.checking.add(task);
    void task.then(() => {
      this.checking.delete(task); this.finishClose();
    }, error => {
      this.checking.delete(task); this.closeFailure ??= error;
      this.emit("error", error); this.finishClose();
    });
  }
  private async prepareRequest(message: Packet): Promise<void> {
    let clientOwned = false, pin: MachPeerPin | null = null, endpoint: ReturnType<typeof createMachEndpoint> | null = null;
    let binding: MachPeerBinding | undefined, expired = false, ticket: Pending | undefined, cancel = (): void => {};
    try {
      if (message.id !== OPEN || message.bytes.length !== 48 || this.purpose === null ||
          !message.bytes.subarray(16).equals(this.purpose) || message.reply === null ||
          this.maximum !== undefined && this.pending.size + this.streams.size + this.checking.size >= this.maximum) return;
      const expires = performance.now() + duration(this.seconds);
      binding = bindMachSender(message.sender);
      cancel = deadline(Math.max(1, expires - performance.now()), () => {
        expired = true;
        if (ticket !== undefined) {
          try { this.discard(ticket); } catch (error) { this.emit("error", error); }
        }
      });
      await binding.ready;
      if (this.closing || expired || performance.now() >= expires) return;
      pin = binding.take();
      endpoint = createMachEndpoint();
      ticket = { client: message.reply, endpoint, pin, nonce: message.bytes, expires, cancel };
      this.pending.add(ticket);
      clientOwned = true; pin = null; endpoint = null;
    } catch (error) {
      // A client with no bindable live image receives no channel. Cleanup
      // failures, unlike an authentication refusal, reach the listener owner.
      if (error instanceof AggregateError) { this.closeFailure ??= error; this.emit("error", error); }
      else this.emit("clientError", error);
    } finally {
      try {
        await withAsyncCleanup(async () => { await binding?.close(); }, () => cleanupAll([
          () => { if (!clientOwned) cancel(); }, () => { if (!clientOwned) message.reply?.close(); },
          () => pin?.close(), () => endpoint?.receive.close(), () => endpoint?.send.close(),
        ]));
      } catch (error) { this.closeFailure ??= error; this.emit("error", error); }
    }
  }
  private tick(): void {
    if (this.closing || this.receiver === null) return;
    for (const ticket of [...this.pending]) {
      if (performance.now() >= ticket.expires || !ticket.pin.alive()) { this.discard(ticket); continue; }
      let enqueued = false, stream: PacketStream<MachAuditSender> | undefined;
      try {
        if (ticket.client.send(OPENED, ticket.nonce, ticket.endpoint.send) === "again") continue;
        enqueued = true;
        this.pending.delete(ticket); ticket.cancel();
        ticket.endpoint.send.close();
        stream = this.accept({ receive: ticket.endpoint.receive, send: ticket.client }, ticket.pin);
        const accepted = stream;
        stream.once("close", () => {
          this.streams.delete(accepted);
          if (!accepted.resourcesReturned) {
            this.closeFailure ??= unavailable("Mach stream resource return is unconfirmed");
            this.emit("error", this.closeFailure);
          }
          this.finishClose();
        });
        this.streams.add(stream);
        try { this.serve(stream); } catch (error) { stream.destroy(error instanceof Error ? error : unavailable("Mach connection setup failed")); }
      } catch (error) {
        // A failed send/stream setup may follow enqueue. It creates no RPC
        // acceptance and returns every local owner without retrying a request.
        const failures: unknown[] = [error];
        if (stream !== undefined) stream.destroy(error instanceof Error ? error : unavailable("Mach connection setup failed"));
        else {
          this.pending.add(ticket);
          try { this.discard(ticket); } catch (cleanup) { failures.push(cleanup); }
        }
        const invalidDestination = error !== null && typeof error === "object" && "machCode" in error && error.machCode === 0x10000003;
        if (enqueued || failures.length > 1 || !invalidDestination) {
          const failure = failures.length > 1 ? new AggregateError(failures, "Mach handshake and cleanup failed") : error;
          this.closeFailure ??= failure; this.emit("error", failure);
        } else this.emit("clientError", error);
      }
    }
    const message = this.receiver.receive();
    if (message.kind === "data") this.request(message);
  }
  close(callback?: () => void): this {
    if (this.closed) { if (callback) queueMicrotask(callback); return this; }
    if (callback) this.waiters.push(callback);
    if (!this.closing) {
      this.closing = true;
      try { cleanupAll([() => this.poll?.close(), () => this.releaseReceiver?.(), ...[...this.pending].map(ticket => () => this.discard(ticket))]); }
      catch (error) { this.closeFailure ??= error; }
    }
    if (this.closeFailure !== undefined) throw this.closeFailure;
    this.finishClose(); return this;
  }
  private finishClose(): void {
    if (!this.closing || this.closed || this.closeFailure !== undefined || this.pending.size || this.checking.size || this.streams.size) return;
    this.closed = true;
    queueMicrotask(() => { this.emit("close"); for (const callback of this.waiters.splice(0)) callback(); });
  }
}

/** Only kernel-mechanism operations cross this port. A pin is claimed once;
 * its common request/connection reference owner then decides when to close it.
 */
export function createMachBrokerTransport(handshakeSeconds: number) {
  duration(handshakeSeconds);
  const peers = new WeakMap<Duplex, { readonly pin: MachPeerPin; taken: boolean; authorize: ((sender: unknown) => boolean) | null }>();
  interface Endpoint {
    readonly receiver: MachReceiveRight;
    state: "reserved" | "listening" | "closed";
    failure?: unknown;
  }
  const endpoints = new Map<string, Endpoint>();
  const release = (name: string, endpoint: Endpoint): void => {
    if (endpoint.failure !== undefined) throw endpoint.failure;
    if (endpoint.state === "closed") return;
    endpoint.state = "closed";
    try { endpoint.receiver.close(); }
    catch (error) { endpoint.failure = error; throw error; }
    if (endpoints.get(name) === endpoint) endpoints.delete(name);
  };
  const acquire = (name: string) => {
    let endpoint = endpoints.get(name);
    if (endpoint !== undefined && endpoint.state !== "reserved") throw unavailable("Mach endpoint already has an owner");
    if (endpoint === undefined) {
      endpoint = { receiver: listenMachService(name), state: "listening" };
      endpoints.set(name, endpoint);
    } else endpoint.state = "listening";
    const selected = endpoint;
    return { receiver: selected.receiver, close: () => release(name, selected) };
  };
  return {
    /** Reserve the exact future listener before starting its trusted Runner.
     * This transfers only an endpoint capability; Broker still admits the
     * current Actor/Run when it adopts the listener. */
    reservePeer(path: string): { readonly peer: DarwinJobPeer; close(): void } {
      const name = machRendezvousName(path);
      if (endpoints.has(name)) throw unavailable("Mach endpoint already has an owner");
      const endpoint: Endpoint = { receiver: listenMachService(name), state: "reserved" };
      endpoints.set(name, endpoint);
      let peer: DarwinJobPeer;
      try { peer = peerFromMachReceiver(endpoint.receiver); }
      catch (error) { return withCleanup(() => { throw error; }, () => release(name, endpoint)); }
      let closed = false, failure: unknown;
      return Object.freeze({ peer, close(): void {
        if (failure !== undefined) throw failure;
        if (closed) return; closed = true;
        try { cleanupAll([() => peer.close(), () => { if (endpoint.state === "reserved") release(name, endpoint); }]); }
        catch (error) { failure = error; throw error; }
      } });
    },
    pinPeer(stream: Duplex): MachPeerPin | null {
      const peer = peers.get(stream);
      if (peer === undefined || peer.taken) return null;
      peer.taken = true; return peer.pin;
    },
    assertEndpoint(path: string): void { machRendezvousName(path); },
    prepareEndpoint(path: string): void { machRendezvousName(path); }, // Bootstrap check-in owns name exclusivity; no pathname is unlinked.
    openListener(serve: (socket: Duplex) => void, maximum?: number) {
      if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 1)) throw new RangeError("invalid Mach listener connection bound");
      const listener = new MachListener(handshakeSeconds, maximum, (endpoints, pin) => {
        const peer = { pin, taken: false, authorize: null as ((sender: unknown) => boolean) | null };
        const stream = machStream(endpoints, sender => peer.authorize?.(sender) ?? false, () => { if (!peer.taken) pin.close(); });
        stream.on("error", () => {});
        peers.set(stream, peer); return stream;
      }, serve, acquire);
      return { listener, prepare(): void {} };
    },
    peerStream(stream: Duplex, authorize: (sender: unknown) => boolean): Duplex {
      const peer = peers.get(stream);
      if (!peer?.taken || peer.authorize !== null) throw new StoreError("AUTH_FAILED", "Mach stream has no unclaimed peer authorization boundary");
      peer.authorize = authorize; return stream;
    },
  };
}
