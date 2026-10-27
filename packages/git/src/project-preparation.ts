import { mkdirAt } from "@oma/file-descriptors";
/** P0-4/FS-005: a snapshot's owned preparation, held until its consumer ends.
 * Every Git child inherits the lease; an unobserved child keeps the tree. */
import { constants } from "node:fs";
import { closeEvery, openBeneath, withinDirectory } from "@oma/native/files";
import { openOwnedDirectoryPath, removeOwnedFile } from "@oma/storage/directory";
import { TreeLease, collectLeasedTree } from "@oma/storage/tree-lease";


/** Owned state: no mutation resolves an unchecked parent pathname. */
export function prepareProjectDirectory(path: string): ProjectPreparation {
  const lease = TreeLease.take(path, true);
  let made = false;
  let directory: number | undefined;
  try {
    withinDirectory(path, (parent, name) => { mkdirAt(parent, name, 0o700); made = true; });
    directory = openOwnedDirectoryPath(path);
    return {
      path, get descriptor() { return lease.descriptor; },
      openContent: (index = 0) => {
        if (directory === undefined) throw new Error("snapshot preparation is disposed");
        return openBeneath(directory, projectContentName(index), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
      },
      readContent: (index = 0) => {
        if (directory === undefined) throw new Error("snapshot preparation is disposed");
        return openBeneath(directory, projectContentName(index), constants.O_RDONLY | constants.O_NOFOLLOW);
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


export interface ProjectPreparation {
  readonly path: string;
  readonly descriptor: number;
  openContent(index?: number): number;
  readContent(index?: number): number;
  dispose(): void;
}

/** Private spool names, independent of untrusted project filenames. */
export function projectContentName(index = 0): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new TypeError("invalid snapshot content index");
  return index === 0 ? "content" : `content-${index}`;
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
