/** A7: the one locked read-modify-replace over engine-owned files. A writer
 * lock in the same directory serializes writers; inside it the update sees
 * the current bytes (undefined when the file is absent) and answers the
 * replacement, or undefined to leave the file untouched. Read and write keep
 * the user-file guarantees: bounded, single-named, atomically replaced. */
import { join } from "node:path";
import { withCleanup } from "../process/cleanup.js";
import { ProcessLock } from "./process-lock.js";
import { ensureUserDirectory, readUserFile, replaceUserFile } from "./user-files.js";

export function lockedUserReplace(directory: string, name: string, bound: number,
  update: (current: string | undefined) => string | undefined): void {
  ensureUserDirectory(directory);
  const lock = ProcessLock.acquire(join(directory, "oma-settings.lock"));
  withCleanup(() => {
    const path = join(directory, name);
    const current = readUserFile(path, bound, { singleName: true });
    const next = update(current ?? undefined);
    if (next !== undefined && next !== current) replaceUserFile(path, next);
  }, () => lock.close());
}
