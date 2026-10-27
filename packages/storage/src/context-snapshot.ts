/** CTX-004 / FS-002: revision bytes first, derived current link last.
 * Only a new publication's unique temporary tree is cleaned here. The accepted
 * source/commit-work and an existing revision are never removed or regenerated.
 * Context files use fixed 0644; mail's immutable-file 0444 policy is separate.
 */
import { constants, closeSync, fchmodSync, fstatSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ContextEntry } from "@oma/contracts";
import { generateOperationId } from "@oma/native/identity";
import { isValidFullOid } from "@oma/domain/identifiers";
import { contextRevisionLinkFor } from "@oma/domain/derived";
import { contextEntriesCheck } from "@oma/domain/context-policy";
import { StoreError } from "@oma/domain/errors";
import { contextRevisionPathAt } from "@oma/domain/paths";
import { assertContextDirectory, readContextEntry } from "./context-files.js";
import { ensureOwnedDurableDirectory, fsyncDir, fsyncTree, writeExclusiveFsyncedFile } from "./durable-fs.js";
import { publishStagedDirectory, replaceDerivedSymlink } from "./staged-tree.js";
import { openBeneath, openDirectory } from "@oma/native/files";
import { removeOwnedFile, removeOwnedTree } from "./directory.js";
import { withCleanup } from "@oma/native/cleanup";
import { directoryNames } from "@oma/file-descriptors";
import { statAt } from "@oma/native/posix-files";
import { TreeLease, leasePathOf } from "./tree-lease.js";

/** Complete permitted tree verification; no writes or silent byte repair.
 * Mode validation is explicit because a new temporary has not been sealed yet.
 */
export function verifyContextRevision(root: string | number, entries: readonly ContextEntry[], fixedModes = false): void {
  const invalid = contextEntriesCheck(entries, { requireSorted: true });
  if (invalid) throw new StoreError("STORE_CORRUPT", invalid);
  const directory = typeof root === "string" ? openDirectory(root) : root;
  try {
    if (fixedModes && (fstatSync(directory).mode & 0o777) !== 0o555) throw new StoreError("STORE_CORRUPT", "context revision directory mode differs");
    const expected = new Set(entries.map(entry => entry.path));
    const walk = (parent: number, relative = ""): void => {
      for (const name of directoryNames(parent)) {
        const path = relative ? `${relative}/${name}` : name;
        const stat = statAt(parent, name);
        if (stat.isDirectory() && path === "decisions" && entries.some(entry => entry.path.startsWith("decisions/"))) {
          const child = openBeneath(parent, name, constants.O_RDONLY | constants.O_DIRECTORY);
          try {
            if (fixedModes && (fstatSync(child).mode & 0o777) !== 0o555) throw new StoreError("STORE_CORRUPT", "context decisions directory mode differs");
            walk(child, path);
          } finally { closeSync(child); }
        } else if (!stat.isFile() || stat.nlink !== 1 || !expected.has(path) || (fixedModes && (stat.mode & 0o777) !== 0o644)) {
          throw new StoreError("STORE_CORRUPT", `unexpected context entry or mode ${path}`);
        }
      }
    };
    walk(directory);
    for (const entry of entries) readContextEntry(directory, entry, fd => {
      if (fixedModes && (fstatSync(fd).mode & 0o777) !== 0o644) throw new StoreError("STORE_CORRUPT", "context file mode differs");
    });
  } finally { if (typeof root === "string") closeSync(directory); }
}
function sealRevision(root: string, entries: readonly ContextEntry[]): void {
  const directory = openDirectory(root);
  try {
    verifyContextRevision(directory, entries);
    // Metadata effects act on the exact file descriptor whose bytes were checked.
    for (const entry of entries) readContextEntry(directory, entry, fd => fchmodSync(fd, 0o644));
    if (entries.some(entry => entry.path.startsWith("decisions/"))) {
      const decisions = openBeneath(directory, "decisions", constants.O_RDONLY | constants.O_DIRECTORY);
      try { fchmodSync(decisions, 0o555); } finally { closeSync(decisions); }
    }
    fchmodSync(directory, 0o555);
    fsyncTree(directory, "context-single-link");
    verifyContextRevision(directory, entries, true);
  } finally { closeSync(directory); }
}

/** Mechanism only. The context coordinator must validate the accepted plan and
 * fresh canonical-ref evidence before calling this trusted-root materializer.
 */
export function publishContextRevision(
  worldDir: string, candidate: string, entries: readonly ContextEntry[], source: string,
): void {
  const invalid = contextEntriesCheck(entries, { requireSorted: true });
  if (invalid || !isValidFullOid(candidate)) throw new StoreError("STORE_CORRUPT", invalid ?? "invalid context revision");
  assertContextDirectory(source);
  const revisions = join(worldDir, "context", "revisions");
  ensureOwnedDurableDirectory(revisions, worldDir, 0o755);
  const destination = contextRevisionPathAt(worldDir, candidate);
  if (!lstatSync(destination, { throwIfNoEntry: false })) {
    const temporary = join(revisions, `.prepare-${candidate}-${generateOperationId()}`);
    // AV-20261003-19 (P0-4): the temporary is lease-owned from creation, so a
    // publication interrupted between creation and the atomic rename leaves a
    // residue whose quiescence startup recovery can prove -- not an ownerless
    // tree with no recoverable ownership.
    const lease = TreeLease.take(temporary);
    // Everything after `take` is inside the same release-on-failure guard:
    // a failure while the tree is being made must not strand the lease fd
    // or leave its ".lease" reading active until process exit (AV-18 shape).
    // withCleanup owns the shape: a cleanup failure beside an in-flight
    // publish failure is retained beside it (P0-4), never substituted for it,
    // and the release still runs exactly once.
    withCleanup(() => {
      ensureOwnedDurableDirectory(temporary, worldDir, 0o755);
      for (const entry of entries) {
        const bytes = readContextEntry(source, entry);
        const target = join(temporary, entry.path);
        ensureOwnedDurableDirectory(dirname(target), worldDir, 0o755);
        writeExclusiveFsyncedFile(target, bytes, 0o644);
      }
      sealRevision(temporary, entries);
      publishStagedDirectory(temporary, destination, root => verifyContextRevision(root, entries, true), "context-single-link");
    }, () => withCleanup(() => {
      // Any residue this leaves -- tree, lease or both -- is named for the
      // startup collector, which removes it once the lease proves quiescence.
      removeOwnedTree(temporary);
      removeOwnedFile(leasePathOf(temporary));
    }, () => lease.release()));
  }
  sealRevision(destination, entries);
  replaceDerivedSymlink(join(worldDir, "context", "current"), contextRevisionLinkFor(candidate));
}
