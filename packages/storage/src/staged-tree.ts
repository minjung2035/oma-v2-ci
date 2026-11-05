import { directoryNames, unlinkAt } from "@oma/file-descriptors";
import { renameAt, symlinkAt, statAt } from "@oma/native/posix-files";
/** CTX-004 / FS-002: staged directories and derived links have distinct owners.
 * The caller serializes publication in a trusted root and validates artifact
 * identity. These syscalls do not establish a new kernel no-replace guarantee.
 */
import { closeSync, constants, fstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { fsyncHeldDir, fsyncTree, type TreeFlushPolicy } from "./durable-fs.js";
import { assertDirectory } from "./directory.js";
import { openBeneath, withinDirectory } from "@oma/native/files";

/** Caller prepares file contents and proves artifact identity. An existing
 * destination is verified and flushed first: staging and its parent may already
 * be gone after an earlier successful rename. ENOENT from verification is damage,
 * NOT proof that the destination is absent. Nothing here merges or removes either
 * tree. On "existing" any surviving staging remains caller-owned. A post-rename
 * error is ambiguous, never permission to overwrite an observed destination.
 * Empty/raced destination handling remains bounded by the caller's trusted
 * serialized publication authority and the S-06 filesystem admission gate.
 * The explicit flush policy distinguishes context single-link entries from
 * legitimate workspace symlinks; it never enables following a link target.
 */
export function publishStagedDirectory(
  staging: string,
  destination: string,
  verify: (root: string) => void,
  policy: TreeFlushPolicy = "regular-files",
): "published" | "existing" {
  if (staging === destination) throw new StoreError("STORE_CORRUPT", "staging and destination must differ");
  assertDirectory(dirname(destination));
  return withinDirectory(destination, (to, toName) => {
    let present = true;
    try { statAt(to, toName); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; present = false; }
    // Replay still works after staging and its parent have been collected.
    if (present) return existingStagedDirectory(to, toName, () => verify(destination), policy);
    assertDirectory(dirname(staging));
    return withinDirectory(staging, (from, fromName) => publishStagedDirectoryAt(from, fromName, to, toName,
      (_root, phase) => verify(phase === "staging" ? staging : destination), policy));
  });
}

/** Mutable current link: one owned link -> rename -> parent fsync. No target
 * is opened or recursively flushed. Context retains revision identity policy;
 * this primitive additionally rejects lexical escape in the relative target.
 */
export function replaceDerivedSymlink(path: string, target: string): void {
  assertDirectory(dirname(path));
  withinDirectory(path, (parent, name) => replaceDerivedSymlinkAt(parent, name, path, target));
}

/** The same derived-link operation in an already held publication directory. */
export function replaceDerivedSymlinkAt(parent: number, name: string, path: string, target: string): void {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0"))
    throw new StoreError("STORE_CORRUPT", "derived link requires one entry name");
  if (isAbsolute(target) || target.includes("\0") || target.split("/").some(part => part === "" || part === "." || part === ".."))
    throw new StoreError("STORE_CORRUPT", "derived link target must remain relative and contained");
  // Same rule as the derived file: the parent is resolved once and the link is
  // created, renamed and cleaned up through that descriptor only.
  // P0V-111 (G01r2-02): a link cannot carry a lock, so the proof that a
  // leftover link temporary of this name is dead is who writes it: this
  // synchronous call is its only writer, and the caller serializes
  // publication in its root (above). What a killed one left is removed
  // before the next link is made; a file, or another name's, is not.
  for (const entry of directoryNames(parent)) {
    if (!entry.startsWith(`.${name}.`) || !/\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/.test(entry)) continue;
    try { if (statAt(parent, entry).isSymbolicLink()) unlinkAt(parent, entry); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const temporaryName = `.${name}.${randomUUID()}.tmp`;
  symlinkAt(target, parent, temporaryName);
  let owned = true;
  try {
    renameAt(parent, temporaryName, parent, name); owned = false;
    fsyncHeldDir(parent, dirname(path));
  } finally {
    if (owned) {
      try { unlinkAt(parent, temporaryName); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      fsyncHeldDir(parent, dirname(path));
    }
  }
}

/** Staging and destination are leaves of retained directories. Verification
 * and both persistence barriers consume the opened tree, never its old path. */
export function publishStagedDirectoryAt(from: number, staging: string, to: number, destination: string,
    verify: (root: number, phase: "staging" | "destination") => void, policy: TreeFlushPolicy = "regular-files"): "published" | "existing" {
  for (const name of [staging, destination]) if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0"))
    throw new StoreError("STORE_CORRUPT", "staged publication requires one entry name");
  const sourceParent = fstatSync(from), destinationParent = fstatSync(to);
  if (sourceParent.dev === destinationParent.dev && sourceParent.ino === destinationParent.ino && staging === destination)
    throw new StoreError("STORE_CORRUPT", "staging and destination must differ");
  const existing = (): "existing" => existingStagedDirectory(to, destination,
    root => verify(root, "destination"), policy);
  try { statAt(to, destination); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; else return publish(); }
  return existing();
  function publish(): "published" | "existing" {
    const root = openBeneath(from, staging, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      verify(root, "staging"); fsyncTree(root, policy);
      try { renameAt(from, staging, to, destination); }
      catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; return existing(); }
      fsyncHeldDir(to, destination);
      if (sourceParent.dev !== destinationParent.dev || sourceParent.ino !== destinationParent.ino) fsyncHeldDir(from, staging);
      const published = openBeneath(to, destination, constants.O_RDONLY | constants.O_DIRECTORY);
      try {
        const expected = fstatSync(root), actual = fstatSync(published);
        if (actual.dev !== expected.dev || actual.ino !== expected.ino) throw new StoreError("STORE_CORRUPT", "published staged directory changed");
        verify(published, "destination");
      } finally { closeSync(published); }
      return "published";
    } finally { closeSync(root); }
  }
}

function existingStagedDirectory(parent: number, name: string, verify: (root: number) => void,
    policy: TreeFlushPolicy): "existing" {
  const root = openBeneath(parent, name, constants.O_RDONLY | constants.O_DIRECTORY);
  try { verify(root); fsyncTree(root, policy); fsyncHeldDir(parent, name); return "existing"; }
  finally { closeSync(root); }
}
