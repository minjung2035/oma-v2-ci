/** Snapshots of the state disk (macos-platform §8.4, MAC-619..622, MAC-661).
 *
 * A snapshot is an APFS clone of `state.img` (`COPYFILE_FICLONE_FORCE`,
 * which is clonefile(2) on macOS), taken only at a quiescent point (REC-005):
 * with the VM stopped, or with every society stopped through its own
 * shutdown and the file system frozen for the moment of the clone. No DB is
 * opened for it (MAC-619). A copy whose consistency is not proven -- a stop
 * whose outcome is unknown, a freeze the deadline ended before the thaw -- is
 * discarded, never kept as a snapshot (MAC-622, P0-5).
 */
import { constants, copyFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { StoreError } from "../../domain/errors.js";
import { withAsyncCleanup } from "../../process/cleanup.js";
import { collectTemporaries, discardTemporary, publishMade, removeHostStaged, temporaryPath } from "./files.js";
import type { GuestLink } from "./guest-link.js";

export interface SnapshotStore {
  readonly dir: string;
  readonly statePath: string;
  /** The clone itself; injectable because it exists only on APFS. */
  readonly clone?: (from: string, to: string) => void;
  /** How long the file system may stay frozen for the clone. */
  readonly freezeMs?: number;
}
const apfsClone = (from: string, to: string): void => { copyFileSync(from, to, constants.COPYFILE_FICLONE_FORCE); };

/** A snapshot id's alphabet: a plain filename's characters. The image
 * version's alphabet (`image.ts`, `host-guest.ts`) is a subset -- `+`
 * included -- so `update-<version>` is always an id this accepts, and a
 * version's `+build` suffix cannot refuse the update's own first boot.
 * host-api.ts checks this same constant at the wire. */
export const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,99}$/;

/** P0V-103 (F-08, G12-04): a snapshot's name carries its place in the
 * order snapshots were made -- `<sequence>-<id>.img` -- because the order is
 * what pruning keeps by, and a clone's time is the disk's, not the
 * snapshot's (and the wall clock can go back). */
const SNAPSHOT = /^(\d{8})-(.+)\.img$/;
function sequenceOf(name: string): number { const match = SNAPSHOT.exec(name); return match === null ? -1 : Number(match[1]); }

/** The id a published snapshot's name carries, or null for a name that is
 * not a snapshot's. Matching against this -- never the name's tail -- is
 * what keeps a user id that merely ENDS in another id's bytes (`x-update-…`
 * beside `update-…`) from reading as that id. */
export function snapshotIdOf(name: string): string | null {
  const match = SNAPSHOT.exec(name);
  return match !== null && SNAPSHOT_ID.test(match[2]!) ? match[2]! : null;
}

/** The snapshots directory's own start, under the host lock: what a dead
 * service left of a snapshot it did not finish is removed. */
export function openSnapshotStore(dir: string): string[] { return collectTemporaries(dir); }

/** P0V-103: the clone is made as a temporary, flushed, and published under
 * a new name without replacing one -- so a snapshot that exists is a whole
 * one, and one that was not finished is a temporary the store's start
 * removes. */
function publish(store: SnapshotStore, id: string, take: (partial: string) => Promise<boolean>): Promise<string> {
  if (!SNAPSHOT_ID.test(id)) return Promise.reject(new StoreError("INVALID_REQUEST", "a snapshot id is a plain name"));
  const sequence = 1 + Math.max(-1, ...readdirSync(store.dir).map(sequenceOf));
  const name = `${String(sequence).padStart(8, "0")}-${id}.img`;
  const partial = temporaryPath(store.dir, name);
  return withAsyncCleanup(async () => {
    if (!await take(partial)) throw new StoreError("BROKER_UNAVAILABLE", "the backup could not be made; try again");
    if (publishMade(partial, store.dir, name) === "existing") throw new StoreError("BROKER_UNAVAILABLE", "another backup took this name; try again");
    return join(store.dir, name);
  }, () => discardTemporary(partial));
}

/** With the VM stopped the disk is quiescent as it is. */
export function snapshotStopped(store: SnapshotStore, id: string): Promise<string> {
  return publish(store, id, async partial => { (store.clone ?? apfsClone)(store.statePath, partial); return true; });
}

/** With the VM running: maintenance, every running society stopped, a
 * freeze for the clone. Answers the societies that were stopped, for the UI
 * to reopen. */
export async function snapshotRunning(store: SnapshotStore, link: GuestLink, id: string): Promise<{ path: string; stopped: string[] }> {
  // The maintenance latch's key is a request key, whose alphabet is narrower
  // than the id's ("+" is a legal id): the digest carries the id injectively.
  const key = `snapshot-${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
  const society = await link.json("society");
  const stopped: string[] = [];
  try {
    await society.request("maintenance.begin", {}, key);
    // NB-27: the latch is returned on every path, and a return that fails is
    // told -- with the snapshot's own failure kept primary -- never left
    // silently holding society.open shut.
    return await withAsyncCleanup(async () => {
      const listed = await society.request("society.list", {}) as { societies: { society: string; running: boolean }[] };
      for (const entry of listed.societies.filter(item => item.running)) {
        const closed = await society.request("society.close", { society: entry.society, mode: "stop" }) as { state: string };
        // P0-5: a stop not seen to end is not a quiescent society.
        if (closed.state !== "stopped") throw new StoreError("BROKER_UNAVAILABLE", "a society did not stop; no backup was made");
        stopped.push(entry.society);
      }
      const control = await link.json("control");
      try {
        const path = await publish(store, id, async partial => {
          await control.request("fs.freeze", { deadlineMs: store.freezeMs ?? 5000 });
          let cloned: Error | null = null;
          try { (store.clone ?? apfsClone)(store.statePath, partial); } catch (error) { cloned = error as Error; }
          // MAC-622: only a thaw that found the freeze still in place proves
          // the clone was taken while nothing could write.
          const { thawed } = await control.request("fs.thaw", {}) as { thawed: boolean };
          if (cloned !== null) throw cloned;
          return thawed === true;
        });
        return { path, stopped };
      } finally { control.close(); }
    }, () => society.request("maintenance.end", {}, key).then(() => undefined));
  } finally { society.close(); }
}

/** MAC-661: space before count. The newest `keep` stay, and the update's own
 * snapshot until the update is settled; beyond that, the oldest go first --
 * by the order they were made (G12-04), a name without one being older than
 * any with one. */
export function pruneSnapshots(dir: string, keep: number, protect: ReadonlySet<string>): string[] {
  const snapshots = readdirSync(dir).filter(name => name.endsWith(".img") && !name.startsWith("."))
    .sort((a, b) => sequenceOf(b) - sequenceOf(a) || (a < b ? 1 : a > b ? -1 : 0)).map(name => ({ name }));
  const removed: string[] = [];
  let kept = 0;
  for (const snapshot of snapshots) {
    if (protect.has(snapshot.name)) continue;
    if (kept < keep) { kept += 1; continue; }
    removeHostStaged(join(dir, snapshot.name));
    removed.push(snapshot.name);
  }
  return removed;
}
