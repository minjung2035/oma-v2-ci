/** Darwin rendezvous and endpoint mechanics. Shared Broker/Client owners keep
 * RPC framing, roles, scope, current grants, retries and accepted outcomes.
 * Dynamic bootstrap check-in and this adapter remain Darwin NOT_RUN; product
 * qualification guards are not relaxed by compiling or wiring this module.
 */
import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";
import { StoreError } from "@oma/domain/errors";
import { deadline } from "@oma/process/deadline";
import type { PacketStream } from "@oma/process/packet-stream";
import {
  createMachEndpoint, listenMachService, lookupMachService,
  type MachMessage, type MachReceiveRight, type MachSendRight, type MachAuditSender,
} from "@oma/native/mach-message";
import { cleanupAll, withAsyncCleanup, withCleanup } from "@oma/native/cleanup";
import { bindMachSender, type MachPeerPin, type MachPeerBinding } from "./audit-peer.js";
import { machStream } from "./mach-stream.js";
import { machPoll } from "./mach-poll.js";
import { machRendezvousName } from "./mach-address.js";

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
  const name = machRendezvousName(path), ms = duration(handshakeSeconds), nonce = randomBytes(16);
  const expires = performance.now() + ms;
  const service = lookupMachService(name);
  let local: ReturnType<typeof createMachEndpoint>;
  try { local = createMachEndpoint(); }
  catch (error) { return withCleanup(() => { throw error; }, () => service.close()); }
  let remote: MachSendRight | null = null, pin: MachPeerPin | null = null, opened = false, sent = false;
  let binding: MachPeerBinding | undefined;
  let poll: ReturnType<typeof machPoll> | undefined, cancel = (): void => {};
  let resolve!: () => void, reject!: (error: unknown) => void;
  const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void ready.catch(() => {}); // Constructor failure can precede a returned endpoint owner.
  const socket = machStream({
    receive: local.receive,
    send: {
      send: (id, bytes, reply) => remote === null ? "again" : remote.send(id, bytes, reply),
      destination: () => remote?.destination() ?? "unknown",
      close: () => remote?.close(),
    },
  }, sender => pin !== null && pin.sameSender(sender) && pin.alive(), async () => {
    reject(unavailable("Mach connection ended before readiness"));
    await withAsyncCleanup(async () => {
      cleanupAll([cancel, () => poll?.close(), () => service.close(), () => local.send.close(), () => pin?.close()]);
    }, () => binding?.close());
  }, () => opened);
  const fail = (error: unknown): void => {
    const failure = error instanceof Error ? error : new Error("Mach connection failed", { cause: error });
    reject(failure); socket.destroy(failure);
  };
  // Retains terminal error ownership even if a caller destroys the pending
  // connector before installing its channel-generation listeners.
  socket.on("error", reject);
  const receive = (): void => {
    if (socket.destroyed || opened || binding !== undefined) return;
    if (performance.now() >= expires) { fail(unavailable("Mach rendezvous deadline exceeded")); return; }
    if (!sent) {
      if (service.send(OPEN, nonce, local.send) === "again") return;
      sent = true;
    }
    const message = local.receive.receive();
    if (message.kind === "again") return;
    let transferred = false;
    withCleanup(() => {
      if (message.id !== OPENED || message.reply === null || !message.bytes.equals(nonce))
        throw new StoreError("AUTH_FAILED", "invalid Mach rendezvous reply");
      remote = message.reply; transferred = true;
      binding = bindMachSender(message.sender);
      const acquisition = binding;
      poll?.request(false);
      void acquisition.ready.then(() => {
        if (socket.destroyed) return;
        if (performance.now() >= expires) throw unavailable("Mach rendezvous deadline exceeded");
        pin = acquisition.take();
        cleanupAll([() => service.close(), () => local.send.close(), cancel, () => poll?.close()]);
        opened = true; resolve();
      }).catch(fail);
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
    private readonly serve: (socket: Duplex) => void) { super(); duration(seconds); }
  listen(path: string): this {
    if (this.started || this.closing) throw unavailable("Mach listener cannot bind twice");
    this.started = true;
    try {
      this.receiver = listenMachService(machRendezvousName(path));
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
      if (message.id !== OPEN || message.bytes.length !== 16 || message.reply === null ||
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
      try { cleanupAll([() => this.poll?.close(), () => this.receiver?.close(), ...[...this.pending].map(ticket => () => this.discard(ticket))]); }
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
  return {
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
      }, serve);
      return { listener, prepare(): void {} };
    },
    peerStream(stream: Duplex, authorize: (sender: unknown) => boolean): Duplex {
      const peer = peers.get(stream);
      if (!peer?.taken || peer.authorize !== null) throw new StoreError("AUTH_FAILED", "Mach stream has no unclaimed peer authorization boundary");
      peer.authorize = authorize; return stream;
    },
  };
}
