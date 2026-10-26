/** Bounded Keychain helper framing. Channel failure rejects requests; only the
 * child owner can observe actual helper close. No VM operations or events. */
import type { Socket } from "node:net";
import { StoreError } from "@oma/domain/errors";
import { parseJsonObject } from "@oma/protocol/frame";

const LINE_BYTES = 1024 * 1024;
type KeychainOperation = "keychain.get" | "keychain.put";
type Pending = { op: KeychainOperation; resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: NodeJS.Timeout };
interface NativeChannelOptions {
  readonly endedMessage: string;
  readonly refusal: (message: Record<string, unknown>) => Error;
}
export class NativeChannel {
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private pieces: Buffer[] = [];
  private bytes = 0;
  private ended = false;
  constructor(private readonly socket: Socket, private readonly options: NativeChannelOptions) {
    socket.on("data", (chunk: Buffer) => { this.received(chunk); });
    socket.on("error", () => { this.close(); });
    socket.once("end", () => { this.close(); });
    socket.once("close", () => { this.close(); });
  }
  close(): void {
    this.ended = true; this.pieces = []; this.bytes = 0;
    this.socket.destroy();
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new StoreError("BROKER_UNAVAILABLE", this.options.endedMessage));
    }
    this.pending.clear();
  }
  private received(chunk: Buffer): void {
    for (let from = 0; from < chunk.length && !this.ended;) {
      const at = chunk.indexOf(0x0a, from);
      const piece = chunk.subarray(from, at < 0 ? chunk.length : at);
      if (piece.length > LINE_BYTES - this.bytes) { this.close(); return; }
      if (piece.length) { this.pieces.push(Buffer.from(piece)); this.bytes += piece.length; }
      if (at < 0) return;
      const line = Buffer.concat(this.pieces, this.bytes);
      this.pieces = []; this.bytes = 0; from = at + 1;
      let message: Record<string, unknown>;
      try { message = parseJsonObject(line).raw; }
      catch { this.close(); return; }
      if (!Number.isSafeInteger(message.id) || (message.id as number) <= 0 || typeof message.ok !== "boolean") {
        this.close(); return;
      }
      const item = this.pending.get(message.id as number);
      const allowed = message.ok ? ["id", "ok", "value"] : ["id", "ok", "error"];
      if (!item || Object.keys(message).some(key => !allowed.includes(key)) ||
          (message.ok ? message.value !== undefined && (typeof message.value !== "string" || item.op !== "keychain.get") : typeof message.error !== "string")) {
        this.close(); return;
      }
      this.pending.delete(message.id as number); clearTimeout(item.timer);
      if (message.ok) item.resolve(message);
      else item.reject(this.options.refusal(message));
    }
  }
  request(op: KeychainOperation, fields: Record<string, unknown>, deadlineMs: number): Promise<Record<string, unknown>> {
    if (op !== "keychain.get" && op !== "keychain.put")
      return Promise.reject(new StoreError("INVALID_REQUEST", "unsupported Keychain operation"));
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
        this.pending.delete(id); this.close();
        reject(new StoreError("BROKER_UNAVAILABLE", `the Keychain helper did not answer ${op} in time`));
      }, deadlineMs);
      timer.unref();
      this.pending.set(id, { op, resolve, reject, timer });
      try { this.socket.write(`${line}\n`, error => { if (error) this.close(); }); }
      catch { this.close(); }
    });
  }
}
