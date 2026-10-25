/** P0-4/FS-005: a snapshot's owned preparation, held until its consumer ends.
 * Every Git child inherits the lease; an unobserved child keeps the tree. */
import { constants, mkdirSync } from "node:fs";
import { closeEvery, entryAt, openBeneath, withinDirectory } from "@oma/native/files";
import { openOwnedDirectoryPath, removeOwnedFile } from "@oma/storage/directory";
import { TreeLease, collectLeasedTree } from "@oma/storage/tree-lease";

import { disposeProjectPreparation, projectContentName, type ProjectPreparation } from "./project-preparation.js";

/** Linux society state: no mutation resolves an unchecked parent pathname. */
export function prepareProjectDirectory(path: string): ProjectPreparation {
  const lease = TreeLease.take(path, true);
  let made = false;
  let directory: number | undefined;
  try {
    withinDirectory(path, (parent, name) => { mkdirSync(entryAt(parent, name), { mode: 0o700 }); made = true; });
    directory = openOwnedDirectoryPath(path);
    return {
      path, get descriptor() { return lease.descriptor; },
      openContent: (index = 0) => {
        if (directory === undefined) throw new Error("snapshot preparation is disposed");
        return openBeneath(directory, projectContentName(index), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
      },
      dispose() {
        // Even a failed close is not proof of a child having exited. The
        // collector's fresh lock observation alone permits removal.
        disposeProjectPreparation(() => {
          const held = directory; directory = undefined;
          disposeProjectPreparation(() => closeEvery(held), () => lease.release());
        }, () => { collectLeasedTree(path); });
      },
    };
  } catch (error) {
    try { disposeProjectPreparation(() => {
      const held = directory; directory = undefined;
      disposeProjectPreparation(() => closeEvery(held), () => lease.release());
    }, () => {
      if (made) collectLeasedTree(path); else removeOwnedFile(`${path}.lease`);
    }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "snapshot preparation and cleanup failed"); }
    throw error;
  }
}

