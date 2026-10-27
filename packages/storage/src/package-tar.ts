/** Positional, streaming tar decoding into an already-owned staging area.
 * This module interprets bytes; it does not acquire or publish package state. */
import { readSync } from "node:fs";
import { isAbsolute } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { PACKAGE_ARCHIVE_BOUNDS } from "@oma/domain/package-policy";
import type { StageArea } from "./package-staging.js";

const USTAR = "ustar";
const BLOCK = 512;

/** The NUL-terminated text of one header field. */
function tarString(field: Buffer): string {
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString("utf8");
}

/** An octal (or GNU base-256) header number. */
function tarNumber(field: Buffer): number {
  if (field.length > 0 && (field[0]! & 0x80)) {
    let value = 0;
    for (let index = 1; index < field.length; index++) value = value * 256 + field[index]!;
    return value;
  }
  const text = tarString(field).trim();
  return text === "" ? 0 : Number.parseInt(text, 8);
}

/** A header's own checksum, with the checksum field read as spaces per ustar. */
function tarChecksum(header: Buffer): boolean {
  let sum = 0;
  for (let index = 0; index < BLOCK; index++) sum += index >= 148 && index < 156 ? 0x20 : header[index]!;
  return sum === tarNumber(header.subarray(148, 156));
}

/** One `len key=value\n` pax record; the length includes itself. */
function* paxRecords(content: Buffer, fail: (words: string) => never): Generator<{ key: string; value: string }> {
  let at = 0;
  while (at < content.length) {
    const space = content.indexOf(0x20, at);
    if (space < 0) fail("a pax record has no length");
    const length = Number.parseInt(content.subarray(at, space).toString("ascii"), 10);
    if (!Number.isInteger(length) || length < 3 || at + length > content.length) fail("a pax record length is wrong");
    const record = content.subarray(space + 1, at + length - 1).toString("utf8");
    const equal = record.indexOf("=");
    if (equal > 0) yield { key: record.slice(0, equal), value: record.slice(equal + 1) };
    at += length;
  }
}

/** Bytes of one member's in-band metadata (a pax record block or a GNU long
 * name) buffered whole to be parsed: a record whose payload names paths and
 * sizes is path-sized, so this is generous, and a file member never pays it
 * -- member bytes stream to the staged file. */
const TAR_METADATA_BYTES = 1024 * 1024;

/** Writes every entry of a ustar stream into the staging area; nothing that
 * is not a regular file or a directory, and no name that is not a normalized
 * relative path -- the same rule a `packages:` entry keeps. `source` is read
 * positionally a chunk at a time: the archive is never a buffer in memory. */
export function extractTar(source: number, area: StageArea): void {
  const fail = (words: string): never => { throw new StoreError("INVALID_REQUEST", `the package archive is not a tar oma can install: ${words}`); };
  const made = new Set<string>();
  let position = 0, entries = 0;
  /** Exactly `length` bytes at the cursor, or the end of the archive short of
   * them -- null. */
  const take = (length: number): Buffer | null => {
    const out = Buffer.alloc(length);
    let used = 0;
    while (used < length) {
      const got = readSync(source, out, used, length - used, position + used);
      if (got === 0) return null;
      used += got;
    }
    position += length;
    return out;
  };
  /** Bytes past the cursor to the end of the archive (a tail is at most a
   * block's worth of zero padding by the header loop's own shape). */
  const rest = (): Buffer => {
    const out = Buffer.alloc(BLOCK);
    const got = readSync(source, out, 0, BLOCK, position);
    return out.subarray(0, got);
  };
  /** `rel` (a directory) and its parents exist beneath the staging root. */
  const ensure = (rel: string): void => {
    let at = "";
    for (const part of rel.split("/")) {
      at = at === "" ? part : `${at}/${part}`;
      if (part !== "" && !made.has(at)) { area.make(at); made.add(at); }
    }
  };
  /** The directories `rel`'s parent names, made; a root-level name has none
   * (`lastIndexOf` answers -1, which `slice` would read as "drop the last
   * character"). */
  const ensureParents = (rel: string): void => {
    const cut = rel.lastIndexOf("/");
    ensure(cut < 0 ? "" : rel.slice(0, cut));
  };
  let longName: string | undefined;
  let paxPath: string | undefined, paxSize: number | undefined;
  /** A directory member's name ends in one `/` (as `npm pack` writes it);
   * that trailing mark is stripped before the normalized-path rule runs --
   * every other shape (`//`, embedded empties, `.`, `..`, absolute) fails. */
  const entryName = (raw: string, directory: boolean): string => {
    let name = raw.startsWith("./") ? raw.slice(2) : raw;
    if (directory && name.endsWith("/")) name = name.slice(0, -1);
    if (Buffer.byteLength(name, "utf8") === 0 || Buffer.byteLength(name, "utf8") > PACKAGE_ARCHIVE_BOUNDS.pathBytes ||
        name.includes("\0") || name.includes("\\") || isAbsolute(name) ||
        name.split("/").some(part => !part || part === "." || part === ".." || Buffer.byteLength(part, "utf8") > PACKAGE_ARCHIVE_BOUNDS.componentBytes))
      fail(`an entry name is not a normalized relative path: ${JSON.stringify(raw)}`);
    return name;
  };
  for (;;) {
    const header = take(BLOCK) ?? (rest().every(byte => byte === 0) ? null : fail("it ends inside a header"));
    if (header === null) break;
    if (header.every(byte => byte === 0)) break;
    if (tarString(header.subarray(257, 262)) !== USTAR) fail("a header is not ustar");
    if (!tarChecksum(header)) fail("a header checksum does not hold");
    if (++entries > PACKAGE_ARCHIVE_BOUNDS.entries) fail(`it holds more than ${PACKAGE_ARCHIVE_BOUNDS.entries} entries`);
    const type = header[156]!;
    const size = tarNumber(header.subarray(124, 136));
    if (!Number.isSafeInteger(size) || size < 0) fail("an entry names a size that cannot be observed exactly");
    const content = position;
    position += Math.ceil(size / BLOCK) * BLOCK;
    const name = paxPath ?? longName ?? (() => {
      const leaf = tarString(header.subarray(0, 100));
      const prefix = tarString(header.subarray(345, 500));
      return prefix ? `${prefix}/${leaf}` : leaf;
    })();
    const sizeOverride = paxSize;
    paxPath = undefined; paxSize = undefined; longName = undefined;
    if (sizeOverride !== undefined && sizeOverride !== size) fail("a pax size does not match its header");
    switch (type) {
      case 0x78: { // 'x' — pax per-entry metadata
        if (size > TAR_METADATA_BYTES) fail("a pax record is larger than a path's metadata can be");
        const block = readMetadata(source, content, size) ?? fail("it ends inside a file");
        for (const record of paxRecords(block, fail)) {
          if (record.key === "path") paxPath = record.value;
          else if (record.key === "size") paxSize = Number.parseInt(record.value, 10);
        }
        continue;
      }
      case 0x67: continue; // 'g' — pax globals; none apply per entry
      case 0x4c: { // 'L' — GNU long name
        if (size > TAR_METADATA_BYTES) fail("a long name is larger than a path's metadata can be");
        const block = readMetadata(source, content, size) ?? fail("it ends inside a file");
        longName = tarString(block);
        continue;
      }
      case 0x4b: continue; // 'K' — a long link name; the link itself is refused below
      case 0x35: { // '5' — directory
        const rel = entryName(name, true);
        ensureParents(rel);
        if (made.has(rel)) fail(`a duplicate entry: ${rel}`);
        area.make(rel);
        made.add(rel);
        continue;
      }
      case 0x00: case 0x30: case 0x37: { // regular file
        const rel = entryName(name, false);
        ensureParents(rel);
        if (made.has(rel)) fail(`a duplicate entry: ${rel}`);
        try {
          area.writeFrom(rel, source, content, size, (tarNumber(header.subarray(100, 108)) & 0o111) !== 0);
        } catch (error) {
          if (error instanceof StoreError && error.code === "INVALID_REQUEST") fail("it ends inside a file");
          throw error;
        }
        made.add(rel);
        continue;
      }
      default:
        fail(`an entry that is not a file or a directory (type ${JSON.stringify(String.fromCharCode(type))}): ${name}`);
    }
  }
}

/** `size` bytes of `source` at `position`, or null when the archive ends
 * inside them -- for the small metadata members a pax record or long name
 * is. File members stream instead. */
function readMetadata(source: number, position: number, size: number): Buffer | null {
  const out = Buffer.alloc(size);
  let used = 0;
  while (used < size) {
    const got = readSync(source, out, used, size - used, position + used);
    if (got === 0) return null;
    used += got;
  }
  return out;
}
