/** Shared operational output policy. Storage owns bytes; no log observation
 * grants authority, settles a receipt or proves an execution ended. */
import { StringDecoder } from "node:string_decoder";
import { StoreError } from "@oma/domain/errors";
import type { ResidentLogEntry, ResidentLogObservation } from "@oma/contracts/runtime";

export function boundedLogOutput(bytes: Buffer, maxBytes: number, forcedTruncated = false): { text: string; truncated: boolean } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new StoreError("INTERNAL_ERROR", "invalid log byte limit");
  const prefix = bytes.subarray(0, Math.min(bytes.length, maxBytes));
  let truncated = forcedTruncated || bytes.length > maxBytes;
  const decoder = new StringDecoder("utf8");
  let text = truncated ? decoder.write(prefix) : decoder.end(prefix);
  while (Buffer.byteLength(text, "utf8") > maxBytes && text.length > 0) {
    text = text.slice(0, (text.codePointAt(text.length - 2) ?? 0) > 0xffff ? -2 : -1); truncated = true;
  }
  return { text, truncated };
}
export function residentLogSinks(actor: string, invocationId: string, incarnation: () => number | null,
  append: (entry: ResidentLogEntry) => void, now: () => number = Date.now) {
  const receive = (stream: "stdout" | "stderr", bytes: Uint8Array): void => {
    for (let offset = 0; offset < bytes.byteLength; offset += 65536)
      append({ actor, invocationId, incarnation: incarnation(), atMs: now(), stream, bytes: bytes.subarray(offset, offset + 65536) });
  };
  return Object.freeze({ stdoutSink: (bytes: Uint8Array) => receive("stdout", bytes), stderrSink: (bytes: Uint8Array) => receive("stderr", bytes) });
}
export function residentLogView(observations: Iterable<ResidentLogObservation>, sinceSeconds: number, limit: number, observedAtMs = Date.now()) {
  if (!Number.isFinite(sinceSeconds) || sinceSeconds < 0 || !Number.isSafeInteger(limit) || limit < 0)
    throw new StoreError("INVALID_REQUEST", "invalid operational log view bounds");
  const chunks: Buffer[] = []; let length = 0, truncated = false;
  const decoders = new Map<string, StringDecoder>(); let invocation = "", generation = "";
  const finish = (): void => {
    for (const decoder of decoders.values()) if (decoder.end().length > 0) truncated = true;
    decoders.clear();
  };
  for (const observed of observations) {
    if (observed.kind === "incomplete") { truncated = true; continue; }
    const entry = observed.entry;
    if (entry.atMs < observedAtMs - sinceSeconds * 1000) continue;
    const identity = JSON.stringify([entry.actor, entry.invocationId, entry.incarnation]);
    if (generation !== identity) { finish(); invocation = entry.invocationId; generation = identity; }
    let decoder = decoders.get(entry.stream);
    if (!decoder) { decoder = new StringDecoder("utf8"); decoders.set(entry.stream, decoder); }
    const text = decoder.write(Buffer.from(entry.bytes));
    if (!text) continue;
    const value = Buffer.from(`[${new Date(entry.atMs).toISOString()} ${entry.actor} incarnation=${entry.incarnation ?? "opening"} invocation=${invocation} ${entry.stream}] ${text}`);
    const keep = Math.min(value.length, limit - length); chunks.push(value.subarray(0, keep)); length += keep;
    if (keep < value.length) { truncated = true; break; }
  }
  finish();
  return { ...boundedLogOutput(Buffer.concat(chunks, length), limit, truncated), observedAtMs };
}
