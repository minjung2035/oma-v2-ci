/** Shared bounded byte-stream ownership over a nonblocking packet driver.
 * RPC framing, deadlines and authority remain with their existing owners.
 * Every data packet and explicit EOF needs fresh sender authorization.
 */
import { Duplex } from "node:stream";
import { StoreError } from "@oma/domain/errors";
import { withAsyncCleanup } from "@oma/native/cleanup";

export type OutboundPacket = { readonly kind: "data"; readonly bytes: Uint8Array } | { readonly kind: "end" };
export type PacketObservation<Sender> = { readonly kind: "again" } |
  { readonly kind: "data"; readonly bytes: Uint8Array; readonly sender: Sender } |
  { readonly kind: "end"; readonly sender: Sender };
export interface PacketDriver<Sender> {
  readonly maximumPacketBytes: number;
  read(): PacketObservation<Sender>;
  send(packet: OutboundPacket): "sent" | "again";
  /** Notifications are asynchronous and stop after close. */
  watch(ready: () => void, failure: (error: Error) => void): {
    request(read: boolean, write: boolean): void; close(): void;
  };
  /** Resolves only after all pending native work and resources return. */
  close(): void | Promise<void>;
}
interface PendingWrite {
  readonly bytes: Buffer; readonly end: boolean; readonly callback: (error?: Error | null) => void;
  offset: number;
}
function errorOf(error: unknown): Error { return error instanceof Error ? error : new Error("packet transport failed", { cause: error }); }

export class PacketStream<Sender> extends Duplex {
  private watch: ReturnType<PacketDriver<Sender>["watch"]> | undefined;
  private reading = false;
  private flushing = false;
  private pending: PendingWrite | null = null;
  private returned = false;
  /** Stream close/error is distinct from a confirmed driver resource return. */
  get resourcesReturned(): boolean { return this.returned; }
  constructor(private readonly driver: PacketDriver<Sender>, private readonly authorize: (sender: Sender) => boolean) {
    super({ allowHalfOpen: true, readableHighWaterMark: 65536, writableHighWaterMark: 65536 });
  }
  override _construct(callback: (error?: Error | null) => void): void {
    // Node waits for construction before I/O/destruction. Setup failures use
    // the same asynchronous return owner as cancellation and normal EOF.
    if (this.destroyed) { callback(); return; }
    const { driver } = this;
    if (!Number.isSafeInteger(driver.maximumPacketBytes) || driver.maximumPacketBytes < 1 || driver.maximumPacketBytes > 65536) {
      callback(new TypeError("invalid packet transport window")); return;
    }
    try { this.watch = driver.watch(() => this.ready(), error => this.destroy(error)); }
    catch (error) { callback(errorOf(error)); return; }
    callback();
  }
  override _read(): void { this.reading = true; this.request(); }
  private request(): void {
    if (this.destroyed) return;
    try { this.watch?.request(this.reading, this.pending !== null); }
    catch (error) { this.destroy(errorOf(error)); }
  }
  private ready(): void {
    if (this.destroyed) return;
    try {
      this.flush();
      if (!this.reading || this.destroyed) return;
      const observed = this.driver.read();
      if (observed.kind === "again") return;
      if (!this.authorize(observed.sender)) throw new StoreError("AUTH_FAILED", "packet is not from the pinned connector");
      if (observed.kind === "end") { this.reading = false; this.request(); this.push(null); return; }
      if (!(observed.bytes instanceof Uint8Array) || observed.bytes.length < 1 || observed.bytes.length > this.driver.maximumPacketBytes)
        throw new StoreError("STREAM_INVALID", "invalid packet byte window");
      if (!this.push(observed.bytes)) { this.reading = false; this.request(); }
    } catch (error) { this.destroy(errorOf(error)); }
  }
  override _write(bytes: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (bytes.length === 0) { callback(); return; }
    this.pending = { bytes, end: false, offset: 0, callback };
    this.flush();
  }
  override _final(callback: (error?: Error | null) => void): void {
    this.pending = { bytes: Buffer.alloc(0), end: true, offset: 0, callback };
    this.flush();
  }
  private flush(): void {
    if (this.flushing || this.destroyed) return;
    this.flushing = true;
    try {
      // Scheduling fairness, never an input quota or dropped packet. A full
      // kernel queue retains this same write and callback for the next wake.
      for (let sent = 0; sent < 16 && this.pending !== null && !this.destroyed; sent++) {
        const pending = this.pending;
        const end = Math.min(pending.bytes.length, pending.offset + this.driver.maximumPacketBytes);
        const packet: OutboundPacket = pending.end ? { kind: "end" } : { kind: "data", bytes: pending.bytes.subarray(pending.offset, end) };
        const result = this.driver.send(packet);
        if (result === "again") break;
        if (result !== "sent") throw new Error("packet enqueue was not observed successful");
        pending.offset = end;
        if (pending.end || end === pending.bytes.length) {
          this.pending = null;
          pending.callback();
        }
      }
    } catch (error) { this.destroy(errorOf(error)); }
    finally { this.flushing = false; this.request(); }
  }
  override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.reading = false;
    const pending = this.pending; this.pending = null;
    const complete = (failure: Error | null): void => {
      if (pending !== null) {
        try { pending.callback(failure ?? new StoreError("BROKER_UNAVAILABLE", "packet transport closed before write completion")); }
        catch (cleanup) { failure = failure === null ? errorOf(cleanup) : new AggregateError([failure, cleanup], "packet callback cleanup failed"); }
      }
      callback(failure);
    };
    void withAsyncCleanup(async () => { this.watch?.close(); }, () => this.driver.close()).then(() => {
      this.returned = true; complete(error);
    }, cleanup => complete(error === null ? errorOf(cleanup) : new AggregateError([error, cleanup], "packet transport and cleanup failed")));
  }
}
