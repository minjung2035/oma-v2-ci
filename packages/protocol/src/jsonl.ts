import { StoreError } from "@oma/domain/errors";
import { decodeUtf8 } from "@oma/domain/utf8";

export interface PiEvent { type: string; id?: string; [key: string]: unknown }
/** No event queue: each bounded line is handed synchronously to its owner.
 * LF is the only delimiter. CR inside a JSON string is never a delimiter.
 * EOF does not implicitly terminate a final partial line.
 *
 * DR15, P0-5: a line longer than the bound is not a broken stream. JSON
 * escapes every LF inside a string, so the next LF ends that line exactly: the
 * reader keeps none of its bytes, reports its size to `skipped`, and goes on
 * with the next line. Memory stays within the bound. A line that is not the
 * protocol -- not UTF-8, not JSON, not an event -- still poisons the reader,
 * because nothing after it can be trusted to be framed. */
export class JsonlReader {
  private pieces: Buffer[] = [];
  private length = 0;
  /** Bytes of the line being skipped so far, or null when none is. */
  private skipping: number | null = null;
  private state: "open" | "closed" | "poisoned" = "open";
  private feeding = false;
  constructor(readonly lineBytes: number, private readonly skipped?: (bytes: number) => void) {
    if (!Number.isSafeInteger(lineBytes) || lineBytes < 1)
      throw new StoreError("UNSUPPORTED_PROFILE", "JSONL line limit must be a positive safe integer");
  }
  get pendingBytes(): number { return this.length; }
  /** A line has begun and not ended (held or being skipped). */
  get midLine(): boolean { return this.length > 0 || this.skipping !== null; }
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
        start = index + 1; this.ended += 1;
        if (this.skipping !== null) {
          const bytes = this.skipping; this.skipping = null;
          this.skipped?.(bytes);
          if (this.state !== "open") return;
          continue;
        }
        const bytes = Buffer.concat(this.pieces, this.length);
        this.pieces = []; this.length = 0;
        let event: unknown;
        try {
          const line = decodeUtf8(bytes);
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
      this.state = "poisoned"; this.pieces = []; this.length = 0; this.skipping = null; throw error;
    } finally { this.feeding = false; }
  }
  private append(bytes: Uint8Array): void {
    if (this.skipping !== null) { this.skipping += bytes.byteLength; return; }
    if (bytes.byteLength > this.lineBytes - this.length) {
      if (this.skipped === undefined)
        throw new StoreError("FRAME_TOO_LARGE", "Pi RPC JSONL line exceeds the configured frame bound");
      this.skipping = this.length + bytes.byteLength; this.pieces = []; this.length = 0;
      return;
    }
    if (bytes.byteLength > 0) { this.pieces.push(Buffer.from(bytes)); this.length += bytes.byteLength; }
  }
  finish(): void {
    if (this.state !== "open") throw new StoreError("INVALID_REQUEST", "JSONL reader is no longer open");
    if (this.midLine) {
      this.state = "poisoned"; this.pieces = []; this.length = 0; this.skipping = null;
      throw new StoreError("INVALID_REQUEST", "Pi RPC EOF has an unterminated JSONL line");
    }
    this.close();
  }
  close(): void { if (this.state === "open") this.state = "closed"; this.pieces = []; this.length = 0; this.skipping = null; }
}
