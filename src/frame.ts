// MUST [IPC-001/002]: uint32 BE length + JSON frame parser over a stream.
// Byte-split tolerant (T04); rejects oversize length, invalid UTF-8, duplicate
// JSON keys, NaN/Infinity and non-object roots with bounded memory.
import { TextDecoder } from "node:util";

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
      let s = "";
      let closed = false;
      while (j < n) {
        const ch = text[j]!;
        if (ch === "\\") {
          s += text[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (ch === '"') {
          closed = true;
          break;
        }
        s += ch;
        j++;
      }
      if (!closed) return null; // unterminated string; JSON.parse will fail
      j++;
      const top = stack[stack.length - 1];
      if (top && top.isObj && top.expectKey) {
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
      out.push(this.parseText(rawBytes));
    }
    return out;
  }

  private parseText(rawBytes: Buffer): ParsedFrame {
    // MUST [IPC-001]: reject invalid UTF-8 via strict decode of the raw bytes.
    let text: string;
    try {
      text = decoder.decode(rawBytes);
    } catch {
      throw new FrameError("INVALID_REQUEST", "invalid UTF-8 in frame");
    }
    if (text.includes("NaN") || text.includes("Infinity")) {
      throw new FrameError("INVALID_REQUEST", "non-finite literal in frame");
    }
    const dup = findDuplicateKey(text);
    if (dup !== null)
      throw new FrameError("INVALID_REQUEST", `duplicate JSON key "${dup}"`);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new FrameError(
        "INVALID_REQUEST",
        `malformed JSON: ${(e as Error).message}`,
      );
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new FrameError(
        "INVALID_REQUEST",
        "frame root must be a JSON object",
      );
    }
    return { raw, text };
  }
}
