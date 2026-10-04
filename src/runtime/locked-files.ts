/** A7: the one locked read-modify-replace over engine-owned files. A writer
 * lock in the same directory serializes writers; inside it the update sees
 * the current bytes (undefined when the file is absent) and answers the
 * replacement, or undefined to leave the file untouched. Read and write keep
 * the user-file guarantees: bounded, single-named, atomically replaced. */
import { join } from "node:path";
import { withCleanup } from "../process/cleanup.js";
import { ProcessLock } from "./process-lock.js";
import { ensureOwnedUserDirectory, ensureUserDirectory, readUserFile, replaceUserFile } from "./user-files.js";

function lockedReplace(ensure: (directory: string) => void, directory: string, name: string, bound: number,
  update: (current: string | undefined) => string | undefined): void {
  ensure(directory);
  const lock = ProcessLock.acquire(join(directory, "oma-settings.lock"));
  withCleanup(() => {
    const path = join(directory, name);
    const current = readUserFile(path, bound, { singleName: true });
    const next = update(current ?? undefined);
    if (next !== undefined && next !== current) replaceUserFile(path, next);
  }, () => lock.close());
}

export function lockedUserReplace(directory: string, name: string, bound: number,
  update: (current: string | undefined) => string | undefined): void {
  lockedReplace(ensureUserDirectory, directory, name, bound, update);
}

/** `lockedUserReplace` for a directory oma owns (the agent directory and its
 * tails): `ownedFrom` names the first component oma itself made, and every
 * component from it down is repaired before the lock is taken -- a mode-000
 * `.engine` or `.engine/themes` a same-UID stray left cannot wedge the
 * replace. The ancestors above it are the user's and are never rewritten. */
export function lockedOwnedReplace(directory: string, ownedFrom: string, name: string, bound: number,
  update: (current: string | undefined) => string | undefined): void {
  lockedReplace(other => ensureOwnedUserDirectory(other, ownedFrom), directory, name, bound, update);
}
