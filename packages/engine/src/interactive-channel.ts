/** Bounded, process-private UI control. This socket carries no authority. */
import type { Socket } from "node:net";
import { JsonlReader, type PiEvent } from "@oma/protocol/jsonl";
import { alarm, type Timer, type PiRpcLimits } from "./pi-rpc.js";

export const INTERACTIVE_RPC_FD = 5;
export const INTERACTIVE_UI_FD = 6;

export class InteractiveChannel {
  private readonly reader: JsonlReader;
  private partial: Timer | null = null;
  private writing: Timer | null = null;
  private closed = false;
  constructor(private readonly socket: Socket, private readonly limits: PiRpcLimits,
    private readonly accept: (event: PiEvent) => void, private readonly ended: (error?: unknown) => void) {
    this.reader = new JsonlReader(limits.frameBytes);
    try {
      socket.on("data", this.read);
      socket.on("error", this.close);
      socket.on("end", this.onEnd);
      socket.on("close", this.onClose);
      socket.on("drain", this.onDrain);
    } catch (error) {
      try { this.release(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "UI channel setup and cleanup failed"); }
      throw error;
    }
  }
  send(event: PiEvent): void {
    this.write(event);
  }
  /** Local write completion only; not a peer receipt or processing acknowledgement. */
  sendAndWait(event: PiEvent): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    try {
      this.write(event, error => {
        if (this.socket.writableLength === 0) this.onDrain();
        if (error === undefined || error === null) resolve();
        else reject(error);
      });
    } catch (error) { reject(error); }
    return promise;
  }
  private write(event: PiEvent, flushed?: (error?: Error | null) => void): void {
    if (this.closed) { flushed?.(new Error("interactive channel closed")); return; }
    try {
      const line = JSON.stringify(event) + "\n";
      const bytes = Buffer.byteLength(line);
      if (bytes > this.limits.frameBytes + 1 || this.socket.writableLength + bytes > 4 * (this.limits.frameBytes + 1))
        throw new Error("interactive control buffer limit exceeded");
      if ((!this.socket.write(line, flushed) || (flushed !== undefined && this.socket.writableLength > 0)) && this.writing === null)
        this.writing = alarm(this.limits.receiptWaitSeconds, () => this.close(new Error("interactive write deadline exceeded")));
    } catch (error) {
      this.close(error);
      flushed?.(error instanceof Error ? error : new Error(String(error), { cause: error }));
    }
  }
  private readonly read = (data: Buffer): void => {
    try {
      const before = this.reader.endedLines;
      this.reader.feed(data, event => { if (!this.closed) this.accept(event); });
      if (this.closed) return;
      if (this.reader.endedLines !== before || !this.reader.midLine) { this.partial?.cancel(); this.partial = null; }
      if (this.reader.midLine && this.partial === null)
        this.partial = alarm(this.limits.idleStreamSeconds, () => this.close(new Error("interactive frame deadline exceeded")));
    } catch (error) { this.close(error); }
  };
  private readonly onEnd = (): void => {
    try { this.reader.finish(); this.close(); } catch (error) { this.close(error); }
  };
  private readonly onClose = (): void => this.close();
  private readonly onDrain = (): void => { this.writing?.cancel(); this.writing = null; };
  private release(): void {
    this.closed = true;
    this.partial?.cancel(); this.writing?.cancel(); this.reader.close();
    this.socket.off("data", this.read);
    this.socket.off("error", this.close);
    this.socket.off("end", this.onEnd);
    this.socket.off("close", this.onClose);
    this.socket.off("drain", this.onDrain);
    this.socket.on("error", () => {});
    this.socket.destroy();
  }
  close = (error?: unknown): void => {
    if (this.closed) return;
    this.release();
    this.ended(error);
  };
}
