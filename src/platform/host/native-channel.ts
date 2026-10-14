/** JSONL framing and request correlation for the signed native helper.
 * Channel loss ends requests; only the child owner can prove helper/VM death. */
import type { Socket } from "node:net";
import { StoreError } from "../../domain/errors.js";

// The existing helper wire limit, per UTF-8 line, not per socket read.
const LINE_BYTES = 1024 * 1024;
type Pending = { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: NodeJS.Timeout };
interface NativeChannelOptions {
  readonly endedMessage: string;
  readonly helper: "VM" | "Keychain";
  readonly refusal: (message: Record<string, unknown>) => Error;
  readonly event?: (message: Record<string, unknown>) => boolean;
  readonly strictResponses: boolean;
  readonly timeoutEndsChannel: boolean;
}

export class NativeChannel {
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private buffered = "";
  private bytes = 0;
  private ended = false;

  constructor(private readonly socket: Socket, private readonly options: NativeChannelOptions) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => { this.received(chunk); });
    socket.on("error", () => { this.close(); });
    socket.once("end", () => { this.close(); });
    socket.once("close", () => { this.close(); });
  }

  close(): void {
    this.ended = true;
    this.buffered = ""; this.bytes = 0;
    this.socket.destroy();
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new StoreError("BROKER_UNAVAILABLE", this.options.endedMessage));
    }
    this.pending.clear();
  }

  private received(chunk: string): void {
    for (let from = 0; from < chunk.length && !this.ended;) {
      const at = chunk.indexOf("\n", from);
      const piece = chunk.slice(from, at < 0 ? chunk.length : at);
      this.bytes += Buffer.byteLength(piece);
      if (this.bytes > LINE_BYTES) { this.close(); return; }
      this.buffered += piece;
      if (at < 0) return;
      const line = this.buffered;
      // Consume before dispatch, including unknown IDs and events.
      this.buffered = ""; this.bytes = 0; from = at + 1;
      let value: unknown;
      try { value = JSON.parse(line); }
      catch { this.close(); return; }
      if (value === null || typeof value !== "object" || Array.isArray(value)) { this.close(); return; }
      const message = value as Record<string, unknown>;
      if (message.event !== undefined) {
        if (this.options.event?.(message) !== true) this.close();
        continue;
      }
      if (!Number.isSafeInteger(message.id) || (message.id as number) <= 0 || typeof message.ok !== "boolean") {
        this.close(); return;
      }
      const item = this.pending.get(message.id as number);
      if (item === undefined) {
        if (this.options.strictResponses) this.close();
        continue;
      }
      this.pending.delete(message.id as number); clearTimeout(item.timer);
      if (message.ok) item.resolve(message);
      else item.reject(this.options.refusal(message));
    }
  }

  request(op: string, fields: Record<string, unknown>, deadlineMs: number): Promise<Record<string, unknown>> {
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > 0x7fffffff)
      return Promise.reject(new StoreError("INVALID_REQUEST", "invalid native helper request deadline"));
    if (this.ended || this.socket.destroyed)
      return Promise.reject(new StoreError("BROKER_UNAVAILABLE", this.options.endedMessage));
    const id = ++this.sequence;
    const line = JSON.stringify({ ...fields, op, id });
    if (Buffer.byteLength(line) > LINE_BYTES)
      return Promise.reject(new StoreError("INVALID_REQUEST", "the request exceeds the native helper channel limit"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (this.options.timeoutEndsChannel) this.close();
        reject(new StoreError("BROKER_UNAVAILABLE", `the ${this.options.helper} helper did not answer ${op} in time`));
      }, deadlineMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.write(`${line}\n`, error => { if (error) this.close(); }); }
      catch { this.close(); }
    });
  }
}
