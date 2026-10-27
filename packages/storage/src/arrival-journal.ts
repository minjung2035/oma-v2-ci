/** A delivery arrival is durable only after the whole record and its name.
 * The caller keeps the inbox directory pinned through publication and append. */
import { closeSync, fstatSync, fsyncSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { isValidMessageId } from "@oma/domain/identifiers";
import { openOwnedAppendFile } from "./directory.js";
import { faultAt, fsyncHeldDir, type DurabilityObserver } from "./durable-fs.js";

export function appendMailArrival(directory: number, directoryPath: string, messageId: string,
  faults?: DurabilityObserver): void {
  if (!isValidMessageId(messageId)) throw new StoreError("STORE_CORRUPT", "arrival has an invalid message identity");
  const path = join(directoryPath, "arrival");
  const fd = openOwnedAppendFile(directory, "arrival");
  try {
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    if (size > 0 && readSync(fd, last, 0, 1, size - 1) !== 1)
      throw new StoreError("BROKER_UNAVAILABLE", "arrival journal tail could not be observed");
    // Preserve an interrupted append, but keep the next complete record on its
    // own line. A failed append does not authorize materialized or succeeded.
    const bytes = Buffer.from(`${size === 0 || last[0] === 0x0a ? "" : "\n"}${Date.now()} ${messageId}\n`);
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
  } finally { closeSync(fd); }
  fsyncHeldDir(directory, directoryPath, faults);
}
