// MUST [IPC-001/002]: uint32 BE length + JSON frame parser over a stream.
// Byte-split tolerant (T04); rejects oversize length, invalid UTF-8, duplicate
// JSON keys, NaN/Infinity and non-object roots with bounded memory.
import { TextDecoder } from "node:util";
import { checkString } from "./validate.js";

const unicodeString = checkString();

export class FrameError extends Error {
  constructor(
    readonly code: "FRAME_TOO_LARGE" | "INVALID_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "FrameError";
  }
}

/** Reject duplicate object keys in JSON text (IPC-001). Returns the offending key. */
export function findDuplicateKey(text: string): string | null {
  interface Container {
    isObj: boolean;
    keys: Set<string> | null;
    expectKey: boolean;
  }
  const stack: Container[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const ch = text[j]!;
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === '"') {
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) return null; // unterminated string; JSON.parse will fail
      j++;
      const top = stack[stack.length - 1];
      if (top && top.isObj && top.expectKey) {
        let s: string;
        try { s = JSON.parse(text.slice(i, j)); }
        catch { return null; } // The frame parser reports malformed JSON.
        if (top.keys!.has(s)) return s;
        top.keys!.add(s);
        top.expectKey = false;
      }
      i = j;
      continue;
    }
    if (c === "{") {
      stack.push({ isObj: true, keys: new Set(), expectKey: true });
    } else if (c === "[") {
      stack.push({ isObj: false, keys: null, expectKey: false });
    } else if (c === "}") {
      stack.pop();
    } else if (c === "]") {
      stack.pop();
    } else if (c === ",") {
      const top = stack[stack.length - 1];
      if (top) top.expectKey = top.isObj;
    }
    i++;
  }
  return null;
}

/** MUST [IPC-001]: client-side frame encoding: uint32 BE length + UTF-8 JSON. */
export function encodeFrame(obj: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32BE(body.length, 0);
  body.copy(out, 4);
  return out;
}

const decoder = new TextDecoder("utf-8", { fatal: true });
import { createHash } from "node:crypto";

export interface ParsedFrame {
  raw: unknown;
  text: string;
}

/**
 * Incremental parser: feed() consumes arbitrary chunk boundaries and returns
 * zero or more complete frames. On a framing/encoding error it raises
 * FrameError and resynchronizes past the offending frame so the connection can
 * continue (the broker decides whether to close).
 */
export class FrameParser {
  private buf: Buffer = Buffer.alloc(0);
  constructor(readonly maxFrameBytes: number) {}

  feed(chunk: Buffer): ParsedFrame[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const out: ParsedFrame[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.buf.length < 4) break;
      const len = this.buf.readUInt32BE(0);
      if (len > this.maxFrameBytes) {
        const skip = 4 + len;
        if (this.buf.length >= skip) {
          this.buf = this.buf.subarray(skip);
          throw new FrameError(
            "FRAME_TOO_LARGE",
            `frame length ${len} exceeds max ${this.maxFrameBytes}`,
          );
        }
        // cannot resync yet; drop all buffered data and wait for the full frame
        this.buf = this.buf.subarray(0, 0);
        throw new FrameError(
          "FRAME_TOO_LARGE",
          `frame length ${len} exceeds max ${this.maxFrameBytes}`,
        );
      }
      if (this.buf.length < 4 + len) break;
      const rawBytes = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      out.push(parseJsonObject(rawBytes));
    }
    return out;
  }

}

/** Strict JSON object decoding shared by wire frames and host configuration. */
export function parseJsonObject(rawBytes: Buffer): ParsedFrame {
  let text: string;
  try {
    text = decoder.decode(rawBytes);
  } catch {
    throw new FrameError("INVALID_REQUEST", "invalid UTF-8 in JSON");
  }
  const dup = findDuplicateKey(text);
  if (dup !== null)
    throw new FrameError("INVALID_REQUEST", `duplicate JSON key "${dup}"`);
  let raw: unknown;
  try {
    raw = JSON.parse(text, (key: string, value: unknown) => {
      if (unicodeString(key) || (typeof value === "string" && unicodeString(value)))
        throw new Error("unpaired Unicode surrogate");
      if (typeof value === "number" && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))))
        throw new Error("non-finite number or unsafe integer");
      return value;
    });
  } catch (e) {
    throw new FrameError("INVALID_REQUEST", `malformed JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new FrameError("INVALID_REQUEST", "root must be a JSON object");
  return { raw, text };
}

export type DecoderEvent =
  | { kind: "frame"; frame: ParsedFrame }
  | { kind: "stream"; bytes: Buffer }
  | {
      kind: "invalid";
      code: "FRAME_TOO_LARGE" | "INVALID_REQUEST";
      message: string;
    };

/**
 * MUST [IPC-001/002]: connection-level decoder. Owns the byte queue so that a
 * metadata frame and its raw stream body can be split at exact byte
 * boundaries regardless of how the kernel chunks them: frame mode parses
 * uint32 BE length + JSON; beginStream() switches the SAME queue into raw
 * collection of exactly declared bytes (never trusting read boundaries), and
 * any leftover bytes after the stream become frames again. Per-connection
 * instance; no state is shared across sockets.
 *
 * A broker may supply `streamSink` to consume raw stream chunks incrementally.
 * In that mode the decoder never retains the stream body; the terminal stream
 * event carries an empty Buffer and the sink owns durable/bounded storage.
 */
export class ConnectionDecoder {
  private queue: Buffer = Buffer.alloc(0);
  private parser: FrameParser;
  private stream: {
    remaining: number;
    chunks: Buffer[] | null;
    total: number;
    sha: ReturnType<typeof createHash>;
  } | null = null;

  constructor(
    readonly maxFrameBytes: number,
    private readonly streamSink: ((chunk: Buffer) => void) | null = null,
  ) {
    this.parser = new FrameParser(maxFrameBytes);
  }

  streaming(): boolean {
    return this.stream !== null;
  }

  /**
   * Parse at most ONE frame per drain (then stop), so the broker can decide —
   * before any following bytes are interpreted — whether this frame opens a
   * raw stream. runByteBoundary tests depend on this: a frame's tail bytes and
   * the raw's first bytes may share a data event, and the raw may already be
   * queued; beginStream() consumes it byte-exactly.
   */
  private drain(events: DecoderEvent[]): void {
    if (this.stream) {
      this.consumeStream(events);
      return;
    }
    if (this.queue.length < 4) return;
    const len = this.queue.readUInt32BE(0);
    if (len > this.maxFrameBytes) {
      events.push({
        kind: "invalid",
        code: "FRAME_TOO_LARGE",
        message: `frame length ${len} exceeds max ${this.maxFrameBytes}`,
      });
      this.queue = Buffer.alloc(0);
      return;
    }
    if (this.queue.length < 4 + len) return; // wait for the full frame
    const slice = this.queue.subarray(0, 4 + len);
    this.queue = this.queue.subarray(4 + len);
    let frames: ParsedFrame[];
    try {
      frames = this.parser.feed(slice);
    } catch (e) {
      events.push({
        kind: "invalid",
        code: e instanceof FrameError ? e.code : "INVALID_REQUEST",
        message: (e as Error).message,
      });
      return;
    }
    for (const f of frames) events.push({ kind: "frame", frame: f });
  }

  push(chunk: Buffer): DecoderEvent[] {
    this.queue =
      this.queue.length === 0 ? chunk : Buffer.concat([this.queue, chunk]);
    const events: DecoderEvent[] = [];
    this.drain(events);
    return events;
  }

  /**
   * MUST [IPC-002]: after a raw stream completes, classify any leftover bytes:
   *  - "clean": no bytes remain; dispatch is safe immediately;
   *  - "next": a complete, valid follow-up frame is already buffered;
   *  - "pending": a partial follow-up frame/header is buffered; wait for more
   *              bytes or EOF before dispatching the completed stream;
   *  - "excess": buffered bytes cannot be a valid follow-up frame and the
   *              completed mutation must be rejected before dispatch.
   * Uses a throwaway parser so this probe never mutates connection state.
   */
  excessStatus(): "clean" | "next" | "pending" | "excess" {
    if (this.queue.length === 0) return "clean";
    if (this.queue.length < 4) return "pending";
    const len = this.queue.readUInt32BE(0);
    if (len > this.maxFrameBytes) return "excess";
    if (this.queue.length < 4 + len) return "pending";
    const slice = this.queue.subarray(0, 4 + len);
    const probe = new FrameParser(this.maxFrameBytes);
    try {
      const frames = probe.feed(slice);
      return frames.length > 0 ? "next" : "excess";
    } catch {
      return "excess";
    }
  }

  /** continue parsing after the broker decided the previous frame opened no stream. */
  resumeParsing(): DecoderEvent[] {
    const events: DecoderEvent[] = [];
    this.drain(events);
    return events;
  }

  /** Switch this connection to raw collection of exactly declared bytes; any
   * bytes already queued (coalesced chunk) are consumed immediately. */
  beginStream(declaredBytes: number): DecoderEvent[] {
    if (declaredBytes <= 0) return [];
    this.stream = {
      remaining: declaredBytes,
      chunks: this.streamSink ? null : [],
      total: 0,
      sha: createHash("sha256"),
    };
    const events: DecoderEvent[] = [];
    this.consumeStream(events);
    return events;
  }

  private consumeStream(events: DecoderEvent[]): void {
    while (this.stream && this.queue.length > 0) {
      const take = Math.min(this.stream.remaining, this.queue.length);
      const part = this.queue.subarray(0, take);
      if (this.streamSink) this.streamSink(part);
      else this.stream.chunks!.push(part);
      this.stream.total += part.length;
      this.stream.sha.update(part);
      this.queue = this.queue.subarray(take);
      this.stream.remaining -= take;
      if (this.stream.remaining === 0) {
        const done = this.stream;
        this.stream = null;
        events.push({
          kind: "stream",
          bytes: done.chunks ? Buffer.concat(done.chunks) : Buffer.alloc(0),
        });
        return;
      }
    }
  }
}
