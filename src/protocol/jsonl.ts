import { StoreError } from "../domain/errors.js";

export interface PiEvent { type: string; id?: string; [key: string]: unknown }
/** No event queue: each bounded line is handed synchronously to its owner.
 * LF is the only delimiter. CR inside a JSON string is never a delimiter.
 * EOF does not implicitly terminate a final partial line.
 */
export class JsonlReader {
  private pieces: Buffer[] = [];
  private length = 0;
  private state: "open" | "closed" | "poisoned" = "open";
  private feeding = false;
  private readonly utf8 = new TextDecoder("utf-8", { fatal: true });
  constructor(readonly lineBytes: number) {
    if (!Number.isSafeInteger(lineBytes) || lineBytes < 1)
      throw new StoreError("UNSUPPORTED_PROFILE", "JSONL line limit must be a positive safe integer");
  }
  get pendingBytes(): number { return this.length; }
  /** How many lines this reader has ended, so an owner can tell the partial
   * line it holds now from the one it held before a chunk (P0V-48). */
  get endedLines(): number { return this.ended; }
  private ended = 0;
  feed(chunk: Uint8Array, accept: (event: PiEvent) => void): void {
    if (this.state !== "open" || this.feeding)
      throw new StoreError("INVALID_REQUEST", "JSONL reader is closed, poisoned or re-entered");
    this.feeding = true;
    try {
      let start = 0;
      for (let index = 0; index < chunk.byteLength; index++) {
        if (chunk[index] !== 0x0a) continue;
        this.append(chunk.subarray(start, index));
        const bytes = Buffer.concat(this.pieces, this.length);
        this.pieces = []; this.length = 0; start = index + 1; this.ended += 1;
        let event: unknown;
        try {
          const line = this.utf8.decode(bytes);
          if (line.trim().length === 0) continue;
          event = JSON.parse(line);
        } catch { throw new StoreError("INVALID_REQUEST", "Pi RPC returned malformed UTF-8 or JSON"); }
        if (event === null || typeof event !== "object" || Array.isArray(event) ||
          !("type" in event) || typeof event.type !== "string" || event.type.length === 0 ||
          ("id" in event && typeof event.id !== "string"))
          throw new StoreError("INVALID_REQUEST", "Pi RPC event must have a string type and optional string id");
        // Keep observer exceptions outside the parser's JSON error conversion.
        accept(Object.freeze(event) as PiEvent);
        if (this.state !== "open") return;
      }
      this.append(chunk.subarray(start));
    } catch (error) {
      this.state = "poisoned"; this.pieces = []; this.length = 0; throw error;
    } finally { this.feeding = false; }
  }
  private append(bytes: Uint8Array): void {
    if (bytes.byteLength > this.lineBytes - this.length)
      throw new StoreError("FRAME_TOO_LARGE", "Pi RPC JSONL line exceeds the configured frame bound");
    if (bytes.byteLength > 0) { this.pieces.push(Buffer.from(bytes)); this.length += bytes.byteLength; }
  }
  finish(): void {
    if (this.state !== "open") throw new StoreError("INVALID_REQUEST", "JSONL reader is no longer open");
    if (this.length !== 0) {
      this.state = "poisoned"; this.pieces = []; this.length = 0;
      throw new StoreError("INVALID_REQUEST", "Pi RPC EOF has an unterminated JSONL line");
    }
    this.close();
  }
  close(): void { if (this.state === "open") this.state = "closed"; this.pieces = []; this.length = 0; }
}
