/** TUI-004/REC-007: which `oma` owns a society, for as long as it owns it.
 *
 * Ownership used to be a fact about a child process: the broker took a lock on
 * the society's run root, said it was ready, and the host read that as "I own
 * this society". That definition has a hole that cannot be patched, only
 * replaced. The lock lives and dies with the broker, so every gap in the
 * broker's life -- the back-off between a crash and a restart, and the whole
 * time after restarts run out -- is a gap in ownership, while the engine the
 * host started for that ownership keeps running. Another `oma` walks into the
 * gap, takes the society and starts a second engine on it: two writers of one
 * private workspace and one session history.
 *
 * So ownership is not derived from the broker any more. The host takes this
 * lease itself, before it writes anything or starts anything, and holds it for
 * its whole life. A broker that crashes and restarts never touches it, so the
 * gaps close. A host that gives up -- its broker cannot be kept running, or
 * the society turns out to be someone else's -- releases it, and releasing it
 * is the same act as ending the engine: nothing that exists because of the
 * lease outlives it.
 *
 * The broker keeps its own lock. That one answers a different question -- may
 * this process be the society's single SQLite writer -- and still refuses a
 * broker started by hand. This answers "may this process run the society's one
 * engine", and only a host asks it.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ProcessLock } from "./process-lock.js";

/** The lease file, in the run root: ownership is a fact about this boot, not
 * something a stale file in the state tree can claim after a reboot. */
export const SOCIETY_LEASE_FILE = "society.lease";

export interface SocietyLease {
  /** The lease file this host holds. */
  readonly path: string;
  /** Gives the society up. Idempotent; after it, another `oma` may take it, so
   * everything this host ran on the strength of the lease must already be
   * stopped when this is called. */
  release(): void;
}

/** Takes the society for this process, or answers null when another process
 * holds it. Every other failure throws: "someone else owns this" and "this
 * could not be locked at all" are different answers, and a caller that starts
 * an engine on the first must not be handed the second. */
export function tryHoldSociety(runRoot: string): SocietyLease | null {
  mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  const lock = ProcessLock.tryAcquire(join(runRoot, SOCIETY_LEASE_FILE));
  if (lock === null) return null;
  let released = false;
  return {
    path: lock.path,
    release(): void {
      if (released) return;
      released = true;
      lock.close();
    },
  };
}
