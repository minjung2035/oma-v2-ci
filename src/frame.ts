// MUST [IPC-001/002]: uint32 BE length + strict JSON; fatal errors never resynchronize.
import { TextDecoder } from "node:util";
import { checkString } from "./validate.js";
import { ByteQueue } from "./protocol/byte-queue.js";
import { decodeUtf8 } from "./domain/utf8.js";
const unicodeString = checkString();
export class FrameError extends Error {
  constructor(readonly code: "FRAME_TOO_LARGE" | "INVALID_REQUEST", message: string) { super(message); this.name = "FrameError"; }
}
/** Reject duplicate object keys, including escaped spelling of the same key. */
export function findDuplicateKey(text: string): string | null {
  interface Container { isObj: boolean; keys: Set<string> | null; expectKey: boolean }
  const stack: Container[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '"') {
      let end = index + 1; let closed = false;
      while (end < text.length) {
        const next = text[end]!;
        if (next === "\\") { end += 2; continue; }
        if (next === '"') { closed = true; break; }
        end++;
      }
      if (!closed) return null;
      end++;
      const top = stack[stack.length - 1];
      if (top?.isObj && top.expectKey) {
        let key: unknown;
        try { key = JSON.parse(text.slice(index, end)); } catch { return null; }
        if (typeof key !== "string") return null;
        if (top.keys!.has(key)) return key;
        top.keys!.add(key); top.expectKey = false;
      }
      index = end; continue;
    }
    if (char === "{") stack.push({ isObj: true, keys: new Set(), expectKey: true });
    else if (char === "[") stack.push({ isObj: false, keys: null, expectKey: false });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === ",") { const top = stack[stack.length - 1]; if (top) top.expectKey = top.isObj; }
    index++;
  }
  return null;
}
export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const out = Buffer.alloc(4 + body.length); out.writeUInt32BE(body.length, 0); body.copy(out, 4);
  return out;
}
/** Only the JSON root shape is established here; request fields remain unknown. */
export interface ParsedFrame { raw: Record<string, unknown>; text: string }
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseJsonObject(bytes: Uint8Array): ParsedFrame {
  let text: string;
  try { text = decodeUtf8(bytes); } catch { throw new FrameError("INVALID_REQUEST", "invalid UTF-8 in JSON"); }
  const duplicate = findDuplicateKey(text);
  if (duplicate !== null) throw new FrameError("INVALID_REQUEST", `duplicate JSON key "${duplicate}"`);
  let raw: unknown;
  try {
    raw = JSON.parse(text, (key: string, value: unknown) => {
      if (unicodeString(key) || (typeof value === "string" && unicodeString(value))) throw new Error("unpaired Unicode surrogate");
      if (typeof value === "number" && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error("non-finite number or unsafe integer");
      return value;
    });
  } catch (error) { throw new FrameError("INVALID_REQUEST", `malformed JSON: ${error instanceof Error ? error.message : "invalid JSON"}`); }
  if (!isJsonObject(raw)) throw new FrameError("INVALID_REQUEST", "root must be a JSON object");
  return { raw, text };
}
function checkedLimit(maximum: number): number {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new RangeError("invalid frame byte limit");
  return Math.min(maximum, 0xffffffff);
}
/** Arbitrary byte splits; no retained body exceeds one declared frame. */
export class FrameParser {
  private readonly bytes = new ByteQueue();
  private failure: FrameError | null = null;
  private readonly bound: number;
  constructor(readonly maxFrameBytes: number) { this.bound = checkedLimit(maxFrameBytes); }
  get poisoned(): boolean { return this.failure !== null; }
  private poison(error: FrameError): never { this.failure = error; this.bytes.clear(); throw error; }
  feed(chunk: Buffer): ParsedFrame[] {
    if (this.failure) throw this.failure;
    const frames: ParsedFrame[] = [];
    try {
      this.bytes.append(chunk);
      while (this.bytes.length >= 4) {
        const length = this.bytes.uint32BE();
        if (length > this.bound) throw new FrameError("FRAME_TOO_LARGE", `frame length ${length} exceeds max ${this.maxFrameBytes}`);
        if (this.bytes.length < length + 4) break;
        this.bytes.take(4); // exact header, including headers split across four chunks
        frames.push(parseJsonObject(this.bytes.take(length)));
      }
      this.bytes.ownRemainder(this.bound + 4);
      return frames;
    } catch (error) { return this.poison(error instanceof FrameError ? error : new FrameError("INVALID_REQUEST", "invalid frame state")); }
  }
  finish(): void {
    if (this.failure) throw this.failure;
    if (this.bytes.length) this.poison(new FrameError("INVALID_REQUEST", "EOF inside frame header or body"));
  }
}
export type DecoderEvent = { kind: "frame"; frame: ParsedFrame } | { kind: "stream"; bytes: Buffer } |
  { kind: "invalid"; code: "FRAME_TOO_LARGE" | "INVALID_REQUEST"; message: string };
/** One queue, at most one decoded control frame per call. Streaming sinks retain
 * no body chunks. Explicit collection mode has a separate finite budget.
 */
export class ConnectionDecoder {
  private readonly queue = new ByteQueue();
  private readonly bound: number;
  private failure: FrameError | null = null;
  private stream: { remaining: number; chunks: Buffer[] | null; total: number } | null = null;
  constructor(readonly maxFrameBytes: number, private readonly streamSink: ((chunk: Buffer) => void) | null = null,
    private readonly maxCollectedStreamBytes: number = maxFrameBytes) {
    this.bound = checkedLimit(maxFrameBytes);
    if (!Number.isSafeInteger(maxCollectedStreamBytes) || maxCollectedStreamBytes < 0) throw new RangeError("invalid collected stream byte limit");
  }
  get bufferedBytes(): number { return this.queue.length; }
  get poisoned(): boolean { return this.failure !== null; }
  streaming(): boolean { return this.stream !== null; }
  poison(error = new FrameError("INVALID_REQUEST", "connection decoder is closed")): void {
    this.failure ??= error; this.queue.clear(); this.stream = null;
  }
  private invalid(error: FrameError): DecoderEvent[] { this.poison(error); return [{ kind: "invalid", code: error.code, message: error.message }]; }
  private guardedDrain(): DecoderEvent[] {
    if (this.failure) return this.invalid(this.failure);
    try { return this.drain(); }
    catch (error) {
      if (error instanceof FrameError) return this.invalid(error);
      this.poison(); throw error;
    }
  }
  push(chunk: Buffer): DecoderEvent[] {
    if (this.failure) return this.invalid(this.failure);
    this.queue.append(chunk); return this.guardedDrain();
  }
  /** During execution the socket is paused; only one next control frame may be retained. */
  bufferControl(chunk: Buffer): DecoderEvent[] {
    if (this.failure) return this.invalid(this.failure);
    this.queue.append(chunk);
    try { this.requireControlBudget(); return []; }
    catch (error) { return this.invalid(error instanceof FrameError ? error : new FrameError("INVALID_REQUEST", "invalid control queue")); }
  }
  requireControlBudget(): void {
    if (this.failure) throw this.failure;
    if (this.queue.length > this.bound + 4) {
      const error = new FrameError("FRAME_TOO_LARGE", "queued control bytes exceed the existing frame budget");
      this.poison(error); throw error;
    }
    this.queue.ownRemainder(this.bound + 4);
  }
  resumeParsing(): DecoderEvent[] { return this.guardedDrain(); }
  beginStream(declaredBytes: number): DecoderEvent[] {
    if (this.failure) return this.invalid(this.failure);
    if (this.stream !== null || !Number.isSafeInteger(declaredBytes) || declaredBytes < 0) return this.invalid(new FrameError("INVALID_REQUEST", "invalid raw stream transition or length"));
    if (this.streamSink === null && declaredBytes > this.maxCollectedStreamBytes) return this.invalid(new FrameError("FRAME_TOO_LARGE", "collected raw body exceeds its finite byte budget"));
    this.stream = { remaining: declaredBytes, chunks: this.streamSink ? null : [], total: 0 };
    return this.guardedDrain();
  }
  private drain(): DecoderEvent[] {
    if (this.stream) {
      while (this.stream.remaining > 0 && this.queue.length > 0) {
        const part = this.queue.shift(this.stream.remaining);
        if (this.streamSink) this.streamSink(part); else this.stream.chunks!.push(Buffer.from(part));
        this.stream.remaining -= part.length; this.stream.total += part.length;
      }
      if (this.stream.remaining !== 0) return [];
      const done = this.stream; this.stream = null;
      return [{ kind: "stream", bytes: done.chunks ? Buffer.concat(done.chunks, done.total) : Buffer.alloc(0) }];
    }
    if (this.queue.length < 4) return [];
    const length = this.queue.uint32BE();
    if (length > this.bound) throw new FrameError("FRAME_TOO_LARGE", `frame length ${length} exceeds max ${this.maxFrameBytes}`);
    if (this.queue.length < length + 4) return [];
    this.queue.take(4); // shift() intentionally returns only one raw chunk
    return [{ kind: "frame", frame: parseJsonObject(this.queue.take(length)) }];
  }
  /** Probe without consuming a possible next frame or accepting a raw mutation. */
  excessStatus(): "clean" | "next" | "pending" | "excess" {
    if (this.failure) return "excess";
    if (this.queue.length === 0) return "clean";
    if (this.queue.length < 4) return "pending";
    const length = this.queue.uint32BE();
    if (length > this.bound) return "excess";
    if (this.queue.length < length + 4) return "pending";
    try { parseJsonObject(this.queue.peek(length + 4).subarray(4)); return "next"; } catch { return "excess"; }
  }
  finish(): DecoderEvent[] {
    if (this.failure) return this.invalid(this.failure);
    if (this.stream || this.queue.length) return this.invalid(new FrameError("INVALID_REQUEST", "EOF inside a frame or raw body"));
    return [];
  }
}
