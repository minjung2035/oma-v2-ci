/** IPC-001/008: role-neutral transport only. It never retries, synthesizes
 * REQUEST_NOT_FOUND, owns a Store, grants a lease, or exits the caller process.
 */
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import type { ProtocolLimits } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { isValidRequestKey } from "@oma/domain/identifiers";
import { snapshotJson } from "@oma/domain/canonical-json";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { PUBLIC_METHODS, isPublicMethod } from "@oma/protocol/methods";
import { decodeRpcReply, isRpcMethod, type RpcMethod, type RpcReply } from "@oma/protocol/response-codec";
import { alarm, type Timer } from "@oma/protocol/alarm";
export type { RpcMethod, RpcReply } from "@oma/protocol/response-codec";
export type ChannelLimits = Pick<ProtocolLimits, "frameBytes" | "idleStreamSeconds" | "receiptWaitSeconds">;
export const DEFAULT_CHANNEL_LIMITS: Readonly<ChannelLimits> = Object.freeze({ frameBytes: 256 * 1024, idleStreamSeconds: 30, receiptWaitSeconds: 30 });
export interface ChannelCallOptions { readonly request?: string; readonly streamBytes?: Uint8Array }
export interface DialedChannel { readonly socket: Duplex; readonly ready: Promise<void> }
export type ChannelDialer = (path: string) => DialedChannel;
/** Node's Unix connector supplies readiness; channel generations own its
 * cancellation, framing and deadlines just as for an injected OS connector. */
export function dialUnixChannel(path: string): DialedChannel {
  const socket = connect(path);
  const ready = new Promise<void>((resolve, reject) => {
    const clear = (): void => { socket.off("connect", connected); socket.off("error", failed); socket.off("close", closed); };
    const connected = (): void => { clear(); resolve(); };
    const failed = (error: Error): void => { clear(); reject(error); };
    const closed = (): void => { clear(); reject(new StoreError("BROKER_UNAVAILABLE", "channel closed while connecting")); };
    socket.once("connect", connected); socket.once("error", failed); socket.once("close", closed);
  });
  return { socket, ready };
}
interface Pending {
  readonly id: string; readonly method: RpcMethod; readonly params: Readonly<Record<string, unknown>>;
  readonly frame: Buffer; readonly body: Uint8Array | undefined; readonly timer: Timer;
  readonly resolve: (reply: RpcReply) => void; readonly reject: (error: unknown) => void;
  metadataSent: boolean; offset: number; waitingDrain: boolean; writeDone: boolean; flushing: boolean;
}
interface Generation {
  readonly socket: Duplex; readonly parser: FrameParser;
  readonly inherited: boolean;
  readonly connected: () => void; readonly connectFailed: (error: unknown) => void;
  state: "connecting" | "ready" | "closed";
  pending: Pending | null; idle: Timer | null; inboundBytes: number;
  removeListeners: () => void;
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
const unavailable = (message: string): StoreError => new StoreError("BROKER_UNAVAILABLE", message);

export class BrokerChannel {
  private generation: Generation | null = null;
  private readonly limits: Readonly<ChannelLimits>;
  constructor(limits: ChannelLimits = DEFAULT_CHANNEL_LIMITS, private readonly dial: ChannelDialer = dialUnixChannel) {
    for (const value of [limits.frameBytes, limits.idleStreamSeconds, limits.receiptWaitSeconds])
      if (!Number.isSafeInteger(value) || value <= 0) throw new StoreError("UNSUPPORTED_PROFILE", "channel limits must be positive safe integers");
    this.limits = Object.freeze({ ...limits, frameBytes: Math.min(limits.frameBytes, 0xffffffff) });
  }
  connect(path: string): Promise<void> {
    this.close();
    let endpoint: DialedChannel;
    try { endpoint = this.dial(path); } catch (error) { return Promise.reject(error); }
    return this.adopt(endpoint.socket, false, endpoint.ready);
  }
  /** One directly inherited endpoint, with no pathname reconnect. Its process
   * owner bounds idle lifetime; frame and in-flight receipt limits still apply. */
  attach(socket: Duplex): Promise<void> { this.close(); return this.adopt(socket, true); }
  get connected(): boolean { return this.generation?.state === "ready" && !this.generation.socket.destroyed; }
  private adopt(socket: Duplex, inherited: boolean, ready?: Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const generation: Generation = { socket, inherited, parser: new FrameParser(this.limits.frameBytes), state: "connecting", pending: null,
        connected: resolve, connectFailed: reject, idle: null, inboundBytes: 0, removeListeners: () => {} };
      this.generation = generation;
      const onConnect = (): void => {
        if (!this.current(generation) || generation.state !== "connecting") return;
        generation.state = "ready"; this.touch(generation); generation.connected();
      };
      const onData = (chunk: Buffer | string): void => {
        if (!this.current(generation)) return;
        if (!Buffer.isBuffer(chunk)) { this.fail(generation, unavailable("broker channel must stay in byte mode")); return; }
        this.receive(generation, chunk);
      };
      const onDrain = (): void => {
        if (!this.current(generation)) return;
        this.touch(generation);
        if (generation.pending) { generation.pending.waitingDrain = false; this.flush(generation, generation.pending); }
      };
      const onError = (error: Error): void => this.fail(generation, error);
      const onEnd = (): void => {
        if (!this.current(generation)) return;
        try { generation.parser.finish(); } catch (error) { this.fail(generation, error); return; }
        this.fail(generation, unavailable("broker EOF before another complete response"));
      };
      const onClose = (): void => this.fail(generation, unavailable("broker channel closed"));
      generation.removeListeners = () => {
        socket.off("data", onData); socket.off("drain", onDrain);
        socket.off("end", onEnd); socket.off("error", onError); socket.off("close", onClose);
        // destroy/error delivery may be asynchronous; a late error cannot crash
        // the process or re-enter a newer generation's pending request.
        socket.on("error", () => {});
      };
      socket.on("data", onData); socket.on("drain", onDrain);
      socket.on("end", onEnd); socket.on("error", onError); socket.on("close", onClose);
      this.touch(generation);
      if (inherited) onConnect();
      else void ready!.then(onConnect, error => this.fail(generation, error));
    });
  }
  private current(generation: Generation): boolean { return this.generation === generation && generation.state !== "closed"; }
  private touch(generation: Generation): void {
    generation.idle?.cancel();
    generation.idle = generation.inherited ? null : alarm(this.limits.idleStreamSeconds, () => this.fail(generation, unavailable("broker channel timed out")));
  }
  call<M extends RpcMethod>(method: M, params: Record<string, unknown>, options: ChannelCallOptions = {}): Promise<RpcReply<M>> {
    const generation = this.generation;
    if (!generation || generation.state !== "ready" || generation.socket.destroyed)
      return Promise.reject(unavailable("broker channel is not connected"));
    // One control request is the already-reviewed connection budget. No hidden
    // parsed queue, unlimited pending map or new host configuration field.
    if (generation.pending) return Promise.reject(new StoreError("LIMIT_EXCEEDED", "one request may be in flight on this channel"));
    return new Promise((resolve, reject) => {
      if (!isRpcMethod(method)) throw new StoreError("UNKNOWN_METHOD", "unsupported channel method");
      const copied = snapshotJson(params);
      if (!record(copied)) throw new StoreError("INVALID_REQUEST", "request params must be an object");
      const mutation = isPublicMethod(method) && PUBLIC_METHODS[method].mode === "mutation";
      if (mutation ? !isValidRequestKey(options.request) : options.request !== undefined)
        throw new StoreError("INVALID_REQUEST", "request key does not match method policy");
      const descriptor = method === "git.submit" ? copied.bundle : method === "context.publish" ? copied.content : undefined;
      const body = options.streamBytes;
      if (body !== undefined && !(body instanceof Uint8Array)) throw new StoreError("STREAM_INVALID", "raw body must be bytes");
      if (descriptor !== undefined) {
        if (!record(descriptor) || !Number.isSafeInteger(descriptor.bytes) || typeof descriptor.bytes !== "number" || descriptor.bytes < 0 ||
            descriptor.bytes !== (body?.byteLength ?? 0)) throw new StoreError("STREAM_INVALID", "raw body length differs from request descriptor");
      } else if (body !== undefined || method === "context.publish") throw new StoreError("STREAM_INVALID", "raw body has no allowed descriptor");
      const id = `rpc-${randomUUID()}`;
      const frame = encodeFrame({ v: 1, id, method, params: copied, ...(options.request === undefined ? {} : { request: options.request }) });
      if (frame.length - 4 > this.limits.frameBytes) throw new StoreError("FRAME_TOO_LARGE", "broker request exceeds frame limit");
      const timer = alarm(this.limits.receiptWaitSeconds, () => this.fail(generation, unavailable("broker receipt timed out")));
      const pending: Pending = { id, method, params: copied, frame, body, timer,
        resolve: reply => resolve(reply as RpcReply<M>), reject,
        metadataSent: false, offset: 0, waitingDrain: false, writeDone: false, flushing: false };
      generation.pending = pending; generation.inboundBytes = 0;
      this.flush(generation, pending);
    });
  }
  private flush(generation: Generation, pending: Pending): void {
    if (!this.current(generation) || generation.pending !== pending || pending.waitingDrain || pending.flushing) return;
    pending.flushing = true;
    try {
      while (this.current(generation) && generation.pending === pending && !pending.waitingDrain) {
        let bytes: Uint8Array;
        if (!pending.metadataSent) { bytes = pending.frame; pending.metadataSent = true; }
        else if (pending.body && pending.offset < pending.body.byteLength) {
          const end = Math.min(pending.body.byteLength, pending.offset + 64 * 1024);
          bytes = pending.body.subarray(pending.offset, end); pending.offset = end;
        } else { pending.writeDone = true; return; }
        this.touch(generation);
        if (!generation.socket.write(bytes)) pending.waitingDrain = true;
      }
    } catch (error) { this.fail(generation, error); }
    finally { pending.flushing = false; }
  }
  private receive(generation: Generation, chunk: Buffer): void {
    if (!this.current(generation)) return;
    try {
      this.touch(generation);
      const pending = generation.pending;
      if (!pending) throw unavailable("unsolicited or duplicate broker response");
      if (chunk.length > this.limits.frameBytes + 4 - generation.inboundBytes)
        throw new StoreError("FRAME_TOO_LARGE", "broker response bytes exceed the frame budget");
      generation.inboundBytes += chunk.length;
      const frames = generation.parser.feed(chunk);
      if (frames.length === 0) return;
      if (frames.length !== 1) throw unavailable("duplicate or unsolicited combined broker responses");
      const reply = decodeRpcReply(pending.method, frames[0]!.raw, pending.id, pending.params);
      // finish detects any trailing partial frame in this same read, rather
      // than silently carrying its prefix into the next response generation.
      generation.parser.finish();
      if (reply.ok && !pending.writeDone &&
          (!pending.metadataSent || (pending.body !== undefined && pending.offset < pending.body.byteLength)))
        throw unavailable("success arrived before the declared raw upload was sent");
      generation.pending = null; pending.timer.cancel();
      pending.resolve(reply);
      if (!reply.ok && !pending.writeDone) this.fail(generation, unavailable("broker rejected an unfinished raw upload"));
    } catch (error) { this.fail(generation, error); }
  }
  close(error: unknown = unavailable("broker channel closed")): void {
    const generation = this.generation;
    if (generation) this.fail(generation, error);
  }
  private fail(generation: Generation, error: unknown): void {
    if (generation.state === "closed") return;
    generation.state = "closed";
    if (this.generation === generation) this.generation = null;
    generation.idle?.cancel(); generation.idle = null;
    const pending = generation.pending; generation.pending = null;
    if (pending) { pending.timer.cancel(); pending.reject(error); }
    generation.connectFailed(error);
    generation.removeListeners();
    generation.socket.destroy();
  }
}
