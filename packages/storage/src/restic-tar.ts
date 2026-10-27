/** Incremental authenticated dump verifier. Payload bytes are hashed without
 * spilling an archive or retaining a file in memory. Inventory independently
 * verifies Restic's exact nanosecond metadata and hardlink identities. */
import { createHash, type Hash } from "node:crypto";
import { StoreError } from "@oma/domain/errors";
import { decodeUtf8 } from "@oma/domain/utf8";
import type { CacheTreeObservation } from "./cache-trees.js";

const BLOCK = 512;
// Format bound for a single extended header, never a file/output quota.
const EXTENDED_HEADER_BYTES = 1024 * 1024;
function invalid(message: string): never { throw new StoreError("STORE_CORRUPT", `Restic dump verification failed: ${message}`); }
function text(bytes: Buffer): string {
  const nul = bytes.indexOf(0); return decodeUtf8(nul < 0 ? bytes : bytes.subarray(0, nul));
}
function integer(bytes: Buffer): bigint {
  if ((bytes[0]! & 0x80) !== 0) {
    let number = BigInt(bytes[0]! & 0x7f);
    for (const byte of bytes.subarray(1)) number = number * 256n + BigInt(byte);
    if ((bytes[0]! & 0x40) !== 0) number -= 1n << BigInt(bytes.length * 8 - 1);
    return number;
  }
  const value = text(bytes).trim();
  if (!/^[0-7]*$/.test(value)) return invalid("invalid numeric field");
  return value ? BigInt(`0o${value}`) : 0n;
}
function name(value: string): string {
  const result = value.replace(/\/$/, "");
  if (!result || result.includes("\0") || result.split("/").some(part => !part || part === "." || part === "..")) invalid("invalid entry path");
  return result;
}
function pax(bytes: Buffer): Record<string, string> {
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let at = 0; at < bytes.length;) {
    const space = bytes.indexOf(32, at);
    if (space < 0 || space - at > 8) invalid("invalid PAX record length");
    const digits = bytes.subarray(at, space).toString("ascii");
    if (!/^[1-9][0-9]*$/.test(digits)) invalid("invalid PAX record length");
    const length = Number(digits), end = at + length;
    if (end > bytes.length || end <= space + 2 || bytes[end - 1] !== 10) invalid("truncated PAX record");
    const record = decodeUtf8(bytes.subarray(space + 1, end - 1)), equal = record.indexOf("=");
    if (equal <= 0) invalid("invalid PAX field");
    const key = record.slice(0, equal);
    if (Object.hasOwn(fields, key) || !["path", "linkpath", "size", "mtime", "uid", "gid", "atime", "ctime", "uname", "gname"].includes(key)) invalid("duplicate or unsupported PAX field");
    fields[key] = record.slice(equal + 1); at = end;
  }
  return fields;
}
function decimal(value: string): bigint {
  if (!/^[0-9]+$/.test(value)) invalid("invalid PAX integer"); return BigInt(value);
}
function seconds(nanos: bigint): bigint {
  return nanos >= 0n ? nanos / 1_000_000_000n : (nanos - 999_999_999n) / 1_000_000_000n;
}

export class ResticTarVerifier {
  private header = Buffer.alloc(0);
  private remaining = 0;
  private padding = 0;
  private zeroes = 0;
  private extended: Record<string, string> | null = null;
  private payload: { readonly name: string; readonly hash: Hash; readonly expected: string } | null = null;
  private paxParts: Buffer[] | null = null;
  private readonly seen = new Set<string>();
  constructor(private readonly source: Pick<CacheTreeObservation, "paths" | "metadata">) {}
  push(input: Uint8Array): void {
    let bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    while (bytes.length) {
      if (this.remaining > 0) {
        const count = Math.min(this.remaining, bytes.length), part = bytes.subarray(0, count);
        this.payload?.hash.update(part); this.paxParts?.push(Buffer.from(part));
        bytes = bytes.subarray(count); this.remaining -= count;
        if (this.remaining === 0) this.completePayload();
      } else if (this.padding > 0) {
        const count = Math.min(this.padding, bytes.length);
        if (bytes.subarray(0, count).some(byte => byte !== 0)) invalid("nonzero entry padding");
        bytes = bytes.subarray(count); this.padding -= count;
      } else {
        const count = Math.min(BLOCK - this.header.length, bytes.length);
        this.header = Buffer.concat([this.header, bytes.subarray(0, count)]); bytes = bytes.subarray(count);
        if (this.header.length === BLOCK) { const header = this.header; this.header = Buffer.alloc(0); this.beginEntry(header); }
      }
    }
  }
  private completePayload(): void {
    if (this.payload !== null) {
      const payload = this.payload; this.payload = null;
      if (payload.hash.digest("hex") !== payload.expected) invalid(`file contents differ at ${payload.name}`);
    }
    if (this.paxParts !== null) {
      const parts = this.paxParts; this.paxParts = null; this.extended = pax(Buffer.concat(parts));
    }
  }
  private beginEntry(header: Buffer): void {
    if (header.every(byte => byte === 0)) { this.zeroes++; return; }
    if (this.zeroes !== 0) invalid("entry after end marker");
    let checksum = 0;
    for (let index = 0; index < BLOCK; index++) checksum += index >= 148 && index < 156 ? 32 : header[index]!;
    if (BigInt(checksum) !== integer(header.subarray(148, 156))) invalid("header checksum mismatch");
    const type = String.fromCharCode(header[156]!), rawSize = integer(header.subarray(124, 136));
    if (rawSize < 0n || rawSize > BigInt(Number.MAX_SAFE_INTEGER)) invalid("unaddressable entry size");
    if (type === "x") {
      if (this.extended !== null || rawSize === 0n || rawSize > BigInt(EXTENDED_HEADER_BYTES)) invalid("invalid extended header");
      this.remaining = Number(rawSize); this.padding = (BLOCK - this.remaining % BLOCK) % BLOCK; this.paxParts = []; return;
    }
    const extended = this.extended; this.extended = null;
    const prefix = text(header.subarray(345, 500)), rawName = text(header.subarray(0, 100));
    const path = name(extended?.path ?? (prefix ? `${prefix}/${rawName}` : rawName));
    const expected = this.source.metadata.get(path);
    if (!expected || !this.source.paths.has(path) || this.seen.has(path)) invalid(`unexpected or duplicate entry ${path}`);
    const size = extended?.size === undefined ? rawSize : decimal(extended.size);
    if (size > BigInt(Number.MAX_SAFE_INTEGER)) invalid("unaddressable PAX size");
    const mode = integer(header.subarray(100, 108)), uid = extended?.uid === undefined ? integer(header.subarray(108, 116)) : decimal(extended.uid);
    const gid = extended?.gid === undefined ? integer(header.subarray(116, 124)) : decimal(extended.gid);
    const mtime = extended?.mtime;
    let modified: bigint;
    if (mtime === undefined) modified = integer(header.subarray(136, 148));
    else {
      if (!/^-?[0-9]+(?:\.[0-9]{1,9})?$/.test(mtime)) invalid("invalid PAX timestamp");
      const [whole, fraction = ""] = mtime.split(".");
      const nanos = BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0")) * (mtime.startsWith("-") ? -1n : 1n);
      if (nanos !== BigInt(expected.mtimeNs)) invalid(`PAX timestamp differs at ${path}`);
      modified = seconds(nanos);
    }
    // Go's USTAR writer rounds to the nearest second. The independently read
    // inventory must still match every nanosecond; PAX retains exact precision.
    const expectedSeconds = seconds(BigInt(expected.mtimeNs) + (mtime === undefined ? 500_000_000n : 0n));
    if (mode !== BigInt(expected.mode) || String(uid) !== expected.uid || String(gid) !== expected.gid || modified !== expectedSeconds) invalid(`metadata differs at ${path}`);
    const link = extended?.linkpath ?? text(header.subarray(157, 257));
    if (type === "0" || type === "\0") {
      if (expected.type !== "file" || size !== BigInt(expected.size ?? -1) || !/^[0-9a-f]{64}$/.test(expected.contentHash ?? "")) invalid(`invalid regular file ${path}`);
      this.payload = { name: path, hash: createHash("sha256"), expected: expected.contentHash! };
    } else if (type === "5") {
      if (expected.type !== "dir" || size !== 0n) invalid(`invalid directory ${path}`);
    } else if (type === "2") {
      if (expected.type !== "symlink" || size !== 0n || Buffer.from(link).toString("base64") !== expected.linkTarget) invalid(`link differs at ${path}`);
    } else if (type === "1") {
      const targetName = name(link), target = this.source.metadata.get(targetName);
      // The next header is reached only after the earlier payload hash was
      // verified. Induction over admitted links excludes self/forward/cycles
      // without retaining another graph or treating source metadata as data.
      if (!this.seen.has(targetName) || expected.type !== "file" || size !== 0n || target?.type !== "file" || !expected.hardlinkGroup || expected.hardlinkGroup !== target.hardlinkGroup || expected.contentHash !== target.contentHash) invalid(`hardlink differs at ${path}`);
    } else invalid(`unsupported entry type at ${path}`);
    this.seen.add(path);
    this.remaining = Number(size); this.padding = (BLOCK - this.remaining % BLOCK) % BLOCK;
    if (this.remaining === 0) this.completePayload();
  }
  finish(): void {
    if (this.header.length || this.remaining || this.padding || this.zeroes < 2 || this.extended !== null || this.paxParts !== null || this.payload !== null || this.seen.size !== this.source.paths.size)
      invalid("truncated or incomplete archive");
  }
}

/** The caller's dump port resolves after native close/exit validation. Storage
 * consumes the complete stream before it can authorize any archive selection. */
export async function verifyResticDump(source: Pick<CacheTreeObservation, "paths" | "metadata">,
  dump: (consume: (bytes: Uint8Array) => void) => Promise<void>): Promise<void> {
  const verifier = new ResticTarVerifier(source);
  await dump(bytes => verifier.push(bytes));
  verifier.finish();
}
