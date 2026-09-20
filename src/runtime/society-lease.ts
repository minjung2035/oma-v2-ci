/** TUI-004/REC-007: which `oma` owns a society, and what must be dead before
 * another one may have it.
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
 * its whole life.
 *
 * That alone still had a hole, and it is the one this module now closes. A
 * lease released by running code can only promise the order in which this
 * process made its calls, and `close()` on a child is a signal, not a death:
 * the host could send SIGKILL, release the lease, and be replaced by a second
 * `oma` whose engine starts while the first engine is still running. A host
 * that is itself SIGKILLed runs no code at all, and the kernel drops its lock
 * the instant it dies -- with its engine still alive.
 *
 * The lease is therefore not a lock a process holds. It is a lock an open file
 * description holds, and every process started because of the lease inherits a
 * descriptor onto that same description. flock releases only when the last of
 * them closes, so the society cannot pass to another host until the engine,
 * the broker and everything they started are gone -- whether this process
 * released it politely, crashed, or was killed outright. The fence is the
 * kernel's, not this code's, which is what makes it true on the paths where
 * this code never runs.
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
  /** The descriptor every process this lease pays for must inherit.
   *
   * Passing it to a child is not an optimisation and not a convenience: it is
   * what makes the child's death a precondition of the society changing hands.
   * A child started without it can outlive the lease. */
  readonly fence: number;
  /** Gives up this process's own hold. Idempotent.
   *
   * It does not, by itself, hand the society to anyone: any child still
   * holding the inherited descriptor keeps the lease held until it exits. That
   * is deliberate -- it means releasing can never be too early, only too late,
   * and a teardown that fails to wait for its engine degrades into waiting for
   * the kernel instead of into two engines on one society. */
  release(): void;
}

/** Takes the society for this process, or answers null when another process
 * holds it -- which now includes a process whose host is already gone but
 * whose engine is not. Every other failure throws: "someone else owns this"
 * and "this could not be locked at all" are different answers, and a caller
 * that starts an engine on the first must not be handed the second. */
export function tryHoldSociety(runRoot: string): SocietyLease | null {
  mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  const lock = ProcessLock.tryAcquire(join(runRoot, SOCIETY_LEASE_FILE));
  if (lock === null) return null;
  const fence = lock.descriptor;
  let released = false;
  return {
    path: lock.path,
    fence,
    release(): void {
      if (released) return;
      released = true;
      lock.close();
    },
  };
}
