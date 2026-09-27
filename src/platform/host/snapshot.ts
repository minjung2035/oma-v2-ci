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
import { constants, copyFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "../../domain/errors.js";
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

function publish(store: SnapshotStore, id: string, take: (partial: string) => Promise<boolean>): Promise<string> {
  const partial = join(store.dir, `${id}.partial`);
  const final = join(store.dir, `${id}.img`);
  return take(partial).then(kept => {
    if (!kept) { rmSync(partial, { force: true }); throw new StoreError("BROKER_UNAVAILABLE", "the backup could not be made; try again"); }
    renameSync(partial, final);
    return final;
  }, error => { rmSync(partial, { force: true }); throw error; });
}

/** With the VM stopped the disk is quiescent as it is. */
export function snapshotStopped(store: SnapshotStore, id: string): Promise<string> {
  return publish(store, id, async partial => { (store.clone ?? apfsClone)(store.statePath, partial); return true; });
}

/** With the VM running: maintenance, every running society stopped, a
 * freeze for the clone. Answers the societies that were stopped, for the UI
 * to reopen. */
export async function snapshotRunning(store: SnapshotStore, link: GuestLink, id: string): Promise<{ path: string; stopped: string[] }> {
  const key = `snapshot-${id}`;
  const society = await link.json("society");
  const stopped: string[] = [];
  try {
    await society.request("maintenance.begin", {}, key);
    try {
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
    } finally { await society.request("maintenance.end", {}, key).catch(() => undefined); }
  } finally { society.close(); }
}

/** MAC-661: space before count. The newest `keep` stay, and the update's own
 * snapshot until the update is settled; beyond that, the oldest go first. */
export function pruneSnapshots(dir: string, keep: number, protect: ReadonlySet<string>): string[] {
  const snapshots = readdirSync(dir).filter(name => name.endsWith(".img"))
    .map(name => ({ name, at: statSync(join(dir, name)).mtimeMs })).sort((a, b) => b.at - a.at);
  const removed: string[] = [];
  let kept = 0;
  for (const snapshot of snapshots) {
    if (protect.has(snapshot.name)) continue;
    if (kept < keep) { kept += 1; continue; }
    rmSync(join(dir, snapshot.name));
    removed.push(snapshot.name);
  }
  return removed;
}
