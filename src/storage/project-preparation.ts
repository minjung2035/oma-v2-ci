/** P0-4/FS-005: a snapshot's owned preparation, held until its consumer ends.
 * Every Git child inherits the lease; an unobserved child keeps the tree. */
import { constants, mkdirSync } from "node:fs";
import { join } from "node:path";
import { entryAt, openBeneath, withinDirectory } from "./contained-fs.js";
import { removeOwnedFile } from "./directory.js";
import { TreeLease, collectLeasedTree } from "./tree-lease.js";

export interface ProjectPreparation {
  readonly path: string;
  readonly descriptor: number;
  openContent(): number;
  dispose(): void;
}

/** Linux society state: no mutation resolves an unchecked parent pathname. */
export function prepareProjectDirectory(path: string): ProjectPreparation {
  const lease = TreeLease.take(path, true);
  let made = false;
  try {
    withinDirectory(path, (parent, name) => { mkdirSync(entryAt(parent, name), { mode: 0o700 }); made = true; });
    return {
      path, get descriptor() { return lease.descriptor; },
      openContent: () => withinDirectory(join(path, "content"), (parent, name) =>
        openBeneath(parent, name, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)),
      dispose() {
        // Even a failed close is not proof of a child having exited. The
        // collector's fresh lock observation alone permits removal.
        disposeProjectPreparation(() => lease.release(), () => { collectLeasedTree(path); });
      },
    };
  } catch (error) {
    try { disposeProjectPreparation(() => lease.release(), () => {
      if (made) collectLeasedTree(path); else removeOwnedFile(`${path}.lease`);
    }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "snapshot preparation and cleanup failed"); }
    throw error;
  }
}

/** P0-4: attempt both ownership releases; a secondary error never replaces
 * the first. Releasing our hold is not proof that a child's hold ended. */
export function disposeProjectPreparation(release: () => void, collect: () => void): void {
  const failures: unknown[] = [];
  try { release(); } catch (error) { failures.push(error); }
  try { collect(); } catch (error) { failures.push(error); }
  if (failures.length > 1) throw new AggregateError(failures, "snapshot lease release and collection failed");
  if (failures.length === 1) throw failures[0];
}
