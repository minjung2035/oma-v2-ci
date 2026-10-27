/** One bounded readable buffer and the existing Writable backpressure. The
 * platform supplies kernel observations, never framing or authority policy. */
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import { StoreError } from "@oma/domain/errors";
export type InboundObservation<Sender> = { readonly kind: "again" } | { readonly kind: "end" } |
  { readonly kind: "data"; readonly bytes: Uint8Array; readonly sender: Sender | null; readonly ancillary: boolean };
export interface ObservedStreamReader<Sender> {
  read(): InboundObservation<Sender>;
  watch(ready: () => void, failure: (error: Error) => void): { request(enabled: boolean): void; close(): void };
}
export class ObservedStream<Sender> extends Duplex {
  private readonly watch;
  private reading = false;
  constructor(private readonly owner: Socket, private readonly reader: ObservedStreamReader<Sender>,
    private readonly authorize: (sender: Sender | null) => boolean) {
    super({ allowHalfOpen: true, readableHighWaterMark: 65536, writableHighWaterMark: owner.writableHighWaterMark });
    owner.pause();
    this.watch = reader.watch(() => this.receive(), error => this.destroy(error));
    owner.once("error", error => this.destroy(error));
    owner.once("close", () => { this.watch.close(); if (!this.destroyed) this.destroy(); });
  }
  override _read(): void { this.reading = true; this.watch.request(true); }
  private receive(): void {
    if (!this.reading || this.destroyed) return;
    try {
      const observed = this.reader.read();
      if (observed.kind === "again") return;
      if (observed.kind === "end") { this.reading = false; this.watch.request(false); this.push(null); return; }
      if (observed.ancillary || !this.authorize(observed.sender))
        throw new StoreError("AUTH_FAILED", "stream bytes are not from the pinned connector");
      if (!this.push(observed.bytes)) { this.reading = false; this.watch.request(false); }
    } catch (error) { this.destroy(error instanceof Error ? error : new Error("kernel stream observation failed", { cause: error })); }
  }
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.owner.write(chunk, callback);
  }
  override _final(callback: (error?: Error | null) => void): void { this.owner.end(callback); }
  override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.watch.close(); this.owner.destroy(); callback(error);
  }
}
