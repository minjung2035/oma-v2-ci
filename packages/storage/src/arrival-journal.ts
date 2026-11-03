/** A delivery arrival is durable only after the whole record and its name.
 * The caller keeps the inbox directory pinned through publication and append. */
import { closeSync, fstatSync, fsyncSync, readSync, writeSync, type BigIntStats } from "node:fs";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { isValidMessageId } from "@oma/domain/identifiers";
import { openOwnedAppendFile } from "./directory.js";
import { faultAt, fsyncHeldDir, type DurabilityObserver } from "./durable-fs.js";

/** A full record can outlive the SQL materialized update. Reuse it on replay,
 * but still repeat both fsyncs below. Stream the journal with bounded memory;
 * an interrupted/non-record line never proves this arrival. Inbox publication
 * and append are synchronous under the broker's exclusive inbox owner. */
// Advisory memory only, bounded across recently used inboxes. Any replacement,
// append, truncation or timestamp change requires a fresh scan. The broker is
// the exclusive writer; durable records and both fsyncs remain authoritative.
const CACHE_RECORDS = 262144;
type CachedArrivals = { stat: BigIntStats; ids: Set<string> };
const cached = new Map<string, CachedArrivals>();
let cachedRecords = 0;
const unchanged = (a: BigIntStats, b: BigIntStats): boolean => a.dev === b.dev && a.ino === b.ino &&
  a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
function scanArrivals(fd: number, size: number, messageId: string): {found: boolean; ids: Set<string> | null} {
  let found = false, ids: Set<string> | null = new Set();
  const chunk = Buffer.alloc(64 * 1024);
  let position = 0, line = "", overlong = false;
  while (position < size) {
    const got = readSync(fd, chunk, 0, Math.min(chunk.length, size - position), position);
    if (got === 0) throw new StoreError("BROKER_UNAVAILABLE", "arrival journal could not be observed");
    position += got;
    for (const byte of chunk.subarray(0, got)) {
      if (byte === 0x0a) {
        if (!overlong && /^\d+ m-[0-9a-f-]+-\d+$/.test(line)) {
          const space = line.indexOf(" "), time = Number(line.slice(0, space));
          const id = line.slice(space + 1);
          if (Number.isSafeInteger(time) && time >= 0 && isValidMessageId(id)) {
            if (id === messageId) found = true;
            ids?.add(id);
            if (ids && ids.size > CACHE_RECORDS) ids = null;
          }
        }
        line = ""; overlong = false;
      } else if (!overlong) {
        if (line.length >= 128) { overlong = true; line = ""; }
        else line += String.fromCharCode(byte);
      }
    }
  }
  return {found, ids};
}
export function appendMailArrival(directory: number, directoryPath: string, messageId: string,
  faults?: DurabilityObserver): void {
  if (!isValidMessageId(messageId)) throw new StoreError("STORE_CORRUPT", "arrival has an invalid message identity");
  const path = join(directoryPath, "arrival");
  const fd = openOwnedAppendFile(directory, "arrival");
  let nextCache: CachedArrivals | null = null;
  try {
    const stat = fstatSync(fd, {bigint:true}), size = Number(stat.size);
    const previous = cached.get(path);
    if (previous) { cached.delete(path); cachedRecords -= previous.ids.size; }
    // Interrupted writes/flushes cannot leave a trusted negative.
    const observed = previous !== undefined && unchanged(previous.stat, stat)
      ? {found:previous.ids.has(messageId),ids:previous.ids} : scanArrivals(fd,size,messageId);
    const last = Buffer.alloc(1);
    if (size > 0 && readSync(fd, last, 0, 1, size - 1) !== 1)
      throw new StoreError("BROKER_UNAVAILABLE", "arrival journal tail could not be observed");
    // Preserve an interrupted append, but keep the next complete record on its
    // own line. A failed append does not authorize materialized or succeeded.
    const bytes = observed.found ? Buffer.alloc(0) : Buffer.from(`${size === 0 || last[0] === 0x0a ? "" : "\n"}${Date.now()} ${messageId}\n`);
    for (let offset = 0; offset < bytes.length;) {
      faultAt(faults, "file-write", "before", path);
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written === 0) throw new StoreError("BROKER_UNAVAILABLE", "arrival journal append made no progress");
      offset += written;
      faultAt(faults, "file-write", "after-visible", path);
    }
    faultAt(faults, "file-fsync", "ambiguous", path);
    fsyncSync(fd);
    faultAt(faults, "file-fsync", "after-visible", path);
    if (observed.ids && (bytes.length === 0 || size === 0 || last[0] === 0x0a)) {
      observed.ids.add(messageId);
      if (observed.ids.size <= CACHE_RECORDS) nextCache = {stat:fstatSync(fd,{bigint:true}),ids:observed.ids};
    }
  } finally { closeSync(fd); }
  fsyncHeldDir(directory, directoryPath, faults);
  if (nextCache) {
    while (cached.size >= 32 || cachedRecords + nextCache.ids.size > CACHE_RECORDS) {
      const oldest = cached.keys().next().value!;
      cachedRecords -= cached.get(oldest)!.ids.size; cached.delete(oldest);
    }
    cached.set(path, nextCache); cachedRecords += nextCache.ids.size;
  }
}
