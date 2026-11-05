/** CTX-004 / FS-002: revision bytes first, derived current link last.
 * Only a new publication's unique temporary tree is cleaned here. The accepted
 * source/commit-work and an existing revision are never removed or regenerated.
 * Context files use fixed 0644; mail's immutable-file 0444 policy is separate.
 */
import { constants, closeSync, fchmodSync, fstatSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ContextEntry } from "@oma/contracts";
import { generateOperationId } from "@oma/native/identity";
import { isValidFullOid } from "@oma/domain/identifiers";
import { contextRevisionLinkFor } from "@oma/domain/derived";
import { contextEntriesCheck } from "@oma/domain/context-policy";
import { StoreError } from "@oma/domain/errors";
import { readContextEntry } from "./context-files.js";
import { ensureOwnedDurableDirectory, fsyncHeldDir, fsyncTree, writeExclusiveFsyncedEntry } from "./durable-fs.js";
import { publishStagedDirectoryAt, replaceDerivedSymlinkAt } from "./staged-tree.js";
import { closeEvery, openBeneath, openDirectory } from "@oma/native/files";
import { openOwnedDirectory, removeOwnedTreeAt } from "./directory.js";
import { withCleanup } from "@oma/native/cleanup";
import { directoryNames, mkdirAt, unlinkAt } from "@oma/file-descriptors";
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
function sealRevision(directory: number, entries: readonly ContextEntry[]): void {
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
}

/** Mechanism only. The context coordinator must validate the accepted plan and
 * fresh canonical-ref evidence before calling this trusted-root materializer.
 */
export function publishContextRevision(
  worldDir: string, candidate: string, entries: readonly ContextEntry[], source: string | number,
  control: { readonly directoryFd?: number } = {},
): void {
  const invalid = contextEntriesCheck(entries, { requireSorted: true });
  if (invalid || !isValidFullOid(candidate)) throw new StoreError("STORE_CORRUPT", invalid ?? "invalid context revision");
  let world: number | undefined, context: number | undefined, revisions: number | undefined, sourceDirectory: number | undefined;
  const ensure = (parent: number, name: string, label: string): number => {
    try { mkdirAt(parent, name, 0o755); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const child = openOwnedDirectory(parent, name);
    try { fsyncHeldDir(child, label); fsyncHeldDir(parent, dirname(label)); return child; }
    catch (error) { return withCleanup(() => { throw error; }, () => closeSync(child)); }
  };
  return withCleanup(() => {
    sourceDirectory = typeof source === "number" ? source : openDirectory(source);
    if (!fstatSync(sourceDirectory).isDirectory()) throw new StoreError("STORE_CORRUPT", "context source is not a directory");
    if (control.directoryFd === undefined) ensureOwnedDurableDirectory(worldDir, worldDir, 0o755);
    world = control.directoryFd ?? openDirectory(worldDir);
    const root = fstatSync(world);
    if (!root.isDirectory()) throw new StoreError("STORE_CORRUPT", "context publication root is not a directory");
    if ((root.mode & 0o700) !== 0o700) fchmodSync(world, (root.mode & 0o7777) | 0o700);
    context = ensure(world, "context", join(worldDir, "context"));
    revisions = ensure(context, "revisions", join(worldDir, "context", "revisions"));
    let present = true;
    try { statAt(revisions, candidate); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; present = false; }
    if (!present) {
      const name = `.prepare-${candidate}-${generateOperationId()}`, temporary = join(worldDir, "context", "revisions", name);
      const lease = TreeLease.take(temporary, false, { directoryFd: revisions });
      withCleanup(() => {
        mkdirAt(revisions!, name, 0o755);
        const tree = openBeneath(revisions!, name, constants.O_RDONLY | constants.O_DIRECTORY);
        withCleanup(() => {
          for (const entry of entries) {
            const bytes = readContextEntry(sourceDirectory!, entry);
            let parent = tree;
            if (entry.path.startsWith("decisions/")) parent = ensure(tree, "decisions", join(temporary, "decisions"));
            withCleanup(() => writeExclusiveFsyncedEntry(parent, entry.path.split("/").at(-1)!, join(temporary, entry.path), bytes, 0o644),
              () => { if (parent !== tree) closeSync(parent); });
          }
          sealRevision(tree, entries);
          publishStagedDirectoryAt(revisions!, name, revisions!, candidate,
            root => verifyContextRevision(root, entries, true), "context-single-link");
        }, () => closeSync(tree));
      }, () => withCleanup(() => {
        removeOwnedTreeAt(revisions!, name);
        try { unlinkAt(revisions!, leasePathOf(name)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        fsyncHeldDir(revisions!, join(worldDir, "context", "revisions"));
      }, () => lease.release()));
    }
    const destination = openBeneath(revisions, candidate, constants.O_RDONLY | constants.O_DIRECTORY);
    withCleanup(() => sealRevision(destination, entries), () => closeSync(destination));
    replaceDerivedSymlinkAt(context, "current", join(worldDir, "context", "current"), contextRevisionLinkFor(candidate));
  }, () => closeEvery(revisions, context, typeof source === "string" ? sourceDirectory : undefined,
    control.directoryFd === undefined ? world : undefined));
}
