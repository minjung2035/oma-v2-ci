// MUST [IPC-001/002]: uint32 BE length + strict JSON; fatal errors never resynchronize.
import { TextDecoder } from "node:util";
import { checkString } from "@oma/domain/validation";
import { ByteQueue } from "./byte-queue.js";
import { decodeUtf8 } from "@oma/domain/utf8";
import { JSON_NESTING_LIMIT } from "@oma/domain/canonical-json";
const unicodeString = checkString();
export class FrameError extends Error {
  constructor(readonly code: "FRAME_TOO_LARGE" | "INVALID_REQUEST", message: string) { super(message); this.name = "FrameError"; }
}
/** Reject duplicate object keys, including escaped spelling of the same key. */
export function findDuplicateKey(text: string): string | null {
  const structure = jsonStructure(text);
  return structure?.kind === "duplicate" ? structure.key : null;
}
/** What a JSON text's structure shows before it is parsed, in one iterative
 * pass: its first duplicated object key, or nesting past JSON_NESTING_LIMIT
 * (P0V-119), which no recursive walk after the parse then meets. */
function jsonStructure(text: string): { readonly kind: "duplicate"; readonly key: string } | { readonly kind: "too-deep" } | null {
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
        if (top.keys!.has(key)) return { kind: "duplicate", key };
        top.keys!.add(key); top.expectKey = false;
      }
      index = end; continue;
    }
    if ((char === "{" || char === "[") && stack.length >= JSON_NESTING_LIMIT) return { kind: "too-deep" };
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
  const structure = jsonStructure(text);
  if (structure?.kind === "too-deep") throw new FrameError("INVALID_REQUEST", `JSON nesting exceeds ${JSON_NESTING_LIMIT}`);
  if (structure?.kind === "duplicate") throw new FrameError("INVALID_REQUEST", `duplicate JSON key "${structure.key}"`);
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
/** B7: the three-way decision every consumer makes on the queue's head. Fewer
 * than four header bytes or an incomplete body means wait; past the bound is
 * the one fatal size verdict; otherwise the declared body length is ready to
 * take. Reading the decision consumes nothing, so probe and drain paths share
 * it. */
type FrameHead =
  | { readonly kind: "pending" }
  | { readonly kind: "ready"; readonly bodyBytes: number }
  | { readonly kind: "too-large"; readonly declared: number };
function frameHead(queue: ByteQueue, bound: number): FrameHead {
  if (queue.length < 4) return { kind: "pending" };
  const length = queue.uint32BE();
  if (length > bound) return { kind: "too-large", declared: length };
  return queue.length < length + 4 ? { kind: "pending" } : { kind: "ready", bodyBytes: length };
}
function tooLarge(declared: number, maxFrameBytes: number): FrameError {
  return new FrameError("FRAME_TOO_LARGE", `frame length ${declared} exceeds max ${maxFrameBytes}`);
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
      while (true) {
        const head = frameHead(this.bytes, this.bound);
        if (head.kind === "pending") break;
        if (head.kind === "too-large") throw tooLarge(head.declared, this.maxFrameBytes);
        this.bytes.take(4); // exact header, including headers split across four chunks
        frames.push(parseJsonObject(this.bytes.take(head.bodyBytes)));
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
    const head = frameHead(this.queue, this.bound);
    if (head.kind === "pending") return [];
    if (head.kind === "too-large") throw tooLarge(head.declared, this.maxFrameBytes);
    this.queue.take(4); // shift() intentionally returns only one raw chunk
    return [{ kind: "frame", frame: parseJsonObject(this.queue.take(head.bodyBytes)) }];
  }
  /** Probe without consuming a possible next frame or accepting a raw mutation. */
  excessStatus(): "clean" | "next" | "pending" | "excess" {
    if (this.failure) return "excess";
    if (this.queue.length === 0) return "clean";
    const head = frameHead(this.queue, this.bound);
    if (head.kind === "pending") return "pending";
    if (head.kind === "too-large") return "excess";
    try { parseJsonObject(this.queue.peek(head.bodyBytes + 4).subarray(4)); return "next"; } catch { return "excess"; }
  }
  finish(): DecoderEvent[] {
    if (this.failure) return this.invalid(this.failure);
    if (this.stream || this.queue.length) return this.invalid(new FrameError("INVALID_REQUEST", "EOF inside a frame or raw body"));
    return [];
  }
}
